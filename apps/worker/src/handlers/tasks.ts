// Pupil task flows. Every submit is: (1) read what we need, (2) decide with PURE functions,
// (3) write EVERYTHING in one atomic batch (attempt + progress + XP + badge).
import {
  checkAttemptLimit, checkQuestionType, checkStation, copiedFraction, exceedsThreshold, levelForXp, mcqPassed, mcqXp, XP_VALUES, xpKey,
  type OpenAccess, type TaskRes, type WritingPayloadView,
} from "@newsroom/shared";
import type { Ctx } from "../router";
import { assertAllowed, loadArticleContext, loadPupil, type ArticleCtx, type Pupil } from "../data/pupil";
import { badgeStatements, completionAfter, loadStageState } from "../data/completion";
import { xpInsertStatements, type XpAward } from "../data/xp";
import { conflict, forbidden, notFound } from "../http";
import { buildMcqView, gradeMcq, type CompQ, type VocabQ } from "../taskLogic";
import { gradeReflectAttempt, gradeWritingAttempt } from "../grading/pipeline";
import { logError } from "../log";

const sid = (c: { session: unknown }) => (c.session as { studentId: number }).studentId;
const toArticle = (a: ArticleCtx) => ({ id: a.articleId, title: a.title, sourceName: a.sourceName, publishDate: a.publishDate, section: a.section, fullText: a.fullText, textChunks: a.textChunks, hasImage: a.hasImage });

interface TaskRow { id: number; article_id: number; type: "comprehension" | "vocabulary" | "reflect"; payload: string; pass_threshold: number }
async function loadTaskFor(c: Ctx<any>, pupil: Pupil, taskId: number) {
  const task = await c.db.first<TaskRow>("SELECT id, article_id, type, payload, pass_threshold FROM tasks WHERE id = ?", taskId);
  if (!task) throw notFound("Task not found.");
  const art = await loadArticleContext(c.db, pupil, task.article_id, c.now);
  assertAllowed(checkQuestionType(art.access, task.type));
  const access = art.access as OpenAccess; // checkQuestionType refused every blocked case above
  const prog = await c.db.first<{ attempts_count: number }>("SELECT attempts_count FROM task_progress WHERE student_id = ? AND task_id = ?", pupil.id, task.id);
  const attemptsSoFar = prog?.attempts_count ?? 0;
  return { task, art, access, attemptsSoFar, attemptNumber: attemptsSoFar + 1, payload: JSON.parse(task.payload) };
}

function levelUp(oldXp: number, gained: number): boolean { return levelForXp(oldXp + gained).level > levelForXp(oldXp).level; }

/** Map a D1 uniqueness failure (two simultaneous submits of the same attempt) to a friendly 409. */
async function atomically<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    if (e instanceof Error && /UNIQUE|constraint/i.test(e.message)) throw conflict("This was already submitted. Please reload the page.");
    throw e;
  }
}

export async function getTask(c: Ctx<"getTask">): Promise<TaskRes> {
  const pupil = await loadPupil(c.db, sid(c));
  const t = await loadTaskFor(c, pupil, Number(c.params.taskId));
  assertAllowed(checkAttemptLimit(t.access, t.attemptsSoFar));
  const article = toArticle(t.art);
  if (t.task.type === "reflect") return { taskId: t.task.id, type: "reflect", attemptNumber: t.attemptNumber, article, prompt: t.payload.prompt };
  const seed = { studentId: pupil.id, taskId: t.task.id, attemptNumber: t.attemptNumber };
  return { taskId: t.task.id, type: t.task.type, attemptNumber: t.attemptNumber, article, questions: buildMcqView(t.task.type, t.payload.questions as (CompQ | VocabQ)[], seed) };
}

export async function submitMcq(c: Ctx<"submitMcq">) {
  const pupil = await loadPupil(c.db, sid(c));
  const t = await loadTaskFor(c, pupil, Number(c.params.taskId));
  if (t.task.type === "reflect") throw forbidden("Use the Think & Respond submit for this task.");
  assertAllowed(checkAttemptLimit(t.access, t.attemptsSoFar));
  if (c.body.attemptNumber !== t.attemptNumber) throw conflict("This page is out of date. Please reload the task.");

  const seed = { studentId: pupil.id, taskId: t.task.id, attemptNumber: t.attemptNumber };
  const g = gradeMcq(t.task.type, t.payload.questions as (CompQ | VocabQ)[], seed, c.body.answers);
  const passed = mcqPassed(g.score, t.task.pass_threshold);

  const state = await loadStageState(c.db, pupil.id, t.art.articleId);
  const done = completionAfter(t.access, state, { task: { taskId: t.task.id, passed } });

  const awards: XpAward[] = [];
  const mcqAward = t.attemptNumber === 1 ? mcqXp(t.task.type, g.correctCount) : 0;
  if (mcqAward > 0) awards.push({ delta: mcqAward, reason: `${t.task.type}_first_attempt`, sourceKey: xpKey.mcqFirstAttempt(t.task.id) });
  const statements: D1PreparedStatement[] = [
    c.db.stmt("INSERT INTO attempts (student_id, task_id, attempt_number, answers, score) VALUES (?, ?, ?, ?, ?)", pupil.id, t.task.id, t.attemptNumber, JSON.stringify(c.body.answers), g.score),
    c.db.stmt(
      `INSERT INTO task_progress (student_id, task_id, attempts_count, first_attempt_score, best_score, passed) VALUES (?1, ?2, 1, ?3, ?3, ?4)
       ON CONFLICT(student_id, task_id) DO UPDATE SET attempts_count = attempts_count + 1,
         best_score = MAX(COALESCE(best_score, 0), excluded.best_score), passed = MAX(passed, excluded.passed),
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`, pupil.id, t.task.id, g.score, passed ? 1 : 0),
  ];
  if (done.newlyPublished) { const b = badgeStatements(c.db, pupil.id, t.art.articleId); statements.push(...b.statements); awards.push(b.award); }
  statements.push(...xpInsertStatements(c.db, pupil.id, awards));
  await atomically(() => c.db.batch(statements));

  const gained = awards.reduce((n, a) => n + a.delta, 0);
  return {
    score: g.score, correctCount: g.correctCount, total: g.total, passed, passThreshold: t.task.pass_threshold,
    perQuestionResult: g.perQuestion, xpAwarded: gained, leveledUp: levelUp(pupil.xpTotal, gained), newlyPublished: done.newlyPublished,
  };
}

// ---------------- Think & Respond ----------------
function reflectSimilarity(pupil: Pupil, art: ArticleCtx, payload: { model_answers: string[] }, attemptNumber: number, text: string) {
  // Model answers only become visible after a first submission, so they only count as sources on retries.
  const sources = [art.fullText, ...(attemptNumber > 1 ? payload.model_answers : [])];
  const score = copiedFraction(text, sources);
  return { score, flagged: exceedsThreshold(score, pupil.similarityThreshold) };
}

export async function checkReflect(c: Ctx<"checkReflect">) {
  const pupil = await loadPupil(c.db, sid(c));
  const t = await loadTaskFor(c, pupil, Number(c.params.taskId));
  if (t.task.type !== "reflect") throw forbidden();
  const sim = reflectSimilarity(pupil, t.art, t.payload, t.attemptNumber, `${c.body.short} ${c.body.long}`);
  if (!sim.flagged) return { blocked: false, flagged: false, score: sim.score };
  const warned = await c.db.first<{ n: number }>("SELECT 1 AS n FROM similarity_warnings WHERE student_id = ? AND task_id = ? AND attempt_number = ?", pupil.id, t.task.id, t.attemptNumber);
  if (warned) return { blocked: false, flagged: true, score: sim.score };
  await c.db.run("INSERT OR IGNORE INTO similarity_warnings (student_id, task_id, attempt_number) VALUES (?, ?, ?)", pupil.id, t.task.id, t.attemptNumber);
  return { blocked: true, flagged: true, score: sim.score, message: "Some of your answer is very close to the article. Try telling it in your own words, then submit again." };
}

export async function submitReflect(c: Ctx<"submitReflect">) {
  const pupil = await loadPupil(c.db, sid(c));
  const t = await loadTaskFor(c, pupil, Number(c.params.taskId));
  if (t.task.type !== "reflect") throw forbidden();
  assertAllowed(checkAttemptLimit(t.access, t.attemptsSoFar));
  if (c.body.attemptNumber !== t.attemptNumber) throw conflict("This page is out of date. Please reload the task.");
  const sim = reflectSimilarity(pupil, t.art, t.payload, t.attemptNumber, `${c.body.short} ${c.body.long}`);

  const state = await loadStageState(c.db, pupil.id, t.art.articleId);
  const done = completionAfter(t.access, state, { task: { taskId: t.task.id, passed: true } });
  const awards: XpAward[] = t.attemptNumber === 1 ? [{ delta: XP_VALUES.REFLECT_SUBMISSION, reason: "reflect_first_attempt", sourceKey: xpKey.reflectFirstAttempt(t.task.id) }] : [];
  const statements: D1PreparedStatement[] = [
    c.db.stmt(
      `INSERT INTO attempts (student_id, task_id, attempt_number, answers, grading_status, similarity_score, similarity_flag) VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
      pupil.id, t.task.id, t.attemptNumber, JSON.stringify({ short: c.body.short, long: c.body.long }), sim.score, sim.flagged ? 1 : 0),
    c.db.stmt(
      `INSERT INTO task_progress (student_id, task_id, attempts_count, passed) VALUES (?1, ?2, 1, 1)
       ON CONFLICT(student_id, task_id) DO UPDATE SET attempts_count = attempts_count + 1, passed = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`, pupil.id, t.task.id),
  ];
  if (done.newlyPublished) { const b = badgeStatements(c.db, pupil.id, t.art.articleId); statements.push(...b.statements); awards.push(b.award); }
  statements.push(...xpInsertStatements(c.db, pupil.id, awards));
  const results = await atomically(() => c.db.batch(statements));
  const attemptId = results[0]!.meta.last_row_id as number;

  // The submission is safe. Grade in the background; the pupil polls reflectGrade.
  c.waitUntil(gradeReflectAttempt(c.env, c.db, attemptId, { log: c.log }).catch((e) => logError("grading_failed", { requestId: c.requestId, route: "submitReflect" }, e, { attemptId })));
  const gained = awards.reduce((n, a) => n + a.delta, 0);
  return { attemptId, attemptNumber: t.attemptNumber, modelAnswers: t.payload.model_answers as string[], similarityFlagged: sim.flagged, xpAwarded: gained, leveledUp: levelUp(pupil.xpTotal, gained), newlyPublished: done.newlyPublished };
}

// ---------------- Writing ----------------
async function loadWritingFor(c: Ctx<any>, pupil: Pupil, where: "article" | "task", id: number) {
  const wt = await c.db.first<{ id: number; article_id: number; payload: string }>(
    where === "article" ? "SELECT id, article_id, payload FROM writing_tasks WHERE article_id = ?" : "SELECT id, article_id, payload FROM writing_tasks WHERE id = ?", id);
  if (!wt) throw notFound("Writing task not found.");
  const art = await loadArticleContext(c.db, pupil, wt.article_id, c.now);
  assertAllowed(checkQuestionType(art.access, "writing"));
  assertAllowed(checkStation(art.access, "writing"));
  const access = art.access as OpenAccess;
  const prog = await c.db.first<{ attempts_count: number }>("SELECT attempts_count FROM writing_progress WHERE student_id = ? AND writing_task_id = ?", pupil.id, wt.id);
  const attemptsSoFar = prog?.attempts_count ?? 0;
  return { wt, art, access, attemptsSoFar, attemptNumber: attemptsSoFar + 1, payload: JSON.parse(wt.payload) as WritingPayloadView };
}

export async function getWritingTask(c: Ctx<"getWritingTask">) {
  const pupil = await loadPupil(c.db, sid(c));
  const w = await loadWritingFor(c, pupil, "article", Number(c.params.articleId));
  assertAllowed(checkAttemptLimit(w.access, w.attemptsSoFar));
  const { model_article, ...rest } = w.payload;
  // The model article is a post-attempt teaching aid, never shown before a first draft exists.
  const payload: WritingPayloadView = w.attemptsSoFar >= 1 && model_article ? { ...rest, model_article } : rest;
  return { writingTaskId: w.wt.id, attemptNumber: w.attemptNumber, article: toArticle(w.art), payload, learningLoop: w.access.loop };
}

export async function submitWriting(c: Ctx<"submitWriting">) {
  const pupil = await loadPupil(c.db, sid(c));
  const w = await loadWritingFor(c, pupil, "task", Number(c.params.writingTaskId));
  assertAllowed(checkAttemptLimit(w.access, w.attemptsSoFar));
  if (c.body.attemptNumber !== w.attemptNumber) throw conflict("This page is out of date. Please reload the task.");
  const simScore = copiedFraction(c.body.draft, [w.art.fullText]);
  const flagged = exceedsThreshold(simScore, pupil.similarityThreshold);

  const state = await loadStageState(c.db, pupil.id, w.art.articleId);
  const done = completionAfter(w.access, state, { writingCompleted: true });
  const awards: XpAward[] = w.attemptNumber === 1 ? [{ delta: XP_VALUES.WRITING_FIRST_ATTEMPT, reason: "writing_first_attempt", sourceKey: xpKey.writingFirstAttempt(w.wt.id) }] : [];
  const statements: D1PreparedStatement[] = [
    c.db.stmt("INSERT INTO writing_attempts (student_id, writing_task_id, attempt_number, draft, similarity_score, similarity_flag) VALUES (?, ?, ?, ?, ?, ?)", pupil.id, w.wt.id, w.attemptNumber, c.body.draft, simScore, flagged ? 1 : 0),
    c.db.stmt(
      `INSERT INTO writing_progress (student_id, writing_task_id, attempts_count, completed) VALUES (?1, ?2, 1, 1)
       ON CONFLICT(student_id, writing_task_id) DO UPDATE SET attempts_count = attempts_count + 1, completed = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`, pupil.id, w.wt.id),
  ];
  if (done.newlyPublished) { const b = badgeStatements(c.db, pupil.id, w.art.articleId); statements.push(...b.statements); awards.push(b.award); }
  statements.push(...xpInsertStatements(c.db, pupil.id, awards));
  const results = await atomically(() => c.db.batch(statements));
  const attemptId = results[0]!.meta.last_row_id as number;

  c.waitUntil(gradeWritingAttempt(c.env, c.db, attemptId, { log: c.log }).catch((e) => logError("grading_failed", { requestId: c.requestId, route: "submitWriting" }, e, { attemptId })));
  const gained = awards.reduce((n, a) => n + a.delta, 0);
  return { attemptId, attemptNumber: w.attemptNumber, editingEnabled: w.access.loop.edit, similarityFlagged: flagged, xpAwarded: gained, leveledUp: levelUp(pupil.xpTotal, gained), newlyPublished: done.newlyPublished };
}

// ---------------- grade polling (with rescue for a grader that never finished) ----------------
const PENDING_RESCUE_MS = 45_000;

async function gradeStatus(c: Ctx<"reflectGrade"> | Ctx<"writingGrade">, kind: "reflect" | "writing") {
  const table = kind === "reflect" ? "attempts" : "writing_attempts";
  const read = () => c.db.first<{ grading_status: "not_applicable" | "pending" | "ai" | "fallback"; grade_json: string | null; submitted_at: string }>(
    `SELECT grading_status, grade_json, submitted_at FROM ${table} WHERE id = ? AND student_id = ?`, Number(c.params.attemptId), sid(c));
  let row = await read();
  if (!row) throw notFound();
  if (row.grading_status === "pending" && c.now.getTime() - Date.parse(row.submitted_at) > PENDING_RESCUE_MS) {
    // The background grader never reported back (e.g. the isolate was evicted). Never leave a pupil waiting.
    const id = Number(c.params.attemptId);
    const opts = { forceFallbackReason: "grading_timeout", onlyIfPending: true, log: c.log };
    await (kind === "reflect" ? gradeReflectAttempt(c.env, c.db, id, opts) : gradeWritingAttempt(c.env, c.db, id, opts));
    row = (await read())!;
  }
  return { attemptId: Number(c.params.attemptId), status: row.grading_status, grade: row.grade_json ? JSON.parse(row.grade_json) : null, provisional: row.grading_status === "fallback" };
}
export const reflectGrade = (c: Ctx<"reflectGrade">) => gradeStatus(c, "reflect") as Promise<any>;
export const writingGrade = (c: Ctx<"writingGrade">) => gradeStatus(c, "writing") as Promise<any>;
