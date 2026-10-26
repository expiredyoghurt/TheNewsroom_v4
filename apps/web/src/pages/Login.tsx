import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, setSession } from "../api";
import { ErrorBox } from "../ui";

type Mode = "pupil" | "teacher" | "parent";

export default function Login() {
  const [mode, setMode] = useState<Mode>("pupil");
  const [a, setA] = useState(""); const [b, setB] = useState("");
  const [error, setError] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      if (mode === "pupil") { const r = await api("pupilLogin", { body: { reporterId: a, pressPass: b } }); setSession({ token: r.token, kind: "pupil" }); }
      else if (mode === "teacher") { const r = await api("teacherLogin", { body: { identifier: a, password: b } }); setSession({ token: r.token, kind: "teacher", role: r.role }); }
      else { const r = await api("parentLogin", { body: { classId: Number(a), password: b } }); setSession({ token: r.token, kind: "parent" }); }
      nav(`/${mode}`, { replace: true });
    } catch (err) { setError(err); } finally { setBusy(false); }
  }
  const labels = { pupil: ["Reporter ID", "Press pass"], teacher: ["Username or email", "Password"], parent: ["Class number", "Parent password"] }[mode];
  return (
    <main className="login">
      <h1>The Newsroom</h1>
      <div role="tablist" className="tabs">
        {(["pupil", "teacher", "parent"] as const).map((m) => <button key={m} role="tab" aria-selected={mode === m} onClick={() => { setMode(m); setError(null); }}>{m[0]!.toUpperCase() + m.slice(1)}</button>)}
      </div>
      <form onSubmit={submit} className="stack">
        <label>{labels[0]}<input value={a} onChange={(e) => setA(e.target.value)} autoComplete="username" required inputMode={mode === "parent" ? "numeric" : undefined} /></label>
        <label>{labels[1]}<input type="password" value={b} onChange={(e) => setB(e.target.value)} autoComplete="current-password" required /></label>
        {error ? <ErrorBox error={error} /> : null}
        <button className="primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </main>
  );
}
