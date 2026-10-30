import { parentPort, workerData } from 'node:worker_threads';
import { AppError } from '../../utils/errors';
import { analyze } from './analyze';
import type { CorpusDoc } from './internal-check';

/** Worker-thread entry point: runs one analysis and posts back the report, or an error with its HTTP-style code. */
(async () => {
  const { text, corpus } = workerData as { text: string; corpus: CorpusDoc[] };
  try {
    parentPort!.postMessage({ ok: true, report: await analyze(text, corpus) });
  } catch (err) {
    const e = err as Error;
    parentPort!.postMessage({ ok: false, message: e.message, code: err instanceof AppError ? err.code : undefined });
  }
})();
