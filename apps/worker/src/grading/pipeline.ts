// Grade one stored attempt and persist the outcome atomically: the grading_run row (which provider,
// or that it fell back and why), the attempt's grade, and best_score recomputed from all attempts.
import type { ReflectGradeView, WritingGradeView } from "@newsroom/shared";
import type { Env } from "../env";
import type { Db } from "../db";
import type { Logger } from "../log";
import { runChain } from "./chain";
import { buildProviders } from "./providers";
import { buildReflectPrompt, buildWritingPrompt } from "./prompts";
import { normalizeReflectGrade, normalizeWritingGrade, extractJson } from "./normalize";
import { reflectFallback, writingFallback } from "./fallback";
import type { ChainResult, GradingProvider } from "./types";

export interface GradeOptions { providers?: GradingProvider[]; forceFallbackReason?: string; log?: Logger; /** Only write the grade if the attempt is still 'pending' (protects a late rescue from clobbering a real grade). */ onlyIfPending?: boolean }

function persistStatements(db: Db, kind: "reflect" | "writing", attemptId: number, r: ChainResult<unknown>, score: number, bestScoreSql: D1PreparedStatement, onlyIfPending = false) {
  const table = kind === "reflect" ? "attempts" : "writing_attempts";
  return [
    db.stmt(
      `INSERT INTO grading_runs (kind, attempt_id, outcome, provider, model, latency_ms, attempts_log, fallback_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      kind, attemptId, r.outcome, r.provider, r.model, r.latencyMs, JSON.stringify(r.attempts), r.fallbackReason,
    ),
    db.stmt(
      `UPDATE ${table} SET grading_status = ?, grade_json = ?, score = ?, grading_run_id = last_insert_rowid() WHERE id = ?${onlyIfPending ? " AND grading_status = 'pending'" : ""}`,
      r.outcome, JSON.stringify(r.grade), score, attemptId,
    ),
    bestScoreSql,
  ];
}

export async function gradeReflectAttempt(env: Env, db: Db, attemptId: number, opts: GradeOptions = {}): Promise<ChainResult<ReflectGradeView>> {
  const row = await db.first<{ student_id: number; task_id: number; answers: string; payload: string; full_text: string; text_chunks: string }>(
    `SELECT at.student_id, at.task_id, at.answers, t.payload, a.full_text, a.text_chunks
     FROM attempts at JOIN tasks t ON t.id = at.task_id JOIN articles a ON a.id = t.article_id WHERE at.id = ?`, attemptId);
  if (!row) throw new Error(`reflect attempt ${attemptId} not found`);
  const payload = JSON.parse(row.payload) as { prompt: string; model_answers: string[]; evidence_map: { chunk_id: string; keywords: string[] }[]; marking: unknown };
  const answers = JSON.parse(row.answers) as { short: string; long: string };
  const chunkIds = new Set((JSON.parse(row.text_chunks) as { chunk_id: string }[]).map((c) => c.chunk_id));
  const prompt = buildReflectPrompt({ articleText: row.full_text, question: payload.prompt, short: answers.short, long: answers.long, evidenceMap: payload.evidence_map, modelAnswers: payload.model_answers, marking: payload.marking });
  const chain = await runChain<ReflectGradeView>({
    providers: opts.forceFallbackReason ? [] : (opts.providers ?? buildProviders(env as never)),
    prompt, parse: (t) => normalizeReflectGrade(extractJson(t), chunkIds), fallback: () => reflectFallback(answers, payload.evidence_map),
  });
  if (opts.forceFallbackReason) chain.fallbackReason = opts.forceFallbackReason;
  const best = db.stmt(
    `UPDATE task_progress SET best_score = (SELECT MAX(score) FROM attempts WHERE student_id = ?1 AND task_id = ?2 AND score IS NOT NULL),
       first_attempt_score = COALESCE(first_attempt_score, (SELECT score FROM attempts WHERE student_id = ?1 AND task_id = ?2 AND attempt_number = 1))
     WHERE student_id = ?1 AND task_id = ?2`, row.student_id, row.task_id);
  await db.batch(persistStatements(db, "reflect", attemptId, chain, chain.grade.score, best, opts.onlyIfPending));
  opts.log?.info("grading_done", { kind: "reflect", attemptId, outcome: chain.outcome, provider: chain.provider, fallbackReason: chain.fallbackReason, attempts: chain.attempts.length, ms: chain.latencyMs });
  return chain;
}

export async function gradeWritingAttempt(env: Env, db: Db, attemptId: number, opts: GradeOptions = {}): Promise<ChainResult<WritingGradeView>> {
  const row = await db.first<{ student_id: number; writing_task_id: number; draft: string; payload: string; full_text: string }>(
    `SELECT wa.student_id, wa.writing_task_id, wa.draft, wt.payload, a.full_text
     FROM writing_attempts wa JOIN writing_tasks wt ON wt.id = wa.writing_task_id JOIN articles a ON a.id = wt.article_id WHERE wa.id = ?`, attemptId);
  if (!row) throw new Error(`writing attempt ${attemptId} not found`);
  const payload = JSON.parse(row.payload) as { brief?: { recommended_word_count?: { min: number; max: number } }; source_evidence_map?: { keywords?: string[] }[] } & Record<string, unknown>;
  const { model_article: _omit, ...taskForPrompt } = payload as Record<string, unknown>;
  const prompt = buildWritingPrompt({ articleText: row.full_text, task: taskForPrompt, draft: row.draft });
  const wc = payload.brief?.recommended_word_count ?? { min: 120, max: 300 };
  const chain = await runChain<WritingGradeView>({
    providers: opts.forceFallbackReason ? [] : (opts.providers ?? buildProviders(env as never)),
    prompt, parse: (t) => normalizeWritingGrade(extractJson(t)),
    fallback: () => writingFallback(row.draft, { evidence: payload.source_evidence_map ?? [], minWords: wc.min, maxWords: wc.max }),
  });
  if (opts.forceFallbackReason) chain.fallbackReason = opts.forceFallbackReason;
  const best = db.stmt(
    `UPDATE writing_progress SET best_score = (SELECT MAX(score) FROM writing_attempts WHERE student_id = ?1 AND writing_task_id = ?2 AND score IS NOT NULL),
       first_attempt_score = COALESCE(first_attempt_score, (SELECT score FROM writing_attempts WHERE student_id = ?1 AND writing_task_id = ?2 AND attempt_number = 1))
     WHERE student_id = ?1 AND writing_task_id = ?2`, row.student_id, row.writing_task_id);
  await db.batch(persistStatements(db, "writing", attemptId, chain, chain.grade.score, best, opts.onlyIfPending));
  opts.log?.info("grading_done", { kind: "writing", attemptId, outcome: chain.outcome, provider: chain.provider, fallbackReason: chain.fallbackReason, attempts: chain.attempts.length, ms: chain.latencyMs });
  return chain;
}
