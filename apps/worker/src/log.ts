// Structured logging. Every line is one JSON object so Workers Logs can index/filter on fields.
// RULE: never `console.error(err)` bare. Errors always carry the request context.
// Never log request bodies, passwords, tokens or pupil names.

export interface ReqLogContext {
  requestId: string;
  method: string;
  path: string;
  route?: string;
  role?: string;      // "pupil" | "teacher" | "admin" | "parent" | "anonymous"
  subject?: number;   // numeric id of the pupil/teacher (not a name)
}

function errFields(err: unknown): Record<string, unknown> {
  if (err instanceof Error) return { errorName: err.name, errorMessage: err.message, stack: err.stack?.split("\n").slice(0, 6).join("\n") };
  return { errorMessage: String(err) };
}

export function logInfo(event: string, ctx: Partial<ReqLogContext>, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level: "info", event, ...ctx, ...fields }));
}
export function logWarn(event: string, ctx: Partial<ReqLogContext>, fields: Record<string, unknown> = {}): void {
  console.warn(JSON.stringify({ level: "warn", event, ...ctx, ...fields }));
}
export function logError(event: string, ctx: Partial<ReqLogContext>, err: unknown, fields: Record<string, unknown> = {}): void {
  console.error(JSON.stringify({ level: "error", event, ...ctx, ...errFields(err), ...fields }));
}

export type Logger = {
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, err: unknown, fields?: Record<string, unknown>): void;
};
export function makeLogger(ctx: () => Partial<ReqLogContext>): Logger {
  return {
    info: (e, f) => logInfo(e, ctx(), f),
    warn: (e, f) => logWarn(e, ctx(), f),
    error: (e, err, f) => logError(e, ctx(), err, f),
  };
}
