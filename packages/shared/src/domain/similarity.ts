// "Did they process this, or paste it?"  Not a plagiarism engine: it measures what
// fraction of the pupil's own phrases (word n-grams) appear verbatim in the source
// material. Deterministic, dependency-free, same answer everywhere.

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s']/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function shingles(tokens: readonly string[], n: number): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + n <= tokens.length; i++) out.add(tokens.slice(i, i + n).join(" "));
  return out;
}

export const DEFAULT_NGRAM = 5;
export const DEFAULT_SIMILARITY_THRESHOLD = 0.5;

/** Fraction (0..1) of the candidate's n-grams found in any source. 0 if the candidate is shorter than n words. */
export function copiedFraction(candidate: string, sources: readonly string[], n = DEFAULT_NGRAM): number {
  const cand = shingles(tokenize(candidate), n);
  if (cand.size === 0) return 0;
  const src = new Set<string>();
  for (const s of sources) for (const g of shingles(tokenize(s), n)) src.add(g);
  let hit = 0;
  for (const g of cand) if (src.has(g)) hit++;
  return hit / cand.size;
}

export function exceedsThreshold(score: number, threshold: number | null | undefined): boolean {
  return score > (threshold ?? DEFAULT_SIMILARITY_THRESHOLD);
}
