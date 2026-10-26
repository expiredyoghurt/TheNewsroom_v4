// Pure MCQ logic: build the pupil's view (deterministically shuffled, answer key stripped) and grade
// a submission by mapping clicked POSITIONS back through the same seeded order. Tested directly.
import { applyOrder, originalIndex, SALT, shuffledIndices, type ShuffleSeed } from "@newsroom/shared";

export interface CompQ { id: string; question: string; evidence_chunk_id: string; options: string[]; correct_index: number }
export interface VocabQ { id: string; target_word: string; word_class?: string; context_sentence: string; options: { text: string; role: string }[]; correct_index: number }
export type McqType = "comprehension" | "vocabulary";
type AnyQ = CompQ | VocabQ;

const optionTexts = (q: AnyQ): string[] => (q.options as (string | { text: string })[]).map((o) => (typeof o === "string" ? o : o.text));

export function buildMcqView(type: McqType, questions: readonly AnyQ[], seed: ShuffleSeed) {
  const order = shuffledIndices(questions.length, seed, SALT.questionOrder);
  return applyOrder(questions, order).map((q) => {
    const opts = applyOrder(optionTexts(q), shuffledIndices(q.options.length, seed, SALT.options(q.id)));
    return type === "comprehension"
      ? { id: q.id, question: (q as CompQ).question, options: opts }
      : { id: q.id, targetWord: (q as VocabQ).target_word, contextSentence: (q as VocabQ).context_sentence, options: opts };
  });
}

export interface McqAnswer { selectedIndex: number; chunkId?: string }
export interface McqGrade {
  correctCount: number; total: number; score: number;
  perQuestion: Record<string, { correct: boolean; correctOptionText: string; evidenceChunkId?: string }>;
}

export function gradeMcq(type: McqType, questions: readonly AnyQ[], seed: ShuffleSeed, answers: Record<string, McqAnswer>): McqGrade {
  const perQuestion: McqGrade["perQuestion"] = {};
  let correctCount = 0;
  for (const q of questions) {
    const order = shuffledIndices(q.options.length, seed, SALT.options(q.id));
    const a = answers[q.id];
    const picked = a ? originalIndex(a.selectedIndex, order) : undefined;
    let correct = picked !== undefined && picked === q.correct_index;
    // Comprehension answers must be grounded: the pupil also has to point at the evidence sentence.
    if (type === "comprehension" && correct) correct = a?.chunkId === (q as CompQ).evidence_chunk_id;
    if (correct) correctCount++;
    perQuestion[q.id] = {
      correct, correctOptionText: optionTexts(q)[q.correct_index] ?? "",
      ...(type === "comprehension" ? { evidenceChunkId: (q as CompQ).evidence_chunk_id } : {}),
    };
  }
  const total = questions.length;
  return { correctCount, total, score: total === 0 ? 0 : correctCount / total, perQuestion };
}
