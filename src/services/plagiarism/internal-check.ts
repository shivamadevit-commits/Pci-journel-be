import { buildIdf, cosine, tfidf } from './similarity';
import { Coverage, round1, snippets, toHashSet, type QueryDoc } from './matcher';
import { removeStopwords, tokenize } from './text-processing';

export interface CorpusDoc {
  articleId: string;
  articleTitle: string;
  submissionId?: string;
  text: string;
}

export interface MatchedSource {
  sourceType: 'internal_db' | 'web';
  articleId?: string;
  articleTitle?: string;
  submissionId?: string;
  url?: string;
  matchPercentage: number;
  matchedSnippets: string[];
}

/** Candidates below this TF-IDF cosine are not worth a shingle comparison. */
const MIN_COSINE = 0.1;
const MAX_CANDIDATES = 25;
/** A source must cover at least this share of the document to be listed. */
export const MIN_MATCH_PERCENT = 1;

/**
 * Layer 1. TF-IDF cosine ranks the corpus cheaply; the best candidates are then compared by word-shingle containment,
 * which gives the real "how much of this document appears in that one" percentage.
 */
export function compareInternal(q: QueryDoc, corpus: CorpusDoc[]): { coverage: Coverage; sources: MatchedSource[] } {
  const coverage = new Coverage(q);
  if (!corpus.length || !q.totalShingles) return { coverage, sources: [] };

  const corpusTokens = corpus.map((d) => removeStopwords(tokenize(d.text)));
  const idf = buildIdf([q.contentTokens, ...corpusTokens]);
  const qVec = tfidf(q.contentTokens, idf);

  const candidates = corpus
    .map((doc, i) => ({ doc, cos: cosine(qVec, tfidf(corpusTokens[i], idf)) }))
    .filter((c) => c.cos >= MIN_COSINE)
    .sort((a, b) => b.cos - a.cos)
    .slice(0, MAX_CANDIDATES);

  const sources: MatchedSource[] = [];
  for (const { doc } of candidates) {
    const set = toHashSet(doc.text);
    const { fraction, sentenceIdx } = Coverage.measure(q, set);
    const pct = round1(fraction * 100);
    if (pct < MIN_MATCH_PERCENT) continue;
    coverage.mark(set);
    sources.push({
      sourceType: 'internal_db',
      articleId: doc.articleId,
      articleTitle: doc.articleTitle,
      submissionId: doc.submissionId,
      matchPercentage: pct,
      matchedSnippets: snippets(q, sentenceIdx),
    });
  }
  return { coverage, sources: sources.sort((a, b) => b.matchPercentage - a.matchPercentage) };
}
