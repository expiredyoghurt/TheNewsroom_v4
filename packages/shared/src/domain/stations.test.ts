import { describe, expect, it } from "vitest";
import { stationArticles, stationBadge, type StationArticleView } from "./stations";
import { tierForLevel, LEVELS } from "./xp";
import { FULL_LOOP, STATIONS, QUESTION_TYPES } from "./loop";

const open = (o: Partial<StationArticleView> & { articleId: number }): StationArticleView => ({
  locked: null, tasks: {}, writing: undefined,
  access: { assignmentId: null, stations: [...STATIONS], questionTypes: [...QUESTION_TYPES], attemptsAllowed: null, learningLoop: FULL_LOOP }, ...o,
});
const t = (passed: boolean) => ({ taskId: 1, passed, attemptsCount: passed ? 1 : 0 });

describe("station articles + badges follow the pupil's EFFECTIVE rules", () => {
  it("newsstand: every open story; locked and hidden ones are excluded", () => {
    const list = [open({ articleId: 1 }), open({ articleId: 2, locked: { reason: "past_due", message: "x", startAt: null, dueAt: null } }), open({ articleId: 3, access: null })];
    expect(stationArticles(list, "newsstand").map((e) => e.article.articleId)).toEqual([1]);
    expect(stationBadge(list, "newsstand")).toBe("Ready ✓");
    expect(stationBadge([], "newsstand")).toBe("Nothing yet");
  });
  it("investigation: comprehension and/or vocabulary; done only when every offered task is passed", () => {
    const a = open({ articleId: 1, tasks: { comprehension: t(true), vocabulary: t(false) } });
    expect(stationArticles([a], "investigation")[0]!.done).toBe(false);
    expect(stationBadge([a], "investigation")).toBe("1 waiting");
    const b = open({ articleId: 2, tasks: { comprehension: t(true), vocabulary: t(true) } });
    expect(stationBadge([b], "investigation")).toBe("All done ✓");
  });
  it("vocabulary-only article still counts for the Investigation station", () => {
    const a = open({ articleId: 1, tasks: { vocabulary: t(false) }, access: { assignmentId: null, stations: ["newsstand", "investigation"], questionTypes: ["vocabulary"], attemptsAllowed: null, learningLoop: { ...FULL_LOOP, comprehension: false, think: false, writing: false, edit: false } } });
    expect(stationArticles([a], "investigation")).toHaveLength(1);
    expect(stationBadge([a], "opinion")).toBe("Nothing yet");
  });
  it("an assignment that limits task types removes the other stations (v3 counted by article flags and got this wrong)", () => {
    const a = open({ articleId: 1, tasks: { comprehension: t(false), vocabulary: t(false), reflect: t(false) }, writing: t(false),
      access: { assignmentId: 9, stations: [...STATIONS], questionTypes: ["vocabulary"], attemptsAllowed: null, learningLoop: FULL_LOOP } });
    expect(stationArticles([a], "investigation")).toHaveLength(1);
    expect(stationBadge([a], "opinion")).toBe("Nothing yet");
    expect(stationBadge([a], "writing")).toBe("Nothing yet");
  });
  it("writing vs editor: the editor only offers stories that already have a first draft", () => {
    const fresh = open({ articleId: 1, writing: t(false) });
    const drafted = open({ articleId: 2, writing: { taskId: 5, passed: true, attemptsCount: 1 } });
    expect(stationArticles([fresh, drafted], "writing").map((e) => e.done)).toEqual([false, true]);
    expect(stationArticles([fresh, drafted], "editor").map((e) => e.article.articleId)).toEqual([2]);
    expect(stationBadge([fresh, drafted], "editor")).toBe("1 ready to edit");
  });
  it("editing switched off per article hides the Editor's Desk", () => {
    const a = open({ articleId: 1, writing: { taskId: 5, passed: true, attemptsCount: 2 }, access: { assignmentId: null, stations: ["newsstand", "writing"], questionTypes: ["writing"], attemptsAllowed: null, learningLoop: { ...FULL_LOOP, edit: false } } });
    expect(stationArticles([a], "editor")).toHaveLength(0);
  });
  it("opinion desk and today's story", () => {
    expect(stationBadge([open({ articleId: 1, tasks: { reflect: t(false) } })], "opinion")).toBe("1 waiting");
    expect(stationBadge([], "todaysStory")).toBe("🏆 GOAT");
    expect(stationArticles([open({ articleId: 1 })], "todaysStory")).toEqual([]);
  });
});

describe("rank badge tiers", () => {
  it("two levels per tier, five tiers, covering every defined level", () => {
    expect(LEVELS.map((l) => tierForLevel(l.level))).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  });
  it("is null (no badge) when there is no level, e.g. hidden by the class", () => {
    expect(tierForLevel(null)).toBeNull();
    expect(tierForLevel(undefined)).toBeNull();
    expect(tierForLevel(NaN)).toBeNull();
  });
});
