import { accountOperationClient } from "../account/supabase";
import { sharedQuestionSetDigest, validateShare, type SharedQuestionSetSnapshot } from "./questionSetShare";

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

export async function loadQuestionSetLibraryPreview(accountId: string, id: string): Promise<LibraryQuestionSetPreview> {
  if (!uuid(id)) throw new Error("This Question Set link is invalid.");
  return withAccount(accountId, async client => {
    const { data, error } = await client.rpc("get_question_set_library", { p_id: id });
    // Owners and reviewers may inspect non-public submissions through this RPC.
    // Community discovery/import must never consume those unapproved snapshots.
    if (error || !record(data) || data.id !== id || data.status !== "approved")
      throw new Error("This Question Set is unavailable. It may have been withdrawn.");
    validateShare(data.snapshot_payload);
    const snapshot = data.snapshot_payload;
    if (data.title !== snapshot.title || data.question_count !== snapshot.questions.length)
      throw new Error("This Question Set differs from its protected listing.");
    return { id, snapshot, contentDigest: await sharedQuestionSetDigest(snapshot),
      status: data.status as LibrarySubmission["status"] };
  });
}

export async function listMyQuestionSetSubmissions(accountId: string): Promise<LibrarySubmission[]> {
  return withAccount(accountId, async client => {
    const { data, error } = await client.rpc("my_question_set_library");
    if (error || !Array.isArray(data) || data.length > 50) throw new Error("Your submissions could not be loaded.");
    return data.map(parseSubmission);
  });
}

export async function submitQuestionSetToLibrary(accountId: string, sourceId: string,
  snapshot: SharedQuestionSetSnapshot, credit: string): Promise<string> {
  if (!sourceId.trim() || sourceId !== sourceId.trim() || sourceId.length > 200 || credit.length > 80)
    throw new Error("Check the Question Set identity and public credit.");
  validateShare(snapshot);
  if (!snapshot.questions.length || snapshot.questions.some(question => !question.correctKey))
    throw new Error("Every public library question needs a confirmed answer.");
  return withAccount(accountId, async client => {
    const { data, error } = await client.rpc("submit_question_set_library", {
      p_source_id: sourceId, p_snapshot: snapshot, p_credit: credit.trim(),
      p_rights_confirmed: true, p_answers_confirmed: true,
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

export async function reviewQuestionSetSubmission(accountId: string, id: string, approved: boolean, reason: string): Promise<void> {
  if (!uuid(id) || reason.trim().length < 8 || reason.trim().length > 500) throw new Error("Give a review reason of 8 to 500 characters.");
  return withAccount(accountId, async client => {
    const { error } = await client.rpc("review_question_set_library", { p_id: id, p_approved: approved, p_reason: reason.trim() });
    if (error) throw new Error(error.message);
  });
}
