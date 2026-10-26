// The ONLY place the web app talks to the server. Typed entirely from the shared contract:
// route names, paths, methods, request bodies and response types all come from @newsroom/shared.
import { buildPath, routes, type BodyOf, type QueryOf, type ResOf, type RouteName } from "@newsroom/shared";
import { useCallback, useEffect, useRef, useState } from "react";

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly requestId?: string) { super(message); }
}

const KEY = "newsroom.session";
export type Who = { token: string; kind: "pupil" | "teacher" | "parent"; role?: "teacher" | "admin" };
export const getSession = (): Who | null => { try { return JSON.parse(sessionStorage.getItem(KEY) ?? "null"); } catch { return null; } };
export const setSession = (s: Who | null) => { if (s) sessionStorage.setItem(KEY, JSON.stringify(s)); else sessionStorage.removeItem(KEY); };

export interface Opts<K extends RouteName> {
  params?: Record<string, string | number>;
  body?: BodyOf<K>;
  query?: Partial<QueryOf<K>> extends infer Q ? Q : never;
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  const s = getSession();
  return { ...(s ? { authorization: `Bearer ${s.token}` } : {}), ...extra };
}

export async function api<K extends RouteName>(name: K, o: Opts<K> = {}): Promise<ResOf<K>> {
  const spec = routes[name];
  const qs = o.query ? "?" + new URLSearchParams(Object.entries(o.query as Record<string, unknown>).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString() : "";
  const res = await fetch(buildPath(spec.path, o.params) + qs, {
    method: spec.method,
    headers: headers(o.body !== undefined ? { "content-type": "application/json" } : {}),
    body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && getSession()) { setSession(null); location.assign("/"); }
    throw new ApiError(res.status, data.error ?? "Something went wrong.", data.requestId ?? res.headers.get("x-request-id") ?? undefined);
  }
  return data as ResOf<K>;
}

/** Raw upload (images). Same contract path/method, bytes instead of JSON. */
export async function upload(name: "uploadThumbnail" | "uploadArticleImage", articleId: number, file: Blob): Promise<void> {
  const res = await fetch(buildPath(routes[name].path, { articleId }), { method: routes[name].method, headers: headers({ "content-type": file.type }), body: file });
  if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => ({}))).error ?? "Upload failed.");
}

/** Images need the Authorization header, which <img src> cannot send: fetch as a blob. */
export function AuthImg({ route, articleId, alt, className }: { route: "thumbnail" | "articleImage"; articleId: number; alt: string; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null, dead = false;
    fetch(buildPath(routes[route].path, { articleId }), { headers: headers() })
      .then((r) => (r.ok ? r.blob() : null)).then((b) => { if (b && !dead) { url = URL.createObjectURL(b); setSrc(url); } }).catch(() => {});
    return () => { dead = true; if (url) URL.revokeObjectURL(url); };
  }, [route, articleId]);
  return src ? <img src={src} alt={alt} className={className} /> : <div className={`${className ?? ""} img-placeholder`} aria-hidden />;
}

export function useApi<K extends RouteName>(name: K, o: Opts<K> = {}, deps: unknown[] = []) {
  const [state, setState] = useState<{ data: ResOf<K> | null; error: ApiError | null; loading: boolean }>({ data: null, error: null, loading: true });
  const opts = useRef(o); opts.current = o;
  const reload = useCallback(() => {
    setState((s) => ({ ...s, loading: true }));
    api(name, opts.current).then((data) => setState({ data, error: null, loading: false })).catch((error: ApiError) => setState({ data: null, error, loading: false }));
  }, [name]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reload, [reload, ...deps]);
  return { ...state, reload };
}

export const errText = (e: unknown): string => (e instanceof ApiError ? `${e.message}${e.requestId ? ` (ref ${e.requestId})` : ""}` : "Something went wrong.");
