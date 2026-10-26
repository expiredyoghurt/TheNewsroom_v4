export class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly extra?: Record<string, unknown>) {
    super(message);
    this.name = "HttpError";
  }
}
export const badRequest = (m: string) => new HttpError(400, m);
export const unauthorized = (m = "Please log in again.") => new HttpError(401, m);
export const forbidden = (m = "You do not have access to this.") => new HttpError(403, m);
export const notFound = (m = "Not found.") => new HttpError(404, m);
export const conflict = (m: string) => new HttpError(409, m);

export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
}
