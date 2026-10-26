// Pure: turn untrusted model output into a validated, clamped grade. Never trust a model's own total.
import type { ReflectGradeView, WritingGradeView } from "@newsroom/shared";

export function extractJson(text: string): unknown {
  const stripped = text.replace(/```(?:json)?/gi, "").trim();
  const start = stripped.indexOf("{");
  if (start < 0) throw new Error("no JSON object in model output");
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < stripped.length; i++) {
    const c = stripped[i]!;
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return JSON.parse(stripped.slice(start, i + 1));
  }
  throw new Error("unterminated JSON object in model output");
}

export const clampInt = (v: unknown, min: number, max: number): number => {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.round(n)));
};
const clamp01 = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
};
const strList = (v: unknown, max: number, maxLen = 300): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.slice(0, maxLen)).slice(0, max) : [];
const str = (v: unknown, maxLen = 400): string => (typeof v === "string" ? v.slice(0, maxLen) : "");
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

export const REFLECT_MAX = { opinion: 2, reasoning: 3, article_connection: 2, elaboration: 2, clarity: 1 } as const;
export const WRITING_MAX = { content: 5, organisation: 4, development: 3, language: 4, accuracy: 2, conventions: 2 } as const;

/** Grounding check: only chunk ids that really exist count as evidence. */
export function groundEvidence(claimed: unknown, validChunkIds: ReadonlySet<string>): string[] {
  return [...new Set(strList(claimed, 12, 32).filter((id) => validChunkIds.has(id)))];
}

export function normalizeReflectGrade(raw: unknown, validChunkIds: ReadonlySet<string>): ReflectGradeView {
  const r = obj(raw);
  const b = obj(r.breakdown);
  const evidenceUsed = groundEvidence(r.article_evidence_used, validChunkIds);
  const breakdown = {
    opinion: clampInt(b.opinion, 0, REFLECT_MAX.opinion),
    reasoning: clampInt(b.reasoning, 0, REFLECT_MAX.reasoning),
    article_connection: clampInt(b.article_connection, 0, REFLECT_MAX.article_connection),
    elaboration: clampInt(b.elaboration, 0, REFLECT_MAX.elaboration),
    clarity: clampInt(b.clarity, 0, REFLECT_MAX.clarity),
  };
  // A claimed article connection with no real evidence behind it is capped (hallucinated grounding).
  if (evidenceUsed.length === 0 && breakdown.article_connection > 1) breakdown.article_connection = 1;
  const score = breakdown.opinion + breakdown.reasoning + breakdown.article_connection + breakdown.elaboration + breakdown.clarity;
  return {
    score, maxScore: 10, breakdown,
    thinkingLevel: clampInt(r.thinking_level, 1, 4) as 1 | 2 | 3 | 4,
    position: str(r.position, 80) || "unclear",
    strengths: strList(r.strengths, 3), nextStep: str(r.next_step), confidence: clamp01(r.confidence), evidenceUsed,
  };
}

export function normalizeWritingGrade(raw: unknown): WritingGradeView {
  const r = obj(raw);
  const b = obj(r.breakdown);
  const sc = obj(r.source_check);
  const sourceCheck = { supported: clampInt(sc.supported, 0, 50), questionable: clampInt(sc.questionable, 0, 50), unsupported: clampInt(sc.unsupported, 0, 50) };
  const breakdown: Record<string, number> = {};
  for (const [k, max] of Object.entries(WRITING_MAX)) breakdown[k] = clampInt(b[k], 0, max);
  // Unsupported claims about the article cost accuracy marks, whatever the model decided.
  breakdown.accuracy = Math.min(breakdown.accuracy!, Math.max(0, WRITING_MAX.accuracy - sourceCheck.unsupported));
  const score = Object.values(breakdown).reduce((a, n) => a + n, 0);
  return { score, maxScore: 20, breakdown, strengths: strList(r.strengths, 3), nextStep: str(r.next_step), sourceCheck, confidence: clamp01(r.confidence) };
}
