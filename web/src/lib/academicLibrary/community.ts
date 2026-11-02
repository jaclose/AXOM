import { academicClient } from "./client";

/** Metadata for a submitted current revision. Question text and media are
 * fetched only when a signed-in reader explicitly opens the upload. */
export interface CommunityUpload {
  id: string;
  title: string;
  module: string;
  term: string;
  current_revision_id: string;
  ready_questions: number;
  review_questions: number;
  submitted_at: string;
  owned: boolean;
  status: "unreviewed";
}

export interface CommunityCursor { submittedAt: string; id: string }
export interface CommunityPreview {
  id: string;
  collection_id: string;
  source_revision?: string | null;
  template_text: string;
  ready_questions: number;
  review_questions: number;
}

const uuid = (value: unknown): value is string => typeof value === "string"
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const count = (value: unknown): value is number => typeof value === "number"
  && Number.isSafeInteger(value) && value >= 0 && value <= 100000;
const timestamp = (value: unknown): value is string => typeof value === "string"
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value) && Number.isFinite(Date.parse(value));

function readCommunityUploads(value: unknown): CommunityUpload[] {
  if (!Array.isArray(value) || value.length > 24 || value.some(row => !row
    || !uuid(row.id) || !uuid(row.current_revision_id)
    || ![row.title, row.module, row.term].every((part: unknown) => typeof part === "string" && part.length > 0 && part.length <= 180)
    || !count(row.ready_questions) || !count(row.review_questions)
    || !timestamp(row.submitted_at) || typeof row.owned !== "boolean" || row.status !== "unreviewed")) {
    throw new Error("The community upload list is invalid.");
  }
  return value as CommunityUpload[];
}

/** Current unreviewed submissions, newest first. Approved courses move to the
 * existing academic catalog and are no longer returned here. */
export async function listCommunityUploads(search = "", term = "", after?: CommunityCursor): Promise<CommunityUpload[]> {
  if (after && (!timestamp(after.submittedAt) || !uuid(after.id))) throw new Error("The community page cursor is invalid.");
  const client = await academicClient();
  const { data, error } = await client.rpc("academic_community_catalog", {
    search, term_filter: term, after_submitted_at: after?.submittedAt ?? null, after_id: after?.id ?? null,
  });
  if (error) throw new Error("Community uploads could not be loaded. Your saved courses are unchanged.");
  return readCommunityUploads(data);
}

/** Returns only the current submitted plan and counts. Full revision provenance
 * stays private until reviewer approval. */
export async function communityPreview(collectionId: string, revisionId: string,
  accountId?: string): Promise<CommunityPreview> {
  if (!uuid(collectionId) || !uuid(revisionId)) throw new Error("The community upload identity is invalid.");
  const { data, error } = await (await academicClient(accountId)).rpc("academic_community_preview", {
    collection: collectionId, revision: revisionId,
  });
  if (error || !data || data.id !== revisionId || data.collection_id !== collectionId
    || typeof data.template_text !== "string" || new TextEncoder().encode(data.template_text).length > 262144
    || !count(data.ready_questions) || !count(data.review_questions)
    || (data.source_revision != null && (typeof data.source_revision !== "string" || data.source_revision.length > 80))) {
    throw new Error("This community preview is unavailable. Your saved material is unchanged.");
  }
  return data as CommunityPreview;
}

/** A completed immutable upload is visible to signed-in community readers only
 * after its owner explicitly attests sharing rights and submits this revision. */
export async function submitCommunityUpload(collectionId: string, revisionId: string,
  accountId: string, rightsAttested: boolean): Promise<void> {
  if (!uuid(collectionId) || !uuid(revisionId)) throw new Error("The uploaded course identity is invalid.");
  if (!rightsAttested) throw new Error("Confirm that you have the right to share this material.");
  const { error } = await (await academicClient(accountId)).rpc("academic_submit_community", {
    collection: collectionId, revision: revisionId, rights_attested: true,
  });
  if (error) throw new Error("This current, completed course could not be submitted to Community Uploads. Check its status and retry.");
}

export async function withdrawCommunityUpload(collectionId: string, revisionId: string, accountId: string): Promise<void> {
  if (!uuid(collectionId) || !uuid(revisionId)) throw new Error("The community upload identity is invalid.");
  const { error } = await (await academicClient(accountId)).rpc("academic_community_withdraw", {
    collection: collectionId, revision: revisionId,
  });
  if (error) throw new Error("This pending upload could not be withdrawn. Refresh its status and retry.");
}

/** Only a service-role appointed academic reviewer can promote or reject the
 * exact current submission; the server enforces both checks. */
export async function reviewCommunityUpload(collectionId: string, revisionId: string,
  approved: boolean, accountId: string): Promise<void> {
  if (!uuid(collectionId) || !uuid(revisionId)) throw new Error("The community upload identity is invalid.");
  const { error } = await (await academicClient(accountId)).rpc("academic_community_review", {
    collection: collectionId, revision: revisionId, approved,
  });
  if (error) throw new Error(/Reviewer access/.test(error.message ?? "")
    ? "Only an academic reviewer can approve community uploads."
    : "The submission changed or the review could not be saved. Refresh it before trying again.");
}
