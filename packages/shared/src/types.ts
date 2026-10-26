// Response shapes. The worker's handlers are typed against these; the web app's client returns these.
import type { LearningLoop, QuestionType, Station } from "./domain/loop";
import type { PracticeMode, BlockReason } from "./domain/access";

export type StaffRole = "teacher" | "admin";
export type SessionKind = "pupil" | "teacher" | "parent";
export type ArticleStatus = "draft" | "active" | "archived";
export type GradingStatus = "not_applicable" | "pending" | "ai" | "fallback";
export type AttemptKind = "reflect" | "writing";

export interface Ok { ok: true }
export interface PupilSummary { id: number; firstName: string; lastName: string; xp: number; level: number }
export interface LoginPupilRes { token: string; student: PupilSummary }
export interface LoginTeacherRes { token: string; role: StaffRole }
export interface LoginParentRes { token: string }
export interface ProfileRes { firstName: string | null; xp: number; level: number; title: string; nextLevelAt: number | null }

export interface ArticleText {
  id: number; title: string; sourceName: string; publishDate: string; section: string | null;
  fullText: string; textChunks: { chunk_id: string; text: string }[]; hasImage: boolean;
}

export interface AssignmentInfo {
  assignmentId: number | null; stations: Station[]; questionTypes: QuestionType[];
  attemptsAllowed: number | null; learningLoop: LearningLoop;
}
export interface HubTask { taskId: number; passed: boolean; attemptsCount: number }
export interface HubArticle {
  articleId: number; title: string; section: string | null; publishDate: string; hasThumbnail: boolean;
  published: boolean;
  /** null when open; otherwise why it is locked (assigned-only classes). */
  locked: { reason: BlockReason; message: string; startAt: string | null; dueAt: string | null } | null;
  tasks: Partial<Record<"comprehension" | "vocabulary" | "reflect", HubTask>>;
  writing?: HubTask;
  access: AssignmentInfo | null;
  learningLoop: LearningLoop;
}
export interface HubRes { articles: HubArticle[] }

export interface McqQuestionView { id: string; question: string; options: string[] }
export interface VocabQuestionView { id: string; targetWord: string; contextSentence: string; options: string[] }
export interface McqTaskRes {
  taskId: number; type: "comprehension" | "vocabulary"; attemptNumber: number; article: ArticleText;
  questions: (McqQuestionView | VocabQuestionView)[];
}
export interface ReflectTaskRes { taskId: number; type: "reflect"; attemptNumber: number; article: ArticleText; prompt: string }
export type TaskRes = McqTaskRes | ReflectTaskRes;

export interface McqSubmitRes {
  score: number; correctCount: number; total: number; passed: boolean; passThreshold: number;
  perQuestionResult: Record<string, { correct: boolean; correctOptionText: string; evidenceChunkId?: string }>;
  xpAwarded: number; leveledUp: boolean; newlyPublished: boolean;
}

export interface ReflectCheckRes { blocked: boolean; flagged: boolean; score: number; message?: string }
export interface ReflectBreakdown { opinion: number; reasoning: number; article_connection: number; elaboration: number; clarity: number }
export interface ReflectGradeView {
  score: number; maxScore: 10; breakdown: ReflectBreakdown; thinkingLevel: 1 | 2 | 3 | 4; position: string;
  strengths: string[]; nextStep: string; confidence: number; evidenceUsed: string[];
}
export interface WritingGradeView {
  score: number; maxScore: 20; breakdown: Record<string, number>; strengths: string[]; nextStep: string;
  sourceCheck: { supported: number; questionable: number; unsupported: number }; confidence: number;
}
export interface GradeStatusRes<G> {
  attemptId: number; status: GradingStatus; grade: G | null; provisional: boolean;
}
export interface ReflectSubmitRes {
  attemptId: number; attemptNumber: number; modelAnswers: string[]; similarityFlagged: boolean;
  xpAwarded: number; leveledUp: boolean; newlyPublished: boolean;
}
export interface WritingTaskRes {
  writingTaskId: number; attemptNumber: number; article: ArticleText; payload: WritingPayloadView; learningLoop: LearningLoop;
}
export interface WritingPayloadView {
  enabled?: boolean; task_type: string; title: string;
  brief: { purpose: string; audience: string; recommended_word_count: { min: number; max: number } };
  writing_prompt: string;
  scaffold: { planning_questions?: string[]; paragraph_plan?: string[]; sentence_starters?: string[]; vocabulary_bank?: string[] };
  source_evidence_map?: { chunk_id: string; idea: string; keywords?: string[] }[];
  marking?: { max_score: number; criteria: Record<string, string> }; model_article?: string;
}
export interface WritingSubmitRes {
  attemptId: number; attemptNumber: number; editingEnabled: boolean; similarityFlagged: boolean;
  xpAwarded: number; leveledUp: boolean; newlyPublished: boolean;
}

export interface WallBadge { articleId: number; title: string; hasThumbnail: boolean; awardedAt: string }
export interface WallRes { badges: WallBadge[] }
export interface RankingEntry {
  studentId: number; isYou: boolean; indexNumber: number; firstName: string; lastName: string;
  xp: number | null; level: number | null; tasksCompleted: number; badgesCount: number; retries: number;
}
export interface RankingsRes { rankingsEnabled: boolean; roster: RankingEntry[] }
export interface GoatEntry { studentId: number; isYou: boolean; firstName: string; lastName: string; xp: number; level: number; badgesCount: number }
export interface GoatRes { goat: GoatEntry[] }
export interface ParentRosterEntry { displayName: string; xp: number | null; level: number | null; tasksCompleted: number; badgesCount: number; retries: number }
export interface ParentClassRes { rankingsEnabled: boolean; roster: ParentRosterEntry[] }

// ---- staff ----
export interface ClassSummary {
  id: number; name: string; teacherId: number | null; rankingsEnabled: boolean; similarityThreshold: number | null;
  practiceMode: PracticeMode; enabledStations: Station[]; allowedQuestionTypes: QuestionType[];
  hasParentPassword: boolean; pupils: number; assignments: number;
}
export interface ClassesRes { classes: ClassSummary[] }
export interface CreateIdRes { id: number }
export interface RosterStudent { id: number; reporterId: string; firstName: string; lastName: string; indexNumber: number; xp: number; level: number; archived: boolean }
export interface RosterRes { students: RosterStudent[] }
export interface ImportRosterRes { createdCount: number; created: string[]; skipped: { reporterId: string; reason: string }[] }

export interface AssignmentView {
  assignmentId: number; articleId: number; classId: number; className: string; articleTitle: string; articleStatus: ArticleStatus;
  title: string | null; startAt: string | null; dueAt: string | null; stations: Station[]; questionTypes: QuestionType[];
  attemptsAllowed: number | null; active: boolean;
}
export interface AssignmentsRes { assignments: AssignmentView[] }
export interface ProgressRes {
  students: { id: number; firstName: string; lastName: string; indexNumber: number; xp: number; level: number }[];
  cells: { studentId: number; assignmentId: number; articleId: number; complete: boolean; tasksPassed: number; tasksTotal: number; writingDone: boolean }[];
  assignments: { assignmentId: number; articleId: number; title: string; dueAt: string | null }[];
}
export interface DashboardRes {
  classes: { id: number; name: string; pupils: number; assignments: number }[];
  articles: { total: number; active: number; drafts: number };
  flaggedReviews: number;
}

export interface AdminArticleSummary {
  articleId: number; forkedFromId: number | null; isFork: boolean; title: string; sourceName: string; publishDate: string;
  section: string | null; status: ArticleStatus; createdBy: number | null; createdAt: string; hasThumbnail: boolean; hasImage: boolean; learningLoop: LearningLoop;
}
export interface AdminArticlesRes { articles: AdminArticleSummary[] }
export interface AdminArticleRes {
  article: { articleId: number; forkedFromId: number | null; title: string; sourceName: string; publishDate: string; section: string | null;
    fullText: string; textChunks: { chunk_id: string; text: string }[]; status: ArticleStatus; hasThumbnail: boolean; hasImage: boolean; learningLoop: LearningLoop };
  tasks: { taskId: number; type: "comprehension" | "vocabulary" | "reflect"; payload: unknown; passThreshold: number }[];
  writing: { writingTaskId: number; payload: unknown } | null;
}
export interface ArticleIdRes { articleId: number; status: ArticleStatus }
export interface ForkRes { articleId: number; forkedFromId: number; status: "draft" }
export interface LearningLoopRes { ok: true; learningLoop: LearningLoop }
export interface ImportPromptRes { prompt: string }

export interface ReviewQueueEntry {
  kind: AttemptKind; attemptId: number; studentName: string; articleTitle: string; attemptNumber: number;
  answers: { short?: string; long?: string; draft?: string }; reasons: ("similarity" | "fallback_graded")[];
  similarityScore: number | null; submittedAt: string; reviewed: boolean;
  gradingStatus: GradingStatus; score: number | null; maxScore: number; provider: string | null; model: string | null; confidence: number | null;
  breakdown: Record<string, number> | null; feedback: { strengths?: string[]; nextStep?: string } | null;
}
export interface ReviewQueueRes { queue: ReviewQueueEntry[] }
export interface RemarkRes { ok: true; status: GradingStatus; provider: string }
export interface GradingStatsRes {
  days: number; total: number; fallback: number; fallbackPercent: number;
  byProvider: { provider: string; count: number }[];
  byDay: { day: string; total: number; fallback: number }[];
  avgLatencyMs: number | null;
}
export interface ErrorBody { error: string; requestId?: string; issues?: { path: string; message: string }[] }
