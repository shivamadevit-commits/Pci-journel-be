import fs from 'node:fs/promises';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { prisma } from '../../config/prisma';
import { storage } from '../../storage';
import { AppError, NotFoundError, UnprocessableError } from '../../utils/errors';
import type { PlagiarismReport } from './analyze';
import type { CorpusDoc } from './internal-check';
import { extractText } from './text-extract';

export type { PlagiarismReport } from './analyze';

/** A check that runs longer than this is aborted and reported as failed. */
const WORKER_TIMEOUT_MS = 10 * 60_000;

export type CheckInput =
  | { versionId: string }
  | { filePath: string }
  | { buffer: Buffer; fileName?: string };

/** Plain text of every other article's latest manuscript version, cached on the version row after the first extraction. */
async function loadCorpus(excludeArticleId?: string): Promise<CorpusDoc[]> {
  const versions = await prisma.manuscriptVersion.findMany({
    where: { articleId: excludeArticleId ? { not: excludeArticleId } : undefined },
    orderBy: { createdAt: 'desc' },
    distinct: ['articleId'],
    take: env.PLAGIARISM_INTERNAL_CORPUS_LIMIT,
    select: { id: true, extractedText: true, file: { select: { storageKey: true, originalName: true } }, article: { select: { id: true, title: true, submissionId: true } } },
  });
  const docs: CorpusDoc[] = [];
  for (const v of versions) {
    let text = v.extractedText;
    if (text === null) {
      try {
        text = await extractText(await storage.get(v.file.storageKey), v.file.originalName);
        await prisma.manuscriptVersion.update({ where: { id: v.id }, data: { extractedText: text } });
      } catch (err) {
        logger.warn({ versionId: v.id, err: (err as Error).message }, 'skipping unreadable manuscript in plagiarism corpus');
        continue;
      }
    }
    docs.push({ articleId: v.article.id, articleTitle: v.article.title, submissionId: v.article.submissionId, text });
  }
  return docs;
}

async function loadInput(input: CheckInput): Promise<{ text: string; excludeArticleId?: string }> {
  if ('versionId' in input) {
    const v = await prisma.manuscriptVersion.findUnique({ where: { id: input.versionId }, include: { file: true } });
    if (!v) throw new NotFoundError('Manuscript version not found');
    const text = v.extractedText ?? (await extractText(await storage.get(v.file.storageKey), v.file.originalName));
    if (v.extractedText === null) await prisma.manuscriptVersion.update({ where: { id: v.id }, data: { extractedText: text } });
    return { text, excludeArticleId: v.articleId };
  }
  if ('filePath' in input) {
    let buffer: Buffer;
    try {
      buffer = await fs.readFile(input.filePath);
    } catch {
      throw new UnprocessableError('The file could not be opened.', 'UNREADABLE_DOCUMENT');
    }
    return { text: await extractText(buffer, input.filePath) };
  }
  return { text: await extractText(input.buffer, input.fileName) };
}

/** Runs the analysis in a worker thread so TF-IDF/hash work never blocks the API's event loop. */
function runInWorker(text: string, corpus: CorpusDoc[]): Promise<PlagiarismReport> {
  // Same extension as this file: .ts under tsx (dev, the worker inherits its loader), .js in the compiled build.
  const file = path.join(__dirname, `worker${path.extname(__filename)}`);
  return new Promise((resolve, reject) => {
    const worker = new Worker(file, { workerData: { text, corpus } });
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      fn();
    };
    const timer = setTimeout(() => done(() => reject(new Error('Plagiarism check timed out'))), WORKER_TIMEOUT_MS);
    worker.once('message', (m: { ok: true; report: PlagiarismReport } | { ok: false; message: string; code?: string }) =>
      done(() => (m.ok ? resolve(m.report) : reject(m.code === 'EMPTY_DOCUMENT' || m.code === 'UNREADABLE_DOCUMENT' ? new UnprocessableError(m.message, m.code) : new AppError(500, m.code ?? 'PLAGIARISM_ERROR', m.message)))),
    );
    worker.once('error', (err) => done(() => reject(err)));
    worker.once('exit', (code) => done(() => reject(new Error(`Plagiarism worker exited unexpectedly (code ${code})`))));
  });
}

/**
 * Runs both plagiarism layers on a manuscript version (`{ versionId }`, which also excludes that article from the internal
 * corpus), a file on disk (`{ filePath }`) or an in-memory file (`{ buffer, fileName }`), and returns the full report.
 * Database/storage access happens here; the analysis itself runs in a worker thread.
 */
export async function checkPlagiarism(input: CheckInput): Promise<PlagiarismReport> {
  const { text, excludeArticleId } = await loadInput(input);
  const corpus = await loadCorpus(excludeArticleId);
  return runInWorker(text, corpus);
}
