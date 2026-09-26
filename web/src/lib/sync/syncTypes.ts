import type { NoctyriumState } from "../types";

export type ProtectionStatus =
  | "local-only"
  | "saved-locally"
  | "syncing"
  | "protected"
  | "offline"
  | "retrying"
  | "conflict";

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
}

export type RevisionReason = "foundation" | "automatic" | "manual" | "pre_restore" | "restore";

export interface SnapshotEnvelope {
  schemaVersion: number;
  contentHash: string;
  payload: NoctyriumState;
  deviceId: string;
  baseRevision: number;
  idempotencyKey: string;
  reason: RevisionReason;
}

export type PushResult =
  | { status: "accepted"; revision: number; revisionId: string; idempotent: boolean }
  | { status: "conflict"; serverRevision: number; preservedRevisionId: string };

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
