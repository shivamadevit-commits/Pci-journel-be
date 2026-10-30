import { ArticleStatus as S, FilePurpose, Prisma, Role } from '@prisma/client';
import { prisma, type Tx } from '../config/prisma';
import { isEditorial } from '../constants/roles';
import { PRODUCTION_STATUSES, STATUS_LABELS } from '../constants/workflow';
import type { UploadedFile } from '../middlewares/upload';
import { links } from '../templates/links';
import { transact, type Actor } from '../utils/context';
import { ConflictError, ForbiddenError, NotFoundError, UnprocessableError } from '../utils/errors';
import { pageMeta, skipTake } from '../utils/pagination';
import { loadArticleForEditorial, loadOwnArticle } from './access';
import { AuditAction, recordAudit } from './audit.service';
import { createAsset, stageFile, withStaged } from './files.service';
import { editorialRecipients, notify, notifyMany, productionRecipients } from './notification.service';
import { transitionArticle } from './workflow.service';

// ───────────────────────────── production-side access ─────────────────────────────

/** Production users only ever see accepted articles; they get no reviews, decisions, plagiarism or APC data. */
async function loadProductionArticle(articleId: string, user: Actor) {
  const article = await prisma.article.findUnique({ where: { id: articleId } });
  if (!article) throw new NotFoundError('Article not found');
  if (user.role === Role.PRODUCTION) {
    if (!PRODUCTION_STATUSES.includes(article.status)) throw new NotFoundError('Article not found');
  } else if (user.role === Role.EDITOR) {
    if (article.editorId && article.editorId !== user.id) throw new NotFoundError('Article not found');
  } else if (user.role !== Role.ADMIN) {
    throw new ForbiddenError();
  }
  return article;
}

const queueSelect = {
  id: true,
  submissionId: true,
  title: true,
  status: true,
  acceptedAt: true,
  subjectArea: { select: { name: true } },
  productionTask: { select: { status: true, startedAt: true, assignedTo: { select: { id: true, firstName: true, lastName: true } } } },
} satisfies Prisma.ArticleSelect;

export async function queue(user: Actor, q: { page: number; pageSize: number; status?: S[]; search?: string; assignedToMe?: boolean }) {
  const statuses = (q.status?.length ? q.status : PRODUCTION_STATUSES).filter((s) => PRODUCTION_STATUSES.includes(s));
  const where: Prisma.ArticleWhereInput = {
    status: { in: statuses },
    ...(q.assignedToMe ? { productionTask: { assignedToId: user.id } } : {}),
    ...(q.search ? { OR: [{ title: { contains: q.search, mode: 'insensitive' } }, { submissionId: { contains: q.search, mode: 'insensitive' } }] } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.article.findMany({ where, select: queueSelect, orderBy: { acceptedAt: 'asc' }, ...skipTake(q) }),
    prisma.article.count({ where }),
  ]);
  return { items: items.map((a) => ({ ...a, statusLabel: STATUS_LABELS[a.status] })), meta: pageMeta(q, total) };
}

export async function getArticle(user: Actor, articleId: string) {
  await loadProductionArticle(articleId, user);
  const a = await prisma.article.findUniqueOrThrow({
    where: { id: articleId },
    select: {
      ...queueSelect,
      abstract: true,
      ethicsStatement: true,
      currentWordCount: true,
      coAuthors: { orderBy: { orderIndex: 'asc' }, select: { firstName: true, lastName: true, email: true, affiliation: true, isCorresponding: true } },
      keywords: { select: { keyword: true } },
      versions: { orderBy: { versionNumber: 'desc' }, take: 1, select: { versionNumber: true, wordCount: true, fileId: true } },
      proofs: { orderBy: { versionNumber: 'desc' }, select: { id: true, versionNumber: true, notes: true, sentToAuthorAt: true, authorStatus: true, authorRespondedAt: true, authorFeedback: true, fileId: true } },
      corrections: { orderBy: { createdAt: 'asc' }, select: { id: true, proofId: true, type: true, status: true, location: true, description: true, productionNote: true, editorNote: true, implementedAt: true, escalatedAt: true, editorDecidedAt: true } },
      publication: { select: { status: true, htmlFileId: true, pdfFileId: true, publishedAt: true, metadata: true } },
    },
  });
  const { keywords, ...rest } = a;
  return { ...rest, statusLabel: STATUS_LABELS[a.status], keywords: keywords.map((k) => k.keyword), currentManuscript: a.versions[0] ?? null };
}

// ───────────────────────────── assignment & start ─────────────────────────────

export async function assign(articleId: string, assigneeId: string, actor: Actor) {
  await loadProductionArticle(articleId, actor);
  if (actor.role === Role.PRODUCTION && assigneeId !== actor.id) throw new ForbiddenError('Production users can only assign themselves');
  const assignee = await prisma.user.findFirst({ where: { id: assigneeId, role: Role.PRODUCTION, status: 'ACTIVE' }, select: { id: true } });
  if (!assignee) throw new UnprocessableError('The selected user is not an active production user', 'INVALID_ASSIGNEE', [{ field: 'assigneeId', message: 'Not an active production user' }]);
  return transact(async (tx) => {
    const article = await tx.article.findUniqueOrThrow({ where: { id: articleId } });
    const task = await tx.productionTask.update({ where: { articleId }, data: { assignedToId: assigneeId } });
    await recordAudit(tx, { action: AuditAction.PRODUCTION_ASSIGNED, entityType: 'ProductionTask', entityId: task.id, actor, metadata: { articleId, assigneeId } });
    if (assigneeId !== actor.id) {
      await notify(tx, {
        userId: assigneeId,
        type: 'production.assigned',
        title: `Assigned: ${article.submissionId}`,
        message: `You were assigned production of “${article.title}”.`,
        template: 'production_pending',
        data: { submissionId: article.submissionId, title: article.title, link: links.productionArticle(articleId) },
        entityType: 'Article',
        entityId: articleId,
        dedupeKey: `production:${task.id}:assigned:${assigneeId}`,
      });
    }
    return { assignedToId: assigneeId };
  });
}

export async function start(articleId: string, actor: Actor) {
  await loadProductionArticle(articleId, actor);
  return transact(async (tx) => {
    await transitionArticle(tx, articleId, S.IN_PRODUCTION, actor, { expectedFrom: S.ACCEPTED_PRODUCTION_PENDING, reason: 'Production started' });
    const task = await tx.productionTask.findUniqueOrThrow({ where: { articleId } });
    await tx.productionTask.update({ where: { articleId }, data: { status: 'IN_PROGRESS', startedAt: new Date(), assignedToId: task.assignedToId ?? (actor.role === Role.PRODUCTION ? actor.id : null) } });
    await recordAudit(tx, { action: AuditAction.PRODUCTION_STARTED, entityType: 'Article', entityId: articleId, actor });
    return { status: S.IN_PRODUCTION, statusLabel: STATUS_LABELS[S.IN_PRODUCTION] };
  });
}

// ───────────────────────────── proofs ─────────────────────────────

async function deliverProof(tx: Tx, article: { id: string; authorId: string; submissionId: string; title: string }, proofId: string, actor: Actor) {
  const now = new Date();
  await tx.proofVersion.update({ where: { id: proofId }, data: { sentToAuthorAt: now, authorStatus: 'PENDING_REVIEW' } });
  await transitionArticle(tx, article.id, S.PROOF_SENT_TO_AUTHOR, actor, { expectedFrom: [S.IN_PRODUCTION, S.CORRECTION_REQUIRED], reason: 'Proof sent to author' });
  await tx.productionTask.update({ where: { articleId: article.id }, data: { status: 'AWAITING_AUTHOR' } });
  await recordAudit(tx, { action: AuditAction.PROOF_SENT, entityType: 'ProofVersion', entityId: proofId, actor, metadata: { articleId: article.id } });
  await notify(tx, {
    userId: article.authorId,
    type: 'proof.available',
    title: `Proof available: ${article.submissionId}`,
    message: `A proof of “${article.title}” is ready for your review.`,
    template: 'proof_available',
    data: { submissionId: article.submissionId, title: article.title, link: links.authorArticle(article.id) },
    entityType: 'Article',
    entityId: article.id,
    dedupeKey: `proof:${proofId}:sent`,
  });
}

export async function uploadProof(articleId: string, input: { notes?: string; sendToAuthor: boolean }, file: UploadedFile, actor: Actor) {
  const article = await loadProductionArticle(articleId, actor);
  if (article.status !== S.IN_PRODUCTION && article.status !== S.CORRECTION_REQUIRED) {
    throw new ConflictError(`Proofs can only be uploaded while the article is “${STATUS_LABELS[S.IN_PRODUCTION]}” or “${STATUS_LABELS[S.CORRECTION_REQUIRED]}”`, 'INVALID_STATE_TRANSITION');
  }
  const staged = [await stageFile(file, FilePurpose.PROOF)];
  return withStaged(staged, () =>
    transact(async (tx) => {
      const asset = await createAsset(tx, staged[0]!, { articleId, uploadedById: actor.id });
      const last = await tx.proofVersion.aggregate({ where: { articleId }, _max: { versionNumber: true } });
      // A newer proof supersedes any earlier proof still awaiting the author.
      await tx.proofVersion.updateMany({ where: { articleId, authorStatus: { in: ['PENDING_DELIVERY', 'PENDING_REVIEW'] } }, data: { authorStatus: 'SUPERSEDED' } });
      const proof = await tx.proofVersion.create({
        data: { articleId, versionNumber: (last._max.versionNumber ?? 0) + 1, fileId: asset.id, notes: input.notes, uploadedById: actor.id },
      });
      await recordAudit(tx, { action: AuditAction.PROOF_UPLOADED, entityType: 'ProofVersion', entityId: proof.id, actor, metadata: { articleId, versionNumber: proof.versionNumber } });
      if (input.sendToAuthor) await deliverProof(tx, article, proof.id, actor);
      return { proofId: proof.id, versionNumber: proof.versionNumber, sentToAuthor: input.sendToAuthor, fileId: asset.id };
    }),
  );
}

export async function sendProof(articleId: string, proofId: string, actor: Actor) {
  const article = await loadProductionArticle(articleId, actor);
  return transact(async (tx) => {
    const proof = await tx.proofVersion.findFirst({ where: { id: proofId, articleId } });
    if (!proof) throw new NotFoundError('Proof not found');
    if (proof.authorStatus !== 'PENDING_DELIVERY') throw new ConflictError('This proof has already been sent or superseded', 'PROOF_NOT_SENDABLE');
    await deliverProof(tx, article, proofId, actor);
    return { status: S.PROOF_SENT_TO_AUTHOR };
  });
}

export async function listProofs(user: Actor, articleId: string) {
  await loadProductionArticle(articleId, user);
  return prisma.proofVersion.findMany({
    where: { articleId },
    orderBy: { versionNumber: 'desc' },
    select: { id: true, versionNumber: true, notes: true, sentToAuthorAt: true, authorStatus: true, authorRespondedAt: true, authorFeedback: true, fileId: true, createdAt: true },
  });
}

// ───────────────────────────── author proof review ─────────────────────────────

export async function authorListProofs(userId: string, articleId: string) {
  await loadOwnArticle(articleId, userId);
  return prisma.proofVersion.findMany({
    where: { articleId, sentToAuthorAt: { not: null } },
    orderBy: { versionNumber: 'desc' },
    select: {
      id: true, versionNumber: true, sentToAuthorAt: true, authorStatus: true, authorRespondedAt: true, authorFeedback: true, fileId: true,
      corrections: { select: { id: true, type: true, status: true, location: true, description: true, createdAt: true } },
    },
  });
}

async function openProof(tx: Tx, articleId: string, proofId: string) {
  const proof = await tx.proofVersion.findFirst({ where: { id: proofId, articleId } });
  if (!proof || !proof.sentToAuthorAt) throw new NotFoundError('Proof not found');
  if (proof.authorStatus !== 'PENDING_REVIEW') throw new ConflictError('This proof is no longer awaiting your review', 'PROOF_NOT_PENDING');
  return proof;
}

async function notifyProduction(tx: Tx, articleId: string, article: { submissionId: string; title: string }, template: string, type: string, key: string, title: string, message: string) {
  const task = await tx.productionTask.findUnique({ where: { articleId }, select: { assignedToId: true } });
  const recipients = task?.assignedToId ? [task.assignedToId] : await productionRecipients(tx);
  await notifyMany(tx, recipients, {
    type, title, message, template,
    data: { submissionId: article.submissionId, title: article.title, link: links.productionArticle(articleId) },
    entityType: 'Article', entityId: articleId, dedupeKey: key,
  });
}

export async function approveProof(user: Express.AuthUser, articleId: string, proofId: string, feedback?: string) {
  const article = await loadOwnArticle(articleId, user.id);
  return transact(async (tx) => {
    const proof = await openProof(tx, articleId, proofId);
    await tx.proofVersion.update({ where: { id: proof.id }, data: { authorStatus: 'APPROVED', authorRespondedAt: new Date(), authorFeedback: feedback } });
    await transitionArticle(tx, articleId, S.FINAL_PRODUCTION, user, { expectedFrom: S.PROOF_SENT_TO_AUTHOR, reason: 'Author approved proof' });
    await tx.productionTask.update({ where: { articleId }, data: { status: 'FINALIZING' } });
    await recordAudit(tx, { action: AuditAction.PROOF_APPROVED, entityType: 'ProofVersion', entityId: proof.id, actor: user, metadata: { articleId } });
    await notifyProduction(tx, articleId, article, 'proof_approved_production', 'proof.approved', `proof:${proof.id}:approved`, `Proof approved: ${article.submissionId}`, 'The author approved the proof.');
    return { status: S.FINAL_PRODUCTION, statusLabel: STATUS_LABELS[S.FINAL_PRODUCTION] };
  });
}

export async function submitCorrections(user: Express.AuthUser, articleId: string, proofId: string, input: { feedback?: string; corrections: Array<{ type: 'MINOR' | 'MAJOR'; location?: string; description: string }> }) {
  const article = await loadOwnArticle(articleId, user.id);
  return transact(async (tx) => {
    const proof = await openProof(tx, articleId, proofId);
    const now = new Date();
    await tx.proofVersion.update({ where: { id: proof.id }, data: { authorStatus: 'CORRECTIONS_REQUESTED', authorRespondedAt: now, authorFeedback: input.feedback } });
    for (const c of input.corrections) {
      await tx.correction.create({
        data: {
          articleId,
          proofId,
          type: c.type,
          location: c.location,
          description: c.description,
          requestedById: user.id,
          // Major content changes go straight to the Editor (BR-019); they never reach Production unapproved.
          status: c.type === 'MAJOR' ? 'ESCALATED' : 'OPEN',
          escalatedAt: c.type === 'MAJOR' ? now : null,
        },
      });
    }
    await transitionArticle(tx, articleId, S.CORRECTION_REQUIRED, user, { expectedFrom: S.PROOF_SENT_TO_AUTHOR, reason: 'Author requested corrections' });
    await recordAudit(tx, { action: AuditAction.CORRECTIONS_SUBMITTED, entityType: 'ProofVersion', entityId: proofId, actor: user, metadata: { articleId, count: input.corrections.length, major: input.corrections.filter((c) => c.type === 'MAJOR').length } });

    const hasMajor = input.corrections.some((c) => c.type === 'MAJOR');
    if (hasMajor) await routeToEditor(tx, article, user);
    else await tx.productionTask.update({ where: { articleId }, data: { status: 'CORRECTIONS' } });
    await notifyProduction(tx, articleId, article, 'corrections_received_production', 'proof.corrections', `proof:${proofId}:corrections`, `Corrections received: ${article.submissionId}`, 'The author returned corrections.');
    return { status: hasMajor ? S.MAJOR_CONTENT_CHANGE_EDITOR_REVIEW : S.CORRECTION_REQUIRED, corrections: input.corrections.length };
  });
}

// ───────────────────────────── corrections & major changes ─────────────────────────────

async function routeToEditor(tx: Tx, article: { id: string; editorId: string | null; submissionId: string; title: string }, actor: Actor) {
  await transitionArticle(tx, article.id, S.MAJOR_CONTENT_CHANGE_EDITOR_REVIEW, actor, { expectedFrom: S.CORRECTION_REQUIRED, reason: 'Major content change routed to Editor' });
  await tx.productionTask.update({ where: { articleId: article.id }, data: { status: 'AWAITING_EDITOR' } });
  await notifyMany(tx, await editorialRecipients(tx, article), {
    type: 'production.major_change',
    title: `Major content change: ${article.submissionId}`,
    message: `A major content change for “${article.title}” needs your decision.`,
    template: 'major_change_editor',
    data: { submissionId: article.submissionId, title: article.title, link: links.editorArticle(article.id) },
    entityType: 'Article',
    entityId: article.id,
    dedupeKey: `article:${article.id}:major-change:${Date.now()}`,
  });
}

export async function listCorrections(user: Actor, articleId: string) {
  await loadProductionArticle(articleId, user);
  return prisma.correction.findMany({
    where: { articleId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, proofId: true, type: true, status: true, location: true, description: true, productionNote: true, editorNote: true, implementedAt: true, escalatedAt: true, editorDecidedAt: true },
  });
}

export async function implementCorrection(correctionId: string, note: string | undefined, actor: Actor) {
  const c = await prisma.correction.findUnique({ where: { id: correctionId } });
  if (!c) throw new NotFoundError('Correction not found');
  await loadProductionArticle(c.articleId, actor);
  return transact(async (tx) => {
    const article = await tx.article.findUniqueOrThrow({ where: { id: c.articleId }, select: { status: true } });
    if (article.status !== S.CORRECTION_REQUIRED) throw new ConflictError('Corrections can only be implemented while the article is in “Correction Required”', 'INVALID_STATE_TRANSITION');
    const claimed = await tx.correction.updateMany({
      where: { id: correctionId, OR: [{ type: 'MINOR', status: 'OPEN' }, { type: 'MAJOR', status: 'APPROVED_BY_EDITOR' }] },
      data: { status: 'IMPLEMENTED', implementedAt: new Date(), implementedById: actor.id, productionNote: note },
    });
    if (claimed.count !== 1) throw new ConflictError('This correction cannot be implemented in its current state (major changes need Editor approval first)', 'CORRECTION_NOT_IMPLEMENTABLE');
    await recordAudit(tx, { action: AuditAction.CORRECTION_IMPLEMENTED, entityType: 'Correction', entityId: correctionId, actor, metadata: { articleId: c.articleId } });
    return { status: 'IMPLEMENTED' };
  });
}

/** Production reclassifies an open correction as a major content change; it is held for the Editor. */
export async function escalateCorrection(correctionId: string, reason: string, actor: Actor) {
  const c = await prisma.correction.findUnique({ where: { id: correctionId } });
  if (!c) throw new NotFoundError('Correction not found');
  await loadProductionArticle(c.articleId, actor);
  return transact(async (tx) => {
    const article = await tx.article.findUniqueOrThrow({ where: { id: c.articleId } });
    const claimed = await tx.correction.updateMany({ where: { id: correctionId, status: 'OPEN' }, data: { type: 'MAJOR', status: 'ESCALATED', escalatedAt: new Date(), productionNote: reason } });
    if (claimed.count !== 1) throw new ConflictError('Only open corrections can be escalated', 'CORRECTION_NOT_ESCALATABLE');
    await recordAudit(tx, { action: AuditAction.CORRECTION_ESCALATED, entityType: 'Correction', entityId: correctionId, actor, metadata: { articleId: c.articleId } });
    if (article.status === S.CORRECTION_REQUIRED) await routeToEditor(tx, article, actor);
    else if (article.status !== S.MAJOR_CONTENT_CHANGE_EDITOR_REVIEW) throw new ConflictError('Corrections can only be escalated while corrections are being handled', 'INVALID_STATE_TRANSITION');
    return { status: 'ESCALATED' };
  });
}

export async function listMajorChanges(user: Actor, q: { page: number; pageSize: number; pending?: boolean }) {
  const where: Prisma.CorrectionWhereInput = {
    type: 'MAJOR',
    status: q.pending === false ? { not: 'ESCALATED' } : 'ESCALATED',
    article: user.role === Role.ADMIN ? {} : { OR: [{ editorId: null }, { editorId: user.id }] },
  };
  const [items, total] = await Promise.all([
    prisma.correction.findMany({
      where,
      orderBy: { escalatedAt: 'asc' },
      ...skipTake(q),
      select: { id: true, status: true, location: true, description: true, productionNote: true, escalatedAt: true, editorNote: true, editorDecidedAt: true, article: { select: { id: true, submissionId: true, title: true } } },
    }),
    prisma.correction.count({ where }),
  ]);
  return { items, meta: pageMeta(q, total) };
}

export async function decideMajorChange(correctionId: string, input: { decision: 'APPROVE' | 'REJECT'; note?: string }, actor: Actor) {
  const c = await prisma.correction.findUnique({ where: { id: correctionId } });
  if (!c) throw new NotFoundError('Correction not found');
  if (!isEditorial(actor.role)) throw new ForbiddenError();
  return transact(async (tx) => {
    const article = await loadArticleForEditorial(c.articleId, actor, tx);
    const approve = input.decision === 'APPROVE';
    const claimed = await tx.correction.updateMany({
      where: { id: correctionId, status: 'ESCALATED' },
      data: { status: approve ? 'APPROVED_BY_EDITOR' : 'REJECTED_BY_EDITOR', editorDecidedById: actor.id, editorDecidedAt: new Date(), editorNote: input.note },
    });
    if (claimed.count !== 1) throw new ConflictError('This change is not awaiting an Editor decision', 'NOT_PENDING');
    await recordAudit(tx, { action: AuditAction.MAJOR_CHANGE_DECISION, entityType: 'Correction', entityId: correctionId, actor, metadata: { articleId: c.articleId, decision: input.decision } });

    const stillPending = await tx.correction.count({ where: { articleId: c.articleId, status: 'ESCALATED' } });
    if (stillPending === 0 && article.status === S.MAJOR_CONTENT_CHANGE_EDITOR_REVIEW) {
      await transitionArticle(tx, c.articleId, S.CORRECTION_REQUIRED, actor, { reason: 'Editor decided all major content changes' });
      await tx.productionTask.update({ where: { articleId: c.articleId }, data: { status: 'CORRECTIONS' } });
    }
    await notifyProduction(tx, c.articleId, article, 'major_change_decided', 'production.major_change_decided', `correction:${correctionId}:decided`, `Major change decision: ${article.submissionId}`, `The Editor ${approve ? 'approved' : 'rejected'} a major content change.`);
    return { decision: input.decision, articleStatus: stillPending === 0 ? S.CORRECTION_REQUIRED : article.status };
  });
}

// ───────────────────────────── final files & completion ─────────────────────────────

export async function uploadFinalFile(articleId: string, kind: 'html' | 'pdf', file: UploadedFile, actor: Actor) {
  const article = await loadProductionArticle(articleId, actor);
  if (file.ext !== kind) throw new UnprocessableError(`The final ${kind.toUpperCase()} file must be a .${kind} file`, 'INVALID_FINAL_FILE', [{ field: 'file', message: `Expected a .${kind} file` }]);
  if (article.status !== S.FINAL_PRODUCTION) throw new ConflictError(`Final files can only be uploaded while the article is “${STATUS_LABELS[S.FINAL_PRODUCTION]}”`, 'INVALID_STATE_TRANSITION');
  const staged = [await stageFile(file, kind === 'html' ? FilePurpose.FINAL_HTML : FilePurpose.FINAL_PDF)];
  return withStaged(staged, () =>
    transact(async (tx) => {
      const asset = await createAsset(tx, staged[0]!, { articleId, uploadedById: actor.id });
      await tx.publication.upsert({
        where: { articleId },
        create: { articleId, ...(kind === 'html' ? { htmlFileId: asset.id } : { pdfFileId: asset.id }) },
        update: kind === 'html' ? { htmlFileId: asset.id } : { pdfFileId: asset.id },
      });
      // Replacing a file after hand-off re-opens production completion.
      await tx.productionTask.update({ where: { articleId }, data: { status: 'FINALIZING', completedAt: null } });
      await recordAudit(tx, { action: AuditAction.FINAL_FILE_UPLOADED, entityType: 'Article', entityId: articleId, actor, metadata: { kind, fileId: asset.id } });
      return { fileId: asset.id, kind };
    }),
  );
}

export async function completeProduction(articleId: string, actor: Actor) {
  const article = await loadProductionArticle(articleId, actor);
  if (article.status !== S.FINAL_PRODUCTION) throw new ConflictError(`Production can only be completed while the article is “${STATUS_LABELS[S.FINAL_PRODUCTION]}”`, 'INVALID_STATE_TRANSITION');
  return transact(async (tx) => {
    const pub = await tx.publication.findUnique({ where: { articleId } });
    if (!pub?.htmlFileId || !pub.pdfFileId) throw new ConflictError('Both the final HTML and PDF files are required', 'FINAL_FILES_REQUIRED');
    await tx.productionTask.update({ where: { articleId }, data: { status: 'COMPLETED', completedAt: new Date() } });
    await recordAudit(tx, { action: AuditAction.PRODUCTION_COMPLETED, entityType: 'Article', entityId: articleId, actor });
    await notifyMany(tx, await editorialRecipients(tx, article), {
      type: 'production.completed',
      title: `Production complete: ${article.submissionId}`,
      message: `Final files for “${article.title}” are ready for publication.`,
      template: 'production_complete',
      data: { submissionId: article.submissionId, title: article.title, link: links.editorArticle(articleId) },
      entityType: 'Article',
      entityId: articleId,
      dedupeKey: `article:${articleId}:production-complete:${pub.htmlFileId}:${pub.pdfFileId}`,
    });
    return { completed: true };
  });
}
