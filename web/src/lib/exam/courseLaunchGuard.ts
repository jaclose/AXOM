// Safeguard at the QBank handoff boundary, not another curriculum/session store.
// Agent 4 owns the canonical course selection and its stored payload. The
// existing reader currently returns the subset already present on this device;
// never consume that subset as if it were the entire explicitly requested quiz.
import { COURSE_QUIZ_LAUNCH_KEY, readCourseQuizLaunch, type CourseQuizLaunch } from "../course-engine/quizLaunch";
import { questionPracticeReadiness } from "../questionFilters";
import type { QuestionRecord } from "../questions";

const MAX_SELECTION = 2000;
const MAX_PAYLOAD_CHARS = 240_000;

export type CourseLaunchGuard =
  | { state: "none" }
  | { state: "invalid"; reason: string }
  | { state: "pending"; term: string; module: string; week?: number; total: number;
      ready: number; missing: number; review: number; reviewIds: string[] }
  | { state: "ready"; launch: CourseQuizLaunch };

const invalid = (reason: string): CourseLaunchGuard => ({ state: "invalid", reason });

/** Read-only, deterministic and fail-closed. Never clears or modifies a pending
 * launch; never claims that locally installed records exist in the cloud. */
export function inspectCourseLaunch(questions: readonly QuestionRecord[]): CourseLaunchGuard {
  let raw: string | null;
  try { raw = sessionStorage.getItem(COURSE_QUIZ_LAUNCH_KEY); } catch { return { state: "none" }; }
  if (raw === null) return { state: "none" };
  if (raw.length > MAX_PAYLOAD_CHARS) return invalid("The saved course selection is too large to validate.");
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return invalid("The saved course selection is not valid JSON."); }
  if (!value || typeof value !== "object") return invalid("The saved course selection is malformed.");
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.module !== "string" || !candidate.module.trim()
    || typeof candidate.term !== "string" || !candidate.term.trim()
    || !Array.isArray(candidate.questionIds) || !candidate.questionIds.length
    || candidate.questionIds.length > MAX_SELECTION
    || candidate.questionIds.some((id) => typeof id !== "string" || !id.trim())) {
    return invalid("The saved course selection has missing or invalid academic/question identifiers.");
  }
  const ids = candidate.questionIds as string[];
  if (new Set(ids).size !== ids.length) return invalid("The saved course selection contains duplicate question identifiers.");
  if (candidate.week !== undefined && (!Number.isSafeInteger(candidate.week) || (candidate.week as number) < 1)) {
    return invalid("The saved course selection has an invalid week.");
  }
  if (candidate.setIds !== undefined && (!Array.isArray(candidate.setIds)
    || candidate.setIds.length > MAX_SELECTION
    || candidate.setIds.some((id: unknown) => typeof id !== "string" || !id.trim()))) {
    return invalid("The saved course selection has invalid collection identifiers.");
  }

  const byId = new Map(questions.map((question) => [question.id, question]));
  let ready = 0;
  let missing = 0;
  const reviewIds: string[] = [];
  for (const id of ids) {
    const record = byId.get(id);
    if (!record) missing += 1;
    else if (questionPracticeReadiness(record) === "ready") ready += 1;
    else reviewIds.push(id);
  }

  if (ready === ids.length) {
    // The canonical reader is still the authority on trusted IDs, term and
    // collection metadata. A smaller returned pool must never be auto-launched.
    const launch = readCourseQuizLaunch(questions);
    if (launch && launch.questionIds.length === ids.length
      && launch.questionIds.every((id, index) => id === ids[index])) {
      return { state: "ready", launch };
    }
    return invalid("The course request did not match the canonical launch reader.");
  }

  return {
    state: "pending", term: candidate.term.trim(), module: candidate.module.trim(),
    ...(typeof candidate.week === "number" ? { week: candidate.week } : {}),
    total: ids.length, ready, missing, review: reviewIds.length, reviewIds,
  };
}
