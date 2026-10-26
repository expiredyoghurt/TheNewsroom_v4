// Pupil-facing read routes. LIST endpoints (hub, rankings, goat, wall) fetch related data in a
// FIXED number of round trips regardless of how many rows exist (tests enforce this).
import {
  levelForXp, parseLoop, resolveArticleAccess, blockMessage, isArticleComplete, parentDisplayName,
  type HubArticle, type HubTask, type RankingEntry, type GoatEntry, type ParentRosterEntry,
} from "@newsroom/shared";
import type { Ctx } from "../router";
import { ASSIGNMENT_COLUMNS, assignmentRulesFrom, loadArticleContext, loadPupil, type AssignmentRow, assertAllowed } from "../data/pupil";
import { checkStation } from "@newsroom/shared";
import { forbidden, notFound } from "../http";

export async function pupilProfile(c: Ctx<"pupilProfile">) {
  const p = await loadPupil(c.db, (c.session as { studentId: number }).studentId);
  const lv = levelForXp(p.xpTotal);
  return { firstName: p.firstName, xp: p.xpTotal, level: lv.level, title: lv.title, nextLevelAt: lv.nextThreshold };
}

export async function hub(c: Ctx<"hub">) {
  const pupil = await loadPupil(c.db, (c.session as { studentId: number }).studentId); // 1
  const articles = await c.db.all<AssignmentRow & { id: number; title: string; section: string | null; publish_date: string; has_thumb: number; learning_loop: string }>( // 2
    `SELECT a.id, a.title, a.section, a.publish_date, (a.thumbnail_key IS NOT NULL) AS has_thumb, a.learning_loop, ${ASSIGNMENT_COLUMNS}
     FROM articles a LEFT JOIN assignments asg ON asg.article_id = a.id AND asg.class_id = ?
     WHERE a.status = 'active' ORDER BY a.publish_date DESC, a.id DESC`, pupil.classId);
  const tasks = await c.db.all<{ article_id: number; task_id: number; type: "comprehension" | "vocabulary" | "reflect"; passed: number; attempts: number }>( // 3
    `SELECT t.article_id, t.id AS task_id, t.type, COALESCE(tp.passed, 0) AS passed, COALESCE(tp.attempts_count, 0) AS attempts
     FROM tasks t JOIN articles a ON a.id = t.article_id AND a.status = 'active'
     LEFT JOIN task_progress tp ON tp.task_id = t.id AND tp.student_id = ?`, pupil.id);
  const writing = await c.db.all<{ article_id: number; wt_id: number; completed: number; attempts: number }>( // 4
    `SELECT wt.article_id, wt.id AS wt_id, COALESCE(wp.completed, 0) AS completed, COALESCE(wp.attempts_count, 0) AS attempts
     FROM writing_tasks wt JOIN articles a ON a.id = wt.article_id AND a.status = 'active'
     LEFT JOIN writing_progress wp ON wp.writing_task_id = wt.id AND wp.student_id = ?`, pupil.id);

  const tasksBy = new Map<number, typeof tasks>();
  for (const t of tasks) (tasksBy.get(t.article_id) ?? tasksBy.set(t.article_id, []).get(t.article_id)!).push(t);
  const writingBy = new Map(writing.map((w) => [w.article_id, w]));

  const out: HubArticle[] = [];
  for (const a of articles) {
    const loop = parseLoop(a.learning_loop);
    const access = resolveArticleAccess({ articleLoop: loop, classRules: pupil.classRules, assignment: assignmentRulesFrom(a), now: c.now });
    if (access.status === "blocked" && access.reason === "not_assigned") continue; // nothing to show or lock
    const mine = tasksBy.get(a.id) ?? [];
    const w = writingBy.get(a.id);
    const taskViews: HubArticle["tasks"] = {};
    for (const t of mine) taskViews[t.type] = { taskId: t.task_id, passed: t.passed === 1, attemptsCount: t.attempts } satisfies HubTask;
    const writingView: HubTask | undefined = w ? { taskId: w.wt_id, passed: w.completed === 1, attemptsCount: w.attempts } : undefined;
    const open = access.status === "open";
    out.push({
      articleId: a.id, title: a.title, section: a.section, publishDate: a.publish_date, hasThumbnail: a.has_thumb === 1,
      published: open && isArticleComplete({
        questionTypes: access.questionTypes,
        tasks: mine.map((t) => ({ type: t.type, passed: t.passed === 1 })),
        writing: w ? { completed: w.completed === 1 } : null,
      }),
      locked: open ? null : { reason: access.reason, message: blockMessage(access.reason), startAt: access.startAt, dueAt: access.dueAt },
      tasks: open ? taskViews : {}, writing: open ? writingView : undefined,
      access: open ? { assignmentId: access.assignmentId, stations: access.stations, questionTypes: access.questionTypes, attemptsAllowed: access.attemptsAllowed, learningLoop: access.loop } : null,
      learningLoop: loop,
    });
  }
  return { articles: out };
}

export async function wall(c: Ctx<"wall">) {
  const id = (c.session as { studentId: number }).studentId;
  const rows = await c.db.all<{ article_id: number; title: string; has_thumb: number; awarded_at: string }>(
    `SELECT b.article_id, a.title, (a.thumbnail_key IS NOT NULL) AS has_thumb, b.awarded_at
     FROM badges b JOIN articles a ON a.id = b.article_id WHERE b.student_id = ? ORDER BY b.awarded_at DESC`, id);
  return { badges: rows.map((r) => ({ articleId: r.article_id, title: r.title, hasThumbnail: r.has_thumb === 1, awardedAt: r.awarded_at })) };
}

export async function readArticle(c: Ctx<"readArticle">) {
  const pupil = await loadPupil(c.db, (c.session as { studentId: number }).studentId);
  const a = await loadArticleContext(c.db, pupil, Number(c.params.articleId), c.now);
  assertAllowed(checkStation(a.access, "newsstand"));
  return { id: a.articleId, title: a.title, sourceName: a.sourceName, publishDate: a.publishDate, section: a.section, fullText: a.fullText, textChunks: a.textChunks, hasImage: a.hasImage };
}

// ---- rankings: ONE query each, aggregates computed in SQL ----
const ROSTER_SQL = `
  SELECT s.id, s.index_number, s.first_name, s.last_name, s.xp_total,
    (SELECT COUNT(*) FROM task_progress tp WHERE tp.student_id = s.id AND tp.passed = 1)
      + (SELECT COUNT(*) FROM writing_progress wp WHERE wp.student_id = s.id AND wp.completed = 1) AS tasks_completed,
    (SELECT COUNT(*) FROM badges b WHERE b.student_id = s.id) AS badges,
    (SELECT COALESCE(SUM(MAX(tp.attempts_count - 1, 0)), 0) FROM task_progress tp WHERE tp.student_id = s.id)
      + (SELECT COALESCE(SUM(MAX(wp.attempts_count - 1, 0)), 0) FROM writing_progress wp WHERE wp.student_id = s.id) AS retries
  FROM students s WHERE s.class_id = ? AND s.archived = 0 ORDER BY s.index_number`;
interface RosterAgg { id: number; index_number: number; first_name: string; last_name: string; xp_total: number; tasks_completed: number; badges: number; retries: number }

export async function rankings(c: Ctx<"rankings">) {
  const pupil = await loadPupil(c.db, (c.session as { studentId: number }).studentId);
  const rows = await c.db.all<RosterAgg>(ROSTER_SQL, pupil.classId);
  const roster: RankingEntry[] = rows.map((r) => ({
    studentId: r.id, isYou: r.id === pupil.id, indexNumber: r.index_number, firstName: r.first_name, lastName: r.last_name,
    // XP/level only appear when the class enables rankings (always visible for yourself).
    xp: pupil.rankingsEnabled || r.id === pupil.id ? r.xp_total : null,
    level: pupil.rankingsEnabled || r.id === pupil.id ? levelForXp(r.xp_total).level : null,
    tasksCompleted: r.tasks_completed, badgesCount: r.badges, retries: r.retries,
  }));
  return { rankingsEnabled: pupil.rankingsEnabled, roster };
}

export async function goat(c: Ctx<"goat">) {
  const id = (c.session as { studentId: number }).studentId;
  const rows = await c.db.all<{ id: number; first_name: string; last_name: string; xp_total: number; badges: number }>(
    `SELECT s.id, s.first_name, s.last_name, s.xp_total, (SELECT COUNT(*) FROM badges b WHERE b.student_id = s.id) AS badges
     FROM students s WHERE s.archived = 0 AND s.xp_total > 0 ORDER BY s.xp_total DESC, s.id LIMIT 10`);
  const goat: GoatEntry[] = rows.map((r) => ({ studentId: r.id, isYou: r.id === id, firstName: r.first_name, lastName: r.last_name, xp: r.xp_total, level: levelForXp(r.xp_total).level, badgesCount: r.badges }));
  return { goat };
}

export async function parentClass(c: Ctx<"parentClass">) {
  const classId = (c.session as { classId: number }).classId;
  const cls = await c.db.first<{ rankings_enabled: number }>("SELECT rankings_enabled FROM classes WHERE id = ?", classId);
  if (!cls) throw notFound();
  const rows = await c.db.all<RosterAgg>(ROSTER_SQL, classId);
  const roster: ParentRosterEntry[] = rows.map((r) => ({
    displayName: parentDisplayName(r.first_name, r.last_name),
    xp: cls.rankings_enabled === 1 ? r.xp_total : null, level: cls.rankings_enabled === 1 ? levelForXp(r.xp_total).level : null,
    tasksCompleted: r.tasks_completed, badgesCount: r.badges, retries: r.retries,
  }));
  return { rankingsEnabled: cls.rankings_enabled === 1, roster };
}

// ---- images: served through the Worker so access control applies; cached by content hash ----
async function serveMedia(c: Ctx<"thumbnail"> | Ctx<"articleImage">, column: "thumbnail_key" | "image_key"): Promise<Response> {
  const articleId = Number(c.params.articleId);
  const row = await c.db.first<{ key: string | null; status: string }>(`SELECT ${column} AS key, status FROM articles WHERE id = ?`, articleId);
  if (!row?.key) throw notFound();
  if (c.session?.kind === "pupil" && row.status !== "active") throw forbidden();
  const obj = await c.env.MEDIA.get(row.key);
  if (!obj) throw notFound();
  return new Response(obj.body, { headers: { "content-type": obj.httpMetadata?.contentType ?? "image/jpeg", "cache-control": "private, max-age=31536000, immutable", etag: obj.httpEtag } });
}
export const thumbnail = (c: Ctx<"thumbnail">) => serveMedia(c, "thumbnail_key");
export const articleImage = (c: Ctx<"articleImage">) => serveMedia(c, "image_key");
