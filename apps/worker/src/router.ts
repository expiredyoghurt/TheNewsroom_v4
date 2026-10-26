// Dispatch derived ENTIRELY from the contract in @newsroom/shared. Auth role, validation, rate
// limiting, 404/405 and the Allow header all come from the route table; there is no hand-written
// route list anywhere in the worker.
import {
  routes, routeNames, matchPath, methodsForPath,
  type Role, type RouteName, type ResOf, type BodyOf, type QueryOf, type ErrorBody,
} from "@newsroom/shared";
import type { ZodType } from "zod";
import type { Env } from "./env";
import { Db } from "./db";
import { HttpError, json } from "./http";
import { makeLogger, logError, logInfo, type Logger, type ReqLogContext } from "./log";
import { bearerToken, loadSession, type Session } from "./auth/sessions";

export interface Ctx<K extends RouteName> {
  env: Env;
  db: Db;
  req: Request;
  url: URL;
  session: Session | null;
  params: Record<string, string>;
  body: BodyOf<K>;
  query: QueryOf<K>;
  now: Date;
  requestId: string;
  log: Logger;
  waitUntil(p: Promise<unknown>): void;
}
export type Handlers = { [K in RouteName]: (ctx: Ctx<K>) => Promise<ResOf<K> | Response> };

function roleOf(s: Session | null): string {
  if (!s) return "anonymous";
  return s.kind === "teacher" ? s.role : s.kind;
}
function subjectOf(s: Session | null): number | undefined {
  if (!s) return undefined;
  return s.kind === "pupil" ? s.studentId : s.kind === "teacher" ? s.teacherId : s.classId;
}

function allowed(role: Role, s: Session | null): boolean {
  switch (role) {
    case "public": return true;
    case "authenticated": return s !== null;
    case "pupil": return s?.kind === "pupil";
    case "parent": return s?.kind === "parent";
    case "teacher": return s?.kind === "teacher";
    case "admin": return s?.kind === "teacher" && s.role === "admin";
  }
}

export interface DispatchOptions { now?: () => Date; newRequestId?: () => string }

export async function dispatch(
  req: Request, env: Env, exec: { waitUntil(p: Promise<unknown>): void }, handlers: Handlers, opts: DispatchOptions = {},
): Promise<Response> {
  const started = Date.now();
  const url = new URL(req.url);
  const requestId = req.headers.get("cf-ray") ?? opts.newRequestId?.() ?? crypto.randomUUID();
  const base: ReqLogContext = { requestId, method: req.method, path: url.pathname };
  const db = new Db(env.DB);
  let session: Session | null = null;
  let matchedName: RouteName | undefined;
  let status = 500;

  const respond = (res: Response): Response => {
    status = res.status;
    const h = new Headers(res.headers);
    h.set("x-request-id", requestId);
    h.set("x-db-round-trips", String(db.roundTrips)); // diagnostics + the N+1 guard in tests
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
  };
  const fail = (s: number, message: string, extra: Partial<ErrorBody> = {}, headers: HeadersInit = {}): Response =>
    respond(json({ error: message, requestId, ...extra } satisfies ErrorBody, s, headers));

  try {
    // 1. Route lookup from the table.
    const byPath = routeNames.map((n) => ({ n, params: matchPath(routes[n].path, url.pathname) })).filter((m) => m.params);
    if (byPath.length === 0) return fail(404, "Not found.");
    const hit = byPath.find((m) => routes[m.n].method === req.method);
    if (!hit) {
      const allow = methodsForPath(url.pathname).join(", ");
      if (req.method === "OPTIONS") return respond(new Response(null, { status: 204, headers: { allow } }));
      return fail(405, "Method not allowed.", {}, { allow });
    }
    matchedName = hit.n;
    const spec = routes[hit.n] as (typeof routes)[RouteName];
    base.route = hit.n;

    // 2. Authentication.
    session = await loadSession(env, bearerToken(req));
    base.role = roleOf(session);
    base.subject = subjectOf(session);
    if (spec.role !== "public" && !session) return fail(401, "Please log in again.");
    if (!allowed(spec.role, session)) return fail(403, "You do not have access to this.");

    // 3. Rate limiting (coarse, per location).
    const limiter = "rateLimit" in spec && spec.rateLimit === "auth" ? env.AUTH_LIMITER : "rateLimit" in spec && spec.rateLimit === "submit" ? env.SUBMIT_LIMITER : undefined;
    if ("rateLimit" in spec && spec.rateLimit && limiter) {
      const who = session ? `${session.kind}:${subjectOf(session)}` : (req.headers.get("cf-connecting-ip") ?? "unknown");
      const { success } = await limiter.limit({ key: `${hit.n}:${who}` });
      if (!success) return fail(429, "Too many requests. Please wait a moment and try again.", {}, { "retry-after": "30" });
    }

    // 4. Input validation from the contract's schemas.
    let body: unknown = undefined;
    if ("body" in spec && spec.body) {
      let raw: unknown;
      try { raw = await req.json(); } catch { return fail(400, "Request body must be valid JSON."); }
      const parsed = (spec.body as ZodType).safeParse(raw);
      if (!parsed.success) {
        return fail(400, "Invalid request.", { issues: parsed.error.issues.slice(0, 10).map((i) => ({ path: i.path.join("."), message: i.message })) });
      }
      body = parsed.data;
    }
    let query: unknown = undefined;
    if ("query" in spec && spec.query) {
      const parsed = (spec.query as ZodType).safeParse(Object.fromEntries(url.searchParams));
      if (!parsed.success) {
        return fail(400, "Invalid query.", { issues: parsed.error.issues.slice(0, 10).map((i) => ({ path: i.path.join("."), message: i.message })) });
      }
      query = parsed.data;
    }

    // 5. Handler.
    const ctx = {
      env, db, req, url, session, params: hit.params!, body, query,
      now: opts.now?.() ?? new Date(), requestId,
      log: makeLogger(() => base),
      waitUntil: (p: Promise<unknown>) => exec.waitUntil(p.catch((e) => logError("background_task_failed", base, e))),
    } as Ctx<RouteName>;
    const out = await (handlers[hit.n] as (c: Ctx<RouteName>) => Promise<unknown>)(ctx);
    return respond(out instanceof Response ? out : json(out));
  } catch (err) {
    if (err instanceof HttpError) {
      return fail(err.status, err.message, {}, {});
    }
    // Unexpected: log WITH request context (method, path, route, role, request id). Never a bare console.error(err).
    logError("unhandled_error", base, err, { roundTrips: db.roundTrips });
    return fail(500, "Something went wrong. Please try again. If it keeps happening, quote the request id.");
  } finally {
    logInfo("request", base, { status, ms: Date.now() - started, roundTrips: db.roundTrips });
  }
}
