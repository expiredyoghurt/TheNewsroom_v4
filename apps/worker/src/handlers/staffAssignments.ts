import {
  isArticleComplete, levelForXp, parseAllowed, parseLoop, QUESTION_TYPES, resolveArticleAccess, STATIONS, toIsoOrNull, type AssignmentRules, type ClassRules,
} from "@newsroom/shared";
import type { Ctx } from "../router";
import { classScope, requireClass, staff } from "../data/tenancy";
import { badRequest, conflict, forbidden, notFound } from "../http";

export async function listAssignments(c: Ctx<"listAssignments">) {
  const s = staff(c.session);
  const sc = classScope(s);
  const filter = c.query.classId !== undefined ? " AND a.class_id = ?" : "";
  const rows = await c.db.all<{
    id: number; article_id: number; class_id: number; class_name: string; title: string; article_status: "draft" | "active" | "archived";
    a_title: string | null; start_at: string | null; due_at: string | null; stations: string; types: string; attempts: number | null; active: number;
  }>(
    `SELECT a.id, a.article_id, a.class_id, c.name AS class_name, ar.title, ar.status AS article_status, a.title AS a_title, a.start_at, a.due_at,
            a.required_stations AS stations, a.allowed_question_types AS types, a.attempts_allowed AS attempts, a.active
     FROM assignments a JOIN classes c ON c.id = a.class_id JOIN articles ar ON ar.id = a.article_id
     WHERE ${sc.sql}${filter} ORDER BY a.due_at IS NULL, a.due_at, a.id DESC`, ...sc.binds, ...(c.query.classId !== undefined ? [c.query.classId] : []));
  return {
    assignments: rows.map((r) => ({
      assignmentId: r.id, articleId: r.article_id, classId: r.class_id, className: r.class_name, articleTitle: r.title, articleStatus: r.article_status,
      title: r.a_title, startAt: r.start_at, dueAt: r.due_at, stations: parseAllowed(r.stations, STATIONS, STATIONS),
      questionTypes: parseAllowed(r.types, QUESTION_TYPES, QUESTION_TYPES), attemptsAllowed: r.attempts, active: r.active === 1,
    })),
  };
}

function window(startAt: string | null | undefined, dueAt: string | null | undefined) {
  const start = toIsoOrNull(startAt), due = toIsoOrNull(dueAt);
  if (start && due && start > due) throw badRequest("The start date must be before the due date.");
  return { start, due };
}

export async function createAssignment(c: Ctx<"createAssignment">) {
  const s = staff(c.session);
  const cls = await requireClass(c.db, s, c.body.classId);
  const article = await c.db.first<{ status: string; learning_loop: string }>("SELECT status, learning_loop FROM articles WHERE id = ?", c.body.articleId);
  if (!article) throw notFound("Article not found.");
  if (article.status !== "active") throw badRequest("Only published articles can be assigned.");
  const { start, due } = window(c.body.startAt, c.body.dueAt);
  const stations = c.body.requiredStations ?? parseAllowed(cls.enabled_stations, STATIONS, STATIONS);
  const types = c.body.allowedQuestionTypes ?? parseAllowed(cls.allowed_question_types, QUESTION_TYPES, QUESTION_TYPES);
  // The assignment must leave at least one thing to do once the article's own loop is applied.
  const eff = resolveArticleAccess({
    articleLoop: parseLoop(article.learning_loop),
    classRules: { practiceMode: "free", enabledStations: stations, allowedQuestionTypes: types },
    assignment: null, now: c.now,
  });
  if (eff.status === "open" && eff.questionTypes.length === 0) throw badRequest("None of the chosen task types are enabled on this article.");
  try {
    const r = await c.db.run(
      `INSERT INTO assignments (class_id, article_id, title, start_at, due_at, required_stations, allowed_question_types, attempts_allowed, created_by) VALUES (?,?,?,?,?,?,?,?,?)`,
      c.body.classId, c.body.articleId, c.body.title ?? null, start, due, JSON.stringify(stations), JSON.stringify(types), c.body.attemptsAllowed ?? null, s.teacherId);
    return { id: r.meta.last_row_id as number };
  } catch (e) {
    if (e instanceof Error && /UNIQUE/i.test(e.message)) throw conflict("This class already has an assignment for that article.");
    throw e;
  }
}

async function ownedAssignment(c: Ctx<"updateAssignment"> | Ctx<"deleteAssignment">) {
  const s = staff(c.session);
  const a = await c.db.first<{ id: number; class_id: number; start_at: string | null; due_at: string | null }>("SELECT id, class_id, start_at, due_at FROM assignments WHERE id = ?", Number(c.params.assignmentId));
  if (!a) throw notFound("Assignment not found.");
  await requireClass(c.db, s, a.class_id);
  return a;
}

export async function updateAssignment(c: Ctx<"updateAssignment">) {
  const a = await ownedAssignment(c);
  const b = c.body;
  const sets: string[] = [], binds: unknown[] = [];
  if (b.startAt !== undefined || b.dueAt !== undefined) {
    const { start, due } = window(b.startAt !== undefined ? b.startAt : a.start_at, b.dueAt !== undefined ? b.dueAt : a.due_at);
    sets.push("start_at = ?", "due_at = ?"); binds.push(start, due);
  }
  if (b.title !== undefined) { sets.push("title = ?"); binds.push(b.title ?? null); }
  if (b.requiredStations) { sets.push("required_stations = ?"); binds.push(JSON.stringify(parseAllowed(b.requiredStations, STATIONS, STATIONS))); }
  if (b.allowedQuestionTypes) { sets.push("allowed_question_types = ?"); binds.push(JSON.stringify(parseAllowed(b.allowedQuestionTypes, QUESTION_TYPES, QUESTION_TYPES))); }
  if (b.attemptsAllowed !== undefined) { sets.push("attempts_allowed = ?"); binds.push(b.attemptsAllowed ?? null); }
  if (b.active !== undefined) { sets.push("active = ?"); binds.push(b.active ? 1 : 0); }
  if (sets.length === 0) throw badRequest("Nothing to change.");
  await c.db.run(`UPDATE assignments SET ${sets.join(", ")} WHERE id = ?`, ...binds, a.id);
  return { ok: true as const };
}

export async function deleteAssignment(c: Ctx<"deleteAssignment">) {
  const a = await ownedAssignment(c);
  await c.db.run("DELETE FROM assignments WHERE id = ?", a.id);
  return { ok: true as const };
}

/** Class progress grid: 5 round trips for any class size. Completion uses the SAME shared rule as the pupil hub. */
export async function progress(c: Ctx<"progress">) {
  const cls = await requireClass(c.db, staff(c.session), c.query.classId);
  const classId = c.query.classId;
  const students = await c.db.all<{ id: number; first_name: string; last_name: string; index_number: number; xp_total: number }>(
    "SELECT id, first_name, last_name, index_number, xp_total FROM students WHERE class_id = ? AND archived = 0 ORDER BY index_number", classId);
  const asgs = await c.db.all<{ id: number; article_id: number; title: string; due_at: string | null; stations: string; types: string; attempts: number | null; loop: string }>(
    `SELECT a.id, a.article_id, COALESCE(a.title, ar.title) AS title, a.due_at, a.required_stations AS stations, a.allowed_question_types AS types, a.attempts_allowed AS attempts, ar.learning_loop AS loop
     FROM assignments a JOIN articles ar ON ar.id = a.article_id WHERE a.class_id = ? AND a.active = 1 ORDER BY a.due_at IS NULL, a.due_at, a.id`, classId);
  const taskRows = await c.db.all<{ student_id: number; article_id: number; type: "comprehension" | "vocabulary" | "reflect"; passed: number }>(
    `SELECT s.id AS student_id, t.article_id, t.type, COALESCE(tp.passed, 0) AS passed
     FROM students s JOIN assignments a ON a.class_id = s.class_id AND a.active = 1 JOIN tasks t ON t.article_id = a.article_id
     LEFT JOIN task_progress tp ON tp.student_id = s.id AND tp.task_id = t.id WHERE s.class_id = ? AND s.archived = 0`, classId);
  const writingRows = await c.db.all<{ student_id: number; article_id: number; completed: number }>(
    `SELECT s.id AS student_id, wt.article_id, COALESCE(wp.completed, 0) AS completed
     FROM students s JOIN assignments a ON a.class_id = s.class_id AND a.active = 1 JOIN writing_tasks wt ON wt.article_id = a.article_id
     LEFT JOIN writing_progress wp ON wp.writing_task_id = wt.id AND wp.student_id = s.id WHERE s.class_id = ? AND s.archived = 0`, classId);

  const key = (st: number, ar: number) => `${st}:${ar}`;
  const tBy = new Map<string, typeof taskRows>(), wBy = new Map<string, number>();
  for (const t of taskRows) (tBy.get(key(t.student_id, t.article_id)) ?? tBy.set(key(t.student_id, t.article_id), []).get(key(t.student_id, t.article_id))!).push(t);
  for (const w of writingRows) wBy.set(key(w.student_id, w.article_id), w.completed);

  const cells: { studentId: number; assignmentId: number; articleId: number; complete: boolean; tasksPassed: number; tasksTotal: number; writingDone: boolean }[] = [];
  for (const a of asgs) {
    // Evaluate the assignment's own rules as if it were in force (window ignored: we are reporting, not gating).
    const rules: AssignmentRules = { id: a.id, active: true, startAt: null, dueAt: null, stations: parseAllowed(a.stations, STATIONS, STATIONS), questionTypes: parseAllowed(a.types, QUESTION_TYPES, QUESTION_TYPES), attemptsAllowed: a.attempts };
    const classRules: ClassRules = { practiceMode: "free", enabledStations: STATIONS, allowedQuestionTypes: QUESTION_TYPES };
    const access = resolveArticleAccess({ articleLoop: parseLoop(a.loop), classRules, assignment: rules, now: c.now });
    const types = access.status === "open" ? access.questionTypes : [];
    for (const st of students) {
      const mine = tBy.get(key(st.id, a.article_id)) ?? [];
      const w = wBy.get(key(st.id, a.article_id));
      const enabledTasks = mine.filter((t) => types.includes(t.type));
      cells.push({
        studentId: st.id, assignmentId: a.id, articleId: a.article_id,
        complete: isArticleComplete({ questionTypes: types, tasks: mine.map((t) => ({ type: t.type, passed: t.passed === 1 })), writing: w === undefined ? null : { completed: w === 1 } }),
        tasksPassed: enabledTasks.filter((t) => t.passed === 1).length, tasksTotal: enabledTasks.length, writingDone: w === 1,
      });
    }
  }
  void cls;
  return {
    students: students.map((s) => ({ id: s.id, firstName: s.first_name, lastName: s.last_name, indexNumber: s.index_number, xp: s.xp_total, level: levelForXp(s.xp_total).level })),
    cells, assignments: asgs.map((a) => ({ assignmentId: a.id, articleId: a.article_id, title: a.title, dueAt: a.due_at })),
  };
}
void forbidden;
