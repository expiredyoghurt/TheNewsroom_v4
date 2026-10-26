import { describe, it, expect } from "vitest";
import { routes, routeNames, matchPath, buildPath, allowedMethods, methodsForPath } from "./contract";

describe("route table", () => {
  it("has no duplicate method+path", () => {
    const keys = routeNames.map((n) => `${routes[n].method} ${routes[n].path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("every admin path requires a staff role", () => {
    for (const n of routeNames) if (routes[n].path.startsWith("/api/admin/")) expect(["teacher", "admin"]).toContain(routes[n].role);
  });
  it("every auth login is public + rate limited", () => {
    for (const n of ["pupilLogin", "teacherLogin", "parentLogin"] as const) {
      expect(routes[n].role).toBe("public");
      expect(routes[n].rateLimit).toBe("auth");
    }
  });
  it("only login routes are public", () => {
    expect(routeNames.filter((n) => routes[n].role === "public").sort()).toEqual(["parentLogin", "pupilLogin", "teacherLogin"]);
  });
  it("every submission route is rate limited", () => {
    for (const n of ["submitMcq", "checkReflect", "submitReflect", "submitWriting"] as const) expect(routes[n].rateLimit).toBe("submit");
  });
  it("routes with a body are POST/PATCH only", () => {
    for (const n of routeNames) if ("body" in routes[n]) expect(["POST", "PATCH"]).toContain(routes[n].method);
  });
  it("CORS methods derive from the table", () => {
    expect(allowedMethods().sort()).toEqual(["DELETE", "GET", "PATCH", "POST"]);
    expect(methodsForPath("/api/admin/assignments/4").sort()).toEqual(["DELETE", "PATCH"]);
  });
});

describe("matchPath / buildPath", () => {
  it("extracts params", () => expect(matchPath("/api/tasks/:taskId/submit", "/api/tasks/12/submit")).toEqual({ taskId: "12" }));
  it("rejects wrong shape", () => {
    expect(matchPath("/api/tasks/:taskId", "/api/tasks")).toBeNull();
    expect(matchPath("/api/tasks/:taskId", "/api/tasks/")).toBeNull();
    expect(matchPath("/api/a", "/api/b")).toBeNull();
  });
  it("round-trips", () => expect(buildPath("/api/x/:id/y", { id: 5 })).toBe("/api/x/5/y"));
  it("static routes are not shadowed by param routes", () => {
    // "/api/admin/articles/import" (POST) vs "/api/admin/articles/:articleId" (GET/PATCH) differ by method
    const m = routeNames.filter((n) => matchPath(routes[n].path, "/api/admin/articles/import")).map((n) => routes[n].method);
    expect(m.sort()).toEqual(["GET", "PATCH", "POST"]);
  });
});
