// XP and levels. Level is a PURE FUNCTION of total XP and is never stored,
// so XP and level can never disagree after a crash.

export const XP_VALUES = {
  COMPREHENSION_CORRECT: 10,
  VOCABULARY_CORRECT: 10,
  REFLECT_SUBMISSION: 15,
  WRITING_FIRST_ATTEMPT: 20,
  REVIEW_BONUS_MAX: 10,
  ARTICLE_PUBLISHED: 25,
} as const;

export const LEVELS: readonly { level: number; threshold: number; title: string }[] = [
  { level: 1, threshold: 0, title: "Copy Runner" },
  { level: 2, threshold: 100, title: "Cub Reporter" },
  { level: 3, threshold: 250, title: "Junior Reporter" },
  { level: 4, threshold: 450, title: "Staff Reporter" },
  { level: 5, threshold: 700, title: "Senior Reporter" },
  { level: 6, threshold: 1000, title: "Correspondent" },
  { level: 7, threshold: 1400, title: "Investigative Reporter" },
  { level: 8, threshold: 1900, title: "Bureau Chief" },
  { level: 9, threshold: 2500, title: "Editor" },
  { level: 10, threshold: 3200, title: "Editor-in-Chief" },
];

export function levelForXp(xp: number): { level: number; title: string; nextThreshold: number | null } {
  const total = Number.isFinite(xp) ? Math.max(0, Math.floor(xp)) : 0;
  let idx = 0;
  for (let i = 0; i < LEVELS.length; i++) if (total >= LEVELS[i]!.threshold) idx = i;
  const cur = LEVELS[idx]!;
  const next = LEVELS[idx + 1];
  return { level: cur.level, title: cur.title, nextThreshold: next ? next.threshold : null };
}

/** Idempotency keys for xp_log (UNIQUE per student). Re-submitting can never pay twice. */
export const xpKey = {
  mcqFirstAttempt: (taskId: number) => `mcq_first_attempt:${taskId}`,
  reflectFirstAttempt: (taskId: number) => `reflect_first_attempt:${taskId}`,
  writingFirstAttempt: (writingTaskId: number) => `writing_first_attempt:${writingTaskId}`,
  reviewBonus: (taskId: number) => `review_bonus:${taskId}`,
  articlePublished: (articleId: number) => `article_published:${articleId}`,
} as const;

export function mcqXp(type: "comprehension" | "vocabulary", correctCount: number): number {
  const per = type === "comprehension" ? XP_VALUES.COMPREHENSION_CORRECT : XP_VALUES.VOCABULARY_CORRECT;
  return Math.max(0, Math.floor(correctCount)) * per;
}

export function clampReviewBonus(requested: number): number {
  if (!Number.isFinite(requested) || requested <= 0) return 0;
  return Math.min(Math.floor(requested), XP_VALUES.REVIEW_BONUS_MAX);
}

/** Two levels per badge tier (five tiers of artwork for ten levels). Decorative only. */
export function tierForLevel(level: number | null | undefined): 1 | 2 | 3 | 4 | 5 | null {
  if (level === null || level === undefined || !Number.isFinite(level)) return null;
  if (level <= 2) return 1;
  if (level <= 4) return 2;
  if (level <= 6) return 3;
  if (level <= 8) return 4;
  return 5;
}
