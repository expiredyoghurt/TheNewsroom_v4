import { describe, expect, it } from "vitest";
import { buildMcqView, gradeMcq, type CompQ, type VocabQ } from "../src/taskLogic";
import { planRosterImport } from "../src/rosterPlan";
import { shuffledIndices, SALT } from "@newsroom/shared";

const comp: CompQ[] = [1, 2, 3, 4].map((n) => ({ id: `q${n}`, question: `Q${n}`, evidence_chunk_id: `c${n}`, options: ["a", "b", "c", "d"].map((x) => `${x}${n}`), correct_index: n - 1 }));
const vocab: VocabQ[] = [{ id: "v1", target_word: "w", context_sentence: "s", options: ["right", "near", "opposite", "lookalike"].map((text) => ({ text, role: "x" })), correct_index: 0 }];
const seed = { studentId: 5, taskId: 9, attemptNumber: 1 };

describe("MCQ view + grading", () => {
  it("view is stable for a seed, changes with the attempt number, and hides the key", () => {
    const a = buildMcqView("comprehension", comp, seed);
    expect(buildMcqView("comprehension", comp, seed)).toEqual(a);
    const orders = new Set([1, 2, 3, 4, 5, 6].map((n) => JSON.stringify(buildMcqView("comprehension", comp, { ...seed, attemptNumber: n }))));
    expect(orders.size).toBeGreaterThan(1);
    expect(JSON.stringify(a)).not.toMatch(/correct|evidence/);
  });
  it("every shown option text is one of the real options (nothing dropped or invented)", () => {
    for (const q of buildMcqView("comprehension", comp, seed) as { id: string; options: string[] }[]) {
      const n = Number(q.id.slice(1));
      expect([...q.options].sort()).toEqual(["a", "b", "c", "d"].map((x) => `${x}${n}`));
    }
  });
  it("clicking the shown position of each right option scores 100%", () => {
    const answers: Record<string, { selectedIndex: number; chunkId: string }> = {};
    for (const q of comp) answers[q.id] = { selectedIndex: shuffledIndices(4, seed, SALT.options(q.id)).indexOf(q.correct_index), chunkId: q.evidence_chunk_id };
    const g = gradeMcq("comprehension", comp, seed, answers);
    expect(g).toMatchObject({ correctCount: 4, total: 4, score: 1 });
    expect(g.perQuestion.q1).toMatchObject({ correct: true, correctOptionText: "a1", evidenceChunkId: "c1" });
  });
  it("missing, out-of-range and non-integer answers are simply wrong (never throw)", () => {
    const g = gradeMcq("comprehension", comp, seed, { q1: { selectedIndex: 99 }, q2: { selectedIndex: 1.5 } as never });
    expect(g.correctCount).toBe(0);
  });
  it("vocabulary needs no evidence click", () => {
    const sel = shuffledIndices(4, seed, SALT.options("v1")).indexOf(0);
    expect(gradeMcq("vocabulary", vocab, seed, { v1: { selectedIndex: sel } }).score).toBe(1);
    expect(buildMcqView("vocabulary", vocab, seed)[0]).toMatchObject({ id: "v1", targetWord: "w" });
  });
  it("empty question set does not divide by zero", () => expect(gradeMcq("vocabulary", [], seed, {}).score).toBe(0));
});

describe("planRosterImport", () => {
  const row = (reporterId: string, indexNumber: number) => ({ reporterId, firstName: "A", lastName: "B", indexNumber, pressPass: "x" });
  it("normalises ids, and skips duplicates with a reason each", () => {
    const p = planRosterImport([row("Ann", 1), row("ann", 2), row("Bob", 1), row("Cat", 3), row("Dan", 4)], new Set(["dan"]), new Set([3]));
    expect(p.toCreate.map((r) => r.reporterId)).toEqual(["ann"]);
    expect(p.skipped.map((s) => s.reason)).toEqual(["Duplicate reporter ID in this file", "Duplicate index number in this file", "Index number already used in this class", "Reporter ID already exists"]);
  });
  it("an empty file plans nothing", () => expect(planRosterImport([], new Set(), new Set())).toEqual({ toCreate: [], skipped: [] }));
});
