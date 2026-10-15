import { loadSupabase } from "../account/supabase";
import {
  sharedQuestionSetDigest,
  validateShare,
  type SharedQuestionSetSnapshot,
} from "./questionSetShare";

export interface ResolvedQuestionSetShare {
  id: string;
  snapshot: SharedQuestionSetSnapshot;
  contentDigest: string;
}

export interface OwnedQuestionSetShare {
  id: string;
  sourceId: string;
  token: string;
  title: string;
  questionCount: number;
  createdAt: string;
  expiresAt: string;
  idempotent?: boolean;
}

async function client() {
  const configured = await loadSupabase();
  if (!configured) throw new Error("Question sharing requires cloud configuration.");
  return configured;
}

export async function publishShare(
  sourceId: string,
  snapshot: SharedQuestionSetSnapshot,
): Promise<OwnedQuestionSetShare> {
  if (!sourceId.trim() || sourceId !== sourceId.trim() || [...sourceId].length > 200) {
    throw new Error("Question Set identity is invalid.");
  }
  validateShare(snapshot);
  const configured = await client();
  const { data: { user } } = await configured.auth.getUser();
  if (!user) throw new Error("Sign in to create an unlisted share link.");
  const { data, error } = await configured.rpc("create_question_set_share", {
    p_source_id: sourceId,
    p_snapshot: snapshot,
  });
  if (error) throw new Error(error.message);
  const share = parseOwnedShare(data, true);
  if (share.sourceId !== sourceId) throw new Error("The sharing service returned the wrong Question Set identity.");
  return share;
}

export async function listQuestionSetShares(): Promise<OwnedQuestionSetShare[]> {
  const configured = await client();
  const { data: { user } } = await configured.auth.getUser();
  if (!user) throw new Error("Sign in to manage unlisted share links.");
  const { data, error } = await configured
    .from("question_set_shares")
    .select("id,source_question_set_id,share_token,title,question_count,created_at,expires_at")
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);
  if (!Array.isArray(data)) throw new Error("The sharing service returned an invalid management list.");
  return data.map((row) => parseOwnedShare(row, false));
}

export async function resolveShare(token: string): Promise<ResolvedQuestionSetShare> {
  if (!/^[a-f0-9]{48}$/i.test(token)) throw new Error("This share link is incomplete.");
  const { data, error } = await (await client()).rpc("resolve_question_set_share", { p_token: token });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : undefined;
  if (!isRecord(row)) throw new Error("This share is unavailable or has been revoked.");
  if (typeof row.id !== "string" || !validUuid(row.id)
    || row.share_format_version !== 1
    || typeof row.title !== "string"
    || typeof row.question_count !== "number"
    || !Number.isSafeInteger(row.question_count)) {
    throw new Error("The sharing service returned an invalid set record.");
  }
  validateShare(row.snapshot_payload);
  if (row.title !== row.snapshot_payload.title || row.question_count !== row.snapshot_payload.questions.length) {
    throw new Error("The shared set metadata does not match its protected snapshot.");
  }
  return {
    id: row.id,
    snapshot: row.snapshot_payload,
    contentDigest: await sharedQuestionSetDigest(row.snapshot_payload),
  };
}

export async function revokeShare(id: string) {
  if (!validUuid(id)) throw new Error("Question share identity is invalid.");
  const { error } = await (await client()).rpc("revoke_question_set_share", { p_share_id: id });
  if (error) throw new Error(error.message);
}

function validUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function parseOwnedShare(value: unknown, requireIdempotency: boolean): OwnedQuestionSetShare {
  if (!isRecord(value)
    || typeof value.id !== "string" || !validUuid(value.id)
    || typeof value.source_question_set_id !== "string" || !value.source_question_set_id.trim()
    || value.source_question_set_id !== value.source_question_set_id.trim()
    || [...value.source_question_set_id].length > 200
    || typeof value.share_token !== "string" || !/^[a-f0-9]{48}$/i.test(value.share_token)
    || typeof value.title !== "string"
    || typeof value.question_count !== "number" || !Number.isSafeInteger(value.question_count) || value.question_count < 0
    || !validTimestamp(value.created_at)
    || !validTimestamp(value.expires_at)
    || (requireIdempotency && typeof value.idempotent !== "boolean")) {
    throw new Error("The sharing service returned an invalid link record.");
  }
  return {
    id: value.id,
    sourceId: value.source_question_set_id,
    token: value.share_token,
    title: value.title,
    questionCount: value.question_count,
    createdAt: value.created_at,
    expiresAt: value.expires_at,
    ...(typeof value.idempotent === "boolean" ? { idempotent: value.idempotent } : {}),
  };
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
