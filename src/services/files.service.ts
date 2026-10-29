import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { FilePurpose, Role, type FileAsset } from '@prisma/client';
import { logger } from '../config/logger';
import { prisma, type Db } from '../config/prisma';
import { PRODUCTION_STATUSES, ArticleStatus } from '../constants/workflow';
import { storage } from '../storage';
import type { UploadedFile } from '../middlewares/upload';
import { sha256 } from '../utils/crypto';
import { scrubDocxMetadata } from '../utils/docx';
import { ForbiddenError, NotFoundError } from '../utils/errors';
import { isEditorial } from '../constants/roles';
import { editorialCanAccess } from './access';
import { AuditAction, recordAudit } from './audit.service';

export interface StagedFile {
  storageKey: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  purpose: FilePurpose;
}

/** Writes the object to storage under a server-generated key. The DB row is created later inside the business transaction. */
export async function stageFile(file: UploadedFile, purpose: FilePurpose): Promise<StagedFile> {
  const now = new Date();
  const storageKey = `${purpose.toLowerCase()}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}.${file.ext}`;
  await storage.put(storageKey, file.buffer, file.mime);
  return { storageKey, originalName: file.originalName, mimeType: file.mime, sizeBytes: file.size, sha256: sha256(file.buffer), purpose };
}

export async function discardStaged(files: StagedFile[]): Promise<void> {
  await Promise.all(
    files.map((f) =>
      storage.delete(f.storageKey).catch((err) => logger.warn({ key: f.storageKey, err: (err as Error).message }, 'could not remove orphaned object')),
    ),
  );
}

/** Runs `fn`; if it throws, the staged objects are removed so no orphan files are left behind. */
export async function withStaged<T>(staged: StagedFile[], fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    await discardStaged(staged);
    throw err;
  }
}

export function createAsset(db: Db, f: StagedFile, meta: { articleId?: string | null; uploadedById?: string | null }) {
  return db.fileAsset.create({
    data: {
      storageKey: f.storageKey,
      originalName: f.originalName,
      mimeType: f.mimeType,
      sizeBytes: f.sizeBytes,
      sha256: f.sha256,
      purpose: f.purpose,
      articleId: meta.articleId ?? null,
      uploadedById: meta.uploadedById ?? null,
    },
  });
}

// ───────────────────────────── authorised download ─────────────────────────────

const safeSlug = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80);

interface Decision {
  filename: string;
  scrub: boolean;
}

/**
 * Decides whether `user` may download `asset`, and under what name. Reviewer downloads use a neutral filename and
 * have document metadata scrubbed so author identity cannot leak through file names or properties.
 */
async function authorise(user: Pick<Express.AuthUser, 'id' | 'role'>, asset: FileAsset): Promise<Decision> {
  const ext = asset.storageKey.split('.').pop() ?? 'bin';
  const article = asset.articleId ? await prisma.article.findUnique({ where: { id: asset.articleId } }) : null;
  const deny = () => new NotFoundError('File not found');
  const base = article ? safeSlug(article.submissionId) : 'file';
  const editorial = isEditorial(user.role) && (!article || editorialCanAccess(user, article));
  const ownsArticle = !!article && user.role === Role.AUTHOR && article.authorId === user.id;
  const inProduction = !!article && user.role === Role.PRODUCTION && PRODUCTION_STATUSES.includes(article.status);

  switch (asset.purpose) {
    case FilePurpose.MANUSCRIPT: {
      const version = await prisma.manuscriptVersion.findUnique({ where: { fileId: asset.id } });
      const name = `${base}-manuscript-v${version?.versionNumber ?? 1}.${ext}`;
      if (editorial || ownsArticle || inProduction) return { filename: name, scrub: false };
      if (user.role === Role.REVIEWER && version) {
        const live = await prisma.reviewerAssignment.findFirst({
          where: { versionId: version.id, status: { in: ['ASSIGNED', 'SUBMITTED'] }, reviewer: { userId: user.id } },
          select: { id: true },
        });
        if (live) return { filename: `manuscript.${ext}`, scrub: true };
      }
      throw deny();
    }
    case FilePurpose.TITLE_PAGE:
      if (editorial || ownsArticle) return { filename: `${base}-title-page.${ext}`, scrub: false };
      throw deny();
    case FilePurpose.PLAGIARISM_REPORT:
    case FilePurpose.REVIEWER_CV:
      if (editorial) return { filename: `${base}-${asset.purpose.toLowerCase()}.${ext}`, scrub: false };
      throw deny();
    case FilePurpose.PROOF: {
      const proof = await prisma.proofVersion.findUnique({ where: { fileId: asset.id } });
      const name = `${base}-proof-v${proof?.versionNumber ?? 1}.${ext}`;
      if (editorial || inProduction) return { filename: name, scrub: false };
      if (ownsArticle && proof?.sentToAuthorAt) return { filename: name, scrub: false };
      throw deny();
    }
    case FilePurpose.FINAL_HTML:
    case FilePurpose.FINAL_PDF: {
      const name = `${base}.${ext}`;
      const afterFinal = !!article && ([ArticleStatus.FINAL_PRODUCTION, ArticleStatus.PUBLISHED] as ArticleStatus[]).includes(article.status);
      if (editorial || inProduction || (ownsArticle && afterFinal)) return { filename: name, scrub: false };
      throw deny();
    }
  }
}

async function send(res: Response, asset: FileAsset, d: Decision) {
  let body = await storage.get(asset.storageKey).catch(() => {
    throw new NotFoundError('File not found');
  });
  if (d.scrub && asset.storageKey.endsWith('.docx')) body = await scrubDocxMetadata(body);
  res.setHeader('Content-Type', asset.mimeType);
  res.setHeader('Content-Length', body.length);
  res.setHeader('Content-Disposition', `attachment; filename="${safeSlug(d.filename)}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
  res.end(body);
}

export async function downloadFile(user: Express.AuthUser, fileId: string, res: Response) {
  const asset = await prisma.fileAsset.findUnique({ where: { id: fileId } });
  if (!asset) throw new NotFoundError('File not found');
  const decision = await authorise(user, asset);
  await recordAudit(prisma, { action: AuditAction.FILE_DOWNLOADED, entityType: 'FileAsset', entityId: asset.id, actor: user, metadata: { purpose: asset.purpose, articleId: asset.articleId } });
  await send(res, asset, decision);
}

/** Public download of the final files of a *published* article. */
export async function downloadPublished(submissionId: string, kind: 'html' | 'pdf', res: Response) {
  const pub = await prisma.publication.findFirst({
    where: { status: 'PUBLISHED', article: { submissionId } },
    include: { htmlFile: true, pdfFile: true },
  });
  const asset = kind === 'html' ? pub?.htmlFile : pub?.pdfFile;
  if (!pub || !asset) throw new NotFoundError('Publication file not found');
  const body = await storage.get(asset.storageKey).catch(() => {
    throw new NotFoundError('Publication file not found');
  });
  res.setHeader('Content-Type', asset.mimeType);
  res.setHeader('Content-Length', body.length);
  res.setHeader('Content-Disposition', `inline; filename="${safeSlug(submissionId)}.${kind}"`);
  res.setHeader('Cache-Control', 'public, max-age=300');
  // Published HTML is rendered without scripts or active content; PDFs need the browser's viewer, so no CSP there.
  if (kind === 'html') res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data: https:");
  res.end(body);
}

export { ForbiddenError };
