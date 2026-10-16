import type { CommunicationsService } from "./service";
import { required, checked } from "./service";
import { ProviderError } from "./provider";
import { renderAxomEmail } from "../email";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACCOUNT_STORAGE_BUCKETS = ["workspace-media", "workspace-content", "workspace-originals"] as const;
type StorageFailureScope = "account-storage" | "academic-storage" | "export-storage";
type StorageRemoval = string | { path: string; versionId: string };
interface StorageCleanupPlan {
  bucketName: string;
  failureScope: StorageFailureScope;
  prefix: string;
  removals: StorageRemoval[];
}

async function planStoragePrefix(
  service: CommunicationsService,
  bucketName: string,
  prefix: string,
  failureScope: StorageFailureScope,
): Promise<StorageCleanupPlan> {
  const bucket = service.db.storage.from(bucketName);
  const exactPrefix = `${prefix}/`;
  const removals: StorageRemoval[] = [];
  const seenRemovals = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const listed = await bucket.listV2({
      prefix: exactPrefix,
      limit: 100,
      ...(cursor ? { cursor } : {}),
      sortBy: { column: "name", order: "asc" },
      with_delimiter: false,
      noncurrentVersions: "include",
      deleteMarkers: "include",
    });
    if (listed.error || !listed.data || !Array.isArray(listed.data.objects)
      || !Array.isArray(listed.data.folders) || listed.data.folders.length
      || typeof listed.data.hasNext !== "boolean") {
      throw new Error(`${failureScope}-list-failed`);
    }
    if (!listed.data.objects.length && listed.data.hasNext) {
      throw new Error(`${failureScope}-cleanup-unconfirmed`);
    }
    for (const object of listed.data.objects) {
      if (!object || typeof object.name !== "string") {
        throw new Error(`${failureScope}-object-invalid`);
      }
      const path = typeof object.key === "string"
        ? object.key
        : object.name.startsWith(exactPrefix) ? object.name : `${exactPrefix}${object.name}`;
      if (!path.startsWith(exactPrefix) || path.length === exactPrefix.length) {
        throw new Error(`${failureScope}-object-invalid`);
      }
      const removal: StorageRemoval = typeof object.version === "string" && object.version
        ? { path, versionId: object.version }
        : path;
      const key = JSON.stringify(removal);
      if (seenRemovals.has(key)) throw new Error(`${failureScope}-cleanup-unconfirmed`);
      seenRemovals.add(key);
      removals.push(removal);
    }
    if (!listed.data.hasNext) break;
    if (typeof listed.data.nextCursor !== "string" || !listed.data.nextCursor
      || listed.data.nextCursor === cursor || seenCursors.has(listed.data.nextCursor)) {
      throw new Error(`${failureScope}-cleanup-unconfirmed`);
    }
    seenCursors.add(listed.data.nextCursor);
    cursor = listed.data.nextCursor;
  }
  return { bucketName, failureScope, prefix, removals };
}

async function executeStorageCleanup(service: CommunicationsService, plan: StorageCleanupPlan): Promise<void> {
  const bucket = service.db.storage.from(plan.bucketName);
  let removals = plan.removals;
  let prior = "";
  for (;;) {
    if (removals.length) {
      const signature = JSON.stringify(removals);
      if (signature === prior) throw new Error(`${plan.failureScope}-cleanup-unconfirmed`);
      prior = signature;
      for (let start = 0; start < removals.length; start += 100) {
        const removed = await bucket.remove(removals.slice(start, start + 100));
        if (removed.error) throw new Error(`${plan.failureScope}-remove-failed`);
      }
    }
    const verification = await planStoragePrefix(
      service,
      plan.bucketName,
      plan.prefix,
      plan.failureScope,
    );
    if (!verification.removals.length) return;
    removals = verification.removals;
  }
}

async function executeStorageCleanupPlans(service: CommunicationsService, plans: StorageCleanupPlan[]): Promise<void> {
  for (const plan of plans) await executeStorageCleanup(service, plan);
}

/** Remove immutable workspace objects from each exact owner UUID prefix. The
 * service-role client must not enumerate or remove any unrelated path. */
export async function removeOwnedAccountStorage(service: CommunicationsService, userId: string): Promise<void> {
  const plans = await Promise.all(ACCOUNT_STORAGE_BUCKETS.map(bucket =>
    planStoragePrefix(service, bucket, userId, "account-storage")));
  await executeStorageCleanupPlans(service, plans);
}

/** Remove every immutable academic object owned by this account before Auth
 * deletion cascades its relational manifests. Complete cursor pagination and
 * an empty re-list acknowledge each namespace. Interrupted retries are safe
 * because missing objects are already complete. */
async function planOwnedAcademicStorage(service: CommunicationsService, userId: string): Promise<StorageCleanupPlan[]> {
  const collectionIds: string[] = [];
  const seen = new Set<string>();
  let expected: number | undefined;
  for (let start = 0; ; start += 500) {
    const result = await service.db.from("academic_collections")
      .select("id", { count: "exact" })
      .eq("owner_id", userId)
      .order("id")
      .range(start, start + 499);
    if (result.error || !Array.isArray(result.data) || typeof result.count !== "number") {
      throw new Error("academic-storage-index-unavailable");
    }
    if (expected === undefined) expected = result.count;
    if (result.count !== expected) throw new Error("academic-storage-index-changed");
    for (const row of result.data) {
      if (!row || typeof row.id !== "string" || !UUID.test(row.id) || seen.has(row.id)) {
        throw new Error("academic-storage-index-invalid");
      }
      seen.add(row.id);
      collectionIds.push(row.id);
    }
    if (result.data.length < 500) break;
  }
  if (collectionIds.length !== expected) throw new Error("academic-storage-index-incomplete");

  const plans: StorageCleanupPlan[] = [];
  for (const collectionId of collectionIds) {
    plans.push(await planStoragePrefix(service, "academic-content", collectionId, "academic-storage"));
  }
  return plans;
}

export async function removeOwnedAcademicStorage(service: CommunicationsService, userId: string): Promise<void> {
  await executeStorageCleanupPlans(service, await planOwnedAcademicStorage(service, userId));
}

async function planOwnedExportStorage(service: CommunicationsService, userId: string): Promise<StorageCleanupPlan> {
  const seen = new Set<string>();
  let expected: number | undefined;
  for (let start = 0; ; start += 500) {
    const result = await service.db.from("privacy_requests")
      .select("id,object_path", { count: "exact" })
      .eq("user_id", userId)
      .not("object_path", "is", null)
      .order("id")
      .range(start, start + 499);
    if (result.error || !Array.isArray(result.data) || typeof result.count !== "number") {
      throw new Error("export-storage-index-unavailable");
    }
    if (expected === undefined) expected = result.count;
    if (result.count !== expected) throw new Error("export-storage-index-changed");
    for (const row of result.data) {
      if (!row || typeof row.id !== "string" || !UUID.test(row.id) || typeof row.object_path !== "string"
        || seen.has(row.id) || row.object_path !== `${userId}/${row.id}.json`) {
        throw new Error("export-storage-index-invalid");
      }
      seen.add(row.id);
    }
    if (result.data.length < 500) break;
  }
  if (seen.size !== expected) throw new Error("export-storage-index-incomplete");
  // Enumerating the owner namespace, rather than only recorded paths, also
  // catches upload-before-row-update orphans from interrupted export jobs.
  return planStoragePrefix(service, "communications-exports", userId, "export-storage");
}

export async function removeOwnedExportStorage(service: CommunicationsService, userId: string): Promise<void> {
  await executeStorageCleanup(service, await planOwnedExportStorage(service, userId));
}

async function removeExportAfterBarrierLoss(
  service: CommunicationsService,
  objectPath: string,
  cause: unknown,
  retryAfterConfirmedAbsence: boolean,
): Promise<never> {
  const removed = await service.db.storage.from("communications-exports").remove([objectPath]);
  if (removed.error) throw new Error("export-deletion-reconciliation-required", { cause });
  // A failed upload response is ambiguous even after one remove acknowledgement:
  // the cross-service write has no generation fence. Only a deterministic
  // database refusal may become retryable, and only after an empty re-list.
  if (!retryAfterConfirmedAbsence) {
    throw new Error("export-deletion-reconciliation-required", { cause });
  }
  try {
    const ownerId = objectPath.slice(0, objectPath.indexOf("/"));
    const verification = await planStoragePrefix(
      service,
      "communications-exports",
      ownerId,
      "export-storage",
    );
    if (verification.removals.some(removal =>
      (typeof removal === "string" ? removal : removal.path) === objectPath)) {
      throw new Error("export-storage-cleanup-unconfirmed");
    }
  } catch (error) {
    throw new Error("export-deletion-reconciliation-required", { cause: error });
  }
  throw cause;
}

export async function requestPrivacy(service: CommunicationsService, userId: string, kind: "export" | "deletion"): Promise<void> {
  const user = await service.user(userId);
  if (!user.email_confirmed_at) throw new Error("Verify your email before continuing.");
  const scheduled = new Date(Date.now() + 7 * 86400000).toISOString();
  const result = await service.db.from("privacy_requests").insert({ user_id: userId, kind, status: kind === "deletion" ? "scheduled" : "requested", scheduled_for: kind === "deletion" ? scheduled : null, notification_email: kind === "deletion" ? user.email : null }).select("id").single();
  if (result.error?.code === "23505") {
    const existing = checked(await service.db.from("privacy_requests")
      .select("status,failure_code")
      .eq("user_id", userId)
      .eq("kind", kind)
      .order("created_at", { ascending: false })
      .limit(20)) as { status: string; failure_code: string | null }[] | null;
    const failed = (existing ?? []).find(row => row.status === "failed");
    if (failed) {
      if (kind === "deletion" && failed.failure_code === "deletion-preflight-failed") {
        throw new Error("Cancel the existing failed deletion request before scheduling another.");
      }
      throw new Error(`${kind === "deletion" ? "Deletion" : "Export"} needs manual reconciliation before another request can be scheduled.`);
    }
    return;
  }
  const row = required(result);
  await service.enqueue({ userId, type: kind === "deletion" ? "deletion_requested" : "export_requested", key: `${row.id}:requested`, variables: { requestId: row.id } });
  if (kind === "deletion") await service.enqueue({ userId, type: "deletion_scheduled", key: `${row.id}:scheduled`, variables: { date: scheduled } });
}
export async function cancelDeletion(service: CommunicationsService, userId: string, requestId: string): Promise<void> {
  const current = checked(await service.db.from("privacy_requests").select("id,status,failure_code").eq("id", requestId).eq("user_id", userId).eq("kind", "deletion").maybeSingle());
  const cancellable = current?.status === "scheduled"
    || (current?.status === "failed" && current.failure_code === "deletion-preflight-failed");
  if (!cancellable) throw new Error("Deletion can no longer be cancelled, or it was already cancelled.");
  let query = service.db.from("privacy_requests").update({ status: "cancelled", notification_email: null, failure_code: null })
    .eq("id", requestId).eq("user_id", userId).eq("kind", "deletion").eq("status", current.status);
  if (current.status === "failed") query = query.eq("failure_code", "deletion-preflight-failed");
  const row = checked(await query.select("id").maybeSingle());
  if (!row) throw new Error("Deletion can no longer be cancelled, or it was already cancelled.");
  await service.enqueue({ userId, type: "deletion_cancelled", key: `${row.id}:cancelled` });
}
export async function processPrivacy(service: CommunicationsService): Promise<number> {
  const now = new Date().toISOString();
  // Any stale job may have crossed an external I/O boundary. Keep its durable
  // account barrier closed until an operator confirms Storage and worker state.
  const stale = new Date(Date.now() - 15 * 60000).toISOString();
  checked(await service.db.rpc("quarantine_stale_privacy_requests", { p_stale_before: stale }));
  const requests = checked(await service.db.from("privacy_requests").select("*").in("status", ["requested", "scheduled"]).order("created_at").limit(10));
  let processed = 0;
  for (const request of requests ?? []) {
    if (request.kind === "deletion" && (request.scheduled_for > now || service.env.AXOM_ACCOUNT_DELETION_ENABLED !== "true")) continue;
    const claimed = checked(await service.db.rpc("claim_privacy_request", {
      p_request_id: request.id,
      p_now: now,
    }));
    if (!claimed) continue;
    let destructiveDeletionStarted = false;
    try {
      if (request.kind === "export") {
        const workspace = await service.workspace(request.user_id);
        const [user, prefs, identity, pulses, history, privacy] = await Promise.all([service.user(request.user_id), service.preferenceRows(request.user_id), service.identity(request.user_id), service.db.from("pulse_snapshots").select("*").eq("user_id", request.user_id), service.db.from("email_jobs").select("id,type,status,created_at,sent_at").eq("user_id", request.user_id), service.db.from("privacy_requests").select("id,kind,status,scheduled_for,created_at").eq("user_id", request.user_id)]);
        const data = { format: "axom-account-export", version: 1, generatedAt: now, profile: { id: user.id, email: user.email, displayName: user.user_metadata?.display_name }, preferences: prefs, emailPresentation: identity, workspace: workspace?.state ?? null, workspaceUpdatedAt: workspace?.at ?? null, pulse: checked(pulses), communications: checked(history), privacy: checked(privacy), coverage: "Account-held data only. Device-local source files, original PDFs and attachment binaries are not included. Use the local portable backup for device-owned content." };
        const object_path = `${request.user_id}/${request.id}.json`;
        const serialized = JSON.stringify(data);
        if (new TextEncoder().encode(serialized).byteLength > 25000000) throw new Error("export-too-large");
        // The Postgres claim is a durable account barrier. Deletion cannot
        // claim this account until export finalization or explicit operator
        // reconciliation, even if the global worker lease expires.
        try {
          checked(await service.db.storage.from("communications-exports").upload(object_path, serialized, { contentType: "application/json", upsert: true }));
        } catch (error) {
          // A lost Storage response can be ambiguous: remove the exact object
          // before allowing a safe retry. Failed removal closes the barrier for
          // operator reconciliation.
          await removeExportAfterBarrierLoss(service, object_path, error, false);
        }
        const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
        let finalized: unknown;
        try {
          finalized = checked(await service.db.rpc("finalize_privacy_export", {
            p_request_id: request.id,
            p_object_path: object_path,
            p_expires_at: expiresAt,
          }));
        } catch (error) {
          // The RPC may have committed before its response was lost. Preserve
          // both row and object for reconciliation instead of deleting a
          // possibly ready export or automatically replaying the request.
          throw new Error("export-deletion-reconciliation-required", { cause: error });
        }
        if (!finalized) {
          await removeExportAfterBarrierLoss(
            service,
            object_path,
            new Error("export-barrier-lost"),
            true,
          );
        }
        await service.enqueue({ userId: request.user_id, type: "export_ready", key: `${request.id}:ready`, variables: { requestId: request.id } });
      } else {
        // Claiming the request creates the database-backed upload barrier. Do
        // every fallible dependency/index/list check before crossing the first
        // irreversible boundary so a preflight failure remains cancellable.
        const exportPlan = await planOwnedExportStorage(service, request.user_id);
        const identity = await service.identity(request.user_id);
        if (identity.contact_id && !service.env.RESEND_API_KEY) {
          throw new Error("provider-contact-deletion-unavailable");
        }
        const messages = checked(await service.db.from("email_jobs").select("provider_id").eq("user_id", request.user_id).not("provider_id", "is", null));
        const academicPlans = await planOwnedAcademicStorage(service, request.user_id);
        const accountPlans = await Promise.all(ACCOUNT_STORAGE_BUCKETS.map(bucket =>
          planStoragePrefix(service, bucket, request.user_id, "account-storage")));
        if (!checked(await service.db.rpc("begin_account_deletion_cleanup", {
          p_request_id: request.id,
        }))) throw new Error("deletion-barrier-lost");
        destructiveDeletionStarted = true;
        await executeStorageCleanup(service, exportPlan);
        if (identity.contact_id) {
          try {
            await service.provider.request(`/contacts/${identity.contact_id}`, "DELETE");
          } catch (error) {
            // A prior attempt may have deleted the provider contact before a
            // later dependency failed. Absence is the desired retry result.
            if (!(error instanceof ProviderError) || error.status !== 404) {
              throw new Error("provider-contact-deletion-failed", { cause: error });
            }
          }
        }
        if (messages?.length) checked(await service.db.from("email_events").delete().in("provider_id", messages.map(m => m.provider_id)));
        // Academic objects do not share the user's UUID path, so Auth cascade
        // cannot identify them after the collection rows are gone. Empty and
        // re-check every owned collection prefix first; a failure stops here.
        await executeStorageCleanupPlans(service, academicPlans);
        // Supabase refuses Auth deletion while a user owns any Storage object.
        // These three buckets use exact user UUID/hash paths; re-listing each
        // prefix proves absence without touching another account's objects.
        await executeStorageCleanupPlans(service, accountPlans);
        // getUser validation on every private endpoint rejects tokens after this deletion.
        const deleted = await service.db.auth.admin.deleteUser(request.user_id); if (deleted.error) throw new Error("account-deletion-failed");
        checked(await service.db.from("privacy_requests").update({ status: "completed", failure_code: null }).eq("id", request.id));
      }
      processed++;
    } catch (error) {
      // Keep failed work visible; destructive jobs are never retried blindly.
      if (request.kind === "deletion") {
        checked(await service.db.rpc("record_account_deletion_failure", {
          p_request_id: request.id,
          p_requires_reconciliation: destructiveDeletionStarted,
        }));
      } else {
        const failureCode = error instanceof Error
          && ["export-cancelled-for-deletion", "export-deletion-reconciliation-required"].includes(error.message)
          ? error.message
          : "privacy-processing-failed";
        checked(await service.db.from("privacy_requests").update({ status: "failed", failure_code: failureCode }).eq("id", request.id).eq("status", "processing"));
      }
    }
  }
  const receipts = checked(await service.db.from("privacy_requests").select("id,notification_email,completion_payload,completion_attempt_at,completion_attempts").eq("kind", "deletion").eq("status", "completed").eq("completed_email_sent", false) .is("failure_code", null).lte("completion_retry_at", now).not("notification_email", "is", null).limit(10));
  for (const receipt of receipts ?? []) {
    if (!service.env.RESEND_API_KEY || !["live", "test"].includes(service.env.AXOM_EMAIL_MODE ?? "")) continue;
    try {
    const suppression = checked(await service.db.from("email_suppressions").select("email").eq("email", receipt.notification_email.toLowerCase()).maybeSingle());
    if (!suppression) {
      if (receipt.completion_attempt_at && Date.now() - Date.parse(receipt.completion_attempt_at) > 23 * 3600000) {
        checked(await service.db.from("privacy_requests").update({ failure_code: "receipt-reconciliation-required" }).eq("id", receipt.id)); continue;
      }
      let payload = receipt.completion_payload;
      if (!payload) {
        const email = renderAxomEmail({ type: "deletion_completed", baseUrl: service.base, context: { displayName: "", accent: "#c8a96a", theme: "dark", locale: "en", timezone: "UTC", orbUrl: `${service.base}/icons/axom-orb-512.png` } });
        payload = service.provider.prepare(receipt.notification_email, email);
        checked(await service.db.from("privacy_requests").update({ completion_payload: payload, completion_attempt_at: new Date().toISOString() }).eq("id", receipt.id));
      }
      await service.provider.sendPrepared(payload, `${receipt.id}:completed`);
    }
    checked(await service.db.from("privacy_requests").update({ completed_email_sent: true, notification_email: null, completion_payload: null }).eq("id", receipt.id));
    } catch {
      const attempts = receipt.completion_attempts + 1;
      checked(await service.db.from("privacy_requests").update({ completion_attempts: attempts, completion_retry_at: new Date(Date.now() + Math.pow(2, attempts) * 60000).toISOString(), failure_code: attempts >= 5 ? "receipt-reconciliation-required" : null }).eq("id", receipt.id));
    }
  }
  const expired = checked(await service.db.from("privacy_requests").select("id,user_id,object_path").eq("kind", "export").lt("expires_at", now).not("object_path", "is", null).limit(100));
  for (const row of expired ?? []) {
    if (typeof row.id !== "string" || !UUID.test(row.id) || typeof row.user_id !== "string"
      || row.object_path !== `${row.user_id}/${row.id}.json`) {
      checked(await service.db.from("privacy_requests").update({ failure_code: "export-storage-index-invalid" }).eq("id", row.id));
      continue;
    }
    checked(await service.db.storage.from("communications-exports").remove([row.object_path]));
    checked(await service.db.from("privacy_requests").update({ object_path: null }).eq("id", row.id));
  }
  checked(await service.db.from("communication_tokens").delete().lt("expires_at", now));
  checked(await service.db.from("email_events").delete().lt("created_at", new Date(Date.now() - 30 * 86400000).toISOString()).not("processed_at", "is", null));
  checked(await service.db.from("communication_rate_limits").delete().lt("window_start", new Date(Date.now() - 86400000).toISOString()));
  return processed;
}
