import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { McqQuestionView, McqSubmitRes, VocabQuestionView } from "@newsroom/shared";
import { api, useApi } from "../../api";
import { Async, Card, ErrorBox, Page, Tag } from "../../ui";

export default function TaskPage({ onXp }: { onXp: () => void }) {
  const { taskId } = useParams();
  const s = useApi("getTask", { params: { taskId: taskId! } }, [taskId]);
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [chunks, setChunks] = useState<Record<string, string>>({});
  const [result, setResult] = useState<McqSubmitRes | null>(null);
  const [error, setError] = useState<unknown>(null);

  return (
    <Page title="Investigation">
      <Async s={s}>{(t) => {
        if (t.type === "reflect") return <p>This is a Think &amp; Respond task. <Link to={`/pupil/reflect/${t.taskId}`}>Open it</Link>.</p>;
        const comp = t.type === "comprehension";
        const answered = t.questions.every((q) => picked[q.id] !== undefined && (!comp || chunks[q.id]));
        const submit = async () => {
          setError(null);
          try {
            const answers = Object.fromEntries(t.questions.map((q) => [q.id, { selectedIndex: picked[q.id]!, ...(comp ? { chunkId: chunks[q.id] } : {}) }]));
            setResult(await api("submitMcq", { params: { taskId: t.taskId }, body: { attemptNumber: t.attemptNumber, answers } }));
            onXp();
          } catch (e) { setError(e); }
        };
        return (
          <>
            <details open={comp}><summary>{t.article.title}</summary>
              <div className="article">{t.article.textChunks.map((c) => (
                <span key={c.chunk_id}>
                  {comp && !result ? <button className={`chunk ${Object.values(chunks).includes(c.chunk_id) ? "used" : ""}`} onClick={() => { const q = t.questions.find((x) => picked[x.id] !== undefined && !chunks[x.id]); if (q) setChunks({ ...chunks, [q.id]: c.chunk_id }); }} title="Click the sentence that proves your answer">{c.text}</button> : <>{c.text}</>}{" "}
                </span>))}</div>
            </details>
            {comp && !result ? <p className="muted">Pick an answer, then click the sentence in the story that proves it.</p> : null}
            {(t.questions as (McqQuestionView | VocabQuestionView)[]).map((q) => (
              <Card key={q.id}>
                <h3>{"question" in q ? q.question : <>What does <em>{q.targetWord}</em> mean here? <span className="muted">“{q.contextSentence}”</span></>}</h3>
                {q.options.map((o, i) => {
                  const r = result?.perQuestionResult[q.id];
                  return <label key={i} className={`option ${r && o === r.correctOptionText ? "right" : ""}`}><input type="radio" name={q.id} disabled={!!result} checked={picked[q.id] === i} onChange={() => setPicked({ ...picked, [q.id]: i })} /> {o}</label>;
                })}
                {comp ? <p className="muted">{chunks[q.id] ? "Evidence chosen ✓" : picked[q.id] !== undefined ? "Now click the proof sentence above." : ""}</p> : null}
              </Card>
            ))}
            {error ? <ErrorBox error={error} /> : null}
            {result ? (
              <Card><h3>{result.passed ? "Well done!" : "Not quite — try again!"}</h3>
                <p>{result.correctCount} of {result.total} correct. {result.xpAwarded > 0 ? <Tag tone="good">+{result.xpAwarded} XP</Tag> : null} {result.leveledUp ? <Tag tone="good">Level up!</Tag> : null} {result.newlyPublished ? <Tag tone="good">Story published ★</Tag> : null}</p>
                <Link to="/pupil">Back to the Pressroom</Link> {!result.passed ? <> · <a href="" onClick={(e) => { e.preventDefault(); location.reload(); }}>Try again</a></> : null}</Card>
            ) : <button className="primary" disabled={!answered} onClick={submit}>Submit</button>}
          </>
        );
      }}</Async>
    </Page>
  );
}
