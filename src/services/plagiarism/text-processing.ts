/** Text clean-up, tokenisation, sentence splitting and word-shingle hashing used by every similarity layer. */

const STOPWORDS = new Set(
  ('a about above after again against all am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is it its itself just me more most my no nor not of off on once only or other our out over own same she should so some such than that the their them then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your')
    .split(' '),
);

/** Number of consecutive words hashed into one shingle; 5 words rarely collide by chance in academic prose. */
export const SHINGLE_SIZE = 5;
const MIN_SENTENCE_WORDS = 8;

/** Lowercases, applies Unicode compatibility folding and replaces punctuation/symbols with spaces. */
export function normalize(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u00ad\u200b-\u200d\ufeff]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export const tokenize = (text: string): string[] => {
  const n = normalize(text);
  return n ? n.split(' ') : [];
};

export const removeStopwords = (tokens: string[]): string[] => tokens.filter((t) => t.length > 1 && !STOPWORDS.has(t));

/** Drops the reference list (a trailing "References"/"Bibliography" heading), which otherwise matches every paper citing the same works. */
export function stripReferences(text: string): string {
  const re = /^\s*(references|bibliography|works cited|literature cited)\s*$/gim;
  let cut = -1;
  for (let m = re.exec(text); m; m = re.exec(text)) if (m.index > text.length * 0.5) cut = m.index;
  return cut >= 0 ? text.slice(0, cut) : text;
}

/** Splits into sentences long enough to be meaningful evidence; shorter fragments (headings, captions) are ignored. */
export function splitSentences(text: string): string[] {
  return text
    .replace(/\r/g, '')
    .split(/(?<=[.!?])\s+(?=[\p{Lu}"“(\[])|\n{2,}|\n(?=\s*\n)/u)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => tokenize(s).length >= MIN_SENTENCE_WORDS);
}

/** FNV-1a 32-bit hash of a string. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Hashes every window of `n` consecutive tokens. */
export function shingleHashes(tokens: string[], n = SHINGLE_SIZE): number[] {
  const out: number[] = [];
  for (let i = 0; i + n <= tokens.length; i++) out.push(fnv1a(tokens.slice(i, i + n).join(' ')));
  return out;
}

export const wordCount = (text: string): number => tokenize(text).length;
