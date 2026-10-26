// Request bodies / queries. Written once; the worker validates with them, the web app reuses them.
import { z } from "zod";
import { QUESTION_TYPES, STATIONS } from "./domain/loop";

const nonEmpty = z.string().trim().min(1);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");
export const idParam = z.coerce.number().int().positive();

export const PupilLoginBody = z.object({ reporterId: nonEmpty.max(64), pressPass: z.string().min(1).max(200) });
export const TeacherLoginBody = z.object({ identifier: nonEmpty.max(200), password: z.string().min(1).max(200) });
export const ParentLoginBody = z.object({ classId: idParam, password: z.string().min(1).max(200) });

export const McqSubmitBody = z.object({
  attemptNumber: z.number().int().min(1),
  answers: z.record(z.string(), z.object({ selectedIndex: z.number().int().min(0).max(20), chunkId: z.string().max(64).optional() })),
});
export const ReflectBody = z.object({ attemptNumber: z.number().int().min(1), short: nonEmpty.max(1000), long: nonEmpty.max(5000) });
export const WritingSubmitBody = z.object({ attemptNumber: z.number().int().min(1), draft: nonEmpty.max(20000) });

export const StationEnum = z.enum(STATIONS);
export const QuestionTypeEnum = z.enum(QUESTION_TYPES);
const isoDateTime = z.string().refine((v) => Number.isFinite(Date.parse(v)), "must be a date-time");

export const ClassSettingsBody = z.object({
  rankingsEnabled: z.boolean().optional(),
  similarityThreshold: z.number().min(0.1).max(0.99).nullable().optional(),
  enabledStations: z.array(StationEnum).min(1).optional(),
  allowedQuestionTypes: z.array(QuestionTypeEnum).min(1).optional(),
  practiceMode: z.enum(["free", "assigned_only"]).optional(),
  parentPassword: z.string().min(6).max(200).nullable().optional(),
});
export const CreateClassBody = z.object({ name: nonEmpty.max(100), teacherId: idParam.optional() });

export const RosterRow = z.object({
  reporterId: nonEmpty.max(64), firstName: nonEmpty.max(100), lastName: nonEmpty.max(100),
  indexNumber: z.number().int().min(1).max(999), pressPass: z.string().min(4).max(200),
});
export const AddPupilBody = RosterRow.extend({ classId: idParam });
export const ImportRosterBody = z.object({ classId: idParam, rows: z.array(RosterRow).min(1).max(60) });
export const RemovePupilBody = z.object({ studentId: idParam });
export const ResetPasswordBody = z.object({ studentId: idParam, newPressPass: z.string().min(4).max(200) });
export const ChangeClassBody = z.object({ studentId: idParam, newClassId: idParam });

export const CreateAssignmentBody = z.object({
  classId: idParam, articleId: idParam, title: z.string().trim().max(200).nullish(),
  startAt: isoDateTime.nullish(), dueAt: isoDateTime.nullish(),
  requiredStations: z.array(StationEnum).min(1).optional(),
  allowedQuestionTypes: z.array(QuestionTypeEnum).min(1).optional(),
  attemptsAllowed: z.number().int().min(1).max(50).nullish(),
});
export const UpdateAssignmentBody = z.object({
  title: z.string().trim().max(200).nullish(), startAt: isoDateTime.nullish(), dueAt: isoDateTime.nullish(),
  requiredStations: z.array(StationEnum).min(1).optional(),
  allowedQuestionTypes: z.array(QuestionTypeEnum).min(1).optional(),
  attemptsAllowed: z.number().int().min(1).max(50).nullish(), active: z.boolean().optional(),
});

export const LearningLoopBody = z.object({
  learningLoop: z.object({
    read: z.boolean().optional(), vocabulary: z.boolean().optional(), comprehension: z.boolean().optional(),
    think: z.boolean().optional(), writing: z.boolean().optional(), edit: z.boolean().optional(),
  }),
});

export const ReviewBody = z.object({ bonusXp: z.number().int().min(0).max(100).optional(), note: z.string().max(1000).optional() });
export const ForkBody = z.object({ title: z.string().trim().max(200).optional() }).default({});

// ---- Article import bundle (what the external AI tool produces) ----
const chunk = z.object({ chunk_id: nonEmpty, text: nonEmpty });
const idx = z.number().int().min(0).max(3);
const mcqQuestion = z.object({
  id: nonEmpty, question: nonEmpty, evidence_chunk_id: nonEmpty,
  options: z.array(nonEmpty).length(4), correct_index: idx,
});
const vocabQuestion = z.object({
  id: nonEmpty, target_word: nonEmpty, word_class: z.string().default(""), context_sentence: nonEmpty,
  options: z.array(z.object({ text: nonEmpty, role: z.enum(["correct_synonym", "distant_synonym", "antonym", "lookalike"]) })).length(4),
  correct_index: idx,
});
const marking = z.object({
  max_score: z.literal(10),
  criteria: z.object({ opinion: nonEmpty, reasoning: nonEmpty, article_connection: nonEmpty, elaboration: nonEmpty, clarity: nonEmpty }),
  acceptable_positions: z.array(nonEmpty).min(1),
  common_weak_responses: z.array(z.string()).optional(),
});
export const WritingPayloadSchema = z.object({
  enabled: z.boolean().optional(), task_type: nonEmpty, title: nonEmpty,
  brief: z.object({ purpose: nonEmpty, audience: nonEmpty, recommended_word_count: z.object({ min: z.number().min(50), max: z.number() }) }),
  writing_prompt: nonEmpty,
  scaffold: z.object({
    planning_questions: z.array(z.string()).optional(), paragraph_plan: z.array(z.string()).min(3),
    sentence_starters: z.array(z.string()).optional(), vocabulary_bank: z.array(z.string()).optional(),
  }),
  source_evidence_map: z.array(z.object({ chunk_id: nonEmpty, idea: nonEmpty, keywords: z.array(z.string()).optional() })).optional(),
  marking: z.object({ max_score: z.number(), criteria: z.record(z.string(), z.string()) }).optional(),
  model_article: z.string().optional(),
});
export const ReflectPayloadSchema = z.object({
  prompt: nonEmpty, model_answers: z.array(nonEmpty).length(3),
  evidence_map: z.array(z.object({ chunk_id: nonEmpty, idea: nonEmpty, keywords: z.array(nonEmpty).min(1) })).min(3).max(8),
  marking,
});
export const ComprehensionPayloadSchema = z.object({ questions: z.array(mcqQuestion).length(4) });
export const VocabularyPayloadSchema = z.object({ questions: z.array(vocabQuestion).length(1) });

/** Every chunk id an activity cites must exist. ONE implementation, used by import AND by draft edits. */
export function chunkReferenceIssues(
  chunkIds: ReadonlySet<string>,
  refs: { comprehension?: readonly { evidence_chunk_id: string }[]; reflect?: readonly { chunk_id: string }[]; writing?: readonly { chunk_id: string }[] },
): { path: (string | number)[]; message: string }[] {
  const out: { path: (string | number)[]; message: string }[] = [];
  const msg = "must match a chunk_id from textChunks";
  refs.comprehension?.forEach((q, i) => { if (!chunkIds.has(q.evidence_chunk_id)) out.push({ path: ["comprehension", "questions", i, "evidence_chunk_id"], message: msg }); });
  refs.reflect?.forEach((e, i) => { if (!chunkIds.has(e.chunk_id)) out.push({ path: ["reflect", "evidence_map", i, "chunk_id"], message: msg }); });
  refs.writing?.forEach((e, i) => { if (!chunkIds.has(e.chunk_id)) out.push({ path: ["writing", "source_evidence_map", i, "chunk_id"], message: msg }); });
  return out;
}

export const ImportBundle = z.object({
  title: nonEmpty, sourceName: nonEmpty, section: z.string().trim().default(""), publishDate: isoDate, fullText: nonEmpty,
  textChunks: z.array(chunk).min(1),
  comprehension: ComprehensionPayloadSchema, vocabulary: VocabularyPayloadSchema, reflect: ReflectPayloadSchema,
  writing: WritingPayloadSchema.optional(),
}).superRefine((b, ctx) => {
  const ids = new Set<string>();
  b.textChunks.forEach((c, i) => {
    if (ids.has(c.chunk_id)) ctx.addIssue({ code: "custom", path: ["textChunks", i, "chunk_id"], message: "duplicate chunk_id" });
    ids.add(c.chunk_id);
  });
  for (const issue of chunkReferenceIssues(ids, {
    comprehension: b.comprehension.questions, reflect: b.reflect.evidence_map, writing: b.writing?.source_evidence_map,
  })) ctx.addIssue({ code: "custom", path: issue.path, message: issue.message });
});
export type ImportBundleT = z.infer<typeof ImportBundle>;

/** Teacher edits to a DRAFT article (published articles are locked; fork instead). */
export const UpdateArticleBody = z.object({
  title: nonEmpty.optional(), sourceName: nonEmpty.optional(), publishDate: isoDate.optional(),
  section: nonEmpty.optional(), fullText: nonEmpty.optional(), textChunks: z.array(chunk).min(1).optional(),
  tasks: z.array(z.object({ type: z.enum(["comprehension", "vocabulary", "reflect"]), payload: z.unknown() })).optional(),
  writing: WritingPayloadSchema.optional(),
});

export const ClassIdQuery = z.object({ classId: idParam });
export const OptionalClassIdQuery = z.object({ classId: idParam.optional() });
export const GradingStatsQuery = z.object({ days: z.coerce.number().int().min(1).max(365).default(7) });
