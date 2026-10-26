import { useState } from "react";
import type { ReviewQueueEntry } from "@newsroom/shared";
import { api, useApi } from "../../api";
import { Async, Card, ErrorBox, Page, Tag } from "../../ui";

function Entry({ e, reload }: { e: ReviewQueueEntry; reload: () => void }) {
  const [bonus, setBonus] = useState("0"); const [note, setNote] = useState(""); const [error, setError] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); setError(null); try { await fn(); reload(); } catch (x) { setError(x); } finally { setBusy(false); } };
  const params = { kind: e.kind, attemptId: e.attemptId };
  return (
    <Card className={e.reviewed ? "muted" : ""}>
      <h3>{e.studentName} <span className="muted">· {e.articleTitle} · attempt {e.attemptNumber} · {e.kind}</span></h3>
      <p>{e.reasons.includes("similarity") ? <Tag tone="warn">Close to the article ({Math.round((e.similarityScore ?? 0) * 100)}% copied)</Tag> : null} {e.reasons.includes("fallback_graded") ? <Tag tone="warn">Auto-marked without AI ({e.provider})</Tag> : <Tag>AI: {e.provider}</Tag>} {e.reviewed ? <Tag tone="good">Reviewed</Tag> : null}</p>
      {e.answers.draft ? <blockquote>{e.answers.draft}</blockquote> : <blockquote><strong>{e.answers.short}</strong><br />{e.answers.long}</blockquote>}
      <p>Score: {e.score ?? "–"} / {e.maxScore}{e.confidence !== null ? ` · confidence ${Math.round(e.confidence * 100)}%` : ""}</p>
      {e.feedback?.nextStep ? <p className="muted">Next step given: {e.feedback.nextStep}</p> : null}
      <div className="row">
        <button disabled={busy} onClick={() => run(() => api("regrade", { params }))}>Re-run AI grading</button>
        {e.kind === "reflect" ? <label>Bonus XP (0–10)<input value={bonus} onChange={(x) => setBonus(x.target.value)} inputMode="numeric" size={3} /></label> : null}
        <input value={note} onChange={(x) => setNote(x.target.value)} placeholder="Note (optional)" />
        <button className="primary" disabled={busy} onClick={() => run(() => api("submitReview", { params, body: { bonusXp: e.kind === "reflect" ? Number(bonus) || 0 : 0, note: note || undefined } }))}>Mark reviewed</button>
      </div>
      {error ? <ErrorBox error={error} /> : null}
    </Card>
  );
}

export default function Review() {
  const q = useApi("reviewQueue", { query: {} });
  return <Page title="Review queue"><p className="muted">Submissions that look copied, or that were marked without AI.</p>
    <Async s={q}>{(d) => d.queue.length === 0 ? <p>Nothing to review. 🎉</p> : <>{d.queue.map((e) => <Entry key={`${e.kind}${e.attemptId}`} e={e} reload={q.reload} />)}</>}</Async></Page>;
}
