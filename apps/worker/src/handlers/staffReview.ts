import { clampReviewBonus, xpKey, type ReviewQueueEntry, type GradingStatus } from "@newsroom/shared";
import type { Ctx } from "../router";
import { classScope, requireStudent, staff } from "../data/tenancy";
import { xpInsertStatements } from "../data/xp";
import { badRequest, notFound } from "../http";
import { gradeReflectAttempt, gradeWritingAttempt } from "../grading/pipeline";

interface QueueRow {
  kind: "reflect" | "writing"; id: number; first_name: string; last_name: string; article_title: string; attempt_number: number;
  answers: string; similarity_score: number | null; similarity_flag: number; grading_status: GradingStatus; score: number | null; grade_json: string | null;
  submitted_at: string; reviewed_at: string | null; provider: string | null; model: string | null;
}

/** One round trip: both attempt kinds, flagged for similarity OR graded by the non-AI fallback. */
export async function reviewQueue(c: Ctx<"reviewQueue">) {
  const sc = classScope(staff(c.session));
  const cls = c.query.classId !== undefined ? " AND c.id = ?" : "";
  const extra = c.query.classId !== undefined ? [c.query.classId] : [];
  const rows = await c.db.all<QueueRow>(
    `SELECT * FROM (
       SELECT 'reflect' AS kind, at.id, st.first_name, st.last_name, ar.title AS article_title, at.attempt_number, at.answers, at.similarity_score, at.similarity_flag,
              at.grading_status, at.score, at.grade_json, at.submitted_at, at.reviewed_at, gr.provider, gr.model
       FROM attempts at JOIN students st ON st.id = at.student_id JOIN classes c ON c.id = st.class_id JOIN tasks t ON t.id = at.task_id
       JOIN articles ar ON ar.id = t.article_id LEFT JOIN grading_runs gr ON gr.id = at.grading_run_id
       WHERE ${sc.sql}${cls} AND t.type = 'reflect' AND (at.similarity_flag = 1 OR at.grading_status = 'fallback')
       UNION ALL
       SELECT 'writing', wa.id, st.first_name, st.last_name, ar.title, wa.attempt_number, wa.draft, wa.similarity_score, wa.similarity_flag,
              wa.grading_status, wa.score, wa.grade_json, wa.submitted_at, wa.reviewed_at, gr.provider, gr.model
       FROM writing_attempts wa JOIN students st ON st.id = wa.student_id JOIN classes c ON c.id = st.class_id JOIN writing_tasks wt ON wt.id = wa.writing_task_id
       JOIN articles ar ON ar.id = wt.article_id LEFT JOIN grading_runs gr ON gr.id = wa.grading_run_id
       WHERE ${sc.sql}${cls} AND (wa.similarity_flag = 1 OR wa.grading_status = 'fallback')
     ) ORDER BY reviewed_at IS NOT NULL, submitted_at DESC LIMIT 200`,
    ...sc.binds, ...extra, ...sc.binds, ...extra);
  const queue: ReviewQueueEntry[] = rows.map((r) => {
    const grade = r.grade_json ? JSON.parse(r.grade_json) : null;
    const answers = r.kind === "reflect" ? JSON.parse(r.answers) : { draft: r.answers };
    const reasons: ReviewQueueEntry["reasons"] = [];
    if (r.similarity_flag === 1) reasons.push("similarity");
    if (r.grading_status === "fallback") reasons.push("fallback_graded");
    return {
      kind: r.kind, attemptId: r.id, studentName: `${r.first_name} ${r.last_name}`, articleTitle: r.article_title, attemptNumber: r.attempt_number,
      answers, reasons, similarityScore: r.similarity_score, submittedAt: r.submitted_at, reviewed: r.reviewed_at !== null,
      gradingStatus: r.grading_status, score: r.score, maxScore: r.kind === "reflect" ? 10 : 20, provider: r.provider, model: r.model,
      confidence: grade?.confidence ?? null, breakdown: grade?.breakdown ?? null, feedback: grade ? { strengths: grade.strengths, nextStep: grade.nextStep } : null,
    };
  });
  return { queue };
}

async function loadAttempt(c: Ctx<"submitReview"> | Ctx<"regrade">) {
  const kind = c.params.kind;
  if (kind !== "reflect" && kind !== "writing") throw notFound();
  const id = Number(c.params.attemptId);
  const row = kind === "reflect"
    ? await c.db.first<{ student_id: number; task_id: number }>("SELECT student_id, task_id FROM attempts WHERE id = ?", id)
    : await c.db.first<{ student_id: number; task_id: number }>("SELECT student_id, writing_task_id AS task_id FROM writing_attempts WHERE id = ?", id);
  if (!row) throw notFound("Attempt not found.");
  await requireStudent(c.db, staff(c.session), row.student_id);
  return { kind, id, ...row };
}

export async function submitReview(c: Ctx<"submitReview">) {
  const a = await loadAttempt(c);
  const s = staff(c.session);
  const bonus = clampReviewBonus(c.body.bonusXp ?? 0);
  if (bonus > 0 && a.kind !== "reflect") throw badRequest("Bonus XP is only available for Think & Respond reviews.");
  const table = a.kind === "reflect" ? "attempts" : "writing_attempts";
  await c.db.batch([
    c.db.stmt(`UPDATE ${table} SET reviewed_by = ?, review_note = ?, reviewed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`, s.teacherId, c.body.note ?? null, a.id),
    ...xpInsertStatements(c.db, a.student_id, bonus > 0 ? [{ delta: bonus, reason: "reflect_review_bonus", sourceKey: xpKey.reviewBonus(a.task_id) }] : []),
  ]);
  return { ok: true as const };
}

export async function regrade(c: Ctx<"regrade">) {
  const a = await loadAttempt(c);
  const r = await (a.kind === "reflect" ? gradeReflectAttempt(c.env, c.db, a.id, { log: c.log }) : gradeWritingAttempt(c.env, c.db, a.id, { log: c.log }));
  return { ok: true as const, status: r.outcome as GradingStatus, provider: r.provider };
}

/** Aggregate view of grading health. One round trip. */
export async function gradingStats(c: Ctx<"gradingStats">) {
  staff(c.session);
  const since = new Date(c.now.getTime() - c.query.days * 86_400_000).toISOString();
  const rows = await c.db.all<{ day: string; provider: string; outcome: "ai" | "fallback"; n: number; ms: number | null }>(
    `SELECT substr(created_at, 1, 10) AS day, provider, outcome, COUNT(*) AS n, SUM(latency_ms) AS ms FROM grading_runs WHERE created_at >= ? GROUP BY 1, 2, 3 ORDER BY 1`, since);
  let total = 0, fallback = 0, ms = 0;
  const byProvider = new Map<string, number>(), byDay = new Map<string, { total: number; fallback: number }>();
  for (const r of rows) {
    total += r.n; ms += r.ms ?? 0; if (r.outcome === "fallback") fallback += r.n;
    byProvider.set(r.provider, (byProvider.get(r.provider) ?? 0) + r.n);
    const d = byDay.get(r.day) ?? { total: 0, fallback: 0 };
    d.total += r.n; if (r.outcome === "fallback") d.fallback += r.n; byDay.set(r.day, d);
  }
  return {
    days: c.query.days, total, fallback, fallbackPercent: total === 0 ? 0 : Math.round((fallback / total) * 1000) / 10,
    byProvider: [...byProvider].map(([provider, count]) => ({ provider, count })).sort((a, b) => b.count - a.count),
    byDay: [...byDay].map(([day, v]) => ({ day, ...v })), avgLatencyMs: total === 0 ? null : Math.round(ms / total),
  };
}
