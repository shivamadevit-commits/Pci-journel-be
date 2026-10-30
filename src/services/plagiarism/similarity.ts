/** Similarity primitives: TF-IDF cosine for candidate ranking, shingle containment for the actual match percentage. */

export type SparseVector = Map<string, number>;

/** Inverse document frequency (smoothed) over the given token lists. */
export function buildIdf(docs: string[][]): Map<string, number> {
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const n = docs.length;
  const idf = new Map<string, number>();
  for (const [t, c] of df) idf.set(t, Math.log((1 + n) / (1 + c)) + 1);
  return idf;
}

/** L2-normalised TF-IDF vector (sublinear term frequency). */
export function tfidf(tokens: string[], idf: Map<string, number>): SparseVector {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  const v: SparseVector = new Map();
  let norm = 0;
  for (const [t, c] of tf) {
    const w = (1 + Math.log(c)) * (idf.get(t) ?? 1);
    v.set(t, w);
    norm += w * w;
  }
  norm = Math.sqrt(norm);
  if (norm > 0) for (const [t, w] of v) v.set(t, w / norm);
  return v;
}

/** Cosine of two L2-normalised sparse vectors. */
export function cosine(a: SparseVector, b: SparseVector): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [t, w] of small) {
    const o = large.get(t);
    if (o !== undefined) dot += w * o;
  }
  return dot;
}

/** Jaccard index of two hash sets (reported for diagnostics; containment drives the score). */
export function jaccard(a: Set<number>, b: Set<number>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}
