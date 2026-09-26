import { loadSupabase } from "../account/supabase";
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

  async push(envelope: SnapshotEnvelope): Promise<PushResult> {
    const { data, error } = await (await this.client()).rpc("push_workspace_revision", {
      p_base_revision: envelope.baseRevision,
      p_schema_version: envelope.schemaVersion,
      p_content_hash: envelope.contentHash,
      p_snapshot_payload: envelope.payload,
      p_device_id: envelope.deviceId,
      p_idempotency_key: envelope.idempotencyKey,
      p_reason: envelope.reason,
    });
    if (error) throw new Error(error.message);
    const row = data as Record<string, unknown>;
    return row.status === "conflict"
      ? { status: "conflict", serverRevision: Number(row.server_revision), preservedRevisionId: String(row.preserved_revision_id) }
      : { status: "accepted", revision: Number(row.revision), revisionId: String(row.revision_id), idempotent: Boolean(row.idempotent) };
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
    return (data ?? []).map(mapRevision);
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
    const { data, error } = await (await this.client())
      .from("workspace_revisions")
      .select(REVISION_COLUMNS)
      .eq("id", id)
      .single();
    if (error) throw new Error(error.message);
    return mapRevision(data);
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
    const { error } = await (await this.client()).rpc("delete_my_cloud_data");
    if (error) throw new Error(error.message);
  }
}

function mapRevision(row: Record<string, unknown>): ProtectedRevision {
  return {
    id: String(row.id),
    revision: Number(row.revision),
    schemaVersion: Number(row.schema_version),
    contentHash: String(row.content_hash),
    payload: row.snapshot_payload as ProtectedRevision["payload"],
    reason: String(row.reason),
    createdAt: String(row.created_at),
  };
}
