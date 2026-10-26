import { beforeEach, describe, expect, it } from "vitest";
import { call, clock, env, loginPupil, loginTeacher, resetDb, seedClass, seedStudents, seedTeacher } from "./helpers";

beforeEach(resetDb);

describe("routing derived from the contract", () => {
  it("unknown path -> 404, with a request id", async () => {
    const r = await call("hub", { token: null }); // sanity: known route without auth
    expect(r.status).toBe(401);
    const res = await (await import("../src/router")).dispatch(new Request("https://x.test/api/nope"), env, { waitUntil() {} }, (await import("../src/handlers")).handlers);
    expect(res.status).toBe(404);
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });
  it("wrong method -> 405 with an Allow header derived from the table", async () => {
    const { dispatch } = await import("../src/router");
    const { handlers } = await import("../src/handlers");
    const res = await dispatch(new Request("https://x.test/api/admin/assignments/4", { method: "POST" }), env, { waitUntil() {} }, handlers);
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")?.split(", ").sort()).toEqual(["DELETE", "PATCH"]);
  });
  it("invalid body -> 400 with field-level issues", async () => {
    const r = await call("pupilLogin", { body: { reporterId: "" } });
    expect(r.status).toBe(400);
    expect(r.json.issues?.length).toBeGreaterThan(0);
  });
  it("malformed JSON -> 400", async () => {
    const { dispatch } = await import("../src/router");
    const { handlers } = await import("../src/handlers");
    const res = await dispatch(new Request("https://x.test/api/auth/pupil/login", { method: "POST", body: "{nope" }), env, { waitUntil() {} }, handlers);
    expect(res.status).toBe(400);
  });
});

describe("authentication + roles", () => {
  it("pupil login works, and the session reaches a pupil route", async () => {
    const t = await seedTeacher("t1"); const c = await seedClass("5A", t); await seedStudents(c, 1);
    const token = await loginPupil(c, 1);
    const me = await call("pupilProfile", { token });
    expect(me.status).toBe(200);
    expect(me.json).toMatchObject({ firstName: "First1", xp: 0, level: 1 });
  });
  it("wrong password -> 401 with a generic message (no account enumeration)", async () => {
    const t = await seedTeacher("t1"); const c = await seedClass("5A", t); await seedStudents(c, 1);
    const wrongPw = await call("pupilLogin", { body: { reporterId: `p${c}-1`, pressPass: "nope" } });
    const noUser = await call("pupilLogin", { body: { reporterId: "ghost", pressPass: "nope" } });
    expect(wrongPw.status).toBe(401);
    expect(noUser.status).toBe(401);
    expect(wrongPw.json.error).toBe(noUser.json.error);
  });
  it("locks an account after repeated failures (D1 throttle), even with the right password", async () => {
    const t = await seedTeacher("t1"); const c = await seedClass("5A", t); await seedStudents(c, 1);
    for (let i = 0; i < 8; i++) expect((await call("pupilLogin", { body: { reporterId: `p${c}-1`, pressPass: "bad" } })).status).toBe(401);
    const locked = await call("pupilLogin", { body: { reporterId: `p${c}-1`, pressPass: "pupil-pass" } });
    expect(locked.status).toBe(429);
    clock.now = new Date(clock.now.getTime() + 16 * 60_000);
    const after = await call("pupilLogin", { body: { reporterId: `p${c}-1`, pressPass: "pupil-pass" } });
    expect(after.status).toBe(200);
  });
  it("a successful login clears earlier failures", async () => {
    const t = await seedTeacher("t1"); const c = await seedClass("5A", t); await seedStudents(c, 1);
    for (let i = 0; i < 5; i++) await call("pupilLogin", { body: { reporterId: `p${c}-1`, pressPass: "bad" } });
    expect((await call("pupilLogin", { body: { reporterId: `p${c}-1`, pressPass: "pupil-pass" } })).status).toBe(200);
    for (let i = 0; i < 5; i++) await call("pupilLogin", { body: { reporterId: `p${c}-1`, pressPass: "bad" } });
    expect((await call("pupilLogin", { body: { reporterId: `p${c}-1`, pressPass: "pupil-pass" } })).status).toBe(200);
  });
  it("route-level role checks: no token 401, pupil on staff route 403, teacher on pupil route 403", async () => {
    const t = await seedTeacher("t1"); const c = await seedClass("5A", t); await seedStudents(c, 1);
    const pupil = await loginPupil(c, 1); const teacher = await loginTeacher("t1");
    expect((await call("classes", {})).status).toBe(401);
    expect((await call("classes", { token: pupil })).status).toBe(403);
    expect((await call("hub", { token: teacher })).status).toBe(403);
    expect((await call("classes", { token: teacher })).status).toBe(200);
  });
  it("logout destroys the session", async () => {
    const t = await seedTeacher("t1"); const c = await seedClass("5A", t); await seedStudents(c, 1);
    const token = await loginPupil(c, 1);
    expect((await call("logout", { token })).status).toBe(200);
    expect((await call("pupilProfile", { token })).status).toBe(401);
  });
  it("an archived pupil can no longer log in", async () => {
    const t = await seedTeacher("t1"); const c = await seedClass("5A", t); const [id] = await seedStudents(c, 1);
    await env.DB.prepare("UPDATE students SET archived = 1 WHERE id = ?").bind(id).run();
    expect((await call("pupilLogin", { body: { reporterId: `p${c}-1`, pressPass: "pupil-pass" } })).status).toBe(401);
  });
  it("parent login uses the class parent password", async () => {
    const t = await seedTeacher("t1"); const c = await seedClass("5A", t, { parentPassword: "parents1" });
    expect((await call("parentLogin", { body: { classId: c, password: "wrong!" } })).status).toBe(401);
    const ok = await call("parentLogin", { body: { classId: c, password: "parents1" } });
    expect(ok.status).toBe(200);
    expect((await call("parentClass", { token: (ok.json as { token: string }).token })).status).toBe(200);
  });
  it("a class with no parent password cannot be logged into", async () => {
    const t = await seedTeacher("t1"); const c = await seedClass("5A", t);
    expect((await call("parentLogin", { body: { classId: c, password: "anything" } })).status).toBe(401);
  });
});

describe("rate limiting (binding injected)", () => {
  it("returns 429 when the limiter refuses", async () => {
    const refuse = { limit: async () => ({ success: false }) } as unknown as RateLimit;
    const r = await call("pupilLogin", { body: { reporterId: "a", pressPass: "b" }, env: { AUTH_LIMITER: refuse } });
    expect(r.status).toBe(429);
    expect(r.res.headers.get("retry-after")).toBe("30");
  });
  it("is keyed per route and per client", async () => {
    const seen: string[] = [];
    const spy = { limit: async (o: { key: string }) => { seen.push(o.key); return { success: true }; } } as unknown as RateLimit;
    await call("pupilLogin", { body: { reporterId: "a", pressPass: "b" }, env: { AUTH_LIMITER: spy } });
    expect(seen[0]).toMatch(/^pupilLogin:/);
  });
});
