import { removeStopwords, shingleHashes, splitSentences, stripReferences, tokenize } from './text-processing';

/** The submitted document, pre-processed once and shared by both layers. */
export interface QueryDoc {
  /** Sentences (original text) that are long enough to be evidence. */
  sentences: string[];
  /** Per sentence, the hashes of its word shingles. Sentences too short for a shingle have an empty list. */
  hashes: number[][];
  /** Stopword-free tokens of the whole body, for TF-IDF. */
  contentTokens: string[];
  totalShingles: number;
  wordCount: number;
}

export function buildQueryDoc(text: string): QueryDoc {
  const body = stripReferences(text);
  const sentences = splitSentences(body);
  const hashes = sentences.map((s) => shingleHashes(tokenize(s)));
  return {
    sentences,
    hashes,
    contentTokens: removeStopwords(tokenize(body)),
    totalShingles: hashes.reduce((n, h) => n + h.length, 0),
    wordCount: tokenize(body).length,
  };
}

export const round1 = (n: number) => Math.round(n * 10) / 10;

export const toHashSet = (text: string): Set<number> => new Set(shingleHashes(tokenize(text)));

/** Which of the query's shingles have been found in some source. Shared across sources so scores are unions, not sums. */
export class Coverage {
  private readonly flags: boolean[][];
  constructor(private readonly q: QueryDoc) {
    this.flags = q.hashes.map((h) => h.map(() => false));
  }

  /** Marks the shingles present in `source`; returns the share of the query matched by this source alone and its matching sentences. */
  mark(source: Set<number>): { fraction: number; sentenceIdx: number[] } {
    let hit = 0;
    const sentenceIdx: number[] = [];
    this.q.hashes.forEach((hs, i) => {
      let inSentence = 0;
      hs.forEach((h, j) => {
        if (source.has(h)) {
          this.flags[i][j] = true;
          inSentence++;
        }
      });
      hit += inSentence;
      if (hs.length > 0 && inSentence / hs.length >= 0.5) sentenceIdx.push(i);
    });
    return { fraction: this.q.totalShingles ? hit / this.q.totalShingles : 0, sentenceIdx };
  }

  /** Percentage (0–100, one decimal) of the query covered by all sources marked so far. */
  percent(): number {
    if (!this.q.totalShingles) return 0;
    const covered = this.flags.reduce((n, f) => n + f.filter(Boolean).length, 0);
    return round1((covered / this.q.totalShingles) * 100);
  }

  /** Per-source measurement that leaves no trace in any coverage. */
  static measure(q: QueryDoc, source: Set<number>): { fraction: number; sentenceIdx: number[] } {
    return new Coverage(q).mark(source);
  }

  /** New coverage containing everything covered by either operand (same query). */
  static union(a: Coverage, b: Coverage): Coverage {
    const out = new Coverage(a.q);
    out.flags.forEach((row, i) => row.forEach((_, j) => (row[j] = a.flags[i][j] || b.flags[i][j])));
    return out;
  }
}

/** Up to `limit` matching sentences, truncated for the report. */
export function snippets(q: QueryDoc, idx: number[], limit = 5): string[] {
  return idx.slice(0, limit).map((i) => (q.sentences[i].length > 300 ? `${q.sentences[i].slice(0, 297)}…` : q.sentences[i]));
}
