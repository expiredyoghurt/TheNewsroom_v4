import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { WritingSubmitRes } from "@newsroom/shared";
import { api, useApi } from "../../api";
import { Async, Card, ErrorBox, Page, Tag } from "../../ui";
import { GradeCard, useGrade } from "./Grade";

export default function WritingPage({ onXp }: { onXp: () => void }) {
  const { articleId } = useParams();
  const s = useApi("getWritingTask", { params: { articleId: articleId! } }, [articleId]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<WritingSubmitRes | null>(null);
  const grade = useGrade("writing", done?.attemptId ?? null);
  const words = draft.trim() ? draft.trim().split(/\s+/).length : 0;

  return (
    <Page title="Writing Desk">
      <Async s={s}>{(t) => {
        const editing = t.attemptNumber > 1 && t.learningLoop.edit;
        const wc = t.payload.brief.recommended_word_count;
        return (
          <>
            <h2>{editing ? "Editor's Desk — improve your draft" : t.payload.title}</h2>
            <p>{t.payload.writing_prompt}</p>
            <details><summary>Re-read the story</summary><div className="article">{t.article.fullText}</div></details>
            <details><summary>Planning help</summary>
              <ul>{(t.payload.scaffold.planning_questions ?? []).map((q, i) => <li key={i}>{q}</li>)}</ul>
              <p><strong>Paragraph plan:</strong></p><ol>{(t.payload.scaffold.paragraph_plan ?? []).map((q, i) => <li key={i}>{q}</li>)}</ol>
              {t.payload.scaffold.sentence_starters?.length ? <p><strong>Starters:</strong> {t.payload.scaffold.sentence_starters.join(" · ")}</p> : null}
            </details>
            {t.payload.model_article ? <details><summary>A model article</summary><p>{t.payload.model_article}</p></details> : null}
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={14} disabled={!!done} maxLength={20000} aria-label="Your draft" />
            <p className="muted">{words} words (aim for {wc.min}–{wc.max})</p>
            {error ? <ErrorBox error={error} /> : null}
            {!done ? <button className="primary" disabled={words < 10} onClick={async () => {
              setError(null);
              try { setDone(await api("submitWriting", { params: { writingTaskId: t.writingTaskId }, body: { attemptNumber: t.attemptNumber, draft } })); onXp(); } catch (e) { setError(e); }
            }}>Submit</button> : (
              <>
                <Card><p>Draft saved! {done.xpAwarded ? <Tag tone="good">+{done.xpAwarded} XP</Tag> : null} {done.newlyPublished ? <Tag tone="good">Story published ★</Tag> : null} {done.similarityFlagged ? <Tag tone="warn">Very close to the article</Tag> : null}</p></Card>
                <GradeCard g={grade} />
                <Link to="/pupil">Back to the Pressroom</Link>{done.editingEnabled ? <> · <a href="" onClick={(e) => { e.preventDefault(); location.reload(); }}>Edit my draft</a></> : null}
              </>
            )}
          </>
        );
      }}</Async>
    </Page>
  );
}
