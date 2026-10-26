import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { ReflectSubmitRes } from "@newsroom/shared";
import { api, useApi } from "../../api";
import { Async, Card, ErrorBox, Page, Tag } from "../../ui";
import { GradeCard, useGrade } from "./Grade";

export default function ReflectPage({ onXp }: { onXp: () => void }) {
  const { taskId } = useParams();
  const s = useApi("getTask", { params: { taskId: taskId! } }, [taskId]);
  const [short, setShort] = useState(""); const [long, setLong] = useState("");
  const [nudge, setNudge] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<ReflectSubmitRes | null>(null);
  const grade = useGrade("reflect", done?.attemptId ?? null);

  return (
    <Page title="Opinion Desk">
      <Async s={s}>{(t) => {
        if (t.type !== "reflect") return <p>Wrong task type.</p>;
        const submit = async () => {
          setError(null);
          try {
            // Soft check first: the first time a pupil pastes the article, nudge them to use their own words.
            const chk = await api("checkReflect", { params: { taskId: t.taskId }, body: { attemptNumber: t.attemptNumber, short, long } });
            if (chk.blocked) { setNudge(chk.message ?? "Try using your own words."); return; }
            setNudge(null);
            setDone(await api("submitReflect", { params: { taskId: t.taskId }, body: { attemptNumber: t.attemptNumber, short, long } }));
            onXp();
          } catch (e) { setError(e); }
        };
        return (
          <>
            <details><summary>Re-read: {t.article.title}</summary><div className="article">{t.article.fullText}</div></details>
            <h2>{t.prompt}</h2>
            <label>Your view in one sentence<input value={short} onChange={(e) => setShort(e.target.value)} disabled={!!done} maxLength={1000} /></label>
            <label>Why do you think so? Use ideas from the story.<textarea value={long} onChange={(e) => setLong(e.target.value)} rows={7} disabled={!!done} maxLength={5000} /></label>
            {nudge ? <p className="nudge">{nudge}</p> : null}
            {error ? <ErrorBox error={error} /> : null}
            {!done ? <button className="primary" disabled={!short.trim() || !long.trim()} onClick={submit}>Submit</button> : (
              <>
                <Card><p>Submitted! {done.xpAwarded ? <Tag tone="good">+{done.xpAwarded} XP</Tag> : null} {done.leveledUp ? <Tag tone="good">Level up!</Tag> : null} {done.newlyPublished ? <Tag tone="good">Story published ★</Tag> : null}</p>
                  <h4>Other people's views</h4><ul>{done.modelAnswers.map((m, i) => <li key={i}>{m}</li>)}</ul></Card>
                <GradeCard g={grade} />
                <Link to="/pupil">Back to the Pressroom</Link>
              </>
            )}
          </>
        );
      }}</Async>
    </Page>
  );
}
