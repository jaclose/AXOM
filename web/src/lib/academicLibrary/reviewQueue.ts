import { academicClient, type AcademicPreview } from "./client";
import { academicAccountScope } from "./accountScope";

/** Extends PR #30's submission metadata with the exact reviewed revision and
 * display name. Question bodies, files and learner data never enter this list. */
export interface ReviewSubmission {
  id: string;
  title: string;
  module: string;
  term: string;
  current_revision_id: string;
  owner_display_name: string;
  ready_questions: number;
  review_questions: number;
  submitted_at: string;
}
export interface ReviewCursor { submittedAt: string; id: string }
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const label = (value: unknown): value is string => typeof value === "string" && Boolean(value.trim()) && value.length <= 180;
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 100000;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

async function rpc(name: string, parameters: Record<string, unknown>, accountId: string) {
  const scope = academicAccountScope(accountId);
  try {
    scope.assertCurrent();
    const client = await academicClient(accountId);
    scope.assertCurrent();
    const result = await client.rpc(name, parameters);
    scope.assertCurrent();
    return result;
  } finally { scope.dispose(); }
}

/** Ask afresh on each queue visit/refresh so a revoked membership is not cached. */
export async function canReviewAcademicCourses(accountId: string): Promise<boolean> {
  const { data, error } = await rpc("academic_is_reviewer", {}, accountId);
  return !error && data === true;
}

export async function listAcademicReviewQueue(accountId: string, cursor?: ReviewCursor): Promise<ReviewSubmission[]> {
  const { data, error } = await rpc("academic_review_queue", {
    after_submitted_at: cursor?.submittedAt ?? null, after_id: cursor?.id ?? null,
  }, accountId);
  if (error) throw new Error("The review queue could not be loaded. Refresh and try again.");
  if (!Array.isArray(data) || data.length > 24) throw new Error("The review queue response is invalid. Refresh and try again.");
  const seen = new Set<string>();
  return data.map((value: unknown) => {
    if (!record(value) || !uuid(value.id) || !uuid(value.current_revision_id)
      || !label(value.title) || !label(value.module) || !label(value.term) || !label(value.owner_display_name)
      || !count(value.ready_questions) || !count(value.review_questions)
      || typeof value.submitted_at !== "string" || !Number.isFinite(Date.parse(value.submitted_at)) || seen.has(value.id)) {
      throw new Error("The review queue response is invalid. Refresh and try again.");
    }
    seen.add(value.id);
    return { id: value.id, title: value.title, module: value.module, term: value.term,
      current_revision_id: value.current_revision_id, owner_display_name: value.owner_display_name,
      ready_questions: value.ready_questions, review_questions: value.review_questions, submitted_at: value.submitted_at };
  });
}

export async function previewAcademicReview(submission: ReviewSubmission, accountId: string): Promise<AcademicPreview> {
  const { data, error } = await rpc("academic_review_preview", {
    collection: submission.id, revision: submission.current_revision_id,
  }, accountId);
  if (error || !record(data) || data.id !== submission.current_revision_id || data.collection_id !== submission.id
    || typeof data.template_text !== "string" || new TextEncoder().encode(data.template_text).length > 262144
    || !count(data.ready_questions) || !count(data.review_questions)) {
    throw new Error("This submission is no longer available for review. Refresh the queue and open its current preview.");
  }
  return { id: submission.current_revision_id, collection_id: submission.id, template_text: data.template_text,
    ready_questions: data.ready_questions, review_questions: data.review_questions,
    ...(typeof data.source_revision === "string" ? { source_revision: data.source_revision } : {}) };
}

export async function decideAcademicReview(submission: ReviewSubmission, approved: boolean, accountId: string): Promise<void> {
  const { error } = await rpc("academic_review", {
    collection: submission.id, approved, expected_revision: submission.current_revision_id,
  }, accountId);
  if (error) throw new Error(error.code === "40001"
    ? "This submission changed. Refresh the queue and open its latest preview before reviewing."
    : "Your review could not be saved. Refresh the queue to check its status, then retry.");
}
