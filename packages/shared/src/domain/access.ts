// THE business rule of the app: what may this pupil do with this article, right now?
//
// Three layers merge into one decision:
//   1. the ARTICLE's learning loop        -> hard ceiling, nothing can switch a stage on that the article has off
//   2. the CLASS defaults                 -> used when no assignment applies
//   3. the ASSIGNMENT for that class      -> overrides the class defaults while its window is open
//
// There is exactly ONE implementation of this rule (this function). It never
// throws: call sites decide what a `blocked` result means. The single-article
// routes turn it into a 403; the hub list renders it as a locked card.

import {
  type LearningLoop, type QuestionType, type Station,
  QUESTION_TYPES, STATIONS, enforceLoopInvariants, questionTypeEnabled, stationEnabled,
} from "./loop";

export type PracticeMode = "free" | "assigned_only";

export interface ClassRules {
  practiceMode: PracticeMode;
  enabledStations: readonly Station[];
  allowedQuestionTypes: readonly QuestionType[];
}

export interface AssignmentRules {
  id: number;
  active: boolean;
  startAt: string | null; // ISO-8601
  dueAt: string | null;   // ISO-8601
  stations: readonly Station[];
  questionTypes: readonly QuestionType[];
  attemptsAllowed: number | null;
}

export type BlockReason = "not_assigned" | "not_started" | "past_due";

export interface OpenAccess {
  status: "open";
  /** Which layer supplied the requested stations/types. */
  source: "assignment" | "class";
  assignmentId: number | null;
  stations: Station[];
  questionTypes: QuestionType[];
  loop: LearningLoop;
  attemptsAllowed: number | null;
}

export interface BlockedAccess {
  status: "blocked";
  reason: BlockReason;
  assignmentId: number | null;
  startAt: string | null;
  dueAt: string | null;
}

export type ArticleAccess = OpenAccess | BlockedAccess;

export type WindowState = "open" | "not_started" | "past_due";

/** Evaluate an assignment's start/due window against `now`. Boundaries are inclusive. */
export function assignmentWindow(a: Pick<AssignmentRules, "startAt" | "dueAt">, now: Date): WindowState {
  const t = now.getTime();
  if (a.startAt) {
    const s = Date.parse(a.startAt);
    if (Number.isFinite(s) && t < s) return "not_started";
  }
  if (a.dueAt) {
    const d = Date.parse(a.dueAt);
    if (Number.isFinite(d) && t > d) return "past_due";
  }
  return "open";
}

export function resolveArticleAccess(input: {
  articleLoop: LearningLoop;
  classRules: ClassRules;
  assignment: AssignmentRules | null;
  now: Date;
}): ArticleAccess {
  const { articleLoop, classRules, now } = input;
  const assignment = input.assignment && input.assignment.active ? input.assignment : null;
  const win: WindowState = assignment ? assignmentWindow(assignment, now) : "open";

  let source: "assignment" | "class";
  let requestedStations: readonly Station[];
  let requestedTypes: readonly QuestionType[];
  let attemptsAllowed: number | null = null;

  if (assignment && win === "open") {
    source = "assignment";
    requestedStations = assignment.stations;
    requestedTypes = assignment.questionTypes;
    attemptsAllowed = assignment.attemptsAllowed;
  } else if (classRules.practiceMode === "assigned_only") {
    const reason: BlockReason = !assignment ? "not_assigned" : win === "not_started" ? "not_started" : "past_due";
    return {
      status: "blocked",
      reason,
      assignmentId: assignment?.id ?? null,
      startAt: assignment?.startAt ?? null,
      dueAt: assignment?.dueAt ?? null,
    };
  } else {
    // Free practice: an assignment outside its window is simply not in force.
    // It must NOT block the article for anyone (regression: a scheduled assignment
    // used to hide the whole class's article list).
    source = "class";
    requestedStations = classRules.enabledStations;
    requestedTypes = classRules.allowedQuestionTypes;
  }

  const loop = enforceLoopInvariants({
    read: articleLoop.read,
    vocabulary: articleLoop.vocabulary && requestedTypes.includes("vocabulary"),
    comprehension: articleLoop.comprehension && requestedTypes.includes("comprehension"),
    think: articleLoop.think && requestedTypes.includes("reflect"),
    writing: articleLoop.writing && requestedTypes.includes("writing"),
    edit: articleLoop.edit && requestedStations.includes("editor"),
  });

  return {
    status: "open",
    source,
    assignmentId: source === "assignment" ? assignment!.id : null,
    // Read (newsstand) is always available once the article is open.
    stations: STATIONS.filter((s) => s === "newsstand" || (requestedStations.includes(s) && stationEnabled(loop, s))),
    questionTypes: QUESTION_TYPES.filter((t) => requestedTypes.includes(t) && questionTypeEnabled(loop, t)),
    loop,
    attemptsAllowed,
  };
}

/** Why a request was refused, in words a pupil can read. */
export function blockMessage(reason: BlockReason): string {
  switch (reason) {
    case "not_assigned": return "This article is not assigned to your class.";
    case "not_started": return "This assignment has not started yet.";
    case "past_due": return "This assignment is past its due date.";
  }
}

export type AccessCheck =
  | { ok: true }
  | { ok: false; status: 403; message: string };

/** What a call site that needs a specific question type / station should do with the decision. */
export function checkQuestionType(access: ArticleAccess, type: QuestionType): AccessCheck {
  if (access.status === "blocked") return { ok: false, status: 403, message: blockMessage(access.reason) };
  if (!access.questionTypes.includes(type)) {
    return { ok: false, status: 403, message: "This task type is not enabled for this article and class." };
  }
  return { ok: true };
}

export function checkStation(access: ArticleAccess, station: Station): AccessCheck {
  if (access.status === "blocked") return { ok: false, status: 403, message: blockMessage(access.reason) };
  if (!access.stations.includes(station)) {
    return { ok: false, status: 403, message: "This station is not enabled for this article and class." };
  }
  return { ok: true };
}

/** Attempt limits only exist when an assignment sets them. */
export function checkAttemptLimit(access: OpenAccess, attemptsSoFar: number): AccessCheck {
  if (access.attemptsAllowed !== null && attemptsSoFar >= access.attemptsAllowed) {
    return { ok: false, status: 403, message: "The attempt limit for this assignment has been reached." };
  }
  return { ok: true };
}
