import { levelForXp } from "@newsroom/shared";
import { hashPassword, verifyPassword, DUMMY_HASH_PROMISE } from "../auth/password";
import { createSession, destroySession, bearerToken } from "../auth/sessions";
import { clearFailures, isLockedOut, recordFailure } from "../auth/throttle";
import { HttpError, unauthorized } from "../http";
import type { Ctx } from "../router";
import type { Db } from "../db";

const BAD = "Those details don't match. Check them and try again.";

/** Shared login skeleton: throttle -> look up -> constant-ish-time verify -> record outcome. */
async function authenticate<Row extends { hash: string }>(
  db: Db, now: Date, throttleKey: string, find: () => Promise<Row | null>, password: string,
): Promise<Row> {
  if (await isLockedOut(db, throttleKey, now)) throw new HttpError(429, "Too many failed attempts. Please wait 15 minutes or ask your teacher.");
  const row = await find();
  const ok = await verifyPassword(password, row?.hash ?? (await DUMMY_HASH_PROMISE()));
  if (!row || !ok) { await recordFailure(db, throttleKey, now); throw unauthorized(BAD); }
  await clearFailures(db, throttleKey);
  return row;
}

export async function pupilLogin(c: Ctx<"pupilLogin">) {
  const rid = c.body.reporterId.trim().toLowerCase();
  const row = await authenticate(c.db, c.now, `pupil:${rid}`, async () => {
    const r = await c.db.first<{ id: number; first_name: string; last_name: string; xp_total: number; password_hash: string; archived: number }>(
      "SELECT id, first_name, last_name, xp_total, password_hash, archived FROM students WHERE reporter_id = ?", rid);
    return r && r.archived === 0 ? { ...r, hash: r.password_hash } : null;
  }, c.body.pressPass);
  const token = await createSession(c.env, { kind: "pupil", studentId: row.id });
  return { token, student: { id: row.id, firstName: row.first_name, lastName: row.last_name, xp: row.xp_total, level: levelForXp(row.xp_total).level } };
}

export async function teacherLogin(c: Ctx<"teacherLogin">) {
  const ident = c.body.identifier.trim().toLowerCase();
  const row = await authenticate(c.db, c.now, `staff:${ident}`, async () => {
    const r = await c.db.first<{ id: number; role: "teacher" | "admin"; password_hash: string }>(
      "SELECT id, role, password_hash FROM teachers WHERE username = ?1 OR email = ?1", ident);
    return r ? { ...r, hash: r.password_hash } : null;
  }, c.body.password);
  const token = await createSession(c.env, { kind: "teacher", teacherId: row.id, role: row.role });
  return { token, role: row.role };
}

export async function parentLogin(c: Ctx<"parentLogin">) {
  await authenticate(c.db, c.now, `parent:${c.body.classId}`, async () => {
    const r = await c.db.first<{ parent_password_hash: string | null }>("SELECT parent_password_hash FROM classes WHERE id = ?", c.body.classId);
    return r?.parent_password_hash ? { hash: r.parent_password_hash } : null;
  }, c.body.password);
  return { token: await createSession(c.env, { kind: "parent", classId: c.body.classId }) };
}

export async function logout(c: Ctx<"logout">) {
  const token = bearerToken(c.req);
  if (token) await destroySession(c.env, token);
  return { ok: true as const };
}

export { hashPassword };
