import { useState } from "react";
import { api, useApi } from "../../api";
import { Async, Card, ErrorBox, Page, Tag } from "../../ui";

export default function Assignments() {
  const classes = useApi("classes");
  const articles = useApi("adminArticles");
  const list = useApi("listAssignments", { query: {} });
  const [classId, setClassId] = useState(""); const [articleId, setArticleId] = useState("");
  const [start, setStart] = useState(""); const [due, setDue] = useState(""); const [attempts, setAttempts] = useState("");
  const [error, setError] = useState<unknown>(null);
  const iso = (v: string) => (v ? new Date(v).toISOString() : null);
  return (
    <Page title="Assignments">
      <Card><h3>New assignment</h3>
        <form className="stack" onSubmit={async (e) => {
          e.preventDefault(); setError(null);
          try { await api("createAssignment", { body: { classId: Number(classId), articleId: Number(articleId), startAt: iso(start), dueAt: iso(due), attemptsAllowed: attempts ? Number(attempts) : null } }); list.reload(); }
          catch (err) { setError(err); }
        }}>
          <label>Class<select value={classId} onChange={(e) => setClassId(e.target.value)} required><option value="" />{classes.data?.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>Story (published only)<select value={articleId} onChange={(e) => setArticleId(e.target.value)} required><option value="" />{articles.data?.articles.filter((a) => a.status === "active").map((a) => <option key={a.articleId} value={a.articleId}>{a.title}</option>)}</select></label>
          <label>Opens<input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></label>
          <label>Due<input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} /></label>
          <label>Attempts allowed (blank = unlimited)<input value={attempts} onChange={(e) => setAttempts(e.target.value)} inputMode="numeric" /></label>
          <button className="primary">Assign</button>{error ? <ErrorBox error={error} /> : null}
        </form></Card>
      <Async s={list}>{(d) => <table><thead><tr><th>Class</th><th>Story</th><th>Opens</th><th>Due</th><th>Types</th><th /></tr></thead><tbody>
        {d.assignments.map((a) => <tr key={a.assignmentId}><td>{a.className}</td><td>{a.articleTitle}</td><td>{a.startAt?.slice(0, 16).replace("T", " ") ?? "–"}</td><td>{a.dueAt?.slice(0, 16).replace("T", " ") ?? "–"}</td>
          <td>{a.questionTypes.join(", ")} {!a.active ? <Tag>off</Tag> : null}</td>
          <td><button onClick={async () => { await api("updateAssignment", { params: { assignmentId: a.assignmentId }, body: { active: !a.active } }); list.reload(); }}>{a.active ? "Pause" : "Resume"}</button>{" "}
            <button onClick={async () => { if (confirm("Delete this assignment?")) { await api("deleteAssignment", { params: { assignmentId: a.assignmentId } }); list.reload(); } }}>Delete</button></td></tr>)}</tbody></table>}</Async>
    </Page>
  );
}
