// Badge + "article published" bonus, decided by the shared isArticleComplete().
import { isArticleComplete, xpKey, XP_VALUES, type OpenAccess } from "@newsroom/shared";
import type { Db } from "../db";
import type { XpAward } from "./xp";

interface StageRow { type: "comprehension" | "vocabulary" | "reflect"; passed: number }

/** What this pupil has already done on one article. Two small round trips (single-article routes only). */
export async function loadStageState(db: Db, studentId: number, articleId: number) {
  const tasks = await db.all<StageRow & { task_id: number }>(
    `SELECT t.id AS task_id, t.type, COALESCE(tp.passed, 0) AS passed
     FROM tasks t LEFT JOIN task_progress tp ON tp.task_id = t.id AND tp.student_id = ?
     WHERE t.article_id = ?`, studentId, articleId);
  const w = await db.first<{ writing_task_id: number | null; completed: number | null; has_badge: number }>(
    `SELECT wt.id AS writing_task_id, wp.completed AS completed,
            EXISTS (SELECT 1 FROM badges b WHERE b.student_id = ?1 AND b.article_id = ?2) AS has_badge
     FROM (SELECT 1) x LEFT JOIN writing_tasks wt ON wt.article_id = ?2
     LEFT JOIN writing_progress wp ON wp.writing_task_id = wt.id AND wp.student_id = ?1`, studentId, articleId);
  return {
    tasks: tasks.map((t) => ({ taskId: t.task_id, type: t.type, passed: t.passed === 1 })),
    writing: w?.writing_task_id ? { writingTaskId: w.writing_task_id, completed: w.completed === 1 } : null,
    hasBadge: w?.has_badge === 1,
  };
}
export type StageState = Awaited<ReturnType<typeof loadStageState>>;

/** Apply "this stage was just passed" to the loaded state, then ask the one shared rule. */
export function completionAfter(
  access: OpenAccess, state: StageState,
  change: { task?: { taskId: number; passed: boolean }; writingCompleted?: boolean },
): { complete: boolean; newlyPublished: boolean } {
  const tasks = state.tasks.map((t) => (change.task && t.taskId === change.task.taskId ? { ...t, passed: t.passed || change.task.passed } : t));
  const writing = state.writing ? { completed: state.writing.completed || change.writingCompleted === true } : null;
  const complete = isArticleComplete({ questionTypes: access.questionTypes, tasks, writing });
  return { complete, newlyPublished: complete && !state.hasBadge };
}

export function badgeStatements(db: Db, studentId: number, articleId: number): { statements: D1PreparedStatement[]; award: XpAward } {
  return {
    statements: [db.stmt("INSERT OR IGNORE INTO badges (student_id, article_id) VALUES (?, ?)", studentId, articleId)],
    award: { delta: XP_VALUES.ARTICLE_PUBLISHED, reason: "article_published", sourceKey: xpKey.articlePublished(articleId) },
  };
}
