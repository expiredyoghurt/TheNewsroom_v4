// When is an article "complete" (badge + bonus XP)?  One definition, used by the
// badge award AND the hub display, so they can never disagree.
//
// An article is complete when every stage that is (a) enabled in the pupil's
// EFFECTIVE rules and (b) actually has a task, has been passed. The Editor stage is
// feedback only and never gates completion. Zero required stages is NOT complete
// (no vacuous badges).

import type { QuestionType } from "./loop";

export interface CompletionInput {
  /** Effective question types for this pupil on this article (from resolveArticleAccess). */
  questionTypes: readonly QuestionType[];
  /** Which MCQ/reflect tasks exist for the article, and whether this pupil passed them. */
  tasks: readonly { type: "comprehension" | "vocabulary" | "reflect"; passed: boolean }[];
  /** Null if the article has no writing task. */
  writing: { completed: boolean } | null;
}

export function requiredStages(input: CompletionInput): string[] {
  const out: string[] = [];
  for (const t of input.tasks) if (input.questionTypes.includes(t.type)) out.push(t.type);
  if (input.writing && input.questionTypes.includes("writing")) out.push("writing");
  return out;
}

export function isArticleComplete(input: CompletionInput): boolean {
  const required = requiredStages(input);
  if (required.length === 0) return false;
  for (const t of input.tasks) {
    if (input.questionTypes.includes(t.type) && !t.passed) return false;
  }
  if (input.writing && input.questionTypes.includes("writing") && !input.writing.completed) return false;
  return true;
}

/** Pass rule for MCQ tasks: best score so far meets the threshold. */
export function mcqPassed(bestScore: number, threshold: number): boolean {
  return bestScore + 1e-9 >= threshold;
}
