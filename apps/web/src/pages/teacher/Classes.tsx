import { useState, type FormEvent } from "react";
import { QUESTION_TYPES, STATIONS, type ClassSummary } from "@newsroom/shared";
import { api, useApi } from "../../api";
import { Async, Card, ErrorBox, Page } from "../../ui";

function Settings({ c, onSaved }: { c: ClassSummary; onSaved: () => void }) {
  const [mode, setMode] = useState(c.practiceMode);
  const [rank, setRank] = useState(c.rankingsEnabled);
  const [thr, setThr] = useState(String(c.similarityThreshold ?? ""));
  const [stations, setStations] = useState<string[]>(c.enabledStations);
  const [types, setTypes] = useState<string[]>(c.allowedQuestionTypes);
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState<unknown>(null);
  const toggle = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  async function save(e: FormEvent) {
    e.preventDefault();
    try {
      await api("updateClassSettings", { params: { classId: c.id }, body: {
        practiceMode: mode, rankingsEnabled: rank, similarityThreshold: thr ? Number(thr) : null,
        enabledStations: stations as never, allowedQuestionTypes: types as never, ...(pw ? { parentPassword: pw } : {}) } });
      setMsg("Saved."); setPw(""); onSaved();
    } catch (err) { setMsg(err); }
  }
  return (
    <form onSubmit={save} className="stack">
      <label>Practice mode<select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}><option value="free">Free: every story is open</option><option value="assigned_only">Assigned only</option></select></label>
      <label><input type="checkbox" checked={rank} onChange={(e) => setRank(e.target.checked)} /> Show class rankings (XP and levels)</label>
      <label>Copy-check strictness (0.1–0.99, blank = default)<input value={thr} onChange={(e) => setThr(e.target.value)} inputMode="decimal" /></label>
      <fieldset><legend>Stations</legend>{STATIONS.map((s) => <label key={s}><input type="checkbox" checked={stations.includes(s)} onChange={() => toggle(stations, setStations, s)} /> {s}</label>)}</fieldset>
      <fieldset><legend>Task types</legend>{QUESTION_TYPES.map((t) => <label key={t}><input type="checkbox" checked={types.includes(t)} onChange={() => toggle(types, setTypes, t)} /> {t}</label>)}</fieldset>
      <label>Parent view password {c.hasParentPassword ? "(set — type to replace)" : "(not set: parents cannot log in)"}<input type="password" value={pw} onChange={(e) => setPw(e.target.value)} minLength={6} autoComplete="new-password" /></label>
      <button className="primary">Save settings</button>
      {typeof msg === "string" ? <p>{msg}</p> : msg ? <ErrorBox error={msg} /> : null}
    </form>
  );
}

function Roster({ classId }: { classId: number }) {
  const r = useApi("roster", { query: { classId } }, [classId]);
  const [csv, setCsv] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  async function importCsv() {
    setError(null); setMsg(null);
    try {
      // reporterId,firstName,lastName,indexNumber,pressPass  (header row optional)
      const rows = csv.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => l.split(",").map((x) => x.trim()))
        .filter((c) => c.length >= 5 && !/^reporter/i.test(c[0]!)).map((c) => ({ reporterId: c[0]!, firstName: c[1]!, lastName: c[2]!, indexNumber: Number(c[3]), pressPass: c[4]! }));
      const res = await api("importRoster", { body: { classId, rows } });
      setMsg(`Created ${res.createdCount}. ${res.skipped.length ? "Skipped: " + res.skipped.map((s) => `${s.reporterId} (${s.reason})`).join("; ") : ""}`); setCsv(""); r.reload();
    } catch (e) { setError(e); }
  }
  async function act(fn: () => Promise<unknown>) { setError(null); try { await fn(); r.reload(); } catch (e) { setError(e); } }
  return (
    <>
      <Async s={r}>{(d) => (
        <table><thead><tr><th>#</th><th>Reporter ID</th><th>Name</th><th>Level</th><th>XP</th><th /></tr></thead>
          <tbody>{d.students.map((s) => <tr key={s.id} className={s.archived ? "muted" : ""}><td>{s.indexNumber}</td><td>{s.reporterId}</td><td>{s.firstName} {s.lastName}{s.archived ? " (removed)" : ""}</td><td>{s.level}</td><td>{s.xp}</td>
            <td>{!s.archived ? <>
              <button onClick={() => { const p = prompt(`New press pass for ${s.firstName}?`); if (p) act(() => api("resetPupilPassword", { body: { studentId: s.id, newPressPass: p } })); }}>Reset pass</button>{" "}
              <button onClick={() => { if (confirm(`Remove ${s.firstName} from the class? Their history is kept.`)) act(() => api("removePupil", { body: { studentId: s.id } })); }}>Remove</button></> : null}</td></tr>)}</tbody></table>)}</Async>
      <h3>Import pupils</h3>
      <p className="muted">One per line: reporterId, firstName, lastName, indexNumber, pressPass (max 150 rows)</p>
      <textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={5} />
      <button onClick={importCsv} disabled={!csv.trim()}>Import</button>
      {msg ? <p>{msg}</p> : null}{error ? <ErrorBox error={error} /> : null}
    </>
  );
}

export default function Classes() {
  const cs = useApi("classes");
  const [open, setOpen] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<unknown>(null);
  return (
    <Page title="Classes">
      <Async s={cs}>{(d) => (
        <>
          {d.classes.map((c) => (
            <Card key={c.id}>
              <h3>{c.name} <span className="muted">· {c.pupils} pupils</span></h3>
              <button onClick={() => setOpen(open === c.id ? null : c.id)}>{open === c.id ? "Close" : "Settings & roster"}</button>
              {open === c.id ? <><Settings c={c} onSaved={cs.reload} /><Roster classId={c.id} /></> : null}
            </Card>))}
          <Card><h3>New class</h3>
            <form className="row" onSubmit={async (e) => { e.preventDefault(); setError(null); try { await api("createClass", { body: { name } }); setName(""); cs.reload(); } catch (err) { setError(err); } }}>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 5 Integrity" required /><button className="primary">Create</button></form>
            {error ? <ErrorBox error={error} /> : null}</Card>
        </>)}</Async>
    </Page>
  );
}
