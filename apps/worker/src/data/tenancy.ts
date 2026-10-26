// Who may touch which class. Admins: every class. Teachers: only classes where they are the teacher.
import type { Session } from "../auth/sessions";
import type { Db } from "../db";
import { forbidden, notFound } from "../http";

export type StaffSession = Extract<Session, { kind: "teacher" }>;
export const staff = (s: Session | null): StaffSession => {
  if (!s || s.kind !== "teacher") throw forbidden();
  return s;
};

/** SQL fragment + binds restricting a query to the classes this staff member may see. `alias` is the classes alias. */
export function classScope(s: StaffSession, alias = "c"): { sql: string; binds: unknown[] } {
  return s.role === "admin" ? { sql: "1 = 1", binds: [] } : { sql: `${alias}.teacher_id = ?`, binds: [s.teacherId] };
}

export async function requireClass(db: Db, s: StaffSession, classId: number) {
  const row = await db.first<{ id: number; name: string; teacher_id: number | null; practice_mode: string; enabled_stations: string; allowed_question_types: string; rankings_enabled: number }>(
    "SELECT id, name, teacher_id, practice_mode, enabled_stations, allowed_question_types, rankings_enabled FROM classes WHERE id = ?", classId);
  if (!row) throw notFound("Class not found.");
  if (s.role !== "admin" && row.teacher_id !== s.teacherId) throw forbidden("That is not your class.");
  return row;
}

/** Resolve a student's class and authorise in one query. */
export async function requireStudent(db: Db, s: StaffSession, studentId: number) {
  const row = await db.first<{ id: number; class_id: number; teacher_id: number | null }>(
    "SELECT s.id, s.class_id, c.teacher_id FROM students s JOIN classes c ON c.id = s.class_id WHERE s.id = ?", studentId);
  if (!row) throw notFound("Pupil not found.");
  if (s.role !== "admin" && row.teacher_id !== s.teacherId) throw forbidden("That is not your class.");
  return row;
}
