import { logger } from '../../config/logger';
import { getWebSearchProvider } from '../../providers/websearch.provider';
import { UnprocessableError } from '../../utils/errors';
import { compareInternal, type CorpusDoc, type MatchedSource } from './internal-check';
import { Coverage, buildQueryDoc } from './matcher';
import { compareWeb } from './web-check';

/** Below this the document has too little text for a meaningful comparison (usually a scanned/image-only file). */
const MIN_WORDS = 50;

export interface PlagiarismReport {
  /** Share of the document found in any source (internal or web); overlapping matches are counted once. */
  totalPlagiarismScore: number;
  internalScore: number;
  webScore: number;
  matchedSources: MatchedSource[];
  meta: {
    wordCount: number;
    comparedDocuments: number;
    webStatus: 'completed' | 'partial' | 'skipped';
    webQueries: number;
    webPagesFetched: number;
    warnings: string[];
    generatedAt: string;
  };
}

/**
 * The CPU-heavy part of a check, free of database and storage access so it can run inside a worker thread:
 * pre-processing, layer 1 (internal corpus) and layer 2 (web). The web layer is skipped (and reported as such) when no
 * WEB_SEARCH_PROVIDER is configured or it fails entirely.
 */
export async function analyze(text: string, corpus: CorpusDoc[]): Promise<PlagiarismReport> {
  const q = buildQueryDoc(text);
  if (q.wordCount < MIN_WORDS || q.totalShingles === 0) {
    throw new UnprocessableError('The document has too little readable text to check (it may be scanned or image-only).', 'EMPTY_DOCUMENT');
  }

  const internal = compareInternal(q, corpus);

  const warnings: string[] = [];
  let web: Awaited<ReturnType<typeof compareWeb>> | undefined;
  let webStatus: PlagiarismReport['meta']['webStatus'] = 'skipped';
  const provider = getWebSearchProvider();
  if (!provider) {
    warnings.push('Web check skipped: no web search provider is configured.');
  } else {
    try {
      web = await compareWeb(q, provider);
      warnings.push(...web.warnings);
      webStatus = web.warnings.length ? 'partial' : 'completed';
    } catch (err) {
      logger.error({ err: (err as Error).message }, 'plagiarism web layer failed');
      warnings.push('Web check failed and was skipped.');
    }
  }

  const webCoverage = web?.coverage ?? new Coverage(q);
  return {
    totalPlagiarismScore: Coverage.union(internal.coverage, webCoverage).percent(),
    internalScore: internal.coverage.percent(),
    webScore: webCoverage.percent(),
    matchedSources: [...internal.sources, ...(web?.sources ?? [])].sort((a, b) => b.matchPercentage - a.matchPercentage),
    meta: {
      wordCount: q.wordCount,
      comparedDocuments: corpus.length,
      webStatus,
      webQueries: web?.queries ?? 0,
      webPagesFetched: web?.pagesFetched ?? 0,
      warnings,
      generatedAt: new Date().toISOString(),
    },
  };
}
