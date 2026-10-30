import { Prisma, ArticleStatus as S, FilePurpose } from '@prisma/client';
import { env } from '../config/env';
import { prisma } from '../config/prisma';
import { POST_DECISION_STATUSES, STATUS_LABELS } from '../constants/workflow';
import type { UploadedFiles } from '../middlewares/upload';
import { transact } from '../utils/context';
import { countDocxWords } from '../utils/docx';
import { ConflictError, NotFoundError, UnprocessableError } from '../utils/errors';
import { pageMeta, skipTake } from '../utils/pagination';
import { nextSequence, padded } from '../utils/sequence';
import { links } from '../templates/links';
import { loadOwnArticle } from './access';
import { AuditAction, recordAudit } from './audit.service';
import { getConfig } from './config.service';
import { createAsset, stageFile, withStaged } from './files.service';
import { editorialRecipients, notify, notifyMany } from './notification.service';
import { authorFacingComments } from './review.service';
import { transitionArticle, recordInitialStatus } from './workflow.service';

export interface SubmissionInput {
  title: string;
  abstract: string;
  ethicsStatement: string;
  subjectAreaId?: string;
  keywords: string[];
  authors: Array<{ firstName: string; lastName: string; email: string; affiliation?: string; isCorresponding: boolean }>;
}

async function wordCountOrFail(buffer: Buffer): Promise<number> {
  try {
    return await countDocxWords(buffer);
  } catch {
    throw new UnprocessableError('The Word document could not be read. Please check that it is a valid .docx file.', 'MANUSCRIPT_UNREADABLE');
  }
}

const dedupeKeywords = (kws: string[]) => {
  const seen = new Set<string>();
  return kws.map((k) => k.trim()).filter((k) => {
    const key = k.toLowerCase();
    if (!k || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export async function submitArticle(user: Express.AuthUser, input: SubmissionInput, files: UploadedFiles) {
  const manuscript = files.manuscript![0]!;
  const titlePage = files.titlePage?.[0];
  const cfg = await getConfig();

  if (input.subjectAreaId && !(await prisma.subjectArea.findFirst({ where: { id: input.subjectAreaId, isActive: true }, select: { id: true } }))) {
    throw new UnprocessableError('Unknown subject area', 'INVALID_SUBJECT_AREA', [{ field: 'subjectAreaId', message: 'Unknown subject area' }]);
  }
  const wordCount = await wordCountOrFail(manuscript.buffer);
  const exceeded = wordCount > cfg.wordLimit;

  const staged = [await stageFile(manuscript, FilePurpose.MANUSCRIPT)];
  if (titlePage) staged.push(await stageFile(titlePage, FilePurpose.TITLE_PAGE));

  const keywords = dedupeKeywords(input.keywords);
  const year = new Date().getUTCFullYear();

  const article = await withStaged(staged, () =>
    transact(async (tx) => {
      const seq = await nextSequence(tx, `submission-${year}`);
      const submissionId = `${env.SUBMISSION_ID_PREFIX}-${year}-${padded(seq)}`;
      const a = await tx.article.create({
        data: {
          submissionId,
          title: input.title,
          abstract: input.abstract,
          ethicsStatement: input.ethicsStatement,
          subjectAreaId: input.subjectAreaId,
          authorId: user.id,
          currentWordCount: wordCount,
          wordLimitExceeded: exceeded,
          coAuthors: {
            create: input.authors.map((au, i) => ({
              orderIndex: i,
              firstName: au.firstName,
              lastName: au.lastName,
              email: au.email,
              affiliation: au.affiliation,
              isCorresponding: au.isCorresponding,
            })),
          },
          keywords: { create: keywords.map((keyword) => ({ keyword })) },
        },
      });
      const file = await createAsset(tx, staged[0]!, { articleId: a.id, uploadedById: user.id });
      const titleFile = staged[1] ? await createAsset(tx, staged[1], { articleId: a.id, uploadedById: user.id }) : null;
      await tx.manuscriptVersion.create({
        data: { articleId: a.id, versionNumber: 1, kind: 'ORIGINAL', fileId: file.id, titlePageFileId: titleFile?.id, wordCount, createdById: user.id },
      });
      // While the payment switch is off no APC is due for this submission, and turning it on later must not make it owe one.
      await tx.apcPayment.create({
        data: cfg.paymentEnabled
          ? { articleId: a.id, status: 'PENDING', amount: cfg.apcDefaultAmount ?? undefined, currency: cfg.apcCurrency ?? undefined }
          : { articleId: a.id, status: 'WAIVED', note: 'Submitted while payments were disabled' },
      });
      await recordInitialStatus(tx, a.id, user);
      await recordAudit(tx, {
        action: AuditAction.ARTICLE_SUBMITTED,
        entityType: 'Article',
        entityId: a.id,
        actor: user,
        toStatus: S.SUBMITTED,
        metadata: { submissionId, wordCount, wordLimitExceeded: exceeded },
      });
      await notify(tx, {
        userId: user.id,
        type: 'article.submitted',
        title: `Submission received: ${submissionId}`,
        message: `Your manuscript “${a.title}” was submitted successfully.`,
        template: 'submission_confirmation',
        data: { submissionId, title: a.title, link: links.authorArticle(a.id) },
        entityType: 'Article',
        entityId: a.id,
        dedupeKey: `article:${a.id}:submitted:author`,
      });
      await notifyMany(tx, await editorialRecipients(tx, a), {
        type: 'article.new_submission',
        title: `New submission: ${submissionId}`,
        message: `“${a.title}” is waiting for editorial screening.`,
        template: 'editor_new_submission',
        data: { submissionId, title: a.title, link: links.editorArticle(a.id) },
        entityType: 'Article',
        entityId: a.id,
        dedupeKey: `article:${a.id}:submitted:editors`,
      });
      return a;
    }),
  );
  return { id: article.id, submissionId: article.submissionId, status: article.status, statusLabel: STATUS_LABELS[article.status], wordCount, wordLimitExceeded: exceeded, wordLimit: cfg.wordLimit };
}

export async function uploadRevision(user: Express.AuthUser, articleId: string, changeNote: string | undefined, files: UploadedFiles) {
  const article = await loadOwnArticle(articleId, user.id);
  if (article.status !== S.REVISION_REQUESTED) throw new ConflictError('A revision can only be uploaded when the editor has requested one', 'REVISION_NOT_REQUESTED');
  const manuscript = files.manuscript![0]!;
  const titlePage = files.titlePage?.[0];
  const cfg = await getConfig();
  const wordCount = await wordCountOrFail(manuscript.buffer);
  const staged = [await stageFile(manuscript, FilePurpose.MANUSCRIPT)];
  if (titlePage) staged.push(await stageFile(titlePage, FilePurpose.TITLE_PAGE));

  return withStaged(staged, () =>
    transact(async (tx) => {
      const last = await tx.manuscriptVersion.aggregate({ where: { articleId }, _max: { versionNumber: true } });
      const versionNumber = (last._max.versionNumber ?? 0) + 1;
      const file = await createAsset(tx, staged[0]!, { articleId, uploadedById: user.id });
      const titleFile = staged[1] ? await createAsset(tx, staged[1], { articleId, uploadedById: user.id }) : null;
      await tx.manuscriptVersion.create({
        data: { articleId, versionNumber, kind: 'REVISION', fileId: file.id, titlePageFileId: titleFile?.id, wordCount, changeNote, createdById: user.id },
      });
      await transitionArticle(tx, articleId, S.UNDER_EDITORIAL_DECISION, user, {
        reason: 'Revised manuscript submitted',
        data: { currentWordCount: wordCount, wordLimitExceeded: wordCount > cfg.wordLimit },
      });
      await recordAudit(tx, { action: AuditAction.ARTICLE_VERSION_UPLOADED, entityType: 'Article', entityId: articleId, actor: user, metadata: { versionNumber, wordCount } });
      await notifyMany(tx, await editorialRecipients(tx, article), {
        type: 'article.revision_submitted',
        title: `Revision received: ${article.submissionId}`,
        message: `A revised manuscript for “${article.title}” was submitted.`,
        template: 'editor_new_submission',
        data: { submissionId: article.submissionId, title: article.title, link: links.editorArticle(articleId) },
        entityType: 'Article',
        entityId: articleId,
        dedupeKey: `article:${articleId}:revision:${versionNumber}`,
      });
      return { versionNumber, wordCount, wordLimitExceeded: wordCount > cfg.wordLimit };
    }),
  );
}

// ───────────────────────────── author views ─────────────────────────────

const summarySelect = {
  id: true,
  submissionId: true,
  title: true,
  status: true,
  submittedAt: true,
  currentWordCount: true,
  wordLimitExceeded: true,
  subjectArea: { select: { id: true, name: true } },
  payment: { select: { status: true, amount: true, currency: true } },
} satisfies Prisma.ArticleSelect;

const withLabel = <T extends { status: S }>(a: T) => ({ ...a, statusLabel: STATUS_LABELS[a.status] });

export interface MyArticlesQuery {
  page: number;
  pageSize: number;
  status?: S;
  search?: string;
  sortBy: 'submittedAt' | 'title' | 'status';
  sortOrder: 'asc' | 'desc';
}

export async function listMyArticles(userId: string, q: MyArticlesQuery) {
  const where: Prisma.ArticleWhereInput = {
    authorId: userId,
    status: q.status,
    ...(q.search ? { OR: [{ title: { contains: q.search, mode: 'insensitive' } }, { submissionId: { contains: q.search, mode: 'insensitive' } }] } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.article.findMany({ where, select: summarySelect, orderBy: { [q.sortBy]: q.sortOrder }, ...skipTake(q) }),
    prisma.article.count({ where }),
  ]);
  return { items: items.map(withLabel), meta: pageMeta(q, total) };
}

/**
 * Author-facing article detail. By construction this DTO has no reviewer, assignment, internal-note or plagiarism
 * data; review comments appear only after a final decision and only if the Editor approved them.
 */
export async function getMyArticle(userId: string, articleId: string) {
  await loadOwnArticle(articleId, userId);
  const a = await prisma.article.findUniqueOrThrow({
    where: { id: articleId },
    select: {
      ...summarySelect,
      abstract: true,
      ethicsStatement: true,
      acceptedAt: true,
      publishedAt: true,
      closedAt: true,
      screeningRejected: true,
      coAuthors: { orderBy: { orderIndex: 'asc' }, select: { firstName: true, lastName: true, email: true, affiliation: true, isCorresponding: true } },
      keywords: { select: { keyword: true } },
      versions: { orderBy: { versionNumber: 'asc' }, select: { versionNumber: true, kind: true, wordCount: true, changeNote: true, createdAt: true, fileId: true, titlePageFileId: true } },
      decisions: {
        where: { decision: { in: ['REJECT_AT_SCREENING', 'REJECT_AFTER_PLAGIARISM', 'REJECT', 'ACCEPT', 'REQUEST_REVISION'] } },
        orderBy: { decidedAt: 'desc' },
        select: { decision: true, authorMessage: true, decidedAt: true },
      },
      statusHistory: { orderBy: { createdAt: 'asc' }, select: { fromStatus: true, toStatus: true, createdAt: true } },
      proofs: { where: { sentToAuthorAt: { not: null } }, orderBy: { versionNumber: 'desc' }, select: { id: true, versionNumber: true, sentToAuthorAt: true, authorStatus: true, fileId: true } },
      publication: { select: { status: true, publishedAt: true } },
    },
  });
  const comments = POST_DECISION_STATUSES.includes(a.status) ? await authorFacingComments(prisma, articleId) : [];
  const { keywords, statusHistory, decisions, ...rest } = a;
  return {
    ...withLabel(rest),
    // The plagiarism-stage rejection is presented to authors as a plain rejection; internal stage names are not exposed.
    decisions: decisions.map((d) => ({ ...d, decision: d.decision === 'REJECT_AFTER_PLAGIARISM' ? ('REJECT' as const) : d.decision })),
    keywords: keywords.map((k) => k.keyword),
    statusHistory: statusHistory.map((h) => ({ from: h.fromStatus, to: h.toStatus, at: h.createdAt, toLabel: STATUS_LABELS[h.toStatus] })),
    wordLimit: (await getConfig()).wordLimit,
    approvedReviewerComments: comments,
  };
}

export async function authorDashboard(userId: string) {
  const [byStatus, recent, proofsAwaiting, revisionRequested, unread] = await Promise.all([
    prisma.article.groupBy({ by: ['status'], where: { authorId: userId }, _count: { _all: true } }),
    prisma.article.findMany({ where: { authorId: userId }, select: summarySelect, orderBy: { submittedAt: 'desc' }, take: 5 }),
    prisma.proofVersion.findMany({
      where: { authorStatus: 'PENDING_REVIEW', article: { authorId: userId } },
      select: { id: true, versionNumber: true, sentToAuthorAt: true, article: { select: { id: true, submissionId: true, title: true } } },
    }),
    prisma.article.findMany({ where: { authorId: userId, status: S.REVISION_REQUESTED }, select: { id: true, submissionId: true, title: true } }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);
  return {
    totals: byStatus.map((s) => ({ status: s.status, label: STATUS_LABELS[s.status], count: s._count._all })),
    recentSubmissions: recent.map(withLabel),
    pendingActions: {
      proofsAwaitingReview: proofsAwaiting,
      revisionsRequested: revisionRequested,
    },
    unreadNotifications: unread,
  };
}

export async function getMyArticlePayment(userId: string, articleId: string) {
  await loadOwnArticle(articleId, userId);
  const p = await prisma.apcPayment.findUnique({ where: { articleId }, select: { status: true, amount: true, currency: true, paidAt: true, provider: true } });
  if (!p) throw new NotFoundError('Payment record not found');
  return p;
}
