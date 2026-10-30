import { ArticleStatus as S, FilePurpose, Prisma, type PlagiarismVerdict } from '@prisma/client';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { prisma } from '../config/prisma';
import { STATUS_LABELS } from '../constants/workflow';
import { getPlagiarismProvider } from '../providers/plagiarism.provider';
import type { UploadedFiles } from '../middlewares/upload';
import { storage } from '../storage';
import { transact, type Actor } from '../utils/context';
import { hmacSha256Hex, safeEqualHex } from '../utils/crypto';
import { ConflictError, NotFoundError, ServiceUnavailableError, UnauthorizedError } from '../utils/errors';
import { loadArticleForEditorial } from './access';
import { AuditAction, recordAudit } from './audit.service';
import { createAsset, stageFile, withStaged } from './files.service';
import { notify } from './notification.service';
import { transitionArticle } from './workflow.service';
import { links } from '../templates/links';
import { checkPlagiarism } from './plagiarism';

const checkView = {
  id: true, status: true, source: true, provider: true, providerReference: true, similarityScore: true, verdict: true,
  reportFileId: true, notes: true, errorMessage: true, completedAt: true, createdAt: true, versionId: true,
} satisfies Prisma.PlagiarismCheckSelect;

async function currentVersion(articleId: string) {
  return prisma.manuscriptVersion.findFirstOrThrow({ where: { articleId }, orderBy: { versionNumber: 'desc' }, include: { file: true } });
}

function requirePlagiarismStage(status: S) {
  if (status !== S.PLAGIARISM_CHECK) {
    throw new ConflictError(`Plagiarism checks are only available while the article is “${STATUS_LABELS[S.PLAGIARISM_CHECK]}”`, 'INVALID_STATE_TRANSITION');
  }
}

export async function listChecks(articleId: string, actor: Actor) {
  await loadArticleForEditorial(articleId, actor);
  return prisma.plagiarismCheck.findMany({ where: { articleId }, orderBy: { createdAt: 'desc' }, select: checkView });
}

/** Sends the current manuscript to the configured provider. A provider failure is stored as FAILED — never as a result. */
export async function initiateCheck(articleId: string, actor: Actor) {
  const article = await loadArticleForEditorial(articleId, actor);
  requirePlagiarismStage(article.status);
  const provider = getPlagiarismProvider();
  const version = await currentVersion(articleId);

  const open = await prisma.plagiarismCheck.findFirst({ where: { articleId, versionId: version.id, status: { in: ['PENDING', 'IN_PROGRESS'] } } });
  if (open) throw new ConflictError('A plagiarism check is already in progress for this manuscript version', 'CHECK_IN_PROGRESS');

  const check = await transact(async (tx) => {
    const c = await tx.plagiarismCheck.create({
      data: { articleId, versionId: version.id, status: 'PENDING', source: 'API', provider: provider.name, initiatedById: actor.id },
    });
    await recordAudit(tx, { action: AuditAction.PLAGIARISM_INITIATED, entityType: 'PlagiarismCheck', entityId: c.id, actor, metadata: { articleId, provider: provider.name } });
    return c;
  });

  try {
    const file = await storage.get(version.file.storageKey);
    const { providerReference } = await provider.submit({ articleId, submissionId: article.submissionId, fileName: `${article.submissionId}.docx`, file });
    return await prisma.plagiarismCheck.update({ where: { id: check.id }, data: { status: 'IN_PROGRESS', providerReference }, select: checkView });
  } catch (err) {
    const msg = (err as Error).message.slice(0, 300);
    logger.error({ err: msg, checkId: check.id }, 'plagiarism provider submission failed');
    await prisma.plagiarismCheck.update({ where: { id: check.id }, data: { status: 'FAILED', errorMessage: msg } });
    throw new ServiceUnavailableError('The plagiarism provider could not accept the manuscript. You can retry or record the result manually.', 'PLAGIARISM_PROVIDER_ERROR');
  }
}

const BUILT_IN = 'built-in';

/**
 * Runs the built-in engine (internal DB comparison + web search) on the current manuscript. The check is created
 * IN_PROGRESS and the response returns immediately; the engine finishes in the background and stores the report on the
 * check (poll `listChecks`, fetch the report with `getCheckReport`). Failures are stored as FAILED — never as a result.
 */
export async function runBuiltInCheck(articleId: string, actor: Actor) {
  const article = await loadArticleForEditorial(articleId, actor);
  requirePlagiarismStage(article.status);
  const version = await currentVersion(articleId);

  // A check older than this is assumed lost (e.g. the server restarted mid-run) and no longer blocks a new one.
  const staleBefore = new Date(Date.now() - 15 * 60_000);
  const open = await prisma.plagiarismCheck.findFirst({ where: { articleId, versionId: version.id, status: { in: ['PENDING', 'IN_PROGRESS'] }, createdAt: { gt: staleBefore } } });
  if (open) throw new ConflictError('A plagiarism check is already in progress for this manuscript version', 'CHECK_IN_PROGRESS');

  const check = await transact(async (tx) => {
    const c = await tx.plagiarismCheck.create({
      data: { articleId, versionId: version.id, status: 'IN_PROGRESS', source: 'API', provider: BUILT_IN, initiatedById: actor.id },
      select: checkView,
    });
    await recordAudit(tx, { action: AuditAction.PLAGIARISM_INITIATED, entityType: 'PlagiarismCheck', entityId: c.id, actor, metadata: { articleId, provider: BUILT_IN } });
    return c;
  });

  void checkPlagiarism({ versionId: version.id })
    .then((report) =>
      prisma.plagiarismCheck.update({
        where: { id: check.id },
        data: { status: 'COMPLETED', similarityScore: report.totalPlagiarismScore, report: report as unknown as Prisma.InputJsonValue, completedAt: new Date() },
      }),
    )
    .catch(async (err: Error) => {
      logger.error({ err: err.message, checkId: check.id }, 'built-in plagiarism check failed');
      await prisma.plagiarismCheck
        .update({ where: { id: check.id }, data: { status: 'FAILED', errorMessage: err.message.slice(0, 300), completedAt: new Date() } })
        .catch((e: Error) => logger.error({ err: e.message, checkId: check.id }, 'could not record plagiarism failure'));
    });

  return check;
}

/** The detailed report (scores + matched sources) of a completed built-in check. */
export async function getCheckReport(articleId: string, checkId: string, actor: Actor) {
  await loadArticleForEditorial(articleId, actor);
  const check = await prisma.plagiarismCheck.findFirst({ where: { id: checkId, articleId }, select: { ...checkView, report: true } });
  if (!check) throw new NotFoundError('Plagiarism check not found');
  return check;
}

export interface ManualCheckInput {
  similarityScore: number;
  verdict: PlagiarismVerdict;
  provider?: string;
  providerReference?: string;
  notes?: string;
}

/** Fallback when the provider API is unavailable: the Editor records (and optionally uploads) the report. */
export async function recordManualCheck(articleId: string, input: ManualCheckInput, files: UploadedFiles, actor: Actor) {
  const article = await loadArticleForEditorial(articleId, actor);
  requirePlagiarismStage(article.status);
  const version = await currentVersion(articleId);
  const report = files.report?.[0];
  const staged = report ? [await stageFile(report, FilePurpose.PLAGIARISM_REPORT)] : [];

  return withStaged(staged, () =>
    transact(async (tx) => {
      const asset = staged[0] ? await createAsset(tx, staged[0], { articleId, uploadedById: actor.id }) : null;
      const c = await tx.plagiarismCheck.create({
        data: {
          articleId,
          versionId: version.id,
          status: 'COMPLETED',
          source: 'MANUAL',
          provider: input.provider,
          providerReference: input.providerReference,
          similarityScore: input.similarityScore,
          verdict: input.verdict,
          notes: input.notes,
          reportFileId: asset?.id,
          initiatedById: actor.id,
          completedAt: new Date(),
        },
        select: checkView,
      });
      await recordAudit(tx, { action: AuditAction.PLAGIARISM_RECORDED, entityType: 'PlagiarismCheck', entityId: c.id, actor, metadata: { articleId, source: 'MANUAL', verdict: input.verdict, similarityScore: input.similarityScore } });
      return c;
    }),
  );
}

/** For API-sourced results: the Editor records their judgement (verdict) after viewing the provider's similarity score. */
export async function setVerdict(articleId: string, checkId: string, verdict: PlagiarismVerdict, notes: string | undefined, actor: Actor) {
  const article = await loadArticleForEditorial(articleId, actor);
  requirePlagiarismStage(article.status);
  const check = await prisma.plagiarismCheck.findFirst({ where: { id: checkId, articleId } });
  if (!check) throw new NotFoundError('Plagiarism check not found');
  if (check.status !== 'COMPLETED') throw new ConflictError('The check has not completed yet', 'CHECK_NOT_COMPLETED');
  return transact(async (tx) => {
    const c = await tx.plagiarismCheck.update({ where: { id: checkId }, data: { verdict, notes: notes ?? check.notes }, select: checkView });
    await recordAudit(tx, { action: AuditAction.PLAGIARISM_RECORDED, entityType: 'PlagiarismCheck', entityId: checkId, actor, metadata: { articleId, verdict } });
    return c;
  });
}

/** Provider callback. Authenticated with an HMAC over the raw body; idempotent for redelivery. */
export async function handleProviderResult(rawBody: Buffer | undefined, signature: string | undefined, body: { providerReference: string; status: 'COMPLETED' | 'FAILED'; similarityScore?: number; errorMessage?: string }) {
  const secret = env.PLAGIARISM_WEBHOOK_SECRET;
  if (!secret || !rawBody || !signature || !safeEqualHex(hmacSha256Hex(secret, rawBody), signature.replace(/^sha256=/, ''))) {
    throw new UnauthorizedError('Invalid webhook signature', 'WEBHOOK_INVALID');
  }
  const check = await prisma.plagiarismCheck.findUnique({ where: { providerReference: body.providerReference } });
  if (!check) return { matched: false };
  if (check.status === 'COMPLETED' || check.status === 'FAILED') return { matched: true, duplicate: true };
  await transact(async (tx) => {
    const done = body.status === 'COMPLETED';
    const claimed = await tx.plagiarismCheck.updateMany({
      where: { id: check.id, status: { in: ['PENDING', 'IN_PROGRESS'] } },
      data: { status: body.status, similarityScore: done ? body.similarityScore : undefined, errorMessage: done ? undefined : (body.errorMessage ?? 'Provider reported failure').slice(0, 300), completedAt: new Date() },
    });
    if (claimed.count === 1) {
      await recordAudit(tx, { action: AuditAction.PLAGIARISM_RECORDED, entityType: 'PlagiarismCheck', entityId: check.id, metadata: { articleId: check.articleId, source: 'API', status: body.status } });
    }
  });
  return { matched: true, duplicate: false };
}

/** Editor's gate after the check: clear the article for reviewers, or reject it. */
export async function clearance(articleId: string, input: { action: 'CLEAR' | 'REJECT'; notes?: string; authorMessage?: string }, actor: Actor) {
  return transact(async (tx) => {
    const article = await loadArticleForEditorial(articleId, actor, tx);
    const clear = input.action === 'CLEAR';
    if (!clear) {
      const done = await tx.plagiarismCheck.count({ where: { articleId, status: 'COMPLETED' } });
      if (done === 0) throw new ConflictError('Record a completed plagiarism check before rejecting', 'PLAGIARISM_REQUIRED');
    }
    const to = clear ? S.READY_FOR_REVIEWER_ASSIGNMENT : S.REJECTED;
    const { from } = await transitionArticle(tx, articleId, to, actor, {
      expectedFrom: S.PLAGIARISM_CHECK,
      reason: clear ? 'Plagiarism check cleared' : 'Rejected after plagiarism check',
    });
    const d = await tx.editorialDecision.create({
      data: { articleId, decision: clear ? 'CLEAR_FOR_REVIEW' : 'REJECT_AFTER_PLAGIARISM', fromStatus: from, toStatus: to, notes: input.notes, authorMessage: clear ? undefined : input.authorMessage, decidedById: actor.id },
    });
    await recordAudit(tx, { action: AuditAction.PLAGIARISM_CLEARANCE, entityType: 'Article', entityId: articleId, actor, fromStatus: from, toStatus: to, metadata: { action: input.action, decisionId: d.id } });
    if (!clear) {
      await notify(tx, {
        userId: article.authorId,
        type: 'article.rejected',
        title: `Editorial decision for ${article.submissionId}`,
        message: 'Decision: Rejected.',
        template: 'decision_author',
        data: { submissionId: article.submissionId, title: article.title, decision: 'Rejected', message: input.authorMessage, link: links.authorArticle(articleId) },
        entityType: 'Article',
        entityId: articleId,
        dedupeKey: `decision:${d.id}`,
      });
    }
    return { status: to, statusLabel: STATUS_LABELS[to] };
  });
}
