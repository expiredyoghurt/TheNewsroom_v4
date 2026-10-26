// Deterministic shuffling. The same (pupil, task, attempt) always yields the same
// order, with nothing stored: reopening a question shows the same layout, and a new
// attempt gets a fresh one. The server maps clicked positions back through the same
// function, so the answer key never travels to the client.

/** FNV-1a 32-bit. Stable across runtimes (no reliance on Math.random or crypto). */
export function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 PRNG. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ShuffleSeed { studentId: number; taskId: number; attemptNumber: number }

export function seedString(s: ShuffleSeed, salt: string): string {
  return `${s.studentId}:${s.taskId}:${s.attemptNumber}:${salt}`;
}

/** Fisher-Yates over indices. result[i] = original index shown at position i. */
export function shuffledIndices(length: number, seed: ShuffleSeed, salt: string): number[] {
  const rng = prng(hash32(seedString(seed, salt)));
  const idx = Array.from({ length }, (_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [idx[i], idx[j]] = [idx[j]!, idx[i]!];
  }
  return idx;
}

export function applyOrder<T>(items: readonly T[], order: readonly number[]): T[] {
  return order.map((i) => items[i]!);
}

/** Pupil clicked `shownPosition` in the shuffled list -> which original option is that? */
export function originalIndex(shownPosition: number, order: readonly number[]): number | undefined {
  return Number.isInteger(shownPosition) ? order[shownPosition] : undefined;
}

export const SALT = {
  questionOrder: "questions",
  options: (questionId: string) => `options:${questionId}`,
} as const;
