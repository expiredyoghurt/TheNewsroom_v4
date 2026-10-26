import { beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth/password";
import { call, clock, env, loginPupil, loginTeacher, resetDb, sampleBundle, seedClass, seedPublishedArticle, seedStudents, seedTeacher } from "./helpers";

beforeEach(resetDb);

async function world(opts: { mode?: "free" | "assigned_only"; articles?: number; pupils?: number; rankings?: boolean } = {}) {
  const tid = await seedTeacher("t1");
  const classId = await seedClass("5A", tid, { practiceMode: opts.mode, rankings: opts.rankings });
  const students = await seedStudents(classId, opts.pupils ?? 1);
  const teacher = await loginTeacher("t1");
  const articles = [];
  for (let i = 0; i < (opts.articles ?? 1); i++) articles.push(await seedPublishedArticle(teacher, { title: `Story ${i}`, publishDate: `2026-09-${String(10 + (i % 18)).padStart(2, "0")}` }));
  return { tid, classId, students, teacher, articles, pupil: await loginPupil(classId, 1) };
}

describe("N+1 guards: list endpoints use a FIXED number of round trips", () => {
  it("hub: same round trips for 2 articles and 25 articles", async () => {
    const small = await world({ articles: 2 });
    const a = await call("hub", { token: small.pupil });
    await resetDb();
    const big = await world({ articles: 25 });
    const b = await call("hub", { token: big.pupil });
    expect(a.json.articles).toHaveLength(2);
    expect(b.json.articles).toHaveLength(25);
    expect(b.roundTrips).toBe(a.roundTrips);
    expect(b.roundTrips).toBeLessThanOrEqual(4);
  });
  it("rankings: same round trips for 3 pupils and 40 pupils", async () => {
    const small = await world({ pupils: 3 });
    const a = await call("rankings", { token: small.pupil });
    await resetDb();
    const big = await world({ pupils: 40 });
    const b = await call("rankings", { token: big.pupil });
    expect(b.json.roster).toHaveLength(40);
    expect(b.roundTrips).toBe(a.roundTrips);
  });
  it("GOAT board and parent view are bounded too", async () => {
    const w = await world({ pupils: 30 });
    await env.DB.prepare("UPDATE students SET xp_total = id").run();
    const g = await call("goat", { token: w.pupil });
    expect(g.json.goat).toHaveLength(10);
    expect(g.roundTrips).toBeLessThanOrEqual(1);
    await env.DB.prepare("UPDATE classes SET parent_password_hash = ? WHERE id = ?").bind(await hashPassword("parents1"), w.classId).run();
    const p = await call("parentLogin", { body: { classId: w.classId, password: "parents1" } });
    const pc = await call("parentClass", { token: (p.json as { token: string }).token });
    expect(pc.json.roster).toHaveLength(30);
    expect(pc.roundTrips).toBeLessThanOrEqual(2);
  });
  it("teacher progress grid: bounded for 5 vs 35 pupils", async () => {
    const small = await world({ pupils: 5, articles: 2 });
    for (const a of small.articles) await call("createAssignment", { token: small.teacher, body: { classId: small.classId, articleId: a.articleId } });
    const a = await call("progress", { token: small.teacher, query: { classId: small.classId } });
    await resetDb();
    const big = await world({ pupils: 35, articles: 2 });
    for (const x of big.articles) await call("createAssignment", { token: big.teacher, body: { classId: big.classId, articleId: x.articleId } });
    const b = await call("progress", { token: big.teacher, query: { classId: big.classId } });
    expect(b.json.cells).toHaveLength(35 * 2);
    expect(b.roundTrips).toBe(a.roundTrips);
  });
  it("roster import: round trips do not grow with the number of rows", async () => {
    const w = await world();
    const rows = (n: number, off: number) => Array.from({ length: n }, (_, i) => ({ reporterId: `n${off + i}`, firstName: "A", lastName: "B", indexNumber: 100 + off + i, pressPass: "secret1" }));
    const s = await call("importRoster", { token: w.teacher, body: { classId: w.classId, rows: rows(3, 0) } });
    const l = await call("importRoster", { token: w.teacher, body: { classId: w.classId, rows: rows(60, 10) } });
    expect(s.json.createdCount).toBe(3);
    expect(l.json.createdCount).toBe(60);
    expect(l.roundTrips).toBe(s.roundTrips);
  });
});

describe("hub: the single access rule at the list call site", () => {
  // REGRESSION (v3 review): in free practice, ONE not-yet-started assignment hid the whole class's article list.
  it("free practice: a scheduled (future) assignment does not hide or lock any article", async () => {
    const w = await world({ mode: "free", articles: 3 });
    await call("createAssignment", { token: w.teacher, body: { classId: w.classId, articleId: w.articles[0]!.articleId, startAt: "2026-12-01T00:00:00Z" } });
    const r = await call("hub", { token: w.pupil });
    expect(r.status).toBe(200);
    expect(r.json.articles).toHaveLength(3);
    expect(r.json.articles.every((a) => a.locked === null)).toBe(true);
  });
  it("free practice: the same scheduled assignment does not block opening the task either (single-article call site)", async () => {
    const w = await world({ mode: "free", articles: 1 });
    await call("createAssignment", { token: w.teacher, body: { classId: w.classId, articleId: w.articles[0]!.articleId, startAt: "2026-12-01T00:00:00Z" } });
    expect((await call("getTask", { token: w.pupil, params: { taskId: w.articles[0]!.comprehension } })).status).toBe(200);
    expect((await call("readArticle", { token: w.pupil, params: { articleId: w.articles[0]!.articleId } })).status).toBe(200);
  });
  it("hub and single-article routes AGREE (one rule, two call sites)", async () => {
    const w = await world({ mode: "assigned_only", articles: 3 });
    const [a, b, c] = w.articles;
    await call("createAssignment", { token: w.teacher, body: { classId: w.classId, articleId: a!.articleId } });
    await call("createAssignment", { token: w.teacher, body: { classId: w.classId, articleId: b!.articleId, startAt: "2026-12-01T00:00:00Z" } });
    const hub = await call("hub", { token: w.pupil });
    const byId = new Map(hub.json.articles.map((x) => [x.articleId, x]));
    expect(byId.has(c!.articleId)).toBe(false);                 // not assigned: hidden
    expect(byId.get(a!.articleId)!.locked).toBeNull();           // open
    expect(byId.get(b!.articleId)!.locked?.reason).toBe("not_started");
    expect((await call("getTask", { token: w.pupil, params: { taskId: a!.comprehension } })).status).toBe(200);
    expect((await call("getTask", { token: w.pupil, params: { taskId: b!.comprehension } })).status).toBe(403);
    expect((await call("getTask", { token: w.pupil, params: { taskId: c!.comprehension } })).status).toBe(403);
  });
  it("assigned_only: past-due blocks new work; the window opening later unlocks it", async () => {
    const w = await world({ mode: "assigned_only", articles: 1 });
    const id = w.articles[0]!.articleId;
    await call("createAssignment", { token: w.teacher, body: { classId: w.classId, articleId: id, dueAt: "2026-10-05T00:00:00Z" } });
    expect((await call("hub", { token: w.pupil })).json.articles[0]!.locked?.reason).toBe("past_due");
    expect((await call("getTask", { token: w.pupil, params: { taskId: w.articles[0]!.comprehension } })).status).toBe(403);
    await env.DB.prepare("UPDATE assignments SET due_at = '2026-10-20T00:00:00.000Z'").run();
    expect((await call("getTask", { token: w.pupil, params: { taskId: w.articles[0]!.comprehension } })).status).toBe(200);
  });
  it("an assignment overrides class defaults: only the chosen task types are open", async () => {
    const w = await world({ mode: "free", articles: 1 });
    await call("createAssignment", { token: w.teacher, body: { classId: w.classId, articleId: w.articles[0]!.articleId, allowedQuestionTypes: ["vocabulary"] } });
    const art = (await call("hub", { token: w.pupil })).json.articles[0]!;
    expect(art.access?.questionTypes).toEqual(["vocabulary"]);
    expect((await call("getTask", { token: w.pupil, params: { taskId: w.articles[0]!.vocabulary } })).status).toBe(200);
    expect((await call("getTask", { token: w.pupil, params: { taskId: w.articles[0]!.comprehension } })).status).toBe(403);
    expect((await call("getWritingTask", { token: w.pupil, params: { articleId: w.articles[0]!.articleId } })).status).toBe(403);
  });
  it("the article's own loop is a ceiling the assignment cannot raise", async () => {
    const tid = await seedTeacher("t1"); const classId = await seedClass("5A", tid); await seedStudents(classId, 1);
    const teacher = await loginTeacher("t1");
    const art = await seedPublishedArticle(teacher, {}, { vocabulary: false, think: false, writing: false, edit: false });
    await call("createAssignment", { token: teacher, body: { classId, articleId: art.articleId } }); // asks for everything
    const pupil = await loginPupil(classId, 1);
    const hubArt = (await call("hub", { token: pupil })).json.articles[0]!;
    expect(hubArt.access?.questionTypes).toEqual(["comprehension"]);
    expect((await call("getTask", { token: pupil, params: { taskId: art.reflect } })).status).toBe(403);
  });
  it("attempt limits from the assignment are enforced", async () => {
    const w = await world({ mode: "free", articles: 1 });
    const id = w.articles[0]!;
    await call("createAssignment", { token: w.teacher, body: { classId: w.classId, articleId: id.articleId, attemptsAllowed: 1 } });
    const { correctAnswers } = await import("./helpers");
    const a1 = await correctAnswers(w.pupil, id.vocabulary, "vocabulary", w.students[0]!);
    expect((await call("submitMcq", { token: w.pupil, params: { taskId: id.vocabulary }, body: a1 })).status).toBe(200);
    expect((await call("getTask", { token: w.pupil, params: { taskId: id.vocabulary } })).status).toBe(403);
  });
  it("rankings hide other pupils' XP unless the class enables rankings", async () => {
    const hidden = await world({ pupils: 3, rankings: false });
    await env.DB.prepare("UPDATE students SET xp_total = 120").run();
    const a = await call("rankings", { token: hidden.pupil });
    expect(a.json.roster.find((r) => r.isYou)!.xp).toBe(120);
    expect(a.json.roster.filter((r) => !r.isYou).every((r) => r.xp === null)).toBe(true);
    await env.DB.prepare("UPDATE classes SET rankings_enabled = 1").run();
    const b = await call("rankings", { token: hidden.pupil });
    expect(b.json.roster.every((r) => r.xp === 120 && r.level === 2)).toBe(true);
  });
  it("draft and archived articles never reach pupils", async () => {
    const w = await world({ articles: 2 });
    await env.DB.prepare("UPDATE articles SET status = 'archived' WHERE id = ?").bind(w.articles[0]!.articleId).run();
    const hub = await call("hub", { token: w.pupil });
    expect(hub.json.articles.map((a) => a.articleId)).toEqual([w.articles[1]!.articleId]);
    expect((await call("readArticle", { token: w.pupil, params: { articleId: w.articles[0]!.articleId } })).status).toBe(404);
    void clock; void sampleBundle;
  });
});
