import {
  chunkReferenceIssues, ComprehensionPayloadSchema, hasDownstreamStage, parseLoop, ReflectPayloadSchema, VocabularyPayloadSchema, WritingPayloadSchema,
  type AdminArticleSummary, type ArticleStatus,
} from "@newsroom/shared";
import type { Ctx } from "../router";
import { staff, type StaffSession } from "../data/tenancy";
import { MASTER_IMPORT_PROMPT } from "../importPrompt";
import { badRequest, conflict, forbidden, HttpError, notFound } from "../http";

interface ArticleRow {
  id: number; forked_from_id: number | null; title: string; source_name: string; publish_date: string; section: string | null; full_text: string;
  text_chunks: string; learning_loop: string; thumbnail_key: string | null; image_key: string | null; status: ArticleStatus; created_by: number | null; created_at: string;
}

async function loadArticle(c: Ctx<any>, id: number): Promise<ArticleRow> {
  const a = await c.db.first<ArticleRow>("SELECT * FROM articles WHERE id = ?", id);
  if (!a) throw notFound("Article not found.");
  return a;
}
/** Drafts belong to their author; admins can edit any. */
function mayEdit(s: StaffSession, a: ArticleRow): void {
  if (s.role !== "admin" && a.created_by !== s.teacherId) throw forbidden("Only the author or an admin can change this article.");
}

export async function adminArticles(c: Ctx<"adminArticles">) {
  staff(c.session);
  const rows = await c.db.all<ArticleRow>("SELECT * FROM articles ORDER BY publish_date DESC, id DESC");
  const articles: AdminArticleSummary[] = rows.map((a) => ({
    articleId: a.id, forkedFromId: a.forked_from_id, isFork: a.forked_from_id !== null, title: a.title, sourceName: a.source_name, publishDate: a.publish_date,
    section: a.section, status: a.status, createdBy: a.created_by, createdAt: a.created_at, hasThumbnail: a.thumbnail_key !== null, hasImage: a.image_key !== null, learningLoop: parseLoop(a.learning_loop),
  }));
  return { articles };
}

export async function adminArticle(c: Ctx<"adminArticle">) {
  staff(c.session);
  const a = await loadArticle(c, Number(c.params.articleId));
  const tasks = await c.db.all<{ id: number; type: "comprehension" | "vocabulary" | "reflect"; payload: string; pass_threshold: number }>("SELECT id, type, payload, pass_threshold FROM tasks WHERE article_id = ?", a.id);
  const w = await c.db.first<{ id: number; payload: string }>("SELECT id, payload FROM writing_tasks WHERE article_id = ?", a.id);
  return {
    article: { articleId: a.id, forkedFromId: a.forked_from_id, title: a.title, sourceName: a.source_name, publishDate: a.publish_date, section: a.section, fullText: a.full_text,
      textChunks: JSON.parse(a.text_chunks), status: a.status, hasThumbnail: a.thumbnail_key !== null, hasImage: a.image_key !== null, learningLoop: parseLoop(a.learning_loop) },
    tasks: tasks.map((t) => ({ taskId: t.id, type: t.type, payload: JSON.parse(t.payload), passThreshold: t.pass_threshold })),
    writing: w ? { writingTaskId: w.id, payload: JSON.parse(w.payload) } : null,
  };
}

const PAYLOAD_SCHEMAS = { comprehension: ComprehensionPayloadSchema, vocabulary: VocabularyPayloadSchema, reflect: ReflectPayloadSchema } as const;

export async function updateArticle(c: Ctx<"updateArticle">) {
  const s = staff(c.session);
  const a = await loadArticle(c, Number(c.params.articleId));
  mayEdit(s, a);
  // Published articles are LOCKED so pupil history stays attached to exactly what they saw. Fork to change.
  if (a.status !== "draft") throw conflict("Published articles are locked. Fork the article to make changes.");
  const b = c.body;
  const chunks = b.textChunks ?? (JSON.parse(a.text_chunks) as { chunk_id: string }[]);
  const chunkIds = new Set(chunks.map((x) => x.chunk_id));
  if (chunkIds.size !== chunks.length) throw badRequest("Duplicate chunk_id in textChunks.");

  const statements: D1PreparedStatement[] = [];
  const sets: string[] = [], binds: unknown[] = [];
  const col: [keyof typeof b, string, (v: any) => unknown][] = [
    ["title", "title", (v) => v], ["sourceName", "source_name", (v) => v], ["publishDate", "publish_date", (v) => v], ["section", "section", (v) => v],
    ["fullText", "full_text", (v) => v], ["textChunks", "text_chunks", (v) => JSON.stringify(v)],
  ];
  for (const [k, name, f] of col) if (b[k] !== undefined) { sets.push(`${name} = ?`); binds.push(f(b[k])); }
  if (sets.length) statements.push(c.db.stmt(`UPDATE articles SET ${sets.join(", ")} WHERE id = ?`, ...binds, a.id));

  const refs: Parameters<typeof chunkReferenceIssues>[1] = {};
  for (const t of b.tasks ?? []) {
    const parsed = PAYLOAD_SCHEMAS[t.type].safeParse(t.payload);
    if (!parsed.success) throw new HttpError(400, `Invalid ${t.type} payload.`, { issues: parsed.error.issues.slice(0, 5) });
    if (t.type === "comprehension") refs.comprehension = (parsed.data as { questions: { evidence_chunk_id: string }[] }).questions;
    if (t.type === "reflect") refs.reflect = (parsed.data as { evidence_map: { chunk_id: string }[] }).evidence_map;
    statements.push(c.db.stmt("UPDATE tasks SET payload = ? WHERE article_id = ? AND type = ?", JSON.stringify(parsed.data), a.id, t.type));
  }
  if (b.writing) {
    refs.writing = b.writing.source_evidence_map;
    statements.push(c.db.stmt("UPDATE writing_tasks SET payload = ? WHERE article_id = ?", JSON.stringify(b.writing), a.id));
  }
  const problems = chunkReferenceIssues(chunkIds, refs);
  if (problems.length) throw new HttpError(400, "A task cites a chunk that does not exist.", { issues: problems.slice(0, 5) });
  if (statements.length === 0) throw badRequest("Nothing to change.");
  await c.db.batch(statements);
  return { ok: true as const };
}

export async function setLearningLoop(c: Ctx<"setLearningLoop">) {
  const s = staff(c.session);
  const a = await loadArticle(c, Number(c.params.articleId));
  mayEdit(s, a);
  const loop = parseLoop({ ...parseLoop(a.learning_loop), ...c.body.learningLoop });
  if (!hasDownstreamStage(loop)) throw badRequest("At least one stage after Read must stay on.");
  await c.db.run("UPDATE articles SET learning_loop = ? WHERE id = ?", JSON.stringify(loop), a.id);
  return { ok: true as const, learningLoop: loop };
}

export async function publishArticle(c: Ctx<"publishArticle">) {
  const s = staff(c.session);
  const a = await loadArticle(c, Number(c.params.articleId));
  mayEdit(s, a);
  if (a.status !== "draft") throw conflict("This article is already published.");
  if (!hasDownstreamStage(parseLoop(a.learning_loop))) throw badRequest("Turn on at least one stage after Read before publishing.");
  await c.db.run("UPDATE articles SET status = 'active', published_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND status = 'draft'", a.id);
  return { articleId: a.id, status: "active" as const };
}

/** Fork = a new independent draft. One atomic batch; child rows join through create_ref. */
export async function forkArticle(c: Ctx<"forkArticle">) {
  const s = staff(c.session);
  const a = await loadArticle(c, Number(c.params.articleId));
  const ref = crypto.randomUUID();
  const title = c.body.title || `${a.title} (copy)`;
  const results = await c.db.batch([
    c.db.stmt(
      `INSERT INTO articles (forked_from_id, title, source_name, publish_date, section, full_text, text_chunks, learning_loop, thumbnail_key, image_key, status, created_by, create_ref)
       SELECT id, ?, source_name, publish_date, section, full_text, text_chunks, learning_loop, thumbnail_key, image_key, 'draft', ?, ? FROM articles WHERE id = ?`, title, s.teacherId, ref, a.id),
    c.db.stmt(`INSERT INTO tasks (article_id, type, payload, pass_threshold) SELECT (SELECT id FROM articles WHERE create_ref = ?), type, payload, pass_threshold FROM tasks WHERE article_id = ?`, ref, a.id),
    c.db.stmt(`INSERT INTO writing_tasks (article_id, payload) SELECT (SELECT id FROM articles WHERE create_ref = ?), payload FROM writing_tasks WHERE article_id = ?`, ref, a.id),
  ]);
  return { articleId: results[0]!.meta.last_row_id as number, forkedFromId: a.id, status: "draft" as const };
}

export async function importPrompt(c: Ctx<"importPrompt">) { staff(c.session); return { prompt: MASTER_IMPORT_PROMPT }; }

/** Import = article + tasks + writing in ONE atomic batch (v3 inserted the article first and tried to clean up on failure). */
export async function importArticle(c: Ctx<"importArticle">) {
  const s = staff(c.session);
  const b = c.body;
  const ref = crypto.randomUUID();
  const task = (type: string, payload: unknown) =>
    c.db.stmt("INSERT INTO tasks (article_id, type, payload) VALUES ((SELECT id FROM articles WHERE create_ref = ?), ?, ?)", ref, type, JSON.stringify(payload));
  const statements: D1PreparedStatement[] = [
    c.db.stmt("INSERT INTO articles (title, source_name, publish_date, section, full_text, text_chunks, status, created_by, create_ref) VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?)",
      b.title, b.sourceName, b.publishDate, b.section || null, b.fullText, JSON.stringify(b.textChunks), s.teacherId, ref),
    task("comprehension", b.comprehension), task("vocabulary", b.vocabulary), task("reflect", b.reflect),
  ];
  if (b.writing) statements.push(c.db.stmt("INSERT INTO writing_tasks (article_id, payload) VALUES ((SELECT id FROM articles WHERE create_ref = ?), ?)", ref, JSON.stringify(b.writing)));
  const results = await c.db.batch(statements);
  return { articleId: results[0]!.meta.last_row_id as number, status: "draft" as const };
}

// ---- images ----
const IMAGE_LIMITS = { thumbnail: 150 * 1024, image: 6 * 1024 * 1024 } as const;
function sniff(bytes: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45) return "image/webp";
  return null;
}
async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", buf))].map((x) => x.toString(16).padStart(2, "0")).join("");
}
async function upload(c: Ctx<"uploadThumbnail"> | Ctx<"uploadArticleImage">, kind: "thumbnail" | "image") {
  const s = staff(c.session);
  const a = await loadArticle(c, Number(c.params.articleId));
  mayEdit(s, a);
  const buf = await c.req.arrayBuffer();
  if (buf.byteLength === 0) throw badRequest("No image received.");
  if (buf.byteLength > IMAGE_LIMITS[kind]) throw new HttpError(413, `Image too large (max ${Math.round(IMAGE_LIMITS[kind] / 1024)} KB).`);
  const type = sniff(new Uint8Array(buf.slice(0, 12)));
  if (!type) throw badRequest("Only JPEG, PNG or WebP images are accepted.");
  // Content-addressed: same bytes -> same key. Objects are immutable (so forks can share them safely).
  const key = `${kind === "thumbnail" ? "thumb" : "page"}/${await sha256Hex(buf)}`;
  await c.env.MEDIA.put(key, buf, { httpMetadata: { contentType: type } });
  await c.db.run(`UPDATE articles SET ${kind === "thumbnail" ? "thumbnail_key" : "image_key"} = ? WHERE id = ?`, key, a.id);
  return { ok: true as const };
}
export const uploadThumbnail = (c: Ctx<"uploadThumbnail">) => upload(c, "thumbnail");
export const uploadArticleImage = (c: Ctx<"uploadArticleImage">) => upload(c, "image");

export async function deleteArticleImage(c: Ctx<"deleteArticleImage">) {
  const s = staff(c.session);
  const a = await loadArticle(c, Number(c.params.articleId));
  mayEdit(s, a);
  // Detach only. The R2 object may be shared with a fork, so it is never deleted here.
  await c.db.run("UPDATE articles SET image_key = NULL WHERE id = ?", a.id);
  return { ok: true as const };
}
