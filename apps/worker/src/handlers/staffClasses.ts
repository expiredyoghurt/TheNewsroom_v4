import { levelForXp, parseAllowed, QUESTION_TYPES, STATIONS } from "@newsroom/shared";
import type { Ctx } from "../router";
import { hashPassword } from "../auth/password";
import { classScope, requireClass, requireStudent, staff } from "../data/tenancy";
import { badRequest, conflict, forbidden } from "../http";
import { planRosterImport } from "../rosterPlan";

export async function dashboard(c: Ctx<"dashboard">) {
  const s = staff(c.session);
  const sc = classScope(s);
  const classes = await c.db.all<{ id: number; name: string; pupils: number; assignments: number }>(
    `SELECT c.id, c.name, (SELECT COUNT(*) FROM students st WHERE st.class_id = c.id AND st.archived = 0) AS pupils,
            (SELECT COUNT(*) FROM assignments a WHERE a.class_id = c.id AND a.active = 1) AS assignments
     FROM classes c WHERE ${sc.sql} ORDER BY c.name`, ...sc.binds);
  const art = await c.db.first<{ total: number; active: number; drafts: number }>(
    `SELECT COUNT(*) AS total, COALESCE(SUM(status = 'active'), 0) AS active, COALESCE(SUM(status = 'draft'), 0) AS drafts FROM articles WHERE status != 'archived'`);
  const flagged = await c.db.first<{ n: number }>(
    `SELECT (SELECT COUNT(*) FROM attempts at JOIN students st ON st.id = at.student_id JOIN classes c ON c.id = st.class_id
              WHERE ${sc.sql} AND at.reviewed_at IS NULL AND (at.similarity_flag = 1 OR at.grading_status = 'fallback'))
          + (SELECT COUNT(*) FROM writing_attempts wa JOIN students st ON st.id = wa.student_id JOIN classes c ON c.id = st.class_id
              WHERE ${sc.sql} AND wa.reviewed_at IS NULL AND (wa.similarity_flag = 1 OR wa.grading_status = 'fallback')) AS n`, ...sc.binds, ...sc.binds);
  return { classes, articles: { total: art?.total ?? 0, active: art?.active ?? 0, drafts: art?.drafts ?? 0 }, flaggedReviews: flagged?.n ?? 0 };
}

export async function classes(c: Ctx<"classes">) {
  const sc = classScope(staff(c.session));
  const rows = await c.db.all<{
    id: number; name: string; teacher_id: number | null; rankings_enabled: number; similarity_threshold: number | null; practice_mode: "free" | "assigned_only";
    enabled_stations: string; allowed_question_types: string; has_parent: number; pupils: number; assignments: number;
  }>(
    `SELECT c.id, c.name, c.teacher_id, c.rankings_enabled, c.similarity_threshold, c.practice_mode, c.enabled_stations, c.allowed_question_types,
            (c.parent_password_hash IS NOT NULL) AS has_parent,
            (SELECT COUNT(*) FROM students st WHERE st.class_id = c.id AND st.archived = 0) AS pupils,
            (SELECT COUNT(*) FROM assignments a WHERE a.class_id = c.id) AS assignments
     FROM classes c WHERE ${sc.sql} ORDER BY c.name`, ...sc.binds);
  return {
    classes: rows.map((r) => ({
      id: r.id, name: r.name, teacherId: r.teacher_id, rankingsEnabled: r.rankings_enabled === 1, similarityThreshold: r.similarity_threshold,
      practiceMode: r.practice_mode, enabledStations: parseAllowed(r.enabled_stations, STATIONS, STATIONS),
      allowedQuestionTypes: parseAllowed(r.allowed_question_types, QUESTION_TYPES, QUESTION_TYPES),
      hasParentPassword: r.has_parent === 1, pupils: r.pupils, assignments: r.assignments,
    })),
  };
}

export async function createClass(c: Ctx<"createClass">) {
  const s = staff(c.session);
  if (c.body.teacherId !== undefined && s.role !== "admin") throw forbidden("Only an admin can create a class for another teacher.");
  try {
    const r = await c.db.run("INSERT INTO classes (name, teacher_id) VALUES (?, ?)", c.body.name, c.body.teacherId ?? s.teacherId);
    return { id: r.meta.last_row_id as number };
  } catch (e) {
    if (e instanceof Error && /UNIQUE/i.test(e.message)) throw conflict("A class with that name already exists.");
    throw e;
  }
}

export async function updateClassSettings(c: Ctx<"updateClassSettings">) {
  const s = staff(c.session);
  await requireClass(c.db, s, Number(c.params.classId));
  const b = c.body;
  const sets: string[] = [], binds: unknown[] = [];
  if (b.rankingsEnabled !== undefined) { sets.push("rankings_enabled = ?"); binds.push(b.rankingsEnabled ? 1 : 0); }
  if (b.similarityThreshold !== undefined) { sets.push("similarity_threshold = ?"); binds.push(b.similarityThreshold); }
  if (b.practiceMode !== undefined) { sets.push("practice_mode = ?"); binds.push(b.practiceMode); }
  if (b.enabledStations !== undefined) { sets.push("enabled_stations = ?"); binds.push(JSON.stringify(parseAllowed(b.enabledStations, STATIONS, STATIONS))); }
  if (b.allowedQuestionTypes !== undefined) { sets.push("allowed_question_types = ?"); binds.push(JSON.stringify(parseAllowed(b.allowedQuestionTypes, QUESTION_TYPES, QUESTION_TYPES))); }
  if (b.parentPassword !== undefined) { sets.push("parent_password_hash = ?"); binds.push(b.parentPassword === null ? null : await hashPassword(b.parentPassword)); }
  if (sets.length === 0) throw badRequest("Nothing to change.");
  await c.db.run(`UPDATE classes SET ${sets.join(", ")} WHERE id = ?`, ...binds, Number(c.params.classId));
  return { ok: true as const };
}

export async function roster(c: Ctx<"roster">) {
  await requireClass(c.db, staff(c.session), c.query.classId);
  const rows = await c.db.all<{ id: number; reporter_id: string; first_name: string; last_name: string; index_number: number; xp_total: number; archived: number }>(
    "SELECT id, reporter_id, first_name, last_name, index_number, xp_total, archived FROM students WHERE class_id = ? ORDER BY archived, index_number", c.query.classId);
  return { students: rows.map((r) => ({ id: r.id, reporterId: r.reporter_id, firstName: r.first_name, lastName: r.last_name, indexNumber: r.index_number, xp: r.xp_total, level: levelForXp(r.xp_total).level, archived: r.archived === 1 })) };
}

export async function addPupil(c: Ctx<"addPupil">) {
  await requireClass(c.db, staff(c.session), c.body.classId);
  const b = c.body;
  try {
    const r = await c.db.run(
      "INSERT INTO students (reporter_id, password_hash, first_name, last_name, index_number, class_id) VALUES (?, ?, ?, ?, ?, ?)",
      b.reporterId.trim().toLowerCase(), await hashPassword(b.pressPass), b.firstName, b.lastName, b.indexNumber, b.classId);
    return { id: r.meta.last_row_id as number };
  } catch (e) {
    if (e instanceof Error && /UNIQUE/i.test(e.message)) throw conflict("That reporter ID or index number is already in use.");
    throw e;
  }
}

/** O(1) round trips for any roster size: 2 reads + 1 atomic batch (hashing runs in parallel, not as queries). */
export async function importRoster(c: Ctx<"importRoster">) {
  await requireClass(c.db, staff(c.session), c.body.classId);
  const wanted = JSON.stringify(c.body.rows.map((r) => r.reporterId.trim().toLowerCase()));
  const existing = await c.db.all<{ reporter_id: string }>("SELECT reporter_id FROM students WHERE reporter_id IN (SELECT value FROM json_each(?))", wanted);
  const taken = await c.db.all<{ index_number: number }>("SELECT index_number FROM students WHERE class_id = ? AND archived = 0", c.body.classId);
  const plan = planRosterImport(c.body.rows, new Set(existing.map((r) => r.reporter_id.toLowerCase())), new Set(taken.map((r) => r.index_number)));
  const hashes = await Promise.all(plan.toCreate.map((r) => hashPassword(r.pressPass)));
  await c.db.batch(plan.toCreate.map((r, i) =>
    c.db.stmt("INSERT INTO students (reporter_id, password_hash, first_name, last_name, index_number, class_id) VALUES (?, ?, ?, ?, ?, ?)", r.reporterId, hashes[i], r.firstName, r.lastName, r.indexNumber, c.body.classId)));
  return { createdCount: plan.toCreate.length, created: plan.toCreate.map((r) => r.reporterId), skipped: plan.skipped };
}

export async function removePupil(c: Ctx<"removePupil">) {
  await requireStudent(c.db, staff(c.session), c.body.studentId);
  // Archive, never delete: attempts, XP and badges stay attached for the record.
  await c.db.run("UPDATE students SET archived = 1 WHERE id = ?", c.body.studentId);
  return { ok: true as const };
}

export async function resetPupilPassword(c: Ctx<"resetPupilPassword">) {
  await requireStudent(c.db, staff(c.session), c.body.studentId);
  await c.db.batch([
    c.db.stmt("UPDATE students SET password_hash = ? WHERE id = ?", await hashPassword(c.body.newPressPass), c.body.studentId),
    c.db.stmt("DELETE FROM login_failures WHERE key = (SELECT 'pupil:' || lower(reporter_id) FROM students WHERE id = ?)", c.body.studentId),
  ]);
  return { ok: true as const };
}

export async function changePupilClass(c: Ctx<"changePupilClass">) {
  const s = staff(c.session);
  await requireStudent(c.db, s, c.body.studentId);
  await requireClass(c.db, s, c.body.newClassId);
  try {
    // The pupil takes the next free index number in the new class.
    await c.db.run(
      `UPDATE students SET class_id = ?1, index_number = (SELECT COALESCE(MAX(index_number), 0) + 1 FROM students WHERE class_id = ?1 AND archived = 0) WHERE id = ?2`,
      c.body.newClassId, c.body.studentId);
  } catch (e) {
    if (e instanceof Error && /UNIQUE/i.test(e.message)) throw conflict("Could not allocate an index number. Please try again.");
    throw e;
  }
  return { ok: true as const };
}
