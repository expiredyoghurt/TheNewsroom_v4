import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routes, routeNames } from "@newsroom/shared";
import { handlers } from "../src/handlers";
import { call, loginPupil, resetDb, seedClass, seedStudents, seedTeacher } from "./helpers";

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

describe("every unhandled error is logged WITH request context (never a bare console.error)", () => {
  it("logs method, path, route, role, subject and request id; the client gets the id but no internals", async () => {
    const t = await seedTeacher("t1"); const c = await seedClass("5A", t); await seedStudents(c, 1);
    const pupil = await loginPupil(c, 1);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = { ...handlers, hub: async () => { throw new Error("database exploded: secret-detail"); } };
    const r = await call("hub", { token: pupil, handlers: boom });
    expect(r.status).toBe(500);
    expect(r.json.requestId).toBe("req-test");
    expect(JSON.stringify(r.json)).not.toContain("secret-detail");
    expect(err).toHaveBeenCalledTimes(1);
    const line = JSON.parse(err.mock.calls[0]![0] as string);
    expect(line).toMatchObject({ level: "error", event: "unhandled_error", requestId: "req-test", method: "GET", path: "/api/articles", route: "hub", role: "pupil" });
    expect(typeof line.subject).toBe("number");
    expect(line.errorMessage).toContain("database exploded");
    expect(line.stack).toBeTruthy();
  });
  it("expected errors (4xx) are NOT logged as errors", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await call("classes", {});
    expect(err).not.toHaveBeenCalled();
  });
  it("never logs request bodies or passwords", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await call("pupilLogin", { body: { reporterId: "someone", pressPass: "hunter2-super-secret" } });
    const all = JSON.stringify([...log.mock.calls, ...err.mock.calls]);
    expect(all).not.toContain("hunter2-super-secret");
  });
  it("every response carries a request id header", async () => {
    expect((await call("classes", {})).res.headers.get("x-request-id")).toBe("req-test");
  });
});

describe("one source of truth: contract <-> handlers", () => {
  it("every route in the contract has a handler, and every handler is a route", () => {
    expect(Object.keys(handlers).sort()).toEqual([...routeNames].sort());
  });
  it("the access log records the round-trip count so slow endpoints are visible", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await call("classes", {});
    const line = JSON.parse(log.mock.calls.at(-1)![0] as string);
    expect(line).toMatchObject({ event: "request", route: "classes", status: 401 });
    expect(line.roundTrips).toBeDefined();
    void routes;
  });
});
