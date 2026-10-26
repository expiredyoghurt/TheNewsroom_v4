import { useState } from "react";
import { LOOP_KEYS, type AdminArticleSummary, type LoopKey } from "@newsroom/shared";
import { api, upload, useApi } from "../../api";
import { Async, Card, ErrorBox, Page, Tag } from "../../ui";
import { SectionIcon } from "../../components/Art";

/** Resize in the browser so thumbnails stay a few KB and the server never has to process images. */
async function makeThumbnail(file: File, maxEdge = 240): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Could not make a thumbnail."))), "image/jpeg", 0.7));
}

function Row({ a, reload }: { a: AdminArticleSummary; reload: () => void }) {
  const [error, setError] = useState<unknown>(null);
  const run = async (fn: () => Promise<unknown>) => { setError(null); try { await fn(); reload(); } catch (e) { setError(e); } };
  const draft = a.status === "draft";
  return (
    <Card>
      <h3>{a.title} <Tag tone={draft ? "warn" : a.status === "active" ? "good" : ""}>{a.status}</Tag>{a.isFork ? <Tag>fork</Tag> : null}</h3>
      <p className="muted"><SectionIcon section={a.section} size={14} /> {a.sourceName} · {a.publishDate}{a.section ? ` · ${a.section}` : ""}</p>
      <fieldset className="loop"><legend>Learning loop (which stages this story uses)</legend>
        {LOOP_KEYS.filter((k) => k !== "read").map((k: LoopKey) => (
          <label key={k}><input type="checkbox" checked={a.learningLoop[k]} disabled={k === "edit" && !a.learningLoop.writing}
            onChange={(e) => run(() => api("setLearningLoop", { params: { articleId: a.articleId }, body: { learningLoop: { [k]: e.target.checked } } }))} /> {k}</label>))}
      </fieldset>
      <div className="row">
        {draft ? <button className="primary" onClick={() => confirm("Publish? A published story is locked (fork it to change it).") && run(() => api("publishArticle", { params: { articleId: a.articleId } }))}>Publish</button> : null}
        <button onClick={() => run(() => api("forkArticle", { params: { articleId: a.articleId }, body: {} }))}>Fork to a new draft</button>
        <label className="file">Page photo<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => { const f = e.target.files?.[0]; if (f) run(async () => { await upload("uploadArticleImage", a.articleId, f); await upload("uploadThumbnail", a.articleId, await makeThumbnail(f)); }); }} /></label>
        {a.hasImage ? <button onClick={() => run(() => api("deleteArticleImage", { params: { articleId: a.articleId } }))}>Remove photo</button> : null}
      </div>
      {error ? <ErrorBox error={error} /> : null}
    </Card>
  );
}

function ImportBox({ onDone }: { onDone: () => void }) {
  const prompt = useApi("importPrompt");
  const [json, setJson] = useState(""); const [error, setError] = useState<unknown>(null); const [copied, setCopied] = useState(false);
  return (
    <Card>
      <h3>Import a story</h3>
      <ol><li><button onClick={async () => { if (prompt.data) { await navigator.clipboard.writeText(prompt.data.prompt); setCopied(true); } }}>{copied ? "Copied ✓" : "Copy the AI prompt"}</button> and run it in your AI tool with a photo of the newspaper page.</li>
        <li>Paste the JSON it returns here:</li></ol>
      <textarea value={json} onChange={(e) => setJson(e.target.value)} rows={6} placeholder='{ "title": "...", ... }' />
      <button className="primary" disabled={!json.trim()} onClick={async () => {
        setError(null);
        try { await api("importArticle", { body: JSON.parse(json) }); setJson(""); onDone(); }
        catch (e) { setError(e instanceof SyntaxError ? new Error("That is not valid JSON. Check the AI returned only the JSON object.") : e); }
      }}>Import as draft</button>
      {error ? <ErrorBox error={error} /> : null}
    </Card>
  );
}

export default function Articles() {
  const list = useApi("adminArticles");
  return <Page title="Articles"><ImportBox onDone={list.reload} /><Async s={list}>{(d) => <>{d.articles.map((a) => <Row key={a.articleId} a={a} reload={list.reload} />)}</>}</Async></Page>;
}
