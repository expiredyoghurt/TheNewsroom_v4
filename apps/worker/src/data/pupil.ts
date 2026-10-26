import { parseAllowed, QUESTION_TYPES, STATIONS, parseLoop, resolveArticleAccess, type ArticleAccess, type AssignmentRules, type ClassRules, type LearningLoop, type PracticeMode } from "@newsroom/shared";
import type { Db } from "../db";
import { forbidden, notFound, unauthorized } from "../http";

export interface Pupil {
  id: number; firstName: string; lastName: string; classId: number; xpTotal: number;
  classRules: ClassRules; similarityThreshold: number | null; rankingsEnabled: boolean;
}

export function classRulesFrom(row: { practice_mode: string; enabled_stations: string; allowed_question_types: string }): ClassRules {
  return {
    practiceMode: (row.practice_mode === "assigned_only" ? "assigned_only" : "free") as PracticeMode,
    enabledStations: parseAllowed(row.enabled_stations, STATIONS, STATIONS),
    allowedQuestionTypes: parseAllowed(row.allowed_question_types, QUESTION_TYPES, QUESTION_TYPES),
  };
}

export interface AssignmentRow {
  asg_id: number | null; asg_active: number | null; asg_start: string | null; asg_due: string | null;
  asg_stations: string | null; asg_types: string | null; asg_attempts: number | null;
}
export const ASSIGNMENT_COLUMNS = `asg.id AS asg_id, asg.active AS asg_active, asg.start_at AS asg_start, asg.due_at AS asg_due,
  asg.required_stations AS asg_stations, asg.allowed_question_types AS asg_types, asg.attempts_allowed AS asg_attempts`;

export function assignmentRulesFrom(r: AssignmentRow): AssignmentRules | null {
  if (r.asg_id === null) return null;
  return {
    id: r.asg_id, active: r.asg_active === 1, startAt: r.asg_start, dueAt: r.asg_due,
    stations: parseAllowed(r.asg_stations, STATIONS, STATIONS),
    questionTypes: parseAllowed(r.asg_types, QUESTION_TYPES, QUESTION_TYPES),
    attemptsAllowed: r.asg_attempts,
  };
}

/** One round trip: the pupil plus their class rules. */
export async function loadPupil(db: Db, studentId: number): Promise<Pupil> {
  const r = await db.first<{
    id: number; first_name: string; last_name: string; class_id: number; xp_total: number; archived: number;
    practice_mode: string; enabled_stations: string; allowed_question_types: string; similarity_threshold: number | null; rankings_enabled: number;
  }>(
    `SELECT s.id, s.first_name, s.last_name, s.class_id, s.xp_total, s.archived, c.practice_mode, c.enabled_stations,
            c.allowed_question_types, c.similarity_threshold, c.rankings_enabled
     FROM students s JOIN classes c ON c.id = s.class_id WHERE s.id = ?`, studentId);
  if (!r || r.archived === 1) throw unauthorized();
  return {
    id: r.id, firstName: r.first_name, lastName: r.last_name, classId: r.class_id, xpTotal: r.xp_total,
    classRules: classRulesFrom(r), similarityThreshold: r.similarity_threshold, rankingsEnabled: r.rankings_enabled === 1,
  };
}

export interface ArticleCtx {
  articleId: number; title: string; sourceName: string; publishDate: string; section: string | null;
  fullText: string; textChunks: { chunk_id: string; text: string }[]; hasImage: boolean; articleLoop: LearningLoop; access: ArticleAccess;
}

/** The ONE place a single-article request turns (article, class, assignment) into a decision. */
export async function loadArticleContext(db: Db, pupil: Pupil, articleId: number, now: Date): Promise<ArticleCtx> {
  const r = await db.first<AssignmentRow & {
    id: number; title: string; source_name: string; publish_date: string; section: string | null; full_text: string;
    text_chunks: string; learning_loop: string; image_key: string | null;
  }>(
    `SELECT a.id, a.title, a.source_name, a.publish_date, a.section, a.full_text, a.text_chunks, a.learning_loop, a.image_key, ${ASSIGNMENT_COLUMNS}
     FROM articles a LEFT JOIN assignments asg ON asg.article_id = a.id AND asg.class_id = ?
     WHERE a.id = ? AND a.status = 'active'`, pupil.classId, articleId);
  if (!r) throw notFound("Article not found.");
  const articleLoop = parseLoop(r.learning_loop);
  const access = resolveArticleAccess({ articleLoop, classRules: pupil.classRules, assignment: assignmentRulesFrom(r), now });
  return {
    articleId: r.id, title: r.title, sourceName: r.source_name, publishDate: r.publish_date, section: r.section,
    fullText: r.full_text, textChunks: JSON.parse(r.text_chunks), hasImage: r.image_key !== null, articleLoop, access,
  };
}

export function assertAllowed(check: { ok: true } | { ok: false; message: string }): void {
  if (!check.ok) throw forbidden(check.message);
}
