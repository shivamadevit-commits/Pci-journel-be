import { ArticleStatus as S, Prisma, ReviewCommentSection, ReviewRecommendation } from '@prisma/client';
import { prisma, type Db, type Tx } from '../config/prisma';
import { REQUIRED_REVIEWERS, STATUS_LABELS } from '../constants/workflow';
import { links } from '../templates/links';
import { transact, type Actor } from '../utils/context';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError, UnprocessableError } from '../utils/errors';
import { pageMeta, skipTake } from '../utils/pagination';
import { loadArticleForEditorial } from './access';
import { AuditAction, recordAudit } from './audit.service';
import { getConfig } from './config.service';
import { editorialRecipients, notify, notifyMany } from './notification.service';
import { transitionArticle } from './workflow.service';

const LIVE = ['ASSIGNED', 'SUBMITTED'] as const;
const slotLabel = (slot: number) => `Reviewer ${slot === 1 ? 'A' : 'B'}`;

// ───────────────────────────── eligibility / conflicts (FR-014) ─────────────────────────────

export async function checkEligibility(db: Db, articleId: string, reviewerId: string) {
  const [article, reviewer, cfg] = await Promise.all([
    db.article.findUnique({ where: { id: articleId }, select: { id: true, authorId: true, subjectAreaId: true, coAuthors: { select: { email: true } } } }),
    db.reviewerProfile.findUnique({
      where: { id: reviewerId },
      include: { user: { select: { email: true, status: true, firstName: true, lastName: true } }, subjectAreas: { select: { subjectAreaId: true } }, _count: { select: { assignments: { where: { status: 'ASSIGNED' } } } } },
    }),
    getConfig(),
  ]);
  if (!article) throw new NotFoundError('Article not found');
  if (!reviewer) throw new NotFoundError('Reviewer not found');

  const authorEmails = new Set(article.coAuthors.map((c) => c.email.toLowerCase()));
  const conflicts: string[] = [];
  if (reviewer.userId === article.authorId) conflicts.push('Reviewer is the submitting author');
  if (authorEmails.has(reviewer.user.email.toLowerCase())) conflicts.push('Reviewer is listed as an author of this article');
  const previous = await db.reviewerAssignment.findFirst({ where: { articleId, reviewerId }, select: { status: true } });
  if (previous) conflicts.push('Reviewer already had an assignment on this article');
  const blockers = [...conflicts];
  if (!reviewer.isActive || reviewer.user.status !== 'ACTIVE') blockers.push('Reviewer account is not active');

  return {
    reviewerId,
    reviewerCode: reviewer.reviewerCode,
    isActive: reviewer.isActive && reviewer.user.status === 'ACTIVE',
    meetsProposedEligibility: reviewer.holdsMPharm || reviewer.yearsTeaching >= cfg.reviewerMinYearsTeaching,
    subjectAreaMatch: !!article.subjectAreaId && reviewer.subjectAreas.some((s) => s.subjectAreaId === article.subjectAreaId),
    currentOpenAssignments: reviewer._count.assignments,
    conflicts,
    canBeAssigned: blockers.length === 0,
    blockers,
  };
}

// ───────────────────────────── assignment (editor) ─────────────────────────────

function dueDateFor(requested: Date | undefined, days: number | null): Date | null {
  if (requested) return requested;
  return days ? new Date(Date.now() + days * 86_400_000) : null;
}

function notifyAssigned(tx: Tx, a: { id: string; reviewerUserId: string; submissionId: string; title: string; dueDate: Date | null }) {
  return notify(tx, {
    userId: a.reviewerUserId,
    type: 'review.assigned',
    title: `Review invitation: ${a.submissionId}`,
    message: `You have been assigned “${a.title}” for double-blind review.`,
    template: 'reviewer_assigned',
    data: { submissionId: a.submissionId, title: a.title, dueDate: a.dueDate?.toISOString().slice(0, 10), link: links.reviewerAssignment(a.id) },
    entityType: 'ReviewerAssignment',
    entityId: a.id,
    dedupeKey: `assignment:${a.id}:assigned`,
  });
}

export async function assignReviewers(articleId: string, reviewerIds: string[], dueDate: Date | undefined, actor: Actor) {
  if (reviewerIds.length !== REQUIRED_REVIEWERS || new Set(reviewerIds).size !== REQUIRED_REVIEWERS) {
    throw new UnprocessableError(`Exactly ${REQUIRED_REVIEWERS} distinct reviewers must be selected`, 'REVIEWERS_REQUIRED');
  }
  const cfg = await getConfig();
  return transact(async (tx) => {
    await lockArticle(tx, articleId);
    const article = await loadArticleForEditorial(articleId, actor, tx);
    if (article.status !== S.READY_FOR_REVIEWER_ASSIGNMENT) {
      throw new ConflictError(`Reviewers can only be assigned when the article is “${STATUS_LABELS[S.READY_FOR_REVIEWER_ASSIGNMENT]}”`, 'INVALID_STATE_TRANSITION');
    }
    for (const id of reviewerIds) {
      const e = await checkEligibility(tx, articleId, id);
      if (!e.canBeAssigned) throw new ConflictError(`Reviewer ${e.reviewerCode} cannot be assigned: ${e.blockers.join('; ')}`, 'REVIEWER_NOT_ELIGIBLE');
    }
    const version = await tx.manuscriptVersion.findFirstOrThrow({ where: { articleId }, orderBy: { versionNumber: 'desc' }, select: { id: true } });
    const due = dueDateFor(dueDate, cfg.reviewDueDays);
    const created = [];
    for (const [i, reviewerId] of reviewerIds.entries()) {
      const a = await tx.reviewerAssignment.create({
        data: { articleId, reviewerId, versionId: version.id, slot: i + 1, assignedById: actor.id, dueDate: due },
        include: { reviewer: { select: { userId: true, reviewerCode: true } } },
      });
      created.push(a);
    }
    await transitionArticle(tx, articleId, S.UNDER_REVIEW, actor, { expectedFrom: S.READY_FOR_REVIEWER_ASSIGNMENT, reason: 'Two reviewers assigned' });
    for (const a of created) {
      await notifyAssigned(tx, { id: a.id, reviewerUserId: a.reviewer.userId, submissionId: article.submissionId, title: article.title, dueDate: due });
    }
    await recordAudit(tx, {
      action: AuditAction.REVIEWERS_ASSIGNED,
      entityType: 'Article',
      entityId: articleId,
      actor,
      metadata: { reviewers: created.map((c) => ({ assignmentId: c.id, reviewerCode: c.reviewer.reviewerCode, slot: c.slot })), dueDate: due },
    });
    return created.map((c) => ({ assignmentId: c.id, slot: c.slot, reviewerId: c.reviewerId, reviewerCode: c.reviewer.reviewerCode, status: c.status, dueDate: c.dueDate }));
  });
}

export async function replaceReviewer(articleId: string, assignmentId: string, newReviewerId: string, reason: string | undefined, actor: Actor) {
  return transact(async (tx) => {
    await lockArticle(tx, articleId);
    const article = await loadArticleForEditorial(articleId, actor, tx);
    if (article.status !== S.UNDER_REVIEW) throw new ConflictError('Reviewers can only be replaced while the article is Under Review', 'INVALID_STATE_TRANSITION');
    const old = await tx.reviewerAssignment.findFirst({ where: { id: assignmentId, articleId }, include: { reviewer: { select: { reviewerCode: true } } } });
    if (!old) throw new NotFoundError('Assignment not found');
    if (old.status === 'SUBMITTED') throw new ConflictError('A submitted review cannot be replaced', 'REVIEW_ALREADY_SUBMITTED');
    if (old.status === 'REVOKED') throw new ConflictError('This assignment was already replaced');

    const e = await checkEligibility(tx, articleId, newReviewerId);
    if (!e.canBeAssigned) throw new ConflictError(`Reviewer ${e.reviewerCode} cannot be assigned: ${e.blockers.join('; ')}`, 'REVIEWER_NOT_ELIGIBLE');

    if (old.status === 'ASSIGNED') {
      await tx.reviewerAssignment.update({ where: { id: old.id }, data: { status: 'REVOKED', endedAt: new Date() } });
    }
    const cfg = await getConfig();
    const due = dueDateFor(undefined, cfg.reviewDueDays);
    const fresh = await tx.reviewerAssignment.create({
      data: { articleId, reviewerId: newReviewerId, versionId: old.versionId, slot: old.slot, assignedById: actor.id, dueDate: due },
      include: { reviewer: { select: { userId: true, reviewerCode: true } } },
    });
    await notifyAssigned(tx, { id: fresh.id, reviewerUserId: fresh.reviewer.userId, submissionId: article.submissionId, title: article.title, dueDate: due });
    await recordAudit(tx, {
      action: AuditAction.REVIEWER_REPLACED,
      entityType: 'Article',
      entityId: articleId,
      actor,
      metadata: { replacedReviewerCode: old.reviewer.reviewerCode, newReviewerCode: fresh.reviewer.reviewerCode, slot: old.slot, reason },
    });
    return { assignmentId: fresh.id, slot: fresh.slot, reviewerId: fresh.reviewerId, reviewerCode: fresh.reviewer.reviewerCode, status: fresh.status, dueDate: fresh.dueDate };
  });
}

export async function remindReviewer(articleId: string, assignmentId: string, actor: Actor) {
  const article = await loadArticleForEditorial(articleId, actor);
  const a = await prisma.reviewerAssignment.findFirst({ where: { id: assignmentId, articleId, status: 'ASSIGNED' }, include: { reviewer: { select: { userId: true } } } });
  if (!a) throw new NotFoundError('Pending assignment not found');
  if (a.lastReminderAt && Date.now() - a.lastReminderAt.getTime() < 24 * 3600_000) throw new ConflictError('A reminder was already sent in the last 24 hours', 'REMINDER_TOO_SOON');
  await transact(async (tx) => {
    const marked = await tx.reviewerAssignment.updateMany({ where: { id: a.id, status: 'ASSIGNED', OR: [{ lastReminderAt: null }, { lastReminderAt: { lt: new Date(Date.now() - 24 * 3600_000) } }] }, data: { lastReminderAt: new Date() } });
    if (marked.count !== 1) throw new ConflictError('A reminder was already sent in the last 24 hours', 'REMINDER_TOO_SOON');
    await notify(tx, {
      userId: a.reviewer.userId,
      type: 'review.reminder',
      title: `Reminder: review pending for ${article.submissionId}`,
      message: `Your review of “${article.title}” is still pending.`,
      template: 'reviewer_reminder',
      data: { submissionId: article.submissionId, dueDate: a.dueDate?.toISOString().slice(0, 10), link: links.reviewerAssignment(a.id) },
      entityType: 'ReviewerAssignment',
      entityId: a.id,
      dedupeKey: `assignment:${a.id}:reminder:${new Date().toISOString().slice(0, 10)}`,
    });
    await recordAudit(tx, { action: AuditAction.REVIEWER_REMINDED, entityType: 'ReviewerAssignment', entityId: a.id, actor });
  });
}

/** Serialises concurrent writers on one article (e.g. both reviewers submitting at the same moment). */
async function lockArticle(tx: Tx, articleId: string) {
  await tx.$queryRaw`SELECT id FROM "Article" WHERE id = ${articleId}::uuid FOR UPDATE`;
}

// ───────────────────────────── editor view of reviews (identities visible) ─────────────────────────────

export async function getReviewsForEditor(articleId: string, actor: Actor) {
  await loadArticleForEditorial(articleId, actor);
  const rows = await prisma.reviewerAssignment.findMany({
    where: { articleId },
    orderBy: [{ slot: 'asc' }, { assignedAt: 'asc' }],
    include: {
      reviewer: { select: { id: true, reviewerCode: true, institution: true, user: { select: { firstName: true, lastName: true, email: true } } } },
      report: { include: { comments: { orderBy: { orderIndex: 'asc' } } } },
    },
  });
  return rows.map((a) => ({
    assignmentId: a.id,
    slot: a.slot,
    label: slotLabel(a.slot),
    status: a.status,
    assignedAt: a.assignedAt,
    dueDate: a.dueDate,
    respondedAt: a.respondedAt,
    declineReason: a.declineReason,
    reviewer: { id: a.reviewer.id, reviewerCode: a.reviewer.reviewerCode, name: `${a.reviewer.user.firstName} ${a.reviewer.user.lastName}`, email: a.reviewer.user.email, institution: a.reviewer.institution },
    // Drafts are private to the reviewer; the Editor only sees submitted reports.
    report:
      a.report?.status === 'SUBMITTED'
        ? {
            recommendation: a.report.recommendation,
            submittedAt: a.report.submittedAt,
            comments: a.report.comments.map((c) => ({ id: c.id, section: c.section, body: c.body, approvedForAuthor: c.approvedForAuthor, editedBody: c.editedBody, approvedAt: c.approvedAt })),
          }
        : null,
  }));
}

export async function moderateComments(articleId: string, items: Array<{ commentId: string; approved: boolean; editedBody?: string | null }>, actor: Actor) {
  return transact(async (tx) => {
    const article = await loadArticleForEditorial(articleId, actor, tx);
    if (article.status !== S.REVIEWS_RECEIVED && article.status !== S.UNDER_EDITORIAL_DECISION) {
      throw new ConflictError('Comments can only be moderated after both reviews are received and before the final decision', 'INVALID_STATE_TRANSITION');
    }
    const ids = items.map((i) => i.commentId);
    if (new Set(ids).size !== ids.length) throw new BadRequestError('Duplicate comment ids');
    const comments = await tx.reviewComment.findMany({
      where: { id: { in: ids }, report: { status: 'SUBMITTED', assignment: { articleId } } },
      select: { id: true, section: true },
    });
    if (comments.length !== ids.length) throw new NotFoundError('One or more comments were not found on this article');
    const bySection = new Map(comments.map((c) => [c.id, c.section]));
    const now = new Date();
    for (const it of items) {
      if (it.approved && bySection.get(it.commentId) === ReviewCommentSection.CONFIDENTIAL_TO_EDITOR) {
        throw new UnprocessableError('Comments marked confidential to the editor cannot be released to the author', 'CONFIDENTIAL_COMMENT');
      }
      await tx.reviewComment.update({
        where: { id: it.commentId },
        data: {
          approvedForAuthor: it.approved,
          editedBody: it.approved ? (it.editedBody ?? null) : null,
          approvedById: it.approved ? actor.id : null,
          approvedAt: it.approved ? now : null,
        },
      });
    }
    await recordAudit(tx, {
      action: AuditAction.COMMENTS_DISCLOSURE_SET,
      entityType: 'Article',
      entityId: articleId,
      actor,
      metadata: { approved: items.filter((i) => i.approved).map((i) => i.commentId), withheld: items.filter((i) => !i.approved).map((i) => i.commentId), edited: items.filter((i) => i.approved && i.editedBody).map((i) => i.commentId) },
    });
    return { updated: items.length };
  });
}

/**
 * The ONLY path by which reviewer-written text reaches an author. Returns approved comments only, using the
 * Editor-edited wording when present, labelled with an anonymous slot label — never with any reviewer identity.
 */
export async function authorFacingComments(db: Db, articleId: string) {
  const assignments = await db.reviewerAssignment.findMany({
    where: { articleId, status: 'SUBMITTED', report: { status: 'SUBMITTED' } },
    orderBy: { slot: 'asc' },
    select: { slot: true, report: { select: { comments: { where: { approvedForAuthor: true, section: { not: 'CONFIDENTIAL_TO_EDITOR' } }, orderBy: { orderIndex: 'asc' }, select: { section: true, body: true, editedBody: true } } } } },
  });
  return assignments
    .map((a) => ({
      label: slotLabel(a.slot),
      comments: (a.report?.comments ?? []).map((c) => ({ section: c.section, text: c.editedBody ?? c.body })),
    }))
    .filter((r) => r.comments.length > 0);
}

// ───────────────────────────── reviewer workspace ─────────────────────────────

const assignmentView = {
  id: true,
  slot: true,
  status: true,
  assignedAt: true,
  dueDate: true,
  respondedAt: true,
  article: { select: { id: true, submissionId: true, title: true, subjectArea: { select: { name: true } }, status: true } },
  report: { select: { status: true, recommendation: true, submittedAt: true } },
} satisfies Prisma.ReviewerAssignmentSelect;

async function reviewerProfileId(userId: string): Promise<string> {
  const p = await prisma.reviewerProfile.findUnique({ where: { userId }, select: { id: true, isActive: true } });
  if (!p) throw new ForbiddenError('No reviewer profile found for this account');
  return p.id;
}

/** Loads an assignment that belongs to this reviewer, or 404 (so other reviewers' assignments are not discoverable). */
async function ownAssignment(userId: string, assignmentId: string) {
  const a = await prisma.reviewerAssignment.findFirst({
    where: { id: assignmentId, reviewer: { userId } },
    include: { article: { select: { id: true, submissionId: true, title: true, status: true, editorId: true } } },
  });
  if (!a) throw new NotFoundError('Assignment not found');
  return a;
}

export async function listMyAssignments(userId: string, q: { page: number; pageSize: number; status?: 'ASSIGNED' | 'SUBMITTED' | 'DECLINED' | 'REVOKED'; search?: string }) {
  const reviewerId = await reviewerProfileId(userId);
  const where: Prisma.ReviewerAssignmentWhereInput = {
    reviewerId,
    status: q.status,
    ...(q.search ? { article: { OR: [{ title: { contains: q.search, mode: 'insensitive' } }, { submissionId: { contains: q.search, mode: 'insensitive' } }] } } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.reviewerAssignment.findMany({ where, select: assignmentView, orderBy: { assignedAt: 'desc' }, ...skipTake(q) }),
    prisma.reviewerAssignment.count({ where }),
  ]);
  return { items, meta: pageMeta(q, total) };
}

/** Anonymised manuscript view: no authors, no title page, no author-side metadata. */
export async function getMyAssignment(userId: string, assignmentId: string) {
  const own = await ownAssignment(userId, assignmentId);
  if (own.status === 'REVOKED') throw new NotFoundError('Assignment not found');
  const a = await prisma.reviewerAssignment.findUniqueOrThrow({
    where: { id: assignmentId },
    select: {
      ...assignmentView,
      version: { select: { versionNumber: true, wordCount: true, fileId: true } },
      article: { select: { ...assignmentView.article.select, abstract: true, ethicsStatement: true, keywords: { select: { keyword: true } } } },
      report: { select: { id: true, status: true, recommendation: true, submittedAt: true, comments: { orderBy: { orderIndex: 'asc' }, select: { id: true, section: true, body: true } } } },
    },
  });
  const { article, ...rest } = a;
  return { ...rest, article: { ...article, keywords: article.keywords.map((k) => k.keyword) }, canSubmit: a.status === 'ASSIGNED' && a.article.status === S.UNDER_REVIEW };
}

export async function declineAssignment(user: Express.AuthUser, assignmentId: string, reason: string) {
  const own = await ownAssignment(user.id, assignmentId);
  await transact(async (tx) => {
    await lockArticle(tx, own.articleId);
    const claimed = await tx.reviewerAssignment.updateMany({
      where: { id: assignmentId, status: 'ASSIGNED', article: { status: S.UNDER_REVIEW } },
      data: { status: 'DECLINED', respondedAt: new Date(), endedAt: new Date(), declineReason: reason },
    });
    if (claimed.count !== 1) throw new ConflictError('This assignment can no longer be declined', 'INVALID_STATE_TRANSITION');
    await recordAudit(tx, { action: AuditAction.REVIEWER_DECLINED, entityType: 'ReviewerAssignment', entityId: assignmentId, actor: user, metadata: { articleId: own.articleId } });
    await notifyMany(tx, await editorialRecipients(tx, own.article), {
      type: 'review.declined',
      title: `A reviewer declined ${own.article.submissionId}`,
      message: 'A reviewer declined the assignment. Please assign a replacement.',
      template: 'reviewer_declined_editor',
      data: { submissionId: own.article.submissionId, title: own.article.title, link: links.editorArticle(own.articleId) },
      entityType: 'Article',
      entityId: own.articleId,
      dedupeKey: `assignment:${assignmentId}:declined`,
    });
  });
}

export interface ReviewInput {
  recommendation?: ReviewRecommendation;
  comments: Array<{ section: ReviewCommentSection; body: string }>;
}

async function editableReport(tx: Tx, userId: string, assignmentId: string) {
  const own = await ownAssignment(userId, assignmentId);
  if (own.status !== 'ASSIGNED') throw new ConflictError(own.status === 'SUBMITTED' ? 'Submitted reviews are locked and cannot be changed' : 'This assignment is not open', 'REVIEW_LOCKED');
  if (own.article.status !== S.UNDER_REVIEW) throw new ConflictError('The article is no longer under review', 'INVALID_STATE_TRANSITION');
  const report = (await tx.reviewReport.findUnique({ where: { assignmentId } })) ?? (await tx.reviewReport.create({ data: { assignmentId } }));
  return { own, report };
}

async function writeComments(tx: Tx, reportId: string, comments: ReviewInput['comments']) {
  await tx.reviewComment.deleteMany({ where: { reportId } });
  await tx.reviewComment.createMany({ data: comments.map((c, i) => ({ reportId, section: c.section, body: c.body, orderIndex: i })) });
}

export async function saveDraft(user: Express.AuthUser, assignmentId: string, input: ReviewInput) {
  return transact(async (tx) => {
    const { report } = await editableReport(tx, user.id, assignmentId);
    if (report.status === 'SUBMITTED') throw new ConflictError('Submitted reviews are locked', 'REVIEW_LOCKED');
    await tx.reviewReport.update({ where: { id: report.id }, data: { recommendation: input.recommendation ?? null } });
    await writeComments(tx, report.id, input.comments);
    await recordAudit(tx, { action: AuditAction.REVIEW_DRAFT_SAVED, entityType: 'ReviewerAssignment', entityId: assignmentId, actor: user });
    return { reportId: report.id, status: 'DRAFT' as const };
  });
}

export async function submitReview(user: Express.AuthUser, assignmentId: string, input: ReviewInput & { recommendation: ReviewRecommendation }) {
  if (!input.comments.some((c) => c.section !== 'CONFIDENTIAL_TO_EDITOR' && c.body.trim().length > 0)) {
    throw new UnprocessableError('At least one comment for the author-facing review is required', 'COMMENTS_REQUIRED', [{ field: 'comments', message: 'Add at least one comment that is not marked confidential to the editor' }]);
  }
  const reviewer = await prisma.reviewerAssignment.findFirst({ where: { id: assignmentId, reviewer: { userId: user.id } }, select: { articleId: true } });
  if (!reviewer) throw new NotFoundError('Assignment not found');

  return transact(async (tx) => {
    await lockArticle(tx, reviewer.articleId);
    const { own, report } = await editableReport(tx, user.id, assignmentId);
    const now = new Date();
    await writeComments(tx, report.id, input.comments);
    await tx.reviewReport.update({ where: { id: report.id }, data: { status: 'SUBMITTED', recommendation: input.recommendation, submittedAt: now } });
    await tx.reviewerAssignment.update({ where: { id: assignmentId }, data: { status: 'SUBMITTED', respondedAt: now } });
    await recordAudit(tx, { action: AuditAction.REVIEW_SUBMITTED, entityType: 'ReviewerAssignment', entityId: assignmentId, actor: user, metadata: { articleId: own.articleId, recommendation: input.recommendation } });

    await notify(tx, {
      userId: user.id,
      type: 'review.submitted',
      title: `Review submitted: ${own.article.submissionId}`,
      message: 'Your review was submitted and locked.',
      template: 'review_submitted_reviewer',
      data: { submissionId: own.article.submissionId },
      entityType: 'ReviewerAssignment',
      entityId: assignmentId,
      dedupeKey: `assignment:${assignmentId}:submitted`,
    });

    const submitted = await tx.reviewerAssignment.count({ where: { articleId: own.articleId, status: 'SUBMITTED' } });
    const live = await tx.reviewerAssignment.count({ where: { articleId: own.articleId, status: { in: [...LIVE] } } });
    let bothIn = false;
    if (live === REQUIRED_REVIEWERS && submitted === REQUIRED_REVIEWERS) {
      await transitionArticle(tx, own.articleId, S.REVIEWS_RECEIVED, user, { expectedFrom: S.UNDER_REVIEW, reason: 'Both reviewer reports submitted' });
      bothIn = true;
      await notifyMany(tx, await editorialRecipients(tx, own.article), {
        type: 'review.all_received',
        title: `Both reviews received: ${own.article.submissionId}`,
        message: `Both reviewer reports for “${own.article.title}” are in.`,
        template: 'reviews_received_editor',
        data: { submissionId: own.article.submissionId, title: own.article.title, link: links.editorArticle(own.articleId) },
        entityType: 'Article',
        entityId: own.articleId,
        dedupeKey: `article:${own.articleId}:reviews-received`,
      });
    }
    return { submittedAt: now, allReviewsReceived: bothIn };
  });
}
