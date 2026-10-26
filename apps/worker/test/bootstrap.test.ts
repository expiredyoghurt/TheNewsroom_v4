import { beforeEach, describe, expect, it } from "vitest";
import { adminBootstrapSql } from "../src/bootstrap";
import { hashPassword } from "../src/auth/password";
import { call, env, resetDb } from "./helpers";

beforeEach(resetDb);

describe("first-admin bootstrap (the one-command deploy's only SQL)", () => {
  it("creates an admin that can log in, and is idempotent when re-run", async () => {
    const sql = adminBootstrapSql({ username: "owner", name: "School Admin", passwordHash: await hashPassword("a-long-password") });
    await env.DB.exec(sql);
    await env.DB.exec(sql);
    await env.DB.exec(adminBootstrapSql({ username: "someone-else", name: "X", passwordHash: await hashPassword("another-pass") }));
    expect((await env.DB.prepare("SELECT COUNT(*) n FROM teachers").first<{ n: number }>())!.n).toBe(1);
    const r = await call("teacherLogin", { body: { identifier: "owner", password: "a-long-password" } });
    expect(r.json).toMatchObject({ role: "admin" });
  });
  it("is safe against quotes in the name and rejects odd usernames", async () => {
    await env.DB.exec(adminBootstrapSql({ username: "o.brien", name: "Mr O'Brien", passwordHash: await hashPassword("a-long-password") }));
    expect((await env.DB.prepare("SELECT name FROM teachers").first<{ name: string }>())!.name).toBe("Mr O'Brien");
    expect(() => adminBootstrapSql({ username: "x'; DROP TABLE teachers;--", name: "x", passwordHash: "x" })).toThrow();
  });
});
