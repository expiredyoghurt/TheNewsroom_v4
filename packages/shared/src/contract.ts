// THE route table. Single source of truth for: which routes exist, their method + path,
// who may call them, how their input is validated, which are rate limited, and what they
// return. The worker must implement every entry (compile error otherwise) and the web
// client is generated from it. CORS/auth/route-listing are all derived from this object.
import type { ZodType, z } from "zod";
import * as S from "./schemas";
import type * as T from "./types";

export type Method = "GET" | "POST" | "PATCH" | "DELETE";
/** teacher = teacher OR admin; admin = admin only; authenticated = any valid session. */
export type Role = "public" | "pupil" | "parent" | "teacher" | "admin" | "authenticated";
export type RateLimitKind = "auth" | "submit";

export interface RouteSpec {
  readonly method: Method;
  readonly path: string;
  readonly role: Role;
  readonly body?: ZodType;
  readonly query?: ZodType;
  readonly rateLimit?: RateLimitKind;
  /** Handler returns a raw Response (images) instead of JSON. */
  readonly binary?: boolean;
  /** Request body is raw bytes (image upload), not JSON. */
  readonly rawBody?: boolean;
}
type Phantom<Res> = { readonly __res?: Res };
const route = <Res>() => <const Sp extends RouteSpec>(spec: Sp): Sp & Phantom<Res> => spec;

export const routes = {
  // ---- auth ----
  pupilLogin: route<T.LoginPupilRes>()({ method: "POST", path: "/api/auth/pupil/login", role: "public", body: S.PupilLoginBody, rateLimit: "auth" }),
  teacherLogin: route<T.LoginTeacherRes>()({ method: "POST", path: "/api/auth/teacher/login", role: "public", body: S.TeacherLoginBody, rateLimit: "auth" }),
  parentLogin: route<T.LoginParentRes>()({ method: "POST", path: "/api/auth/parent/login", role: "public", body: S.ParentLoginBody, rateLimit: "auth" }),
  logout: route<T.Ok>()({ method: "POST", path: "/api/auth/logout", role: "authenticated" }),

  // ---- pupil ----
  pupilProfile: route<T.ProfileRes>()({ method: "GET", path: "/api/pupil/me", role: "pupil" }),
  hub: route<T.HubRes>()({ method: "GET", path: "/api/articles", role: "pupil" }),
  wall: route<T.WallRes>()({ method: "GET", path: "/api/wall", role: "pupil" }),
  readArticle: route<T.ArticleText>()({ method: "GET", path: "/api/read/:articleId", role: "pupil" }),
  getTask: route<T.TaskRes>()({ method: "GET", path: "/api/tasks/:taskId", role: "pupil" }),
  submitMcq: route<T.McqSubmitRes>()({ method: "POST", path: "/api/tasks/:taskId/submit", role: "pupil", body: S.McqSubmitBody, rateLimit: "submit" }),
  checkReflect: route<T.ReflectCheckRes>()({ method: "POST", path: "/api/tasks/:taskId/reflect/check", role: "pupil", body: S.ReflectBody, rateLimit: "submit" }),
  submitReflect: route<T.ReflectSubmitRes>()({ method: "POST", path: "/api/tasks/:taskId/reflect/submit", role: "pupil", body: S.ReflectBody, rateLimit: "submit" }),
  getWritingTask: route<T.WritingTaskRes>()({ method: "GET", path: "/api/writing/:articleId", role: "pupil" }),
  submitWriting: route<T.WritingSubmitRes>()({ method: "POST", path: "/api/writing/:writingTaskId/submit", role: "pupil", body: S.WritingSubmitBody, rateLimit: "submit" }),
  reflectGrade: route<T.GradeStatusRes<T.ReflectGradeView>>()({ method: "GET", path: "/api/attempts/reflect/:attemptId/grade", role: "pupil" }),
  writingGrade: route<T.GradeStatusRes<T.WritingGradeView>>()({ method: "GET", path: "/api/attempts/writing/:attemptId/grade", role: "pupil" }),
  rankings: route<T.RankingsRes>()({ method: "GET", path: "/api/rankings", role: "pupil" }),
  goat: route<T.GoatRes>()({ method: "GET", path: "/api/rankings/goat", role: "pupil" }),
  thumbnail: route<never>()({ method: "GET", path: "/api/thumbnail/:articleId", role: "authenticated", binary: true }),
  articleImage: route<never>()({ method: "GET", path: "/api/article-image/:articleId", role: "authenticated", binary: true }),

  // ---- parent ----
  parentClass: route<T.ParentClassRes>()({ method: "GET", path: "/api/parent/class", role: "parent" }),

  // ---- staff: dashboard, classes, roster ----
  dashboard: route<T.DashboardRes>()({ method: "GET", path: "/api/admin/dashboard", role: "teacher" }),
  classes: route<T.ClassesRes>()({ method: "GET", path: "/api/admin/classes", role: "teacher" }),
  createClass: route<T.CreateIdRes>()({ method: "POST", path: "/api/admin/classes", role: "teacher", body: S.CreateClassBody }),
  updateClassSettings: route<T.Ok>()({ method: "PATCH", path: "/api/admin/classes/:classId/settings", role: "teacher", body: S.ClassSettingsBody }),
  roster: route<T.RosterRes>()({ method: "GET", path: "/api/admin/roster", role: "teacher", query: S.ClassIdQuery }),
  addPupil: route<T.CreateIdRes>()({ method: "POST", path: "/api/admin/roster/add", role: "teacher", body: S.AddPupilBody }),
  importRoster: route<T.ImportRosterRes>()({ method: "POST", path: "/api/admin/roster/import", role: "teacher", body: S.ImportRosterBody }),
  removePupil: route<T.Ok>()({ method: "POST", path: "/api/admin/roster/remove", role: "teacher", body: S.RemovePupilBody }),
  resetPupilPassword: route<T.Ok>()({ method: "POST", path: "/api/admin/roster/reset-password", role: "teacher", body: S.ResetPasswordBody }),
  changePupilClass: route<T.Ok>()({ method: "POST", path: "/api/admin/roster/change-class", role: "teacher", body: S.ChangeClassBody }),

  // ---- staff: assignments + progress ----
  listAssignments: route<T.AssignmentsRes>()({ method: "GET", path: "/api/admin/assignments", role: "teacher", query: S.OptionalClassIdQuery }),
  createAssignment: route<T.CreateIdRes>()({ method: "POST", path: "/api/admin/assignments", role: "teacher", body: S.CreateAssignmentBody }),
  updateAssignment: route<T.Ok>()({ method: "PATCH", path: "/api/admin/assignments/:assignmentId", role: "teacher", body: S.UpdateAssignmentBody }),
  deleteAssignment: route<T.Ok>()({ method: "DELETE", path: "/api/admin/assignments/:assignmentId", role: "teacher" }),
  progress: route<T.ProgressRes>()({ method: "GET", path: "/api/admin/progress", role: "teacher", query: S.ClassIdQuery }),

  // ---- staff: articles ----
  adminArticles: route<T.AdminArticlesRes>()({ method: "GET", path: "/api/admin/articles", role: "teacher" }),
  adminArticle: route<T.AdminArticleRes>()({ method: "GET", path: "/api/admin/articles/:articleId", role: "teacher" }),
  updateArticle: route<T.Ok>()({ method: "PATCH", path: "/api/admin/articles/:articleId", role: "teacher", body: S.UpdateArticleBody }),
  setLearningLoop: route<T.LearningLoopRes>()({ method: "PATCH", path: "/api/admin/articles/:articleId/learning-loop", role: "teacher", body: S.LearningLoopBody }),
  publishArticle: route<T.ArticleIdRes>()({ method: "POST", path: "/api/admin/articles/:articleId/publish", role: "teacher" }),
  forkArticle: route<T.ForkRes>()({ method: "POST", path: "/api/admin/articles/:articleId/fork", role: "teacher", body: S.ForkBody }),
  importPrompt: route<T.ImportPromptRes>()({ method: "GET", path: "/api/admin/import-prompt", role: "teacher" }),
  importArticle: route<T.ArticleIdRes>()({ method: "POST", path: "/api/admin/articles/import", role: "teacher", body: S.ImportBundle }),
  uploadThumbnail: route<T.Ok>()({ method: "POST", path: "/api/admin/articles/:articleId/thumbnail", role: "teacher", rawBody: true }),
  uploadArticleImage: route<T.Ok>()({ method: "POST", path: "/api/admin/articles/:articleId/image", role: "teacher", rawBody: true }),
  deleteArticleImage: route<T.Ok>()({ method: "DELETE", path: "/api/admin/articles/:articleId/image", role: "teacher" }),

  // ---- staff: review + grading ----
  reviewQueue: route<T.ReviewQueueRes>()({ method: "GET", path: "/api/admin/review-queue", role: "teacher", query: S.OptionalClassIdQuery }),
  submitReview: route<T.Ok>()({ method: "POST", path: "/api/admin/review/:kind/:attemptId", role: "teacher", body: S.ReviewBody }),
  regrade: route<T.RemarkRes>()({ method: "POST", path: "/api/admin/review/:kind/:attemptId/regrade", role: "teacher" }),
  gradingStats: route<T.GradingStatsRes>()({ method: "GET", path: "/api/admin/grading-stats", role: "teacher", query: S.GradingStatsQuery }),
} as const;

export type RouteName = keyof typeof routes;
export type ResOf<K extends RouteName> = (typeof routes)[K] extends Phantom<infer R> ? R : never;
export type BodyOf<K extends RouteName> = (typeof routes)[K] extends { body: infer B extends ZodType } ? z.infer<B> : undefined;
export type QueryOf<K extends RouteName> = (typeof routes)[K] extends { query: infer Q extends ZodType } ? z.infer<Q> : undefined;

export const routeNames = Object.keys(routes) as RouteName[];

/** CORS methods are DERIVED from the table, never hand-listed. */
export function allowedMethods(): Method[] {
  return [...new Set(routeNames.map((n) => routes[n].method as Method))];
}
export function methodsForPath(pathname: string): Method[] {
  return routeNames.filter((n) => matchPath(routes[n].path, pathname)).map((n) => routes[n].method as Method);
}

/** "/api/tasks/:taskId/submit" vs "/api/tasks/12/submit" -> { taskId: "12" } | null */
export function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  const a = pattern.split("/"), b = pathname.split("/");
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    const seg = a[i]!;
    if (seg.startsWith(":")) {
      if (!b[i]) return null;
      try { params[seg.slice(1)] = decodeURIComponent(b[i]!); } catch { return null; }
    } else if (seg !== b[i]) return null;
  }
  return params;
}

/** Fill a pattern for the client. */
export function buildPath(pattern: string, params: Record<string, string | number> = {}): string {
  return pattern.replace(/:([A-Za-z]+)/g, (_, k: string) => encodeURIComponent(String(params[k] ?? "")));
}
