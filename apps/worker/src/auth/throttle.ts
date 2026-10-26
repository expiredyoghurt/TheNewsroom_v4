// Per-account login throttle in D1: atomic, strongly consistent, works across locations.
// (The Rate Limiting binding is a coarse per-location guard; it is not enough on its own.)
import type { Db } from "../db";

export const MAX_FAILURES = 8;
export const WINDOW_MS = 15 * 60 * 1000;

export async function isLockedOut(db: Db, key: string, now: Date): Promise<boolean> {
  const row = await db.first<{ failures: number; window_start: string }>("SELECT failures, window_start FROM login_failures WHERE key = ?", key);
  if (!row) return false;
  if (now.getTime() - Date.parse(row.window_start) > WINDOW_MS) return false;
  return row.failures >= MAX_FAILURES;
}

export async function recordFailure(db: Db, key: string, now: Date): Promise<void> {
  const iso = now.toISOString();
  const cutoff = new Date(now.getTime() - WINDOW_MS).toISOString();
  await db.run(
    `INSERT INTO login_failures (key, failures, window_start) VALUES (?, 1, ?)
     ON CONFLICT(key) DO UPDATE SET
       failures = CASE WHEN window_start < ? THEN 1 ELSE failures + 1 END,
       window_start = CASE WHEN window_start < ? THEN ? ELSE window_start END`,
    key, iso, cutoff, cutoff, iso,
  );
}

export async function clearFailures(db: Db, key: string): Promise<void> {
  await db.run("DELETE FROM login_failures WHERE key = ?", key);
}
