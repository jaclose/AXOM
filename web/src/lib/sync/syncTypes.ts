import type { NoctyriumState } from "../types";

export type ProtectionStatus =
  | "local-only"
  | "saved-locally"
  | "syncing"
  | "protected"
  | "offline"
  /** An upload failed and another try is a short wait away. */
  | "retrying"
  /** Several tries failed; the next one is a long wait away. */
  | "paused"
  /** The account refused this upload, so repeating it cannot work. */
  | "blocked"
  | "conflict";

/**
 * Why the last upload failed. "network" never reached the account, "server"
 * reached it and it could not answer, "auth" needs a fresh session, and
 * "rejected" is a refusal: the same upload would be refused again.
 */
export type SyncFailureKind = "network" | "server" | "auth" | "rejected";

/** What a refusal was about. */
export type SyncRejection = "too-large" | "storage-limit" | "refused";

/** Bookkeeping about a failed upload. Codes only: never server text or content. */
export interface SyncFailure {
  kind: SyncFailureKind;
  rejection?: SyncRejection;
  /** HTTP status; 0 when no answer arrived. */
  status: number;
  /** SQLSTATE or PostgREST code, when the account sent one. */
  code?: string;
  at: string;
}

export interface SyncMetadata {
  deviceId: string;
  /** The account this device's workspace is linked to. */
  accountUserId?: string;
  baseRevision: number;
  pending: boolean;
  pendingIdempotencyKey?: string;
  lastHash?: string;
  lastProtectedAt?: string;
  attempt: number;
  /** Set when the server preserved this device's upload as a conflict. */
  conflictServerRevision?: number;
  /** The last failed upload, until one succeeds. */
  lastError?: SyncFailure;
  /** Automatic uploads wait until this time (ISO). Shared by every tab. */
  nextAttemptAt?: string;
  /** When the last upload started (ISO), and how large its snapshot was. */
  lastAttemptAt?: string;
  lastPayloadBytes?: number;
  /** The idempotency key of the last upload that was actually sent. */
  sentIdempotencyKey?: string;
}

export type RevisionReason = "foundation" | "automatic" | "manual" | "pre_restore" | "restore";

export interface SnapshotEnvelope {
  schemaVersion: number;
  contentHash: string;
  payload: NoctyriumState;
  /** Size of the payload as compact JSON, in bytes. */
  payloadBytes: number;
  deviceId: string;
  baseRevision: number;
  idempotencyKey: string;
  reason: RevisionReason;
}

export type PushResult =
  /** `contentHash` is what the account stored; on a replayed retry it can differ from what was just sent. */
  | { status: "accepted"; revision: number; revisionId: string; idempotent: boolean; contentHash?: string }
  /** `preservedRevisionId` is absent when the account already holds its limit of conflict copies. */
  | { status: "conflict"; serverRevision: number; preservedRevisionId?: string };

export interface ProtectedRevision {
  id: string;
  revision: number;
  schemaVersion: number;
  contentHash: string;
  payload: NoctyriumState;
  reason: string;
  createdAt: string;
}

/** Revision metadata without the (large) payload, for history lists. */
export type RevisionSummary = Omit<ProtectedRevision, "payload">;

export interface AccountDevice {
  deviceId: string;
  label: string;
  platform?: string;
  lastSeenAt: string;
  lastProtectedRevision?: number;
  current: boolean;
}

export interface SyncTransport {
  push(envelope: SnapshotEnvelope): Promise<PushResult>;
  history(): Promise<ProtectedRevision[]>;
  revision(id: string): Promise<ProtectedRevision>;
}
