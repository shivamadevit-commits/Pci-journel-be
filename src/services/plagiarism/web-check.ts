import { env } from '../../config/env';
import { logger } from '../../config/logger';
import type { WebSearchProvider } from '../../providers/websearch.provider';
import { htmlToText, safeFetchText } from '../../utils/safeFetch';
import { MIN_MATCH_PERCENT, type MatchedSource } from './internal-check';
import { Coverage, round1, snippets, toHashSet, type QueryDoc } from './matcher';
import { tokenize } from './text-processing';

const PHRASE_WORDS = 12;
const RESULTS_PER_QUERY = 5;
const FETCH_CONCURRENCY = 3;
const MAX_PAGE_BYTES = 2_000_000;

export interface WebCheckResult {
  coverage: Coverage;
  sources: MatchedSource[];
  queries: number;
  pagesFetched: number;
  warnings: string[];
}

/**
 * Picks sentences most likely to be distinctive: mid-length, lexically varied, low in digits. They are spread across the
 * document (one per slice) so a copied passage anywhere has a chance of being queried.
 */
export function selectKeySentences(q: QueryDoc, count: number): number[] {
  const scored = q.sentences.map((s, i) => {
    const t = tokenize(s);
    const unique = new Set(t).size / Math.max(t.length, 1);
    const digits = (s.match(/\d/g)?.length ?? 0) / s.length;
    const lengthFit = t.length >= 14 && t.length <= 40 ? 1 : 0.5;
    return { i, score: unique * lengthFit * (1 - Math.min(digits * 4, 0.8)) };
  });
  const slices = Math.min(count, scored.length);
  const picked: number[] = [];
  for (let k = 0; k < slices; k++) {
    const part = scored.slice(Math.floor((k * scored.length) / slices), Math.floor(((k + 1) * scored.length) / slices));
    if (part.length) picked.push(part.reduce((a, b) => (b.score > a.score ? b : a)).i);
  }
  return picked;
}

/** Exact-phrase query built from the middle of the sentence (the start is often a connective). */
function phraseQuery(sentence: string): string {
  const words = sentence.replace(/[“”"]/g, '').split(/\s+/).filter(Boolean);
  const start = Math.max(0, Math.floor((words.length - PHRASE_WORDS) / 2));
  return `"${words.slice(start, start + PHRASE_WORDS).join(' ')}"`;
}

/** Runs `fn` over `items` with at most `limit` in flight. */
async function pool<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

/**
 * Layer 2. Searches the web for exact phrases from key sentences, downloads the matching pages and measures how much of the
 * document each page contains (same shingle-containment measure as layer 1).
 */
export async function compareWeb(q: QueryDoc, provider: WebSearchProvider): Promise<WebCheckResult> {
  const coverage = new Coverage(q);
  const warnings: string[] = [];
  const keys = selectKeySentences(q, env.PLAGIARISM_WEB_MAX_QUERIES);

  const urls = new Map<string, string>();
  let failedSearches = 0;
  for (const i of keys) {
    try {
      for (const r of await provider.search(phraseQuery(q.sentences[i]), RESULTS_PER_QUERY)) if (!urls.has(r.url)) urls.set(r.url, r.title);
    } catch (err) {
      failedSearches++;
      logger.warn({ err: (err as Error).message, provider: provider.name }, 'plagiarism web search failed');
    }
  }
  if (failedSearches) warnings.push(`${failedSearches} of ${keys.length} web searches failed`);

  const candidates = [...urls.keys()].slice(0, env.PLAGIARISM_WEB_MAX_PAGES);
  let failedFetches = 0;
  const pages = await pool(candidates, FETCH_CONCURRENCY, async (url) => {
    try {
      const page = await safeFetchText(url, { timeoutMs: env.PLAGIARISM_FETCH_TIMEOUT_MS, maxBytes: MAX_PAGE_BYTES });
      return { url, text: htmlToText(page.text) };
    } catch (err) {
      failedFetches++;
      logger.debug({ url, err: (err as Error).message }, 'plagiarism page fetch failed');
      return null;
    }
  });
  if (failedFetches) warnings.push(`${failedFetches} of ${candidates.length} matched pages could not be fetched`);

  const sources: MatchedSource[] = [];
  let fetched = 0;
  for (const page of pages) {
    if (!page) continue;
    fetched++;
    const set = toHashSet(page.text);
    const { fraction, sentenceIdx } = Coverage.measure(q, set);
    const pct = round1(fraction * 100);
    if (pct < MIN_MATCH_PERCENT) continue;
    coverage.mark(set);
    sources.push({ sourceType: 'web', url: page.url, articleTitle: urls.get(page.url), matchPercentage: pct, matchedSnippets: snippets(q, sentenceIdx) });
  }
  return { coverage, sources: sources.sort((a, b) => b.matchPercentage - a.matchPercentage), queries: keys.length, pagesFetched: fetched, warnings };
}
