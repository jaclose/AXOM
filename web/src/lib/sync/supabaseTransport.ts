import type { SupabaseClient } from "@supabase/supabase-js";
import { deferContent } from "./deferredContent";
import { saveCloudMediaIndex } from "./cloudMediaCache";
import { readSyncBaseline, saveSyncBaseline } from "./syncBaseline";
import { workspaceDelta } from "./workspaceDelta";
import { workspaceDigest } from "./workspaceDigest";
import { uploadCloudContent, hydrateCloudContent, readContentReferences } from "./cloudContent";
import { canonicalJson, sha256 } from "../compressedText";
import { prepareCloudSnapshot, decodeCloudSnapshot, contentCheckpointHash } from "./cloudSnapshot";
import { uploadCloudMedia, readMediaManifest, validateWorkspaceMedia } from "./cloudMedia";
import { ORIGINALS_BUCKET, repairMissingCloudOriginals, uploadCloudOriginals } from "./cloudOriginals";
import { MAX_SNAPSHOT_BYTES } from "./syncPolicy";
import { accountOperationClient, loadSupabase } from "../account/supabase";
import { SyncPushError, classifyPushFailure } from "./syncFailure";
import type {
  AccountDevice,
  ProtectedRevision,
  PushResult,
  RevisionSummary,
  SnapshotEnvelope,
  SyncTransport,
} from "./syncTypes";

const REVISION_COLUMNS = "id,revision,schema_version,content_hash,snapshot_payload,reason,created_at";
const SUMMARY_COLUMNS = "id,revision,schema_version,content_hash,reason,created_at";

export class SupabaseSyncTransport implements SyncTransport {
  private async client() {
    const value = await loadSupabase();
    if (!value) throw new Error("Cloud protection is not configured. Your work remains saved on this device.");
    return value;
  }

  /**
   * Upload one snapshot. Every failure is thrown as a SyncPushError that says
   * whether another try can help, and the request gives up after a bounded
   * time, so the caller is never left waiting on a silent connection.
   */
  prepare = prepareCloudSnapshot;

  async push(envelope: SnapshotEnvelope): Promise<PushResult> {
    const { client, userId, assertCurrent, resumable } = await accountOperationClient();
    if (!envelope.accountUserId || userId !== envelope.accountUserId) throw new Error("The workspace is linked to a different account. Upload was stopped.");
    if (envelope.payload.deferredContent && envelope.payload.deferredContent.accountId !== userId) throw new Error("Download your saved content in its original account before transferring this workspace.");
    if (!envelope.packed) envelope = await this.prepare(envelope);
    const baseline = await readSyncBaseline(userId, envelope.baseRevision);
    let previous: { media?: unknown; sources?: unknown; content?: string } | null | undefined = baseline?.packed;
    if (!previous) {
      const result = await client.from("workspace_revisions")
        .select("media:snapshot_payload->media,sources:snapshot_payload->sources,content:snapshot_payload->>content").neq("reason", "conflict").order("revision", { ascending: false }).limit(1).maybeSingle();
      if (result.error) throw result.error;
      previous = result.data;
    }
    await uploadCloudContent(client, userId, envelope.contentObjects ?? [], previous?.sources ? readContentReferences(previous.sources) : [], assertCurrent);
    await uploadCloudOriginals(client, userId, envelope.payload, previous?.content, assertCurrent, resumable);
    const media = await uploadCloudMedia(client, userId, envelope.payload, assertCurrent, previous?.media ? readMediaManifest(previous.media) : []);
    const payload = { ...envelope.packed!, media };
    if (new TextEncoder().encode(JSON.stringify(payload)).length > MAX_SNAPSHOT_BYTES) throw new SyncPushError({ kind: "rejected", rejection: "too-large", status: 0 }, "This compressed workspace exceeds the account limit.");
    await assertCurrent();
    const changes = baseline && baseline.packed._axomHashFormat === payload._axomHashFormat ? workspaceDelta(baseline.packed, payload) : undefined;
    const deltaBytes = changes ? new TextEncoder().encode(JSON.stringify(changes)).length : Infinity;
    const useDelta = changes && changes.length <= 1000 && deltaBytes < Math.min(1_000_000, envelope.payloadBytes);
    const common = {
      p_base_revision: envelope.baseRevision,
      p_schema_version: envelope.schemaVersion,
      p_content_hash: envelope.contentHash,
      p_device_id: envelope.deviceId,
      p_idempotency_key: envelope.idempotencyKey,
      p_reason: envelope.reason,
    };
    let requestBytes = 0;
    const send = async (delta: boolean) => {
      const args = delta ? { ...common, p_base_hash: baseline!.contentHash, p_changes: changes! } : { ...common, p_snapshot_payload: payload };
      requestBytes += new TextEncoder().encode(JSON.stringify(args)).length;
      const request = client.rpc(delta ? "push_workspace_delta_v2" : "push_workspace_revision_v2", args);
      const signal = timeoutSignal(pushTimeout(requestBytes));
      return signal && typeof request.abortSignal === "function" ? request.abortSignal(signal) : request;
    };
    let response = await send(Boolean(useDelta));
    if (useDelta && ["PT428", "PGRST202"].includes(response.error?.code ?? "")) {
      // An evicted/corrupt cache or an older backend cannot invalidate local
      // work. The same key takes the existing, fully validated snapshot path.
      await assertCurrent();
      response = await send(false);
    }
    if (response.error?.code === "PT409" && /original source upload is incomplete/i.test(response.error.message)) {
      // An older acknowledged snapshot may reference an original subsequently
      // removed from Storage. Fast-path uploads skip unchanged source hashes;
      // only a server-confirmed missing original triggers an owner-scoped
      // metadata check and replay from a verified local original.
      await assertCurrent();
      const repaired = await repairMissingCloudOriginals(client, userId, envelope.payload, assertCurrent, resumable);
      if (!repaired) throw new Error("An original source upload is incomplete but no recoverable object was found. Keep the local source and inspect account Storage.");
      await assertCurrent();
      response = await send(false); // Same idempotency key; the first attempt was refused.
    }
    const { data, error, status } = response;
    if (error) throw new SyncPushError(classifyPushFailure(error, status ?? 0), error.message);
    await assertCurrent();
    const result = readPushResult(data, status ?? 200);
    let verified: PushResult = result;
    if (result.status === "accepted") {
      // RPC acceptance is necessary but not sufficient for a green "cloud
      // protected" state. The owner's row must be readable with the exact
      // stored hash and revision before the local retry queue can be cleared.
      const storedHash = await verifyCloudRevisionReceipt(client, userId, result, envelope.contentHash, assertCurrent);
      verified = { ...result, contentHash: storedHash };
      await assertCurrent();
      await saveCloudMediaIndex(userId, media);
      if (!result.idempotent || storedHash === envelope.contentHash) {
        await assertCurrent();
        await saveSyncBaseline(userId, { revision: result.revision, contentHash: envelope.contentHash, packed: payload });
      }
    }
    return { ...verified, transferBytes: requestBytes };
  }

  /** Full revisions (with payload). Prefer summaries() for lists. */
  async history(): Promise<ProtectedRevision[]> {
    const { data, error } = await (await this.client())
      .from("workspace_revisions")
      .select(REVISION_COLUMNS)
      .neq("reason", "conflict")
      .order("revision", { ascending: false })
      .limit(30);
    if (error) throw new Error(error.message);
    return Promise.all((data ?? []).map((row) => this.revision(String(row.id))));
  }

  /** Lightweight history for display — never downloads snapshot payloads. */
  async summaries(limit = 30): Promise<RevisionSummary[]> {
    const { data, error } = await (await this.client())
      .from("workspace_revisions")
      .select(SUMMARY_COLUMNS)
      .neq("reason", "conflict")
      .order("revision", { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return (data ?? []).map((row: Record<string, unknown>) => ({
      id: String(row.id),
      revision: Number(row.revision),
      schemaVersion: Number(row.schema_version),
      contentHash: String(row.content_hash),
      reason: String(row.reason),
      createdAt: String(row.created_at),
    }));
  }

  async revision(id: string): Promise<ProtectedRevision> {
    const { client, userId, assertCurrent } = await accountOperationClient();
    const { data, error } = await client
      .from("workspace_revisions")
      .select(REVISION_COLUMNS)
      .eq("id", id)
      .single();
    if (error) throw new Error(error.message);
    await assertCurrent();
    const revision = await mapRevision(data);
    if (revision.sources && revision.hashFormat === 2) {
      if (await contentCheckpointHash(revision.payload, revision.sources) !== revision.contentHash) throw new Error("The account checkpoint failed its integrity check. Your workspace is unchanged.");
      revision.payload = deferContent(revision.payload, userId, revision.sources, revision.media ?? []);
    } else if (revision.sources) {
      revision.payload = await hydrateCloudContent(client, userId, revision.payload, revision.sources, assertCurrent);
      const hash = revision.hashFormat === 1 ? (await workspaceDigest(revision.payload)).hash
        : await sha256(new TextEncoder().encode(canonicalJson(revision.payload)));
      if (hash !== revision.contentHash) {
        throw new Error("The reconstructed account workspace failed its integrity check.");
      }
    }
    if (revision.media !== undefined && !revision.payload.deferredContent) validateWorkspaceMedia(revision.payload, revision.media);
    return revision;
  }

  async prepareMediaCache(revision: ProtectedRevision, expectedUserId: string): Promise<void> {
    if (!revision.media) return; // Legacy versions never claimed to contain images.
    const { userId, assertCurrent } = await accountOperationClient();
    if (userId !== expectedUserId) throw new Error("The signed-in account changed. Restore was stopped.");
    await assertCurrent();
    await saveCloudMediaIndex(userId, revision.media);
    await assertCurrent();
  }

  async latestRevision(): Promise<number> {
    const { data, error } = await (await this.client()).from("workspaces").select("current_revision").maybeSingle();
    if (error) throw new Error(error.message);
    return Number((data as { current_revision?: number } | null)?.current_revision ?? 0);
  }

  async touchDevice(input: { deviceId: string; label: string; platform: string; revision?: number }): Promise<void> {
    const { error } = await (await this.client()).rpc("touch_account_device", {
      p_device_id: input.deviceId,
      p_label: input.label.slice(0, 80) || "Device",
      p_platform: input.platform.slice(0, 40),
      p_revision: input.revision ?? null,
    });
    if (error) throw new Error(error.message);
  }

  async devices(currentDeviceId: string): Promise<AccountDevice[]> {
    const { data, error } = await (await this.client())
      .from("account_devices")
      .select("device_id,label,platform,last_seen_at,last_protected_revision")
      .order("last_seen_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    return (data ?? []).map((row: Record<string, unknown>) => ({
      deviceId: String(row.device_id),
      label: String(row.label ?? "Device"),
      platform: typeof row.platform === "string" ? row.platform : undefined,
      lastSeenAt: String(row.last_seen_at),
      lastProtectedRevision: row.last_protected_revision == null ? undefined : Number(row.last_protected_revision),
      current: String(row.device_id) === currentDeviceId,
    }));
  }

  async forgetDevice(deviceIdToForget: string): Promise<void> {
    const { error } = await (await this.client()).from("account_devices").delete().eq("device_id", deviceIdToForget);
    if (error) throw new Error(error.message);
  }

  /** Deletes every server copy for this account. Local data is untouched. */
  async deleteCloudData(): Promise<void> {
    const { client, userId, assertCurrent } = await accountOperationClient();
    for (const name of ["workspace-media", "workspace-content", ORIGINALS_BUCKET]) {
      const bucket = client.storage.from(name);
      for (;;) {
        await assertCurrent();
        const { data, error } = await bucket.list(userId, { limit: 100 });
        if (error) throw error;
        if (!data?.length) break;
        const deleted = await bucket.remove(data.map((object) => `${userId}/${object.name}`));
        if (deleted.error) throw deleted.error;
      }
    }
    await assertCurrent();
    const { error } = await client.rpc("delete_my_cloud_data");
    if (error) throw new Error(error.message);
    await assertCurrent();
    await saveCloudMediaIndex(userId, []);
  }
}

/**
 * Cloud-confirmed is a server-verified revision, not an RPC promise or a
 * Storage callback. The query is scoped to this owner and retrieves only
 * bounded metadata; source bytes were verified separately during transfer.
 *
 * On a replay, the stored hash may be from the FIRST upload for that key.
 * The coordinator must learn that hash so it can enqueue newer local edits.
 */
export async function verifyCloudRevisionReceipt(
  client: SupabaseClient,
  userId: string,
  result: { revision: number; revisionId: string; idempotent: boolean; contentHash?: string },
  requestedHash: string,
  assertCurrent: () => Promise<void>,
): Promise<string> {
  await assertCurrent();
  const read = await client.from("workspace_revisions")
    .select("id,revision,content_hash,reason")
    .eq("id", result.revisionId)
    .eq("user_id", userId)
    .single();
  await assertCurrent();
  if (read.error || !read.data) {
    // An acknowledged write followed by a failed read can still be retried
    // under its original idempotency key; don't mark it as cloud-protected.
    const auth = read.status === 401 || read.status === 403;
    throw new SyncPushError(auth ? { kind: "auth", status: read.status } : { kind: "server", status: read.status || 503 },
      "The account accepted the upload but its saved revision could not be verified. Your local version is unchanged and will be retried.");
  }
  const row = read.data;
  const hash = typeof row.content_hash === "string" ? row.content_hash : "";
  if (row.id !== result.revisionId || Number(row.revision) !== result.revision
    || row.reason === "conflict" || !/^[a-f0-9]{64}$/.test(hash)
    || (result.contentHash !== undefined && result.contentHash !== hash)
    || (!result.idempotent && requestedHash !== hash)) {
    throw new SyncPushError({ kind: "rejected", rejection: "refused", status: 409 },
      "The account's saved revision does not match the uploaded content. Your local version was not marked protected.");
  }
  return hash;
}

/**
 * Only the two answers this version knows count. Anything else is a failure:
 * an answer AXOM cannot read must never be recorded as "protected".
 */
export function readPushResult(data: unknown, status = 200): PushResult {
  const row = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" && value ? value : undefined);
  const revision = (value: unknown) => ((typeof value === "number" || typeof value === "string") && value !== "" && Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : undefined);
  const serverRevision = revision(row.server_revision);
  if (row.status === "conflict" && serverRevision !== undefined) {
    return { status: "conflict", serverRevision, preservedRevisionId: text(row.preserved_revision_id) };
  }
  const accepted = revision(row.revision);
  const revisionId = text(row.revision_id);
  if (row.status === "accepted" && accepted !== undefined && accepted > 0 && revisionId) {
    return { status: "accepted", revision: accepted, revisionId, idempotent: Boolean(row.idempotent), contentHash: text(row.content_hash) };
  }
  throw new SyncPushError({ kind: "rejected", rejection: "refused", status }, "The account answered in a way this version of AXOM does not understand.");
}

/** Allow for a slow uplink (about 40 KB a second) on top of the account's own time, up to five minutes. */
export function pushTimeout(payloadBytes: number): number {
  return Math.min(300_000, 45_000 + Math.round(payloadBytes / 40));
}

function timeoutSignal(ms: number): AbortSignal | undefined {
  if (typeof AbortSignal === "undefined") return undefined;
  if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

async function mapRevision(row: Record<string, unknown>): Promise<ProtectedRevision> {
  const decoded = await decodeCloudSnapshot(row.snapshot_payload);
  return {
    id: String(row.id),
    revision: Number(row.revision),
    schemaVersion: Number(row.schema_version),
    contentHash: String(row.content_hash),
    payload: decoded.payload,
    media: decoded.media,
    sources: decoded.sources,
    hashFormat: decoded.hashFormat,
    reason: String(row.reason),
    createdAt: String(row.created_at),
  };
}
