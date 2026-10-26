import type { StaffRole } from "@newsroom/shared";
import type { Env } from "../env";

export type Session =
  | { kind: "pupil"; studentId: number }
  | { kind: "teacher"; teacherId: number; role: StaffRole }
  | { kind: "parent"; classId: number };

const TTL_SECONDS: Record<Session["kind"], number> = { pupil: 6 * 3600, teacher: 8 * 3600, parent: 2 * 3600 };
const key = (token: string) => `session:${token}`;

export function newToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export async function createSession(env: Env, session: Session): Promise<string> {
  const token = newToken();
  await env.SESSIONS.put(key(token), JSON.stringify(session), { expirationTtl: TTL_SECONDS[session.kind] });
  return token;
}

export function bearerToken(req: Request): string | null {
  const h = req.headers.get("authorization");
  if (!h) return null;
  const m = /^Bearer\s+([A-Za-z0-9]{32,128})$/.exec(h.trim());
  return m ? m[1]! : null;
}

export async function loadSession(env: Env, token: string | null): Promise<Session | null> {
  if (!token) return null;
  const raw = await env.SESSIONS.get(key(token));
  if (!raw) return null;
  try { return JSON.parse(raw) as Session; } catch { return null; }
}

export async function destroySession(env: Env, token: string): Promise<void> {
  await env.SESSIONS.delete(key(token));
}
