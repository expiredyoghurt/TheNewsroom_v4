// The learning loop: which downstream stages an article uses.
// Pure data + pure functions. No I/O. Tested in loop.test.ts.

export const LOOP_KEYS = ["read", "vocabulary", "comprehension", "think", "writing", "edit"] as const;
export type LoopKey = (typeof LOOP_KEYS)[number];
export type LearningLoop = Record<LoopKey, boolean>;

export const STATIONS = ["newsstand", "investigation", "opinion", "writing", "editor"] as const;
export type Station = (typeof STATIONS)[number];

/** Question types a class/assignment can allow. `reflect` is "Think & Respond". */
export const QUESTION_TYPES = ["comprehension", "vocabulary", "reflect", "writing"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const FULL_LOOP: LearningLoop = {
  read: true, vocabulary: true, comprehension: true, think: true, writing: true, edit: true,
};

/** Normalise any stored/untrusted value into a valid loop.
 *  Invariants: read is always on; edit requires writing. */
export function parseLoop(value: unknown): LearningLoop {
  let raw: unknown = value;
  if (typeof value === "string") {
    try { raw = JSON.parse(value); } catch { raw = {}; }
  }
  const out: LearningLoop = { ...FULL_LOOP };
  if (raw && typeof raw === "object") {
    for (const key of LOOP_KEYS) {
      const v = (raw as Record<string, unknown>)[key];
      if (typeof v === "boolean") out[key] = v;
    }
  }
  return enforceLoopInvariants(out);
}

export function enforceLoopInvariants(loop: LearningLoop): LearningLoop {
  const out = { ...loop, read: true };
  if (!out.writing) out.edit = false;
  return out;
}

/** An article must keep at least one downstream stage on (Read alone is not a lesson). */
export function hasDownstreamStage(loop: LearningLoop): boolean {
  return loop.vocabulary || loop.comprehension || loop.think || loop.writing || loop.edit;
}

export function questionTypeEnabled(loop: LearningLoop, type: QuestionType): boolean {
  return type === "reflect" ? loop.think : loop[type];
}

export function stationEnabled(loop: LearningLoop, station: Station): boolean {
  switch (station) {
    case "newsstand": return loop.read;
    case "investigation": return loop.vocabulary || loop.comprehension;
    case "opinion": return loop.think;
    case "writing": return loop.writing;
    case "editor": return loop.edit;
  }
}

/** Parse a stored JSON array, keeping only allowed members (order of `allowed` preserved). */
export function parseAllowed<T extends string>(value: unknown, allowed: readonly T[], fallback: readonly T[]): T[] {
  let raw: unknown = value;
  if (typeof value === "string") {
    try { raw = JSON.parse(value); } catch { return [...fallback]; }
  }
  if (!Array.isArray(raw)) return [...fallback];
  const set = new Set(raw);
  return allowed.filter((a) => set.has(a));
}
