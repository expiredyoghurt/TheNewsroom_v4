import { beforeEach, describe, expect, it } from "vitest";
import { call, env, fakeAi, loginPupil, loginTeacher, okReflectJson, resetDb, sampleBundle, seedClass, seedPublishedArticle, seedStudents, seedTeacher } from "./helpers";

beforeEach(resetDb);

async function twoTeachers() {
  const a = await seedTeacher("ta"); const b = await seedTeacher("tb"); const admin = await seedTeacher("boss", "admin");
  const classA = await seedClass("5A", a); const classB = await seedClass("5B", b);
  await seedStudents(classA, 3); await seedStudents(classB, 2);
  return { a, b, admin, classA, classB, ta: await loginTeacher("ta"), tb: await loginTeacher("tb"), tadmin: await loginTeacher("boss") };
}

describe("tenancy: teachers see only their classes; admins see all", () => {
  it("class list, roster, settings, progress and assignments are scoped", async () => {
    const w = await twoTeachers();
    expect((await call("classes", { token: w.ta })).json.classes.map((c) => c.name)).toEqual(["5A"]);
    expect((await call("classes", { token: w.tadmin })).json.classes.map((c) => c.name)).toEqual(["5A", "5B"]);
    expect((await call("roster", { token: w.tb, query: { classId: w.classA } })).status).toBe(403);
    expect((await call("progress", { token: w.tb, query: { classId: w.classA } })).status).toBe(403);
    expect((await call("updateClassSettings", { token: w.tb, params: { classId: w.classA }, body: { rankingsEnabled: true } })).status).toBe(403);
    expect((await call("roster", { token: w.tadmin, query: { classId: w.classA } })).status).toBe(200);
    const art = await seedPublishedArticle(w.ta);
    expect((await call("createAssignment", { token: w.tb, body: { classId: w.classA, articleId: art.articleId } })).status).toBe(403);
    await call("createAssignment", { token: w.ta, body: { classId: w.classA, articleId: art.articleId } });
    expect((await call("listAssignments", { token: w.tb, query: {} })).json.assignments).toHaveLength(0);
    expect((await call("listAssignments", { token: w.ta, query: {} })).json.assignments).toHaveLength(1);
  });
  it("pupil-level actions are checked against the pupil's class", async () => {
    const w = await twoTeachers();
    const [{ id }] = (await env.DB.prepare("SELECT id FROM students WHERE class_id = ?").bind(w.classA).all<{ id: number }>()).results as [{ id: number }];
    expect((await call("removePupil", { token: w.tb, body: { studentId: id } })).status).toBe(403);
    expect((await call("resetPupilPassword", { token: w.tb, body: { studentId: id, newPressPass: "newpass1" } })).status).toBe(403);
    expect((await call("removePupil", { token: w.ta, body: { studentId: id } })).status).toBe(200);
  });
  it("only an admin may create a class for another teacher", async () => {
    const w = await twoTeachers();
    expect((await call("createClass", { token: w.ta, body: { name: "6A", teacherId: w.b } })).status).toBe(403);
    expect((await call("createClass", { token: w.tadmin, body: { name: "6A", teacherId: w.b } })).status).toBe(200);
    expect((await call("createClass", { token: w.ta, body: { name: "6B" } })).status).toBe(200);
    expect((await call("createClass", { token: w.ta, body: { name: "6B" } })).status).toBe(409);
  });
});

describe("class settings + roster", () => {
  it("settings update, parent password can be set from the UI route, and an empty patch is rejected", async () => {
    const w = await twoTeachers();
    const r = await call("updateClassSettings", { token: w.ta, params: { classId: w.classA }, body: { practiceMode: "assigned_only", rankingsEnabled: true, similarityThreshold: 0.7, enabledStations: ["newsstand", "investigation"], parentPassword: "family123" } });
    expect(r.status).toBe(200);
    const c = (await call("classes", { token: w.ta })).json.classes[0]!;
    expect(c).toMatchObject({ practiceMode: "assigned_only", rankingsEnabled: true, similarityThreshold: 0.7, enabledStations: ["newsstand", "investigation"], hasParentPassword: true });
    expect((await call("parentLogin", { body: { classId: w.classA, password: "family123" } })).status).toBe(200);
    expect((await call("updateClassSettings", { token: w.ta, params: { classId: w.classA }, body: {} })).status).toBe(400);
    expect((await call("updateClassSettings", { token: w.ta, params: { classId: w.classA }, body: { similarityThreshold: 5 } })).status).toBe(400);
  });
  it("roster import reports why rows were skipped", async () => {
    const w = await twoTeachers();
    const row = (id: string, idx: number) => ({ reporterId: id, firstName: "A", lastName: "B", indexNumber: idx, pressPass: "secret1" });
    const r = await call("importRoster", { token: w.ta, body: { classId: w.classA, rows: [row("new1", 10), row("NEW1", 11), row("new2", 10), row(`p${w.classA}-1`, 12), row("new3", 1), row("new4", 13)] } });
    expect(r.json.created).toEqual(["new1", "new4"]);
    expect(r.json.skipped.map((s) => s.reason)).toEqual(["Duplicate reporter ID in this file", "Duplicate index number in this file", "Reporter ID already exists", "Index number already used in this class"]);
  });
  it("add / remove / reset password / change class", async () => {
    const w = await twoTeachers();
    const add = await call("addPupil", { token: w.ta, body: { classId: w.classA, reporterId: "Zed", firstName: "Z", lastName: "Q", indexNumber: 20, pressPass: "zedpass1" } });
    expect(add.status).toBe(200);
    expect((await call("addPupil", { token: w.ta, body: { classId: w.classA, reporterId: "zed", firstName: "Z", lastName: "Q", indexNumber: 21, pressPass: "zedpass1" } })).status).toBe(409);
    expect((await call("pupilLogin", { body: { reporterId: "ZED", pressPass: "zedpass1" } })).status).toBe(200); // case-insensitive
    // lock the account, then a teacher reset clears the lock AND changes the password
    for (let i = 0; i < 8; i++) await call("pupilLogin", { body: { reporterId: "zed", pressPass: "bad" } });
    const id = (add.json as { id: number }).id;
    await call("resetPupilPassword", { token: w.ta, body: { studentId: id, newPressPass: "brandnew1" } });
    expect((await call("pupilLogin", { body: { reporterId: "zed", pressPass: "zedpass1" } })).status).toBe(401);
    expect((await call("pupilLogin", { body: { reporterId: "zed", pressPass: "brandnew1" } })).status).toBe(200);
    await call("changePupilClass", { token: w.tadmin, body: { studentId: id, newClassId: w.classB } });
    const moved = (await call("roster", { token: w.tb, query: { classId: w.classB } })).json.students.find((s) => s.id === id)!;
    expect(moved.indexNumber).toBe(3);
    await call("removePupil", { token: w.tadmin, body: { studentId: id } });
    expect((await call("pupilLogin", { body: { reporterId: "zed", pressPass: "brandnew1" } })).status).toBe(401);
    expect((await call("roster", { token: w.tb, query: { classId: w.classB } })).json.students.find((s) => s.id === id)!.archived).toBe(true); // archived, never deleted
  });
});

describe("article lifecycle: draft -> published (locked) -> fork", () => {
  it("import validates the bundle, and a bad bundle leaves NOTHING behind", async () => {
    const w = await twoTeachers();
    const bad = sampleBundle(); bad.comprehension.questions[0]!.evidence_chunk_id = "nope";
    const r = await call("importArticle", { token: w.ta, body: bad });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.json.issues)).toContain("evidence_chunk_id");
    expect((await env.DB.prepare("SELECT COUNT(*) n FROM articles").first<{ n: number }>())!.n).toBe(0);
    const wrongCount = sampleBundle(); wrongCount.comprehension.questions.pop();
    expect((await call("importArticle", { token: w.ta, body: wrongCount })).status).toBe(400);
  });
  it("a good import creates article + 3 tasks + writing task together as a draft", async () => {
    const w = await twoTeachers();
    const r = await call("importArticle", { token: w.ta, body: sampleBundle() });
    const id = (r.json as { articleId: number }).articleId;
    const counts = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM tasks WHERE article_id = ?1) t, (SELECT COUNT(*) FROM writing_tasks WHERE article_id = ?1) w, (SELECT status FROM articles WHERE id = ?1) s").bind(id).first();
    expect(counts).toEqual({ t: 3, w: 1, s: "draft" });
  });
  it("a writing-less bundle is valid (writing is optional per article)", async () => {
    const w = await twoTeachers();
    const b = sampleBundle(); delete b.writing;
    expect((await call("importArticle", { token: w.ta, body: b })).status).toBe(200);
  });
  it("drafts are editable; PUBLISHED articles are locked; forking gives a new independent draft", async () => {
    const w = await twoTeachers();
    const id = (await call("importArticle", { token: w.ta, body: sampleBundle() })).json as { articleId: number };
    expect((await call("updateArticle", { token: w.ta, params: { articleId: id.articleId }, body: { title: "Edited" } })).status).toBe(200);
    expect((await call("publishArticle", { token: w.ta, params: { articleId: id.articleId } })).status).toBe(200);
    expect((await call("publishArticle", { token: w.ta, params: { articleId: id.articleId } })).status).toBe(409);       // one-way
    expect((await call("updateArticle", { token: w.ta, params: { articleId: id.articleId }, body: { title: "Again" } })).status).toBe(409); // locked
    const fork = await call("forkArticle", { token: w.tb, params: { articleId: id.articleId }, body: {} });
    expect(fork.status).toBe(200);
    const fid = fork.json.articleId;
    const shape = await env.DB.prepare("SELECT status, forked_from_id, title, (SELECT COUNT(*) FROM tasks WHERE article_id = ?1) t, (SELECT COUNT(*) FROM writing_tasks WHERE article_id = ?1) w FROM articles WHERE id = ?1").bind(fid).first();
    expect(shape).toEqual({ status: "draft", forked_from_id: id.articleId, title: "Edited (copy)", t: 3, w: 1 });
    expect((await call("updateArticle", { token: w.tb, params: { articleId: fid }, body: { title: "Mine now" } })).status).toBe(200);
    expect((await env.DB.prepare("SELECT title FROM articles WHERE id = ?").bind(id.articleId).first<{ title: string }>())!.title).toBe("Edited"); // original untouched
  });
  it("only the author (or an admin) can edit a draft", async () => {
    const w = await twoTeachers();
    const id = ((await call("importArticle", { token: w.ta, body: sampleBundle() })).json as { articleId: number }).articleId;
    expect((await call("updateArticle", { token: w.tb, params: { articleId: id }, body: { title: "Hijack" } })).status).toBe(403);
    expect((await call("updateArticle", { token: w.tadmin, params: { articleId: id }, body: { title: "Admin edit" } })).status).toBe(200);
  });
  it("editing a task cannot point at a chunk that does not exist", async () => {
    const w = await twoTeachers();
    const id = ((await call("importArticle", { token: w.ta, body: sampleBundle() })).json as { articleId: number }).articleId;
    const bad = sampleBundle().comprehension; bad.questions[1]!.evidence_chunk_id = "missing";
    const r = await call("updateArticle", { token: w.ta, params: { articleId: id }, body: { tasks: [{ type: "comprehension", payload: bad }] } });
    expect(r.status).toBe(400);
  });
  it("the learning loop keeps Read on, ties Edit to Writing, and needs one downstream stage", async () => {
    const w = await twoTeachers();
    const id = ((await call("importArticle", { token: w.ta, body: sampleBundle() })).json as { articleId: number }).articleId;
    const r = await call("setLearningLoop", { token: w.ta, params: { articleId: id }, body: { learningLoop: { writing: false } } });
    expect(r.json.learningLoop).toMatchObject({ read: true, writing: false, edit: false });
    const none = await call("setLearningLoop", { token: w.ta, params: { articleId: id }, body: { learningLoop: { vocabulary: false, comprehension: false, think: false } } });
    expect(none.status).toBe(400);
  });
  it("assignments need a published article and a sane window; duplicates are refused", async () => {
    const w = await twoTeachers();
    const draft = ((await call("importArticle", { token: w.ta, body: sampleBundle() })).json as { articleId: number }).articleId;
    expect((await call("createAssignment", { token: w.ta, body: { classId: w.classA, articleId: draft } })).status).toBe(400);
    const pub = await seedPublishedArticle(w.ta);
    expect((await call("createAssignment", { token: w.ta, body: { classId: w.classA, articleId: pub.articleId, startAt: "2026-11-02T00:00:00Z", dueAt: "2026-11-01T00:00:00Z" } })).status).toBe(400);
    const ok = await call("createAssignment", { token: w.ta, body: { classId: w.classA, articleId: pub.articleId, dueAt: "2026-11-01T00:00:00Z" } });
    expect(ok.status).toBe(200);
    expect((await call("createAssignment", { token: w.ta, body: { classId: w.classA, articleId: pub.articleId } })).status).toBe(409);
    const id = (ok.json as { id: number }).id;
    expect((await call("updateAssignment", { token: w.ta, params: { assignmentId: id }, body: { startAt: "2026-12-01T00:00:00Z" } })).status).toBe(400); // start after existing due
    expect((await call("updateAssignment", { token: w.ta, params: { assignmentId: id }, body: { attemptsAllowed: 3, active: false } })).status).toBe(200);
    expect((await call("deleteAssignment", { token: w.tb, params: { assignmentId: id } })).status).toBe(403);
    expect((await call("deleteAssignment", { token: w.ta, params: { assignmentId: id } })).status).toBe(200);
  });
});

describe("images (R2)", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  it("validates type and size, stores content-addressed, and serves only published images to pupils", async () => {
    const w = await twoTeachers();
    const id = ((await call("importArticle", { token: w.ta, body: sampleBundle() })).json as { articleId: number }).articleId;
    expect((await call("uploadThumbnail", { token: w.ta, params: { articleId: id }, raw: { bytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), type: "image/png" } })).status).toBe(400);
    expect((await call("uploadThumbnail", { token: w.ta, params: { articleId: id }, raw: { bytes: new Uint8Array(200 * 1024).fill(0x89), type: "image/png" } })).status).toBe(413);
    expect((await call("uploadArticleImage", { token: w.tb, params: { articleId: id }, raw: { bytes: png, type: "image/png" } })).status).toBe(403);
    expect((await call("uploadArticleImage", { token: w.ta, params: { articleId: id }, raw: { bytes: png, type: "image/png" } })).status).toBe(200);
    const key = (await env.DB.prepare("SELECT image_key FROM articles WHERE id = ?").bind(id).first<{ image_key: string }>())!.image_key;
    expect(key).toMatch(/^page\/[0-9a-f]{64}$/);
    expect(await env.MEDIA.head(key)).not.toBeNull();
    const pupil = await loginPupil(w.classA, 1);
    expect((await call("articleImage", { token: pupil, params: { articleId: id } })).status).toBe(403); // still a draft
    expect((await call("articleImage", { token: w.ta, params: { articleId: id } })).status).toBe(200);
    await call("publishArticle", { token: w.ta, params: { articleId: id } });
    const served = await call("articleImage", { token: pupil, params: { articleId: id } });
    expect(served.status).toBe(200);
    expect(served.res.headers.get("content-type")).toBe("image/png");
    expect((await call("articleImage", { token: null, params: { articleId: id } })).status).toBe(401);
  });
  it("detaching the page image never deletes the shared object", async () => {
    const w = await twoTeachers();
    const id = ((await call("importArticle", { token: w.ta, body: sampleBundle() })).json as { articleId: number }).articleId;
    await call("uploadArticleImage", { token: w.ta, params: { articleId: id }, raw: { bytes: png, type: "image/png" } });
    const key = (await env.DB.prepare("SELECT image_key FROM articles WHERE id = ?").bind(id).first<{ image_key: string }>())!.image_key;
    await call("deleteArticleImage", { token: w.ta, params: { articleId: id } });
    expect(await env.MEDIA.head(key)).not.toBeNull();
    expect((await call("adminArticle", { token: w.ta, params: { articleId: id } })).json.article.hasImage).toBe(false);
  });
});

describe("review queue, bonus XP, re-grading and grading health", () => {
  async function flaggedReflect() {
    const w = await twoTeachers();
    const art = await seedPublishedArticle(w.ta);
    const pupil = await loginPupil(w.classA, 1);
    const sub = await call("submitReflect", { token: pupil, params: { taskId: art.reflect }, body: { attemptNumber: 1, short: "I agree with it", long: "Because pupils learn habits when they recycle at school every day of term." } });
    return { ...w, art, pupil, attemptId: (sub.json as { attemptId: number }).attemptId };
  }
  it("fallback-graded work lands in the queue, with the provider and reason visible", async () => {
    const w = await flaggedReflect();
    const q = (await call("reviewQueue", { token: w.ta, query: {} })).json.queue;
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ kind: "reflect", reasons: ["fallback_graded"], provider: "keyword-fallback", gradingStatus: "fallback", reviewed: false });
    expect((await call("reviewQueue", { token: w.tb, query: {} })).json.queue).toHaveLength(0); // other teacher's class
    expect((await call("dashboard", { token: w.ta })).json.flaggedReviews).toBe(1);
  });
  it("re-requesting AI grading replaces the fallback grade, keeps the history, and clears the flag", async () => {
    const w = await flaggedReflect();
    const r = await call("regrade", { token: w.ta, params: { kind: "reflect", attemptId: w.attemptId }, env: fakeAi(() => okReflectJson()) });
    expect(r.json).toMatchObject({ status: "ai", provider: "workers-ai" });
    expect((await env.DB.prepare("SELECT COUNT(*) n FROM grading_runs").first<{ n: number }>())!.n).toBe(2);
    expect((await call("reviewQueue", { token: w.ta, query: {} })).json.queue).toHaveLength(0);
    expect((await call("regrade", { token: w.tb, params: { kind: "reflect", attemptId: w.attemptId } })).status).toBe(403);
    expect((await call("regrade", { token: w.ta, params: { kind: "bogus", attemptId: w.attemptId } })).status).toBe(404);
  });
  it("review bonus XP is clamped, paid once per task, and recomputed into the cached total", async () => {
    const w = await flaggedReflect();
    const sid = (await env.DB.prepare("SELECT student_id FROM attempts WHERE id = ?").bind(w.attemptId).first<{ student_id: number }>())!.student_id;
    const before = (await env.DB.prepare("SELECT xp_total FROM students WHERE id = ?").bind(sid).first<{ xp_total: number }>())!.xp_total;
    await call("submitReview", { token: w.ta, params: { kind: "reflect", attemptId: w.attemptId }, body: { bonusXp: 100, note: "Good thinking" } });
    await call("submitReview", { token: w.ta, params: { kind: "reflect", attemptId: w.attemptId }, body: { bonusXp: 100 } });
    const after = (await env.DB.prepare("SELECT xp_total FROM students WHERE id = ?").bind(sid).first<{ xp_total: number }>())!.xp_total;
    expect(after - before).toBe(10);
    expect((await call("reviewQueue", { token: w.ta, query: {} })).json.queue[0]!.reviewed).toBe(true);
  });
  it("grading-stats shows how often the non-AI fallback was used", async () => {
    const w = await flaggedReflect();
    await call("regrade", { token: w.ta, params: { kind: "reflect", attemptId: w.attemptId }, env: fakeAi(() => okReflectJson()) });
    await call("regrade", { token: w.ta, params: { kind: "reflect", attemptId: w.attemptId }, env: fakeAi(() => okReflectJson()) });
    const s = (await call("gradingStats", { token: w.ta, query: { days: 7 } })).json;
    expect(s).toMatchObject({ total: 3, fallback: 1, fallbackPercent: 33.3 });
    expect(s.byProvider.map((p) => p.provider).sort()).toEqual(["keyword-fallback", "workers-ai"]);
  });
});

describe("parent view", () => {
  it("shows initials + surname only, and hides XP/levels unless the class enables rankings", async () => {
    const tid = await seedTeacher("t1"); const c = await seedClass("5A", tid, { parentPassword: "parents1" }); await seedStudents(c, 2);
    await env.DB.prepare("UPDATE students SET xp_total = 150").run();
    const token = ((await call("parentLogin", { body: { classId: c, password: "parents1" } })).json as { token: string }).token;
    const off = (await call("parentClass", { token })).json;
    expect(off.roster.map((r) => r.displayName)).toEqual(["F. Last1", "F. Last2"]);
    expect(off.roster.every((r) => r.xp === null && r.level === null)).toBe(true);
    await env.DB.prepare("UPDATE classes SET rankings_enabled = 1").run();
    expect((await call("parentClass", { token })).json.roster[0]).toMatchObject({ xp: 150, level: 2 });
  });
});
