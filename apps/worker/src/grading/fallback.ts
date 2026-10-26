// The last link in the chain: a deterministic, non-AI grader. It exists so a submission is NEVER
// rejected because every provider is down. It is deliberately conservative and always flagged
// as "fallback" so a teacher can review it and re-request AI grading.
import type { ReflectGradeView, WritingGradeView } from "@newsroom/shared";
import { tokenize } from "@newsroom/shared";
import { clampInt, WRITING_MAX } from "./normalize";

const REASON_WORDS = ["because", "since", "so", "therefore", "as a result", "for example", "this means", "which means", "due to"];
const OPINION_WORDS = ["i think", "i believe", "in my opinion", "i feel", "i agree", "i disagree", "should", "should not", "shouldn't", "i would"];

function keywordHits(text: string, keywords: readonly string[]): number {
  const t = text.toLowerCase();
  return new Set(keywords.map((k) => k.toLowerCase()).filter((k) => k && t.includes(k))).size;
}

export function reflectFallback(answer: { short: string; long: string }, evidence: readonly { chunk_id: string; keywords: readonly string[] }[]): ReflectGradeView {
  const all = `${answer.short} ${answer.long}`.toLowerCase();
  const words = tokenize(all);
  const opinion = OPINION_WORDS.some((w) => all.includes(w)) || answer.short.trim().split(/\s+/).length >= 4 ? 2 : answer.short.trim() ? 1 : 0;
  const hasReason = REASON_WORDS.some((w) => all.includes(w));
  const reasoning = hasReason ? (words.length >= 40 ? 3 : 2) : words.length >= 25 ? 1 : 0;
  const hits = evidence.map((e) => keywordHits(all, e.keywords));
  const totalHits = hits.reduce((a, n) => a + n, 0);
  const article_connection = evidence.length === 0 ? 0 : totalHits >= 3 ? 2 : totalHits >= 1 ? 1 : 0;
  const elaboration = words.length >= 60 ? 2 : words.length >= 30 ? 1 : 0;
  const clarity = words.length >= 15 && /[.!?]/.test(answer.long) ? 1 : 0;
  const breakdown = { opinion, reasoning, article_connection, elaboration, clarity };
  const score = opinion + reasoning + article_connection + elaboration + clarity;
  return {
    score, maxScore: 10, breakdown,
    thinkingLevel: (score >= 8 ? 4 : score >= 6 ? 3 : score >= 3 ? 2 : 1) as 1 | 2 | 3 | 4,
    position: "unclear",
    strengths: ["You shared a view and gave your thinking."].slice(0, answer.short.trim() ? 1 : 0),
    nextStep: "Add a reason using the word 'because', and point to a detail from the article.",
    confidence: 0.3,
    evidenceUsed: evidence.filter((_, i) => (hits[i] ?? 0) > 0).map((e) => e.chunk_id),
  };
}

export function writingFallback(
  draft: string,
  opts: { evidence: readonly { keywords?: readonly string[] }[]; minWords: number; maxWords: number },
): WritingGradeView {
  const words = tokenize(draft);
  const n = words.length;
  const paragraphs = draft.split(/\n\s*\n|\n/).filter((p) => p.trim().length > 0).length;
  const sentences = draft.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const kw = opts.evidence.flatMap((e) => e.keywords ?? []);
  const kwTotal = new Set(kw.map((k) => k.toLowerCase())).size;
  const covered = keywordHits(draft, kw);
  const ratio = kwTotal === 0 ? 0.5 : covered / kwTotal;
  const content = clampInt(ratio * WRITING_MAX.content, 0, WRITING_MAX.content);
  const organisation = clampInt(Math.min(paragraphs, 4), 0, WRITING_MAX.organisation);
  const development = n >= opts.minWords ? 3 : n >= opts.minWords * 0.6 ? 2 : n >= opts.minWords * 0.3 ? 1 : 0;
  const avgSentence = sentences.length ? n / sentences.length : 0;
  const lexical = n ? new Set(words).size / n : 0;
  const language = clampInt((avgSentence >= 8 ? 2 : avgSentence >= 5 ? 1 : 0) + (lexical >= 0.55 ? 2 : lexical >= 0.4 ? 1 : 0), 0, WRITING_MAX.language);
  const capitalised = sentences.filter((s) => /^[A-Z]/.test(s.trim())).length;
  const conventions = sentences.length === 0 ? 0 : capitalised / sentences.length >= 0.8 ? 2 : capitalised / sentences.length >= 0.5 ? 1 : 0;
  const accuracy = 1; // cannot be judged without understanding the text; neutral by design
  const breakdown = { content, organisation, development, language, accuracy, conventions };
  const score = Object.values(breakdown).reduce((a, x) => a + x, 0);
  return {
    score, maxScore: 20, breakdown,
    strengths: n > 0 ? ["You wrote a full draft."] : [],
    nextStep: n < opts.minWords ? `Aim for at least ${opts.minWords} words and cover more details from the article.` : "Check each paragraph has one clear idea and reuse key details from the article.",
    sourceCheck: { supported: 0, questionable: 0, unsupported: 0 }, confidence: 0.25,
  };
}
