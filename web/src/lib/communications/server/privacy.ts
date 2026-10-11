import type { CommunicationsService } from "./service";
import { required, checked } from "./service";
import { renderAxomEmail } from "../email";

export async function requestPrivacy(service: CommunicationsService, userId: string, kind: "export" | "deletion"): Promise<void> {
  const user = await service.user(userId);
  if (!user.email_confirmed_at) throw new Error("Verify your email before continuing.");
  const scheduled = new Date(Date.now() + 7 * 86400000).toISOString();
  const result = await service.db.from("privacy_requests").insert({ user_id: userId, kind, status: kind === "deletion" ? "scheduled" : "requested", scheduled_for: kind === "deletion" ? scheduled : null, notification_email: kind === "deletion" ? user.email : null }).select("id").single();
  if (result.error?.code === "23505") return;
  const row = required(result);
  await service.enqueue({ userId, type: kind === "deletion" ? "deletion_requested" : "export_requested", key: `${row.id}:requested`, variables: { requestId: row.id } });
  if (kind === "deletion") await service.enqueue({ userId, type: "deletion_scheduled", key: `${row.id}:scheduled`, variables: { date: scheduled } });
}
export async function cancelDeletion(service: CommunicationsService, userId: string, requestId: string): Promise<void> {
  const row = checked(await service.db.from("privacy_requests").update({ status: "cancelled", notification_email: null }).eq("id", requestId).eq("user_id", userId).eq("kind", "deletion").in("status", ["scheduled", "failed"]).select("id").maybeSingle());
  if (!row) throw new Error("Deletion can no longer be cancelled, or it was already cancelled.");
  await service.enqueue({ userId, type: "deletion_cancelled", key: `${row.id}:cancelled` });
}
export async function processPrivacy(service: CommunicationsService): Promise<number> {
  const now = new Date().toISOString();
  // Export retries overwrite the same private object. Interrupted deletions need operator reconciliation.
  const stale = new Date(Date.now() - 15 * 60000).toISOString();
  checked(await service.db.from("privacy_requests").update({ status: "requested", processing_at: null }).eq("kind", "export").eq("status", "processing").lt("processing_at", stale));
  checked(await service.db.from("privacy_requests").update({ status: "failed", failure_code: "deletion-reconciliation-required" }).eq("kind", "deletion").eq("status", "processing").lt("processing_at", stale));
  const requests = checked(await service.db.from("privacy_requests").select("*").in("status", ["requested", "scheduled"]).order("created_at").limit(10));
  let processed = 0;
  for (const request of requests ?? []) {
    if (request.kind === "deletion" && (request.scheduled_for > now || service.env.AXOM_ACCOUNT_DELETION_ENABLED !== "true")) continue;
    const claimed = checked(await service.db.from("privacy_requests").update({ status: "processing", processing_at: now }).eq("id", request.id).eq("status", request.status).select("id").maybeSingle()); if (!claimed) continue;
    try {
      if (request.kind === "export") {
        const workspace = await service.workspace(request.user_id);
        const [user, prefs, identity, pulses, history, privacy] = await Promise.all([service.user(request.user_id), service.preferenceRows(request.user_id), service.identity(request.user_id), service.db.from("pulse_snapshots").select("*").eq("user_id", request.user_id), service.db.from("email_jobs").select("id,type,status,created_at,sent_at").eq("user_id", request.user_id), service.db.from("privacy_requests").select("id,kind,status,scheduled_for,created_at").eq("user_id", request.user_id)]);
        const data = { format: "axom-account-export", version: 1, generatedAt: now, profile: { id: user.id, email: user.email, displayName: user.user_metadata?.display_name }, preferences: prefs, emailPresentation: identity, workspace: workspace?.state ?? null, workspaceUpdatedAt: workspace?.at ?? null, pulse: checked(pulses), communications: checked(history), privacy: checked(privacy), coverage: "Account-held data only. Device-local source files, original PDFs and attachment binaries are not included. Use the local portable backup for device-owned content." };
        const object_path = `${request.user_id}/${request.id}.json`;
        const serialized = JSON.stringify(data);
        if (new TextEncoder().encode(serialized).byteLength > 25000000) throw new Error("export-too-large");
        checked(await service.db.storage.from("communications-exports").upload(object_path, serialized, { contentType: "application/json", upsert: true }));
        checked(await service.db.from("privacy_requests").update({ status: "ready", object_path, expires_at: new Date(Date.now() + 7 * 86400000).toISOString() }).eq("id", request.id));
        await service.enqueue({ userId: request.user_id, type: "export_ready", key: `${request.id}:ready`, variables: { requestId: request.id } });
      } else {
        const exports = checked(await service.db.from("privacy_requests").select("object_path").eq("user_id", request.user_id).not("object_path", "is", null));
        if (exports?.length) checked(await service.db.storage.from("communications-exports").remove(exports.map(r => r.object_path)));
        const identity = await service.identity(request.user_id);
        if (identity.contact_id) { if (!service.env.RESEND_API_KEY) throw new Error("provider-contact-deletion-unavailable"); try { await service.provider.request(`/contacts/${identity.contact_id}`, "DELETE"); } catch { throw new Error("provider-contact-deletion-failed"); } }
        const messages = checked(await service.db.from("email_jobs").select("provider_id").eq("user_id", request.user_id).not("provider_id", "is", null));
        if (messages?.length) checked(await service.db.from("email_events").delete().in("provider_id", messages.map(m => m.provider_id)));
        // getUser validation on every private endpoint rejects tokens after this deletion.
        const deleted = await service.db.auth.admin.deleteUser(request.user_id); if (deleted.error) throw new Error("account-deletion-failed");
        checked(await service.db.from("privacy_requests").update({ status: "completed" }).eq("id", request.id));
      }
      processed++;
    } catch {
      // Keep failed work visible; destructive jobs are never retried blindly.
      checked(await service.db.from("privacy_requests").update({ status: "failed", failure_code: "privacy-processing-failed" }).eq("id", request.id));
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
  const expired = checked(await service.db.from("privacy_requests").select("id,object_path").eq("kind", "export").lt("expires_at", now).not("object_path", "is", null).limit(100));
  for (const row of expired ?? []) { checked(await service.db.storage.from("communications-exports").remove([row.object_path])); checked(await service.db.from("privacy_requests").update({ object_path: null }).eq("id", row.id)); }
  checked(await service.db.from("communication_tokens").delete().lt("expires_at", now));
  checked(await service.db.from("email_events").delete().lt("created_at", new Date(Date.now() - 30 * 86400000).toISOString()).not("processed_at", "is", null));
  checked(await service.db.from("communication_rate_limits").delete().lt("window_start", new Date(Date.now() - 86400000).toISOString()));
  return processed;
}
