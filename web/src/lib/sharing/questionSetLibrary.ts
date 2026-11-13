import { accountOperationClient } from "../account/supabase";
import { hasExplanationProse } from "../questionExplanationCoverage";
import { hasPrivateDeviceCitation, sharedQuestionSetDigest, validateShare, type SharedQuestionSetSnapshot } from "./questionSetShare";

export interface LibraryQuestionSet {
  id: string;
  title: string;
  credit: string;
  tags: string[];
  questionCount: number;
  approvedAt: string;
  likes: number;
  liked: boolean;
}

export interface LibrarySubmission {
  id: string;
  sourceId: string;
  title: string;
  credit: string;
  questionCount: number;
  status: "pending" | "approved" | "rejected";
  reviewNote: string;
  createdAt: string;
}

export interface LibraryQuestionSetPreview {
  id: string;
  snapshot: SharedQuestionSetSnapshot;
  contentDigest: string;
  status: LibrarySubmission["status"];
  /** Protected server row revision, required for an academic decision. */
  reviewRevision?: number;
}

/** Explicit publisher assertions; this service must not invent consent. */
export interface CommunityPublicationAttestations {
  rightsConfirmed: boolean;
  answersConfirmed: boolean;
}

const uuid = (value: unknown): value is string => typeof value === "string"
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const boundedText = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max;
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

async function withAccount<T>(accountId: string, action: (client: Awaited<ReturnType<typeof accountOperationClient>>["client"]) => Promise<T>): Promise<T> {
  const operation = await accountOperationClient();
  if (operation.userId !== accountId) throw new Error("The signed-in account changed. Reopen the Question Set Library.");
  await operation.assertCurrent();
  const value = await action(operation.client);
  await operation.assertCurrent();
  return value;
}

function parseSummary(value: unknown): LibraryQuestionSet {
  if (!record(value) || !uuid(value.id) || !boundedText(value.title, 200) || !value.title
    || !boundedText(value.credit, 80) || !Array.isArray(value.tags) || value.tags.length > 100
    || value.tags.some(tag => !boundedText(tag, 64)) || !count(value.question_count) || value.question_count < 1
    || !boundedText(value.approved_at, 80) || !Number.isFinite(Date.parse(value.approved_at))
    || !count(value.likes) || typeof value.liked !== "boolean") {
    throw new Error("The Question Set Library returned an invalid listing.");
  }
  return { id: value.id, title: value.title, credit: value.credit, tags: value.tags as string[],
    questionCount: value.question_count, approvedAt: value.approved_at, likes: value.likes, liked: value.liked };
}

function parseSubmission(value: unknown): LibrarySubmission {
  if (!record(value) || !uuid(value.id) || !boundedText(value.source_id, 200) || !value.source_id
    || !boundedText(value.title, 200) || !value.title || !boundedText(value.credit, 80)
    || !count(value.question_count) || value.question_count < 1
    || !["pending", "approved", "rejected"].includes(String(value.status))
    || !boundedText(value.review_note, 500) || !boundedText(value.created_at, 80)
    || !Number.isFinite(Date.parse(value.created_at))) {
    throw new Error("The Question Set Library returned an invalid submission.");
  }
  return { id: value.id, sourceId: value.source_id, title: value.title, credit: value.credit,
    questionCount: value.question_count, status: value.status as LibrarySubmission["status"],
    reviewNote: value.review_note, createdAt: value.created_at };
}

export async function searchQuestionSetLibrary(accountId: string, search = "", offset = 0): Promise<LibraryQuestionSet[]> {
  if (search.length > 100 || !Number.isSafeInteger(offset) || offset < 0 || offset > 1000)
    throw new Error("Search must be at most 100 characters.");
  return withAccount(accountId, async client => {
    const { data, error } = await client.rpc("list_question_set_library", { p_search: search, p_offset: offset });
    if (error) throw new Error("The Question Set Library could not be loaded. Refresh and try again.");
    if (!Array.isArray(data) || data.length > 24) throw new Error("The Question Set Library returned an invalid page.");
    return data.map(parseSummary);
  });
}

// The shared SQL reader legitimately returns pending entries to an owner or an
// academic reviewer. Community learners must only see approved content, while
// the moderation queue must inspect pending content before deciding approval.
// Keep these distinct entry points so caller permissions cannot accidentally
// expand what is discoverable/importable.
async function loadQuestionSetPreviewForStatus(
  accountId: string, id: string, requiredStatus: "approved" | "pending",
): Promise<LibraryQuestionSetPreview> {
  if (!uuid(id)) throw new Error("This Question Set link is invalid.");
  return withAccount(accountId, async client => {
    const { data, error } = await client.rpc("get_question_set_library", { p_id: id });
    if (error || !record(data) || data.id !== id || data.status !== requiredStatus)
      throw new Error(requiredStatus === "approved"
        ? "This Question Set is unavailable. It may have been withdrawn."
        : "This submission is no longer awaiting academic review.");
    if (!count(data.review_revision) || data.review_revision < 1)
      throw new Error(requiredStatus === "pending"
        ? "The pending review revision is missing. Refresh the review queue."
        : "The approved Question Set revision is missing. Reopen the listing.");
    validateShare(data.snapshot_payload);
    const snapshot = data.snapshot_payload;
    if (data.title !== snapshot.title || data.question_count !== snapshot.questions.length)
      throw new Error("This Question Set differs from its protected listing.");
    return { id, snapshot, contentDigest: await sharedQuestionSetDigest(snapshot),
      status: requiredStatus,
      reviewRevision: data.review_revision as number };
  });
}

/** Public learner discovery/import: never expose pending or rejected snapshots. */
export function loadQuestionSetLibraryPreview(accountId: string, id: string): Promise<LibraryQuestionSetPreview> {
  return loadQuestionSetPreviewForStatus(accountId, id, "approved");
}

/**
 * Check a preview against the server's exact approved snapshot and revision
 * under the same SQL row lock. No prior preview or cached digest can authorize
 * a newer publication. This confirms the state at RPC execution, not a
 * durable permission lease across a subsequent private vault write.
 */
export async function authorizeQuestionSetLibraryImport(
  accountId: string, inspected: LibraryQuestionSetPreview,
): Promise<LibraryQuestionSetPreview> {
  if (!inspected || !uuid(inspected.id) || inspected.status !== "approved"
    || !count(inspected.reviewRevision) || inspected.reviewRevision < 1
    || !/^[a-f0-9]{64}$/.test(inspected.contentDigest))
    throw new Error("Reopen the approved Question Set before importing it.");
  if (await sharedQuestionSetDigest(inspected.snapshot) !== inspected.contentDigest)
    throw new Error("The previewed Question Set changed. Reopen the listing.");

  return withAccount(accountId, async client => {
    const { data, error } = await client.rpc("authorize_question_set_library_import", {
      p_id: inspected.id,
      p_expected_revision: inspected.reviewRevision,
      p_expected_snapshot: inspected.snapshot,
    });
    if (error || !record(data) || data.id !== inspected.id || data.status !== "approved"
      || data.review_revision !== inspected.reviewRevision)
      throw new Error("This reviewed Question Set changed or was withdrawn. Reopen its listing.");
    validateShare(data.snapshot_payload);
    if (data.title !== data.snapshot_payload.title
      || data.question_count !== data.snapshot_payload.questions.length)
      throw new Error("The published Question Set differs from its protected listing.");
    const contentDigest = await sharedQuestionSetDigest(data.snapshot_payload);
    if (contentDigest !== inspected.contentDigest)
      throw new Error("The reviewed Question Set changed. Reopen its listing.");
    return { id: inspected.id, snapshot: data.snapshot_payload, status: "approved",
      reviewRevision: data.review_revision as number, contentDigest };
  });
}

/** Moderation only. The queue checks reviewer access; SQL enforces reviewer
 * authority again at the review mutation, independent of this read. */
export function loadPendingQuestionSetReviewPreview(accountId: string, id: string): Promise<LibraryQuestionSetPreview> {
  return loadQuestionSetPreviewForStatus(accountId, id, "pending");
}

export async function listMyQuestionSetSubmissions(accountId: string): Promise<LibrarySubmission[]> {
  return withAccount(accountId, async client => {
    const { data, error } = await client.rpc("my_question_set_library");
    if (error || !Array.isArray(data) || data.length > 50) throw new Error("Your submissions could not be loaded.");
    return data.map(parseSubmission);
  });
}

export async function submitQuestionSetToLibrary(accountId: string, sourceId: string,
  snapshot: SharedQuestionSetSnapshot, credit: string,
  attestations: CommunityPublicationAttestations): Promise<string> {
  // A valid answer key is not evidence of redistribution rights or human
  // source review. Reject direct callers that omit either explicit assertion.
  if (attestations?.rightsConfirmed !== true || attestations?.answersConfirmed !== true)
    throw new Error("Confirm redistribution rights and source-reviewed answers before submitting.");
  if (!sourceId.trim() || sourceId !== sourceId.trim() || sourceId.length > 200 || credit.length > 80)
    throw new Error("Check the Question Set identity and public credit.");
  validateShare(snapshot);
  // Preconstructed snapshots can bypass createQuestionSetShare's outbound
  // privacy check. Enforce it at the final new-submission RPC boundary.
  // Historical approved sets remain readable/importable unchanged.
  if (snapshot.questions.some(question => hasPrivateDeviceCitation(question.citation)))
    throw new Error("Question Set citation contains a private local file path, inline document URI or URL credentials and cannot be published.");
  if (!snapshot.questions.length || snapshot.questions.some(question => !question.correctKey))
    throw new Error("Every public library question needs a confirmed answer.");
  // The dialog filters missing/placeholder rationales, but other callers can
  // reach this service directly. Enforce explanation presence at final egress,
  // without treating prose as medically verified or relaxing reviewer approval.
  // Historical approved snapshots remain readable without this new admission gate.
  if (snapshot.questions.some(question => !hasExplanationProse(question.explanation)))
    throw new Error("Every submitted question needs teaching explanation prose, not only a key or source notice. Review missing explanations before submitting.");
  return withAccount(accountId, async client => {
    const { data, error } = await client.rpc("submit_question_set_library", {
      p_source_id: sourceId, p_snapshot: snapshot, p_credit: credit.trim(),
      p_rights_confirmed: attestations.rightsConfirmed, p_answers_confirmed: attestations.answersConfirmed,
    });
    if (error || !uuid(data)) throw new Error(error?.message ?? "The submission could not be confirmed.");
    return data;
  });
}

export async function withdrawQuestionSetSubmission(accountId: string, id: string): Promise<void> {
  if (!uuid(id)) throw new Error("This submission is invalid.");
  return withAccount(accountId, async client => {
    const { error } = await client.rpc("withdraw_question_set_library", { p_id: id });
    if (error) throw new Error(error.message);
  });
}

export async function setQuestionSetLibraryLike(accountId: string, id: string, liked: boolean): Promise<void> {
  if (!uuid(id)) throw new Error("This Question Set is invalid.");
  return withAccount(accountId, async client => {
    const response = await client.rpc("set_question_set_library_like", { p_id: id, p_liked: liked });
    if (response.error)
      throw new Error("Your like could not be saved. Refresh and try again.");
  });
}

export async function listPendingQuestionSets(accountId: string): Promise<LibrarySubmission[]> {
  return withAccount(accountId, async client => {
    const { data, error } = await client.rpc("pending_question_set_library");
    if (error || !Array.isArray(data) || data.length > 100) throw new Error("Question Set submissions could not be loaded.");
    return data.map(parseSubmission);
  });
}

/**
 * Recheck the exact pending snapshot a reviewer inspected before submitting a
 * decision. Review evidence must not silently authorize a replaced answer key
 * or a withdrawn/resubmitted revision. The SQL RPC still owns reviewer/RLS
 * authorization; SQL also enforces the inspected revision atomically.
 */
export async function reviewQuestionSetSubmission(
  accountId: string, reviewed: LibraryQuestionSetPreview, approved: boolean, reason: string,
): Promise<void> {
  if (!reviewed || !uuid(reviewed.id) || reviewed.status !== "pending"
    || !count(reviewed.reviewRevision) || reviewed.reviewRevision < 1
    || !/^[a-f0-9]{64}$/.test(reviewed.contentDigest))
    throw new Error("Reopen the pending Question Set before reviewing it.");
  if (reason.trim().length < 8 || reason.trim().length > 500)
    throw new Error("Give a review reason of 8 to 500 characters.");
  // Fail closed if the caller supplies an altered preview or a digest from
  // another snapshot. Neither can stand in for the reviewer-visible revision.
  if (await sharedQuestionSetDigest(reviewed.snapshot) !== reviewed.contentDigest)
    throw new Error("The reviewed Question Set changed. Reopen and review it again.");

  // One operation epoch must span *both* the fresh read and the decision,
  // including an A -> B -> A switch during an asynchronous RPC.
  const operation = await accountOperationClient();
  if (operation.userId !== accountId)
    throw new Error("The signed-in account changed. Reopen the Question Set Library.");
  await operation.assertCurrent();
  const { data, error } = await operation.client.rpc("get_question_set_library", { p_id: reviewed.id });
  await operation.assertCurrent();
  if (error || !record(data) || data.id !== reviewed.id || data.status !== "pending")
    throw new Error("This submission is no longer awaiting academic review. Reopen the queue.");
  validateShare(data.snapshot_payload);
  if (data.title !== data.snapshot_payload.title || data.question_count !== data.snapshot_payload.questions.length
    || data.review_revision !== reviewed.reviewRevision
    || await sharedQuestionSetDigest(data.snapshot_payload) !== reviewed.contentDigest)
    throw new Error("The pending Question Set changed since inspection. Reopen and review the current answers.");
  await operation.assertCurrent();
  const decision = await operation.client.rpc("review_question_set_library", {
    p_id: reviewed.id, p_approved: approved, p_reason: reason.trim(),
    // PostgreSQL compares this jsonb against the stored pending snapshot
    // inside the UPDATE, closing the read-then-decide revision race.
    p_expected_snapshot: reviewed.snapshot,
    p_expected_revision: reviewed.reviewRevision,
  });
  await operation.assertCurrent();
  if (decision.error) throw new Error(decision.error.message);
}
