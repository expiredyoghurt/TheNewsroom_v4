// XP writes. Two statements that are ALWAYS issued together in a batch:
//   1. INSERT OR IGNORE into xp_log (idempotent on (student, source_key))
//   2. RECOMPUTE students.xp_total from the log (never "+= delta")
// so a retry, a double-click or a crash can never drift the total away from the log.
import type { Db } from "../db";

export interface XpAward { delta: number; reason: string; sourceKey: string }

export function xpInsertStatements(db: Db, studentId: number, awards: readonly XpAward[]): D1PreparedStatement[] {
  const live = awards.filter((a) => a.delta > 0);
  if (live.length === 0) return [];
  return [
    ...live.map((a) => db.stmt("INSERT OR IGNORE INTO xp_log (student_id, delta, reason, source_key) VALUES (?, ?, ?, ?)", studentId, a.delta, a.reason, a.sourceKey)),
    db.stmt("UPDATE students SET xp_total = (SELECT COALESCE(SUM(delta), 0) FROM xp_log WHERE student_id = ?1) WHERE id = ?1", studentId),
  ];
}
