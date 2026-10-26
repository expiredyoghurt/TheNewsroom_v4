import { describe, it, expect } from "vitest";
import { resolveArticleAccess, assignmentWindow, checkQuestionType, checkStation, checkAttemptLimit, type AssignmentRules, type ClassRules } from "./access";
import { FULL_LOOP, STATIONS, QUESTION_TYPES, type LearningLoop } from "./loop";

const NOW = new Date("2026-10-06T10:00:00Z");
const freeClass: ClassRules = { practiceMode: "free", enabledStations: STATIONS, allowedQuestionTypes: QUESTION_TYPES };
const assignedClass: ClassRules = { ...freeClass, practiceMode: "assigned_only" };
const asg = (o: Partial<AssignmentRules> = {}): AssignmentRules => ({
  id: 7, active: true, startAt: null, dueAt: null, stations: STATIONS, questionTypes: QUESTION_TYPES, attemptsAllowed: null, ...o,
});
const loop = (o: Partial<LearningLoop>): LearningLoop => ({ ...FULL_LOOP, ...o });

describe("assignmentWindow", () => {
  it("is open with no bounds", () => expect(assignmentWindow({ startAt: null, dueAt: null }, NOW)).toBe("open"));
  it("not_started before start", () => expect(assignmentWindow({ startAt: "2026-10-07T00:00:00Z", dueAt: null }, NOW)).toBe("not_started"));
  it("past_due after due", () => expect(assignmentWindow({ startAt: null, dueAt: "2026-10-05T00:00:00Z" }, NOW)).toBe("past_due"));
  it("boundaries are inclusive", () => {
    expect(assignmentWindow({ startAt: NOW.toISOString(), dueAt: null }, NOW)).toBe("open");
    expect(assignmentWindow({ startAt: null, dueAt: NOW.toISOString() }, NOW)).toBe("open");
  });
  it("ignores unparseable dates rather than blocking", () => expect(assignmentWindow({ startAt: "nonsense", dueAt: null }, NOW)).toBe("open"));
});

describe("resolveArticleAccess: free practice", () => {
  it("opens with class defaults when there is no assignment", () => {
    const r = resolveArticleAccess({ articleLoop: FULL_LOOP, classRules: freeClass, assignment: null, now: NOW });
    expect(r).toMatchObject({ status: "open", source: "class", assignmentId: null });
  });

  // REGRESSION (v3): a not-yet-started assignment blocked the article list for the whole class in free mode.
  it("a not-yet-started assignment does NOT block the article", () => {
    const r = resolveArticleAccess({ articleLoop: FULL_LOOP, classRules: freeClass, assignment: asg({ startAt: "2026-12-01T00:00:00Z" }), now: NOW });
    expect(r.status).toBe("open");
    if (r.status === "open") expect(r.source).toBe("class");
  });
  it("a past-due assignment does NOT block the article", () => {
    const r = resolveArticleAccess({ articleLoop: FULL_LOOP, classRules: freeClass, assignment: asg({ dueAt: "2026-01-01T00:00:00Z" }), now: NOW });
    expect(r.status).toBe("open");
  });
  it("an in-window assignment overrides class defaults", () => {
    const cls: ClassRules = { ...freeClass, allowedQuestionTypes: ["comprehension"] };
    const r = resolveArticleAccess({ articleLoop: FULL_LOOP, classRules: cls, assignment: asg({ questionTypes: ["writing"], attemptsAllowed: 2 }), now: NOW });
    expect(r).toMatchObject({ status: "open", source: "assignment", assignmentId: 7, attemptsAllowed: 2 });
    if (r.status === "open") expect(r.questionTypes).toEqual(["writing"]);
  });
  it("an inactive assignment is ignored", () => {
    const r = resolveArticleAccess({ articleLoop: FULL_LOOP, classRules: freeClass, assignment: asg({ active: false, questionTypes: ["vocabulary"] }), now: NOW });
    if (r.status === "open") expect(r.source).toBe("class");
  });
});

describe("resolveArticleAccess: assigned_only", () => {
  it("blocks with not_assigned when there is no assignment", () =>
    expect(resolveArticleAccess({ articleLoop: FULL_LOOP, classRules: assignedClass, assignment: null, now: NOW })).toMatchObject({ status: "blocked", reason: "not_assigned" }));
  it("blocks with not_started", () =>
    expect(resolveArticleAccess({ articleLoop: FULL_LOOP, classRules: assignedClass, assignment: asg({ startAt: "2026-12-01T00:00:00Z" }), now: NOW })).toMatchObject({ status: "blocked", reason: "not_started", assignmentId: 7 }));
  it("blocks with past_due", () =>
    expect(resolveArticleAccess({ articleLoop: FULL_LOOP, classRules: assignedClass, assignment: asg({ dueAt: "2026-01-01T00:00:00Z" }), now: NOW })).toMatchObject({ status: "blocked", reason: "past_due" }));
  it("opens inside the window", () =>
    expect(resolveArticleAccess({ articleLoop: FULL_LOOP, classRules: assignedClass, assignment: asg(), now: NOW }).status).toBe("open"));
  it("never throws, whatever the input", () => {
    expect(() => resolveArticleAccess({ articleLoop: FULL_LOOP, classRules: assignedClass, assignment: asg({ startAt: "x", dueAt: "y" }), now: NOW })).not.toThrow();
  });
});

describe("resolveArticleAccess: article loop is a hard ceiling", () => {
  it("an assignment cannot re-enable a stage the article disabled", () => {
    const r = resolveArticleAccess({ articleLoop: loop({ writing: false, edit: false, think: false }), classRules: freeClass, assignment: asg(), now: NOW });
    if (r.status !== "open") throw new Error("expected open");
    expect(r.questionTypes).toEqual(["comprehension", "vocabulary"]);
    expect(r.stations).not.toContain("writing");
    expect(r.stations).not.toContain("opinion");
    expect(r.stations).not.toContain("editor");
  });
  it("comprehension-only article", () => {
    const r = resolveArticleAccess({ articleLoop: loop({ vocabulary: false, think: false, writing: false, edit: false }), classRules: freeClass, assignment: null, now: NOW });
    if (r.status !== "open") throw new Error("expected open");
    expect(r.questionTypes).toEqual(["comprehension"]);
    expect(r.stations).toEqual(["newsstand", "investigation"]);
  });
  it("vocabulary-only article is valid", () => {
    const r = resolveArticleAccess({ articleLoop: loop({ comprehension: false, think: false, writing: false, edit: false }), classRules: freeClass, assignment: null, now: NOW });
    if (r.status !== "open") throw new Error("expected open");
    expect(r.questionTypes).toEqual(["vocabulary"]);
  });
  it("class can narrow", () => {
    const cls: ClassRules = { ...freeClass, allowedQuestionTypes: ["comprehension"], enabledStations: ["newsstand", "investigation"] };
    const r = resolveArticleAccess({ articleLoop: FULL_LOOP, classRules: cls, assignment: null, now: NOW });
    if (r.status !== "open") throw new Error("expected open");
    expect(r.questionTypes).toEqual(["comprehension"]);
    expect(r.loop.writing).toBe(false);
  });
  it("editor needs writing", () => {
    const r = resolveArticleAccess({ articleLoop: FULL_LOOP, classRules: { ...freeClass, allowedQuestionTypes: ["comprehension"] }, assignment: null, now: NOW });
    if (r.status !== "open") throw new Error("expected open");
    expect(r.loop.edit).toBe(false);
    expect(r.stations).not.toContain("editor");
  });
  it("newsstand is always available when open, even if a class omitted it", () => {
    const r = resolveArticleAccess({ articleLoop: FULL_LOOP, classRules: { ...freeClass, enabledStations: ["writing"] }, assignment: null, now: NOW });
    if (r.status !== "open") throw new Error("expected open");
    expect(r.stations).toContain("newsstand");
  });
});

describe("call-site checks (the single rule, two behaviours)", () => {
  const open = resolveArticleAccess({ articleLoop: FULL_LOOP, classRules: { ...freeClass, allowedQuestionTypes: ["comprehension"] }, assignment: null, now: NOW });
  const blocked = resolveArticleAccess({ articleLoop: FULL_LOOP, classRules: assignedClass, assignment: null, now: NOW });
  it("allows enabled types", () => expect(checkQuestionType(open, "comprehension")).toEqual({ ok: true }));
  it("refuses disabled types", () => expect(checkQuestionType(open, "reflect")).toMatchObject({ ok: false, status: 403 }));
  it("refuses everything when blocked", () => {
    expect(checkQuestionType(blocked, "comprehension")).toMatchObject({ ok: false });
    expect(checkStation(blocked, "newsstand")).toMatchObject({ ok: false });
  });
  it("attempt limit", () => {
    const r = resolveArticleAccess({ articleLoop: FULL_LOOP, classRules: freeClass, assignment: asg({ attemptsAllowed: 2 }), now: NOW });
    if (r.status !== "open") throw new Error("expected open");
    expect(checkAttemptLimit(r, 1)).toEqual({ ok: true });
    expect(checkAttemptLimit(r, 2)).toMatchObject({ ok: false });
  });
  it("no limit without an assignment limit", () => {
    if (open.status !== "open") throw new Error();
    expect(checkAttemptLimit(open, 999)).toEqual({ ok: true });
  });
});
