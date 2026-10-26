import { type ReactNode } from "react";
import { errText, type ApiError } from "./api";

export const Loading = () => <p className="muted">Loading…</p>;
export const ErrorBox = ({ error }: { error: unknown }) => <p role="alert" className="error">{errText(error as ApiError)}</p>;
export function Page({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return <section><header className="page-head"><h1>{title}</h1><div>{actions}</div></header>{children}</section>;
}
export function Async<T>({ s, children }: { s: { data: T | null; error: unknown; loading: boolean }; children: (d: T) => ReactNode }) {
  if (s.loading && !s.data) return <Loading />;
  if (s.error) return <ErrorBox error={s.error} />;
  return s.data ? <>{children(s.data)}</> : null;
}
export const Card = ({ children, className = "" }: { children: ReactNode; className?: string }) => <div className={`card ${className}`}>{children}</div>;
export const Tag = ({ children, tone = "" }: { children: ReactNode; tone?: string }) => <span className={`tag ${tone}`}>{children}</span>;
