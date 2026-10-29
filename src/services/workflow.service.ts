import { ArticleStatus as S, type Prisma } from '@prisma/client';
import type { Tx } from '../config/prisma';
import { REQUIRED_REVIEWERS, STATUS_LABELS, TERMINAL_STATUSES, TRANSITIONS } from '../constants/workflow';
import { currentRequestId, type Actor } from '../utils/context';
import { ConflictError, InvalidTransitionError, NotFoundError } from '../utils/errors';
import { AuditAction, recordAudit } from './audit.service';
import { getConfig } from './config.service';

export function canTransition(from: S, to: S): boolean {
  return TRANSITIONS[from].includes(to);
}

type Article = { id: string; status: S; currentWordCount: number };

/** Business prerequisites for entering a status. Checked inside the same transaction as the transition itself. */
const prerequisites: Partial<Record<S, (tx: Tx, a: Article, from: S) => Promise<void>>> = {
  [S.UNDER_EDITORIAL_SCREENING]: async (tx, a) => {
    const { paymentEnabled, apcEnforcement } = await getConfig();
    if (!paymentEnabled || apcEnforcement !== 'block') return;
    const p = await tx.apcPayment.findUnique({ where: { articleId: a.id }, select: { status: true } });
    if (!p || (p.status !== 'PAID' && p.status !== 'WAIVED')) {
      throw new ConflictError('The Article Publishing Charge must be paid or waived before screening can start', 'APC_INCOMPLETE');
    }
  },

  [S.READY_FOR_REVIEWER_ASSIGNMENT]: async (tx, a) => {
    const version = await tx.manuscriptVersion.findFirst({ where: { articleId: a.id }, orderBy: { versionNumber: 'desc' }, select: { id: true } });
    const check = version
      ? await tx.plagiarismCheck.findFirst({ where: { articleId: a.id, versionId: version.id, status: 'COMPLETED' }, orderBy: { createdAt: 'desc' } })
      : null;
    if (!check || check.verdict !== 'CLEAR') {
      throw new ConflictError('A completed plagiarism check with a clear verdict for the current manuscript version is required before reviewer assignment', 'PLAGIARISM_REQUIRED');
    }
  },

  [S.UNDER_REVIEW]: async (tx, a) => {
    const live = await tx.reviewerAssignment.findMany({ where: { articleId: a.id, status: { in: ['ASSIGNED', 'SUBMITTED'] } }, select: { slot: true } });
    if (live.length !== REQUIRED_REVIEWERS || new Set(live.map((l) => l.slot)).size !== REQUIRED_REVIEWERS) {
      throw new ConflictError(`Exactly ${REQUIRED_REVIEWERS} reviewers must be assigned`, 'REVIEWERS_REQUIRED');
    }
  },

  [S.REVIEWS_RECEIVED]: async (tx, a) => {
    const submitted = await tx.reviewerAssignment.count({ where: { articleId: a.id, status: 'SUBMITTED', report: { status: 'SUBMITTED' } } });
    const live = await tx.reviewerAssignment.count({ where: { articleId: a.id, status: { in: ['ASSIGNED', 'SUBMITTED'] } } });
    if (live !== REQUIRED_REVIEWERS || submitted !== REQUIRED_REVIEWERS) throw new ConflictError('Both reviewer reports must be submitted', 'REVIEWS_INCOMPLETE');
  },

  [S.REVISION_REQUESTED]: async () => {
    if (!(await getConfig()).allowRevisionAfterReview) {
      throw new ConflictError('Revision and resubmission after peer review is not enabled (pending PCI confirmation)', 'REVISION_NOT_ENABLED');
    }
  },

  [S.PROOF_SENT_TO_AUTHOR]: async (tx, a) => {
    const proof = await tx.proofVersion.findFirst({ where: { articleId: a.id, authorStatus: 'PENDING_REVIEW', sentToAuthorAt: { not: null } } });
    if (!proof) throw new ConflictError('A proof must be uploaded and sent to the author', 'PROOF_REQUIRED');
    const open = await tx.correction.count({ where: { articleId: a.id, status: { in: ['OPEN', 'ESCALATED', 'APPROVED_BY_EDITOR'] } } });
    if (open > 0) throw new ConflictError('All corrections must be implemented or resolved before a revised proof is sent', 'CORRECTIONS_PENDING');
  },

  [S.CORRECTION_REQUIRED]: async (tx, a, from) => {
    if (from === S.PROOF_SENT_TO_AUTHOR) {
      const open = await tx.correction.count({ where: { articleId: a.id, status: 'OPEN' } });
      if (open === 0) throw new ConflictError('No corrections were recorded', 'CORRECTIONS_REQUIRED');
    } else {
      const escalated = await tx.correction.count({ where: { articleId: a.id, status: 'ESCALATED' } });
      if (escalated > 0) throw new ConflictError('All major content changes need an Editor decision first', 'EDITOR_DECISION_PENDING');
    }
  },

  [S.MAJOR_CONTENT_CHANGE_EDITOR_REVIEW]: async (tx, a) => {
    const escalated = await tx.correction.count({ where: { articleId: a.id, status: 'ESCALATED' } });
    if (escalated === 0) throw new ConflictError('There is no escalated major content change', 'ESCALATION_REQUIRED');
  },

  [S.FINAL_PRODUCTION]: async (tx, a, from) => {
    const open = await tx.correction.count({ where: { articleId: a.id, status: { in: ['OPEN', 'ESCALATED', 'APPROVED_BY_EDITOR'] } } });
    if (open > 0) throw new ConflictError('Unresolved corrections remain', 'CORRECTIONS_PENDING');
    if (from === S.PROOF_SENT_TO_AUTHOR) {
      const approved = await tx.proofVersion.findFirst({ where: { articleId: a.id, authorStatus: 'APPROVED' } });
      if (!approved) throw new ConflictError('The author must approve the proof', 'PROOF_NOT_APPROVED');
    }
  },

  [S.PUBLISHED]: async (tx, a) => {
    const pub = await tx.publication.findUnique({ where: { articleId: a.id }, include: { metadata: true } });
    const missing: string[] = [];
    if (!pub?.htmlFileId) missing.push('final HTML file');
    if (!pub?.pdfFileId) missing.push('final PDF file');
    const task = await tx.productionTask.findUnique({ where: { articleId: a.id }, select: { status: true } });
    if (task?.status !== 'COMPLETED') missing.push('production completion handoff');
    const kw = await tx.articleKeyword.count({ where: { articleId: a.id } });
    const authors = await tx.articleAuthor.count({ where: { articleId: a.id } });
    if (kw === 0) missing.push('keywords');
    if (authors === 0) missing.push('author details');
    for (const field of (await getConfig()).publicationRequiredMetadata) {
      if (!pub?.metadata?.[field]) missing.push(`metadata.${field}`);
    }
    if (missing.length) throw new ConflictError(`Publication requirements not met: ${missing.join(', ')}`, 'PUBLICATION_REQUIREMENTS_NOT_MET');
  },
};

export interface TransitionOptions {
  reason?: string;
  /** Guard against acting on a stale view: the article must currently be in one of these statuses. */
  expectedFrom?: S | S[];
  /** Extra article columns to set atomically with the status change. Whitelisted by callers, never from request bodies. */
  data?: Prisma.ArticleUncheckedUpdateManyInput;
}

/**
 * The single place where an article's status changes. Validates the edge, checks prerequisites, applies the change
 * with an optimistic guard, and records history + audit in the same transaction.
 */
export async function transitionArticle(tx: Tx, articleId: string, to: S, actor: Actor | null, opts: TransitionOptions = {}) {
  const article = await tx.article.findUnique({ where: { id: articleId }, select: { id: true, status: true, currentWordCount: true } });
  if (!article) throw new NotFoundError('Article not found');
  const from = article.status;

  const expected = opts.expectedFrom === undefined ? null : Array.isArray(opts.expectedFrom) ? opts.expectedFrom : [opts.expectedFrom];
  if (expected && !expected.includes(from)) {
    throw new InvalidTransitionError(`This action is not allowed while the article is “${STATUS_LABELS[from]}”`);
  }
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(`An article cannot move from “${STATUS_LABELS[from]}” to “${STATUS_LABELS[to]}”`);
  }
  await prerequisites[to]?.(tx, article, from);

  const now = new Date();
  const res = await tx.article.updateMany({
    where: { id: articleId, status: from },
    data: {
      ...opts.data,
      status: to,
      ...(TERMINAL_STATUSES.includes(to) && to !== S.PUBLISHED ? { closedAt: now } : {}),
    },
  });
  if (res.count !== 1) throw new ConflictError('The article was changed by someone else. Please reload and try again.', 'CONCURRENT_MODIFICATION');

  await tx.articleStatusHistory.create({
    data: { articleId, fromStatus: from, toStatus: to, actorId: actor?.id ?? null, actorRole: actor?.role ?? null, reason: opts.reason ?? null, requestId: currentRequestId() ?? null },
  });
  await recordAudit(tx, {
    action: AuditAction.ARTICLE_STATUS_CHANGED,
    entityType: 'Article',
    entityId: articleId,
    actor,
    fromStatus: from,
    toStatus: to,
    metadata: opts.reason ? { reason: opts.reason } : undefined,
  });
  return { from, to };
}

/** Records the creation of an article in the status history. */
export async function recordInitialStatus(tx: Tx, articleId: string, actor: Actor) {
  await tx.articleStatusHistory.create({
    data: { articleId, fromStatus: null, toStatus: S.SUBMITTED, actorId: actor.id, actorRole: actor.role, requestId: currentRequestId() ?? null },
  });
}
