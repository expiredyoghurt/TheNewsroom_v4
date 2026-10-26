import { describe, it, expect } from "vitest";
import { parseLoop, FULL_LOOP, hasDownstreamStage, stationEnabled, questionTypeEnabled, parseAllowed, STATIONS } from "./loop";
import { levelForXp, LEVELS, mcqXp, clampReviewBonus, xpKey } from "./xp";
import { shuffledIndices, applyOrder, originalIndex, hash32 } from "./shuffle";
import { isArticleComplete, requiredStages, mcqPassed } from "./completion";
import { copiedFraction, tokenize, exceedsThreshold } from "./similarity";
import { parentDisplayName, toIsoOrNull } from "./names";

describe("loop", () => {
  it("defaults to the full loop", () => expect(parseLoop(undefined)).toEqual(FULL_LOOP));
  it("parses JSON strings and ignores garbage", () => {
    expect(parseLoop('{"writing":false}')).toMatchObject({ writing: false, edit: false, read: true });
    expect(parseLoop("{{not json")).toEqual(FULL_LOOP);
    expect(parseLoop({ vocabulary: "yes" })).toEqual(FULL_LOOP);
  });
  it("read can never be switched off; edit needs writing", () => {
    const l = parseLoop({ read: false, writing: false, edit: true });
    expect(l.read).toBe(true);
    expect(l.edit).toBe(false);
  });
  it("hasDownstreamStage", () => {
    expect(hasDownstreamStage(parseLoop({ vocabulary: false, comprehension: false, think: false, writing: false }))).toBe(false);
    expect(hasDownstreamStage(FULL_LOOP)).toBe(true);
  });
  it("station/type mapping", () => {
    const l = parseLoop({ vocabulary: false, comprehension: true });
    expect(stationEnabled(l, "investigation")).toBe(true);
    expect(questionTypeEnabled(parseLoop({ think: false }), "reflect")).toBe(false);
  });
  it("parseAllowed filters unknown values and keeps canonical order", () => {
    expect(parseAllowed('["writing","bogus","newsstand"]', STATIONS, [])).toEqual(["newsstand", "writing"]);
    expect(parseAllowed("nope", STATIONS, ["newsstand"])).toEqual(["newsstand"]);
  });
});

describe("xp / levels", () => {
  it("level boundaries", () => {
    expect(levelForXp(0).level).toBe(1);
    expect(levelForXp(99).level).toBe(1);
    expect(levelForXp(100).level).toBe(2);
    expect(levelForXp(3199).level).toBe(9);
    expect(levelForXp(3200)).toMatchObject({ level: 10, title: "Editor-in-Chief", nextThreshold: null });
    expect(levelForXp(1e9).level).toBe(10);
  });
  it("is monotonic and total over bad input", () => {
    let last = 0;
    for (let xp = 0; xp < 4000; xp += 7) { const l = levelForXp(xp).level; expect(l).toBeGreaterThanOrEqual(last); last = l; }
    expect(levelForXp(-5).level).toBe(1);
    expect(levelForXp(NaN).level).toBe(1);
  });
  it("thresholds are strictly increasing", () => {
    for (let i = 1; i < LEVELS.length; i++) expect(LEVELS[i]!.threshold).toBeGreaterThan(LEVELS[i - 1]!.threshold);
  });
  it("mcqXp and review bonus clamp", () => {
    expect(mcqXp("comprehension", 3)).toBe(30);
    expect(mcqXp("vocabulary", -1)).toBe(0);
    expect(clampReviewBonus(99)).toBe(10);
    expect(clampReviewBonus(-1)).toBe(0);
    expect(clampReviewBonus(NaN)).toBe(0);
  });
  it("idempotency keys are stable", () => expect(xpKey.articlePublished(5)).toBe("article_published:5"));
});

describe("shuffle", () => {
  const seed = { studentId: 3, taskId: 9, attemptNumber: 1 };
  it("same seed -> same order, always", () => {
    expect(shuffledIndices(4, seed, "options:q1")).toEqual(shuffledIndices(4, seed, "options:q1"));
  });
  it("is a permutation", () => {
    for (let n = 0; n < 12; n++) expect([...shuffledIndices(n, seed, "x")].sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i));
  });
  it("differs across pupils, tasks, attempts and salts (at least somewhere)", () => {
    const base = shuffledIndices(8, seed, "s").join();
    const variants = [
      shuffledIndices(8, { ...seed, studentId: 4 }, "s"),
      shuffledIndices(8, { ...seed, taskId: 10 }, "s"),
      shuffledIndices(8, { ...seed, attemptNumber: 2 }, "s"),
      shuffledIndices(8, seed, "t"),
    ].map((v) => v.join());
    expect(variants.some((v) => v !== base)).toBe(true);
  });
  it("applyOrder / originalIndex round-trip", () => {
    const order = shuffledIndices(4, seed, "o");
    const shown = applyOrder(["a", "b", "c", "d"], order);
    shown.forEach((text, pos) => expect(["a", "b", "c", "d"][originalIndex(pos, order)!]).toBe(text));
    expect(originalIndex(9, order)).toBeUndefined();
    expect(originalIndex(1.5, order)).toBeUndefined();
  });
  it("hash32 known value (guards against accidental algorithm change)", () => expect(hash32("a")).toBe(0xe40c292c));
});

describe("completion", () => {
  const tasks = (c: boolean, v: boolean, r: boolean) => [
    { type: "comprehension" as const, passed: c }, { type: "vocabulary" as const, passed: v }, { type: "reflect" as const, passed: r },
  ];
  it("full loop needs every stage", () => {
    const all = ["comprehension", "vocabulary", "reflect", "writing"] as const;
    expect(isArticleComplete({ questionTypes: all, tasks: tasks(true, true, true), writing: { completed: true } })).toBe(true);
    expect(isArticleComplete({ questionTypes: all, tasks: tasks(true, true, true), writing: { completed: false } })).toBe(false);
    expect(isArticleComplete({ questionTypes: all, tasks: tasks(true, false, true), writing: { completed: true } })).toBe(false);
  });
  it("comprehension-only completes on passing comprehension", () =>
    expect(isArticleComplete({ questionTypes: ["comprehension"], tasks: tasks(true, false, false), writing: { completed: false } })).toBe(true));
  it("vocabulary-only article completes on vocabulary", () =>
    expect(isArticleComplete({ questionTypes: ["vocabulary"], tasks: tasks(false, true, false), writing: null })).toBe(true));
  it("a stage with no task does not block, but zero required stages is never complete", () => {
    expect(isArticleComplete({ questionTypes: ["comprehension", "writing"], tasks: [{ type: "comprehension", passed: true }], writing: null })).toBe(true);
    expect(isArticleComplete({ questionTypes: ["writing"], tasks: [], writing: null })).toBe(false);
    expect(isArticleComplete({ questionTypes: [], tasks: tasks(true, true, true), writing: { completed: true } })).toBe(false);
  });
  it("requiredStages lists only enabled+existing", () =>
    expect(requiredStages({ questionTypes: ["vocabulary", "writing"], tasks: tasks(false, false, false), writing: { completed: false } })).toEqual(["vocabulary", "writing"]));
  it("mcqPassed tolerates float error", () => {
    expect(mcqPassed(0.75, 0.75)).toBe(true);
    expect(mcqPassed(3 / 4, 0.75)).toBe(true);
    expect(mcqPassed(0.5, 0.75)).toBe(false);
  });
});

describe("similarity", () => {
  const article = "The school council met on Tuesday to discuss the new recycling programme and agreed that every classroom would receive two bins by the end of term.";
  it("tokenize strips punctuation and case", () => expect(tokenize("Hello, World! It's")).toEqual(["hello", "world", "it's"]));
  it("verbatim paste scores ~1", () => expect(copiedFraction(article, [article])).toBe(1));
  it("own words score 0", () => expect(copiedFraction("I think recycling is a good idea because it keeps our school tidy and helps nature.", [article])).toBe(0));
  it("partial copying is between", () => {
    const mixed = "I believe that every classroom would receive two bins by the end of term which is great for everyone involved here.";
    const s = copiedFraction(mixed, [article]);
    expect(s).toBeGreaterThan(0.1);
    expect(s).toBeLessThan(0.9);
  });
  it("short answers are not flagged (shorter than one n-gram)", () => expect(copiedFraction("good idea", [article])).toBe(0));
  it("multiple sources are pooled; empty sources are fine", () => {
    expect(copiedFraction(article, ["unrelated", article])).toBe(1);
    expect(copiedFraction(article, [])).toBe(0);
  });
  it("threshold default and override", () => {
    expect(exceedsThreshold(0.6, null)).toBe(true);
    expect(exceedsThreshold(0.5, null)).toBe(false);
    expect(exceedsThreshold(0.6, 0.9)).toBe(false);
  });
});

describe("names/time", () => {
  it("parent display name", () => {
    expect(parentDisplayName("jia", "Lim")).toBe("J. Lim");
    expect(parentDisplayName("", "Lim")).toBe("Lim");
  });
  it("toIsoOrNull", () => {
    expect(toIsoOrNull("2026-10-06T10:00:00Z")).toBe("2026-10-06T10:00:00.000Z");
    expect(toIsoOrNull("")).toBeNull();
    expect(toIsoOrNull("garbage")).toBeNull();
  });
});
