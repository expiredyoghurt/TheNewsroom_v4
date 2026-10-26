// Test harness: REAL D1 (workerd/SQLite), real KV, real R2. Only the clock, rate limiters and the AI
// binding are faked, and only where a test asks for it.
import { env as rawEnv } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { buildPath, routes, type BodyOf, type ImportBundleT, type QueryOf, type ResOf, type RouteName } from "@newsroom/shared";
import type { Env } from "../src/env";
import { dispatch } from "../src/router";
import { handlers as realHandlers } from "../src/handlers";
import { hashPassword } from "../src/auth/password";

export const env = rawEnv as unknown as Env;
export const T0 = new Date("2026-10-06T10:00:00.000Z");
export const clock = { now: T0 };

export interface CallOpts<K extends RouteName> {
  token?: string | null;
  params?: Record<string, string | number>;
  body?: BodyOf<K> | unknown;
  query?: Record<string, string | number>;
  env?: Partial<Env>;
  raw?: { bytes: Uint8Array; type: string };
  handlers?: typeof realHandlers;
}
export interface CallResult<K extends RouteName> { status: number; json: ResOf<K> & { error?: string; requestId?: string; issues?: unknown[] }; res: Response; roundTrips: number; requestId: string }

/** Call a route by NAME through the real dispatcher, then let background work (grading) finish. */
export async function call<K extends RouteName>(name: K, o: CallOpts<K> = {}): Promise<CallResult<K>> {
  const spec = routes[name];
  const qs = o.query ? "?" + new URLSearchParams(Object.fromEntries(Object.entries(o.query).map(([k, v]) => [k, String(v)]))).toString() : "";
  const headers: Record<string, string> = {};
  if (o.token) headers.authorization = `Bearer ${o.token}`;
  let body: BodyInit | undefined;
  if (o.raw) { body = o.raw.bytes; headers["content-type"] = o.raw.type; }
  else if (o.body !== undefined) { body = JSON.stringify(o.body); headers["content-type"] = "application/json"; }
  const req = new Request(`https://newsroom.test${buildPath(spec.path, o.params)}${qs}`, { method: spec.method, headers, body });
  const ctx = createExecutionContext();
  const res = await dispatch(req, { ...env, ...o.env } as Env, ctx, o.handlers ?? realHandlers, { now: () => clock.now, newRequestId: () => "req-test" });
  await waitOnExecutionContext(ctx);
  let json: unknown = null;
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("json")) json = await res.json();
  return { status: res.status, json: json as CallResult<K>["json"], res, roundTrips: Number(res.headers.get("x-db-round-trips") ?? -1), requestId: res.headers.get("x-request-id") ?? "" };
}

export async function resetDb(): Promise<void> {
  const tables = ["similarity_warnings", "login_failures", "xp_log", "badges", "writing_attempts", "attempts", "writing_progress", "task_progress", "grading_runs",
    "assignments", "writing_tasks", "tasks", "articles", "students", "classes", "teachers"];
  await env.DB.batch(tables.map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
  const keys = await env.SESSIONS.list();
  await Promise.all(keys.keys.map((k) => env.SESSIONS.delete(k.name)));
  clock.now = T0;
}

// ---------- seeding (direct SQL: fast, and independent of the routes under test) ----------
export async function seedTeacher(username: string, role: "teacher" | "admin" = "teacher", password = "teach-pass"): Promise<number> {
  const r = await env.DB.prepare("INSERT INTO teachers (username, name, password_hash, role) VALUES (?, ?, ?, ?)").bind(username, username, await hashPassword(password), role).run();
  return r.meta.last_row_id as number;
}
export async function seedClass(name: string, teacherId: number | null, o: { practiceMode?: "free" | "assigned_only"; rankings?: boolean; threshold?: number | null; parentPassword?: string } = {}): Promise<number> {
  const r = await env.DB.prepare("INSERT INTO classes (name, teacher_id, practice_mode, rankings_enabled, similarity_threshold, parent_password_hash) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(name, teacherId, o.practiceMode ?? "free", o.rankings ? 1 : 0, o.threshold ?? null, o.parentPassword ? await hashPassword(o.parentPassword) : null).run();
  return r.meta.last_row_id as number;
}
export async function seedStudents(classId: number, n: number, prefix = "p", password = "pupil-pass", startIndex = 1): Promise<number[]> {
  const hash = await hashPassword(password);
  const stmts = Array.from({ length: n }, (_, i) =>
    env.DB.prepare("INSERT INTO students (reporter_id, password_hash, first_name, last_name, index_number, class_id) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(`${prefix}${classId}-${i + startIndex}`, hash, `First${i + startIndex}`, `Last${i + startIndex}`, i + startIndex, classId));
  const res = await env.DB.batch(stmts);
  return res.map((r) => r.meta.last_row_id as number);
}
export const reporterId = (classId: number, i: number, prefix = "p") => `${prefix}${classId}-${i}`;

export async function loginPupil(classId: number, index: number, password = "pupil-pass", prefix = "p"): Promise<string> {
  const r = await call("pupilLogin", { body: { reporterId: reporterId(classId, index, prefix), pressPass: password } });
  if (r.status !== 200) throw new Error(`pupil login failed: ${r.status} ${JSON.stringify(r.json)}`);
  return (r.json as { token: string }).token;
}
export async function loginTeacher(username: string, password = "teach-pass"): Promise<string> {
  const r = await call("teacherLogin", { body: { identifier: username, password } });
  if (r.status !== 200) throw new Error(`teacher login failed: ${r.status}`);
  return (r.json as { token: string }).token;
}

// ---------- article fixtures ----------
const SENTENCES = [
  "The school council met on Tuesday to talk about a new recycling programme.",
  "Pupils from every class were invited to share their ideas with the council.",
  "The headmaster said that each classroom would receive two coloured bins by the end of term.",
  "A group of Primary Five pupils had collected more than two hundred plastic bottles in one week.",
  "Teachers praised the pupils for their determination and creativity during the project.",
  "The council will review the programme again in December to see how much waste was saved.",
  "Parents are welcome to join the volunteer team that will empty the bins every Friday.",
  "Everyone agreed that small daily habits can make a large difference to the environment.",
];
// Realistic length: the import prompt asks for 2-4 sentences per model answer.
export const MODEL_ANSWERS = [
  "Yes, because recycling saves resources and teaches pupils to care for the planet. Schools reach many families at once, so the habit can spread quickly beyond the classroom.",
  "I am not sure, because the plan only works if pupils really sort their rubbish properly. If nobody checks the bins, the effort could be wasted and people may lose interest.",
  "No, because teachers and pupils already have a very full timetable to manage. A better idea might be a short yearly clean-up day that everyone can join together.",
];
export function sampleBundle(over: Partial<ImportBundleT> = {}): ImportBundleT {
  const chunks = SENTENCES.map((text, i) => ({ chunk_id: `c${i + 1}`, text }));
  const q = (n: number, chunk: string) => ({ id: `q${n}`, question: `Question ${n}?`, evidence_chunk_id: chunk, options: [`A${n}`, `B${n}`, `C${n}`, `D${n}`], correct_index: n % 4 });
  return {
    title: "School Recycling Plan", sourceName: "The Straits Times", section: "Newsroom", publishDate: "2026-10-01",
    fullText: SENTENCES.join(" "), textChunks: chunks,
    comprehension: { questions: [q(1, "c1"), q(2, "c3"), q(3, "c4"), q(4, "c6")] },
    vocabulary: { questions: [{ id: "v1", target_word: "determination", word_class: "noun", context_sentence: SENTENCES[4]!,
      options: [{ text: "resolve", role: "correct_synonym" }, { text: "interest", role: "distant_synonym" }, { text: "doubt", role: "antonym" }, { text: "termination", role: "lookalike" }], correct_index: 0 }] },
    reflect: {
      prompt: "Should every school have a recycling programme? Why?", model_answers: MODEL_ANSWERS,
      evidence_map: [{ chunk_id: "c3", idea: "bins in each classroom", keywords: ["bins", "classroom"] }, { chunk_id: "c4", idea: "pupils collected bottles", keywords: ["bottles", "collected"] }, { chunk_id: "c8", idea: "small habits matter", keywords: ["habits", "environment"] }],
      marking: { max_score: 10, criteria: { opinion: "States a view.", reasoning: "Gives a reason.", article_connection: "Uses the article.", elaboration: "Develops an idea.", clarity: "Is clear." }, acceptable_positions: ["agree", "disagree", "other_reasonable_position"] },
    },
    writing: {
      enabled: true, task_type: "news_report", title: "Junior Reporter Assignment",
      brief: { purpose: "inform", audience: "school newspaper readers", recommended_word_count: { min: 60, max: 200 } },
      writing_prompt: "Write a news report about the recycling programme.",
      scaffold: { paragraph_plan: ["Say what happened", "Give the details", "Say what happens next"], planning_questions: ["Who?"] },
      source_evidence_map: [{ chunk_id: "c2", idea: "pupils share ideas", keywords: ["council", "ideas"] }, { chunk_id: "c3", idea: "bins", keywords: ["bins", "classroom"] }, { chunk_id: "c6", idea: "review", keywords: ["review", "December"] }],
      model_article: "A model article that pupils should only see after trying.",
    },
    ...over,
  };
}

/** Import via the REAL route as a teacher, publish, and return ids. */
export async function seedPublishedArticle(teacherToken: string, over: Partial<ImportBundleT> = {}, loop?: Partial<Record<"vocabulary" | "comprehension" | "think" | "writing" | "edit", boolean>>) {
  const imp = await call("importArticle", { token: teacherToken, body: sampleBundle(over) });
  if (imp.status !== 200) throw new Error(`import failed ${imp.status} ${JSON.stringify(imp.json)}`);
  const articleId = (imp.json as { articleId: number }).articleId;
  if (loop) { const l = await call("setLearningLoop", { token: teacherToken, params: { articleId }, body: { learningLoop: loop } }); if (l.status !== 200) throw new Error("loop failed"); }
  const pub = await call("publishArticle", { token: teacherToken, params: { articleId } });
  if (pub.status !== 200) throw new Error(`publish failed ${pub.status}`);
  const tasks = await env.DB.prepare("SELECT id, type FROM tasks WHERE article_id = ?").bind(articleId).all<{ id: number; type: string }>();
  const wt = await env.DB.prepare("SELECT id FROM writing_tasks WHERE article_id = ?").bind(articleId).first<{ id: number }>();
  const byType = Object.fromEntries(tasks.results.map((t) => [t.type, t.id])) as Record<"comprehension" | "vocabulary" | "reflect", number>;
  return { articleId, ...byType, writingTaskId: wt?.id ?? null };
}

/** A fake Workers AI binding: lets a test drive the AI path (success, garbage, error) with no network. */
export function fakeAi(respond: () => unknown | Promise<unknown>): Partial<Env> {
  return { AI: { run: async () => ({ response: await respond() }) } as unknown as Ai };
}
export const okReflectJson = (o: Record<string, unknown> = {}) => JSON.stringify({
  score: 9, max_score: 10, breakdown: { opinion: 2, reasoning: 3, article_connection: 2, elaboration: 1, clarity: 1 }, thinking_level: 3,
  position: "agree", article_evidence_used: ["c3"], strengths: ["Clear view"], next_step: "Add an example", confidence: 0.8, ...o,
});

/** The single correct-answer click for a question, found by inverting the SAME seeded order the server uses. */
export async function correctAnswers(token: string, taskId: number, type: "comprehension" | "vocabulary", studentId: number, bundle = sampleBundle()) {
  const { shuffledIndices, SALT } = await import("@newsroom/shared");
  const got = await call("getTask", { token, params: { taskId } });
  const t = got.json as { attemptNumber: number };
  const qs = type === "comprehension" ? bundle.comprehension.questions : bundle.vocabulary.questions;
  const answers: Record<string, { selectedIndex: number; chunkId?: string }> = {};
  for (const q of qs) {
    const order = shuffledIndices(4, { studentId, taskId, attemptNumber: t.attemptNumber }, SALT.options(q.id));
    answers[q.id] = { selectedIndex: order.indexOf(q.correct_index), ...(type === "comprehension" ? { chunkId: (q as { evidence_chunk_id: string }).evidence_chunk_id } : {}) };
  }
  return { attemptNumber: t.attemptNumber, answers };
}
