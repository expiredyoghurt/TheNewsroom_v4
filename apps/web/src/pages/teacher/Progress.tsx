import { useState } from "react";
import { useApi } from "../../api";
import { Async, Page } from "../../ui";

export default function Progress() {
  const classes = useApi("classes");
  const [classId, setClassId] = useState<number | null>(null);
  const id = classId ?? classes.data?.classes[0]?.id ?? null;
  const p = useApi("progress", { query: { classId: id ?? 0 } }, [id]);
  return (
    <Page title="Progress" actions={<select value={id ?? ""} onChange={(e) => setClassId(Number(e.target.value))}>{classes.data?.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}>
      {id === null ? <p>Create a class first.</p> : <Async s={p}>{(d) => d.assignments.length === 0 ? <p>No active assignments for this class.</p> : (
        <table><thead><tr><th>Pupil</th>{d.assignments.map((a) => <th key={a.assignmentId}>{a.title}</th>)}</tr></thead><tbody>
          {d.students.map((s) => <tr key={s.id}><td>{s.indexNumber}. {s.firstName} {s.lastName}</td>{d.assignments.map((a) => {
            const c = d.cells.find((x) => x.studentId === s.id && x.assignmentId === a.assignmentId);
            return <td key={a.assignmentId}>{c?.complete ? "★ done" : `${c?.tasksPassed ?? 0}/${c?.tasksTotal ?? 0}${c?.writingDone ? " ✎" : ""}`}</td>;
          })}</tr>)}</tbody></table>)}</Async>}
    </Page>
  );
}
