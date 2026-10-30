import { ArticleStatus as S, Prisma, Role, type PaymentStatus } from '@prisma/client';
import { prisma } from '../config/prisma';
import { STATUS_LABELS } from '../constants/workflow';
import { links } from '../templates/links';
import { transact, type Actor } from '../utils/context';
import { ConflictError, NotFoundError, UnprocessableError } from '../utils/errors';
import { pageMeta, skipTake } from '../utils/pagination';
import { editorialCanAccess, loadArticleForEditorial } from './access';
import { AuditAction, recordAudit } from './audit.service';
import { notify, notifyMany, productionRecipients } from './notification.service';
import { getReviewsForEditor } from './review.service';
import { transitionArticle } from './workflow.service';

/** Row-level visibility filter applied to every editorial query: editors only see their own and unassigned articles. */
const scope = (user: Actor): Prisma.ArticleWhereInput => (user.role === Role.ADMIN ? {} : { OR: [{ editorId: null }, { editorId: user.id }] });

const listSelect = {
  id: true,
  submissionId: true,
  title: true,
  status: true,
  submittedAt: true,
  currentWordCount: true,
  wordLimitExceeded: true,
  subjectArea: { select: { id: true, name: true } },
  author: { select: { id: true, firstName: true, lastName: true, email: true } },
  editor: { select: { id: true, firstName: true, lastName: true } },
  payment: { select: { status: true, amount: true, currency: true } },
} satisfies Prisma.ArticleSelect;

export interface EditorialListQuery {
  page: number;
  pageSize: number;
  status?: S[];
  search?: string;
  subjectAreaId?: string;
  editorId?: string | 'unassigned';
  apcStatus?: PaymentStatus;
  wordLimitExceeded?: boolean;
  from?: Date;
  to?: Date;
  sortBy: 'submittedAt' | 'title' | 'status' | 'submissionId';
  sortOrder: 'asc' | 'desc';
}

export async function listArticles(user: Actor, q: EditorialListQuery) {
  const where: Prisma.ArticleWhereInput = {
    AND: [
      scope(user),
      {
        status: q.status?.length ? { in: q.status } : undefined,
        subjectAreaId: q.subjectAreaId,
        editorId: q.editorId === 'unassigned' ? null : q.editorId,
        payment: q.apcStatus ? { status: q.apcStatus } : undefined,
        wordLimitExceeded: q.wordLimitExceeded,
        submittedAt: q.from || q.to ? { gte: q.from, lte: q.to } : undefined,
        ...(q.search
          ? {
              OR: [
                { title: { contains: q.search, mode: 'insensitive' } },
                { submissionId: { contains: q.search, mode: 'insensitive' } },
                { author: { OR: [{ lastName: { contains: q.search, mode: 'insensitive' } }, { email: { contains: q.search, mode: 'insensitive' } }] } },
              ],
            }
          : {}),
      },
    ],
  };
  const [items, total] = await Promise.all([
    prisma.article.findMany({ where, select: listSelect, orderBy: { [q.sortBy]: q.sortOrder }, ...skipTake(q) }),
    prisma.article.count({ where }),
  ]);
  return { items: items.map((a) => ({ ...a, statusLabel: STATUS_LABELS[a.status] })), meta: pageMeta(q, total) };
}

export async function getArticle(user: Actor, articleId: string) {
  await loadArticleForEditorial(articleId, user);
  const a = await prisma.article.findUniqueOrThrow({
    where: { id: articleId },
    select: {
      ...listSelect,
      abstract: true,
      ethicsStatement: true,
      acceptedAt: true,
      closedAt: true,
      publishedAt: true,
      screeningRejected: true,
      coAuthors: { orderBy: { orderIndex: 'asc' }, select: { firstName: true, lastName: true, email: true, affiliation: true, isCorresponding: true } },
      keywords: { select: { keyword: true } },
      versions: { orderBy: { versionNumber: 'asc' }, select: { id: true, versionNumber: true, kind: true, wordCount: true, changeNote: true, createdAt: true, fileId: true, titlePageFileId: true } },
      decisions: { orderBy: { decidedAt: 'asc' }, select: { id: true, decision: true, fromStatus: true, toStatus: true, notes: true, authorMessage: true, decidedAt: true, decidedBy: { select: { id: true, firstName: true, lastName: true } } } },
      plagiarismChecks: { orderBy: { createdAt: 'desc' }, select: { id: true, status: true, source: true, provider: true, similarityScore: true, verdict: true, reportFileId: true, notes: true, errorMessage: true, completedAt: true, createdAt: true, versionId: true } },
      payment: true,
      productionTask: { select: { status: true, assignedTo: { select: { id: true, firstName: true, lastName: true } }, startedAt: true, completedAt: true } },
    },
  });
  const { keywords, ...rest } = a;
  const reviews = await getReviewsForEditor(articleId, user);
  return { ...rest, statusLabel: STATUS_LABELS[a.status], keywords: keywords.map((k) => k.keyword), reviews };
}

export async function getHistory(user: Actor, articleId: string) {
  await loadArticleForEditorial(articleId, user);
  const rows = await prisma.articleStatusHistory.findMany({
    where: { articleId },
    orderBy: { createdAt: 'asc' },
    select: { fromStatus: true, toStatus: true, reason: true, createdAt: true, actorRole: true, actor: { select: { id: true, firstName: true, lastName: true } } },
  });
  return rows.map((r) => ({ ...r, fromLabel: r.fromStatus ? STATUS_LABELS[r.fromStatus] : null, toLabel: STATUS_LABELS[r.toStatus] }));
}

export async function dashboard(user: Actor) {
  const base = scope(user);
  const [byStatus, pendingApplications, majorChanges, overdueReviews, recent] = await Promise.all([
    prisma.article.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
    prisma.reviewerApplication.count({ where: { status: 'PENDING' } }),
    prisma.correction.count({ where: { status: 'ESCALATED', article: base } }),
    prisma.reviewerAssignment.count({ where: { status: 'ASSIGNED', dueDate: { lt: new Date() }, article: base } }),
    prisma.article.findMany({ where: base, select: listSelect, orderBy: { submittedAt: 'desc' }, take: 8 }),
  ]);
  const count = (s: S) => byStatus.find((b) => b.status === s)?._count._all ?? 0;
  return {
    queues: {
      awaitingScreening: count(S.SUBMITTED) + count(S.UNDER_EDITORIAL_SCREENING),
      plagiarismCheck: count(S.PLAGIARISM_CHECK),
      readyForReviewerAssignment: count(S.READY_FOR_REVIEWER_ASSIGNMENT),
      underReview: count(S.UNDER_REVIEW),
      awaitingDecision: count(S.REVIEWS_RECEIVED) + count(S.UNDER_EDITORIAL_DECISION),
      majorContentChanges: majorChanges,
      pendingReviewerApplications: pendingApplications,
      overdueReviews,
    },
    totals: byStatus.map((b) => ({ status: b.status, label: STATUS_LABELS[b.status], count: b._count._all })),
    recentSubmissions: recent.map((a) => ({ ...a, statusLabel: STATUS_LABELS[a.status] })),
  };
}

// ───────────────────────────── screening ─────────────────────────────

export async function startScreening(articleId: string, actor: Actor) {
  return transact(async (tx) => {
    const article = await loadArticleForEditorial(articleId, actor, tx);
    const claimEditor = article.editorId === null && actor.role === Role.EDITOR;
    await transitionArticle(tx, articleId, S.UNDER_EDITORIAL_SCREENING, actor, { expectedFrom: S.SUBMITTED, data: claimEditor ? { editorId: actor.id } : undefined });
    await recordAudit(tx, { action: AuditAction.SCREENING_STARTED, entityType: 'Article', entityId: articleId, actor });
    return { status: S.UNDER_EDITORIAL_SCREENING, statusLabel: STATUS_LABELS[S.UNDER_EDITORIAL_SCREENING] };
  });
}

export async function screeningDecision(articleId: string, input: { decision: 'PROCEED' | 'REJECT'; notes?: string; authorMessage?: string }, actor: Actor) {
  return transact(async (tx) => {
    const article = await loadArticleForEditorial(articleId, actor, tx);
    const reject = input.decision === 'REJECT';
    const to = reject ? S.REJECTED_AT_SCREENING : S.PLAGIARISM_CHECK;
    const { from } = await transitionArticle(tx, articleId, to, actor, {
      expectedFrom: S.UNDER_EDITORIAL_SCREENING,
      reason: reject ? 'Rejected at initial screening' : 'Passed initial screening',
      data: reject ? { screeningRejected: true } : undefined,
    });
    const d = await tx.editorialDecision.create({
      data: {
        articleId,
        decision: reject ? 'REJECT_AT_SCREENING' : 'PROCEED_TO_PLAGIARISM_CHECK',
        fromStatus: from,
        toStatus: to,
        notes: input.notes,
        authorMessage: reject ? input.authorMessage : undefined,
        decidedById: actor.id,
      },
    });
    await recordAudit(tx, { action: AuditAction.SCREENING_DECISION, entityType: 'Article', entityId: articleId, actor, fromStatus: from, toStatus: to, metadata: { decision: input.decision, decisionId: d.id } });
    if (reject) {
      await notify(tx, {
        userId: article.authorId,
        type: 'article.rejected_at_screening',
        title: `Decision on ${article.submissionId}`,
        message: 'Your submission did not pass initial editorial screening and is closed.',
        template: 'screening_rejected',
        data: { submissionId: article.submissionId, title: article.title, message: input.authorMessage },
        entityType: 'Article',
        entityId: articleId,
        dedupeKey: `decision:${d.id}`,
      });
    }
    return { status: to, statusLabel: STATUS_LABELS[to] };
  });
}

// ───────────────────────────── editor assignment (admin) ─────────────────────────────

export async function assignEditor(articleId: string, editorId: string, actor: Actor) {
  return transact(async (tx) => {
    const article = await tx.article.findUnique({ where: { id: articleId } });
    if (!article) throw new NotFoundError('Article not found');
    if (['REJECTED_AT_SCREENING', 'REJECTED', 'PUBLISHED'].includes(article.status)) throw new ConflictError('This article is closed', 'ARTICLE_CLOSED');
    const editor = await tx.user.findFirst({ where: { id: editorId, role: Role.EDITOR, status: 'ACTIVE' }, select: { id: true } });
    if (!editor) throw new UnprocessableError('The selected user is not an active editor', 'INVALID_EDITOR', [{ field: 'editorId', message: 'Not an active editor' }]);
    await tx.article.update({ where: { id: articleId }, data: { editorId } });
    await recordAudit(tx, { action: AuditAction.ARTICLE_EDITOR_ASSIGNED, entityType: 'Article', entityId: articleId, actor, metadata: { previousEditorId: article.editorId, editorId } });
    await notify(tx, {
      userId: editorId,
      type: 'article.editor_assigned',
      title: `Assigned: ${article.submissionId}`,
      message: `You have been assigned as editor for “${article.title}”.`,
      template: 'editor_assigned',
      data: { submissionId: article.submissionId, title: article.title, link: links.editorArticle(articleId) },
      entityType: 'Article',
      entityId: articleId,
      dedupeKey: `article:${articleId}:editor:${editorId}:from:${article.editorId ?? "none"}`,
    });
    return { editorId };
  });
}

// ───────────────────────────── final decision ─────────────────────────────

const DECISION_LABEL = { ACCEPT: 'Accepted', REJECT: 'Rejected', REQUEST_REVISION: 'Revision requested' } as const;

export async function finalDecision(articleId: string, input: { decision: 'ACCEPT' | 'REJECT' | 'REQUEST_REVISION'; notes?: string; authorMessage?: string }, actor: Actor) {
  return transact(async (tx) => {
    const article = await loadArticleForEditorial(articleId, actor, tx);
    if (article.status === S.REVIEWS_RECEIVED) {
      await transitionArticle(tx, articleId, S.UNDER_EDITORIAL_DECISION, actor, { reason: 'Editor began deliberation' });
    }
    const target = input.decision === 'ACCEPT' ? S.ACCEPTED_PRODUCTION_PENDING : input.decision === 'REJECT' ? S.REJECTED : S.REVISION_REQUESTED;
    const { from } = await transitionArticle(tx, articleId, target, actor, {
      expectedFrom: [S.UNDER_EDITORIAL_DECISION],
      reason: `Final decision: ${input.decision}`,
      data: input.decision === 'ACCEPT' ? { acceptedAt: new Date() } : undefined,
    });
    const d = await tx.editorialDecision.create({
      data: { articleId, decision: input.decision, fromStatus: from, toStatus: target, notes: input.notes, authorMessage: input.authorMessage, decidedById: actor.id },
    });
    await recordAudit(tx, { action: AuditAction.FINAL_DECISION, entityType: 'Article', entityId: articleId, actor, fromStatus: from, toStatus: target, metadata: { decision: input.decision, decisionId: d.id } });

    await notify(tx, {
      userId: article.authorId,
      type: `article.decision.${input.decision.toLowerCase()}`,
      title: `Editorial decision for ${article.submissionId}`,
      message: `Decision: ${DECISION_LABEL[input.decision]}.`,
      template: input.decision === 'REQUEST_REVISION' ? 'revision_requested_author' : 'decision_author',
      data: { submissionId: article.submissionId, title: article.title, decision: DECISION_LABEL[input.decision], message: input.authorMessage, link: links.authorArticle(articleId) },
      entityType: 'Article',
      entityId: articleId,
      dedupeKey: `decision:${d.id}`,
    });

    if (input.decision === 'ACCEPT') {
      await tx.productionTask.create({ data: { articleId } });
      await tx.publication.create({ data: { articleId } });
      await notifyMany(tx, await productionRecipients(tx), {
        type: 'production.new_article',
        title: `Ready for production: ${article.submissionId}`,
        message: `“${article.title}” was accepted and awaits production.`,
        template: 'production_pending',
        data: { submissionId: article.submissionId, title: article.title, link: links.productionArticle(articleId) },
        entityType: 'Article',
        entityId: articleId,
        dedupeKey: `article:${articleId}:accepted`,
      });
    }
    return { status: target, statusLabel: STATUS_LABELS[target], decisionId: d.id };
  });
}

export { editorialCanAccess };
