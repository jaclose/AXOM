import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { CommunicationsService, type EmailJob } from "./server/service";
import { createCommunicationsHandler } from "./server/handler";
import { processPrivacy } from "./server/privacy";
import { validateEditorial } from "./server/campaigns";
import { preferences } from "./model";

// A boundary fake records actual PostgREST calls; SQL/RLS is tested separately in PGlite.
function database(results: { data: unknown; error: { code?: string; message: string } | null }[] = []) {
  const calls: { table: string; method: string; args: unknown[] }[] = [];
  const from = vi.fn((table: string) => {
    const result = results.shift() ?? { data: null, error: null };
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "insert", "update", "upsert", "delete", "eq", "in", "neq", "gt", "gte", "lt", "lte", "is", "not", "order", "limit", "single", "maybeSingle"]) chain[method] = (...args: unknown[]) => { calls.push({ table, method, args }); return chain; };
    chain.then = (resolve: (r: typeof result) => unknown) => Promise.resolve(result).then(resolve);
    return chain;
  });
  const user = { id: "account-a", email: "alex@example.invalid", email_confirmed_at: "2026-01-01", user_metadata: { role: "admin" } } as unknown as User;
  const db = { from, rpc: vi.fn(async () => ({ data: true, error: null })), auth: { getUser: vi.fn(async () => ({ data: { user }, error: null })), admin: { getUserById: vi.fn(async () => ({ data: { user }, error: null })) } }, storage: { from: vi.fn() } } as unknown as SupabaseClient;
  return { db, calls };
}
const job: EmailJob = { id: "job-a", user_id: "account-a", type: "weekly_report", category: "weekly_report", idempotency_key: "account-a:week", status: "processing", attempts: 1, variables: {}, created_at: new Date().toISOString() };
const ok = (data: unknown = null) => ({ data, error: null });

describe("communications server boundaries", () => {
  it("rejects administrator claims supplied through user metadata", async () => {
    const { db } = database(); const handler = createCommunicationsHandler(db, {});
    expect((await handler(new Request("https://axom.invalid?action=admin", { method: "POST", headers: { authorization: "Bearer verified-user" } }))).status).toBe(403);
  });
  it("rejects deletion without recent reauthentication even with the correct confirmation", async () => {
    const { db } = database(); const handler = createCommunicationsHandler(db, { AXOM_ACCOUNT_DELETION_ENABLED: "true" });
    const jwt = `header.${btoa(JSON.stringify({ amr: [{ timestamp: Date.now() / 1000 - 3600 }] }))}.signature`;
    const response = await handler(new Request("https://axom.invalid?action=request-deletion", { method: "POST", headers: { authorization: `Bearer ${jwt}` }, body: JSON.stringify({ confirmation: "DELETE MY ACCOUNT" }) }));
    expect(response.status).toBe(403); expect(db.from).not.toHaveBeenCalled();
  });
  it("rejects cross-origin changes before any account mutation", async () => {
    const { db } = database(); const handler = createCommunicationsHandler(db, { AXOM_PUBLIC_URL: "https://axom.info" });
    expect((await handler(new Request("https://axom.invalid?action=unsubscribe-all", { method: "POST", headers: { origin: "https://untrusted.invalid", authorization: "Bearer user" } }))).status).toBe(403); expect(db.from).not.toHaveBeenCalled();
  });
  it("checks fresh consent after a message has already been queued", async () => {
    const { db, calls } = database([ok(null), ok([]), ok()]); const service = new CommunicationsService(db, {});
    vi.spyOn(service, "preferenceRows").mockResolvedValue(preferences()); vi.spyOn(service, "context").mockResolvedValue({ displayName: "Alex", accent: "#c8a96a", theme: "dark", locale: "en", timezone: "UTC", orbUrl: "https://axom.info/icons/axom-orb-512.png" });
    const send = vi.spyOn(service.provider, "send"); await service.sendAxomEmail(job);
    expect(send).not.toHaveBeenCalled(); expect(calls).toContainEqual({ table: "email_jobs", method: "update", args: [{ status: "suppressed", failure_code: "not-subscribed" }] });
  });
  it("retries the frozen provider payload even if profile or sender configuration changed", async () => {
    const { db } = database([ok(null), ok([]), ok(), ok()]); const service = new CommunicationsService(db, {});
    vi.spyOn(service, "preferenceRows").mockResolvedValue(preferences().map(p => ({ ...p, enabled: true })));
    vi.spyOn(service, "context").mockResolvedValue({ displayName: "Changed name", accent: "#aabbcc", theme: "light", locale: "en", timezone: "UTC", orbUrl: "https://axom.info/icons/axom-orb-512.png" });
    const payload = { from: "Original AXOM <sender@example.invalid>", to: ["alex@example.invalid"], subject: "Original subject", html: "<p>Original content</p>", text: "Original content" };
    const prepare = vi.spyOn(service.provider, "prepare"); const send = vi.spyOn(service.provider, "sendPrepared").mockResolvedValue("provider-one");
    await service.sendAxomEmail({ ...job, delivery_payload: payload, first_attempt_at: new Date().toISOString() });
    expect(prepare).not.toHaveBeenCalled(); expect(send).toHaveBeenCalledWith(payload, job.idempotency_key, undefined);
  });
  it("never delivers a saved payload to an old address after an account email change", async () => {
    const { db, calls } = database([ok(null), ok([]), ok()]); const service = new CommunicationsService(db, {});
    vi.spyOn(service, "preferenceRows").mockResolvedValue(preferences().map(p => ({ ...p, enabled: true })));
    vi.spyOn(service, "context").mockResolvedValue({ displayName: "Alex", accent: "#aabbcc", theme: "dark", locale: "en", timezone: "UTC", orbUrl: "https://axom.info/icons/axom-orb-512.png" });
    const send = vi.spyOn(service.provider, "sendPrepared");
    await service.sendAxomEmail({ ...job, delivery_payload: { from: "AXOM", to: ["old@example.invalid"], subject: "Original", html: "Original", text: "Original" } });
    expect(send).not.toHaveBeenCalled(); expect(calls).toContainEqual({ table: "email_jobs", method: "update", args: [{ status: "suppressed", failure_code: "recipient-changed" }] });
  });
  it("ignores a duplicate webhook that was already committed", async () => {
    const { db, calls } = database([{ data: null, error: { code: "23505", message: "duplicate" } }, ok({ processed_at: "2026-10-10" })]);
    await new CommunicationsService(db, {}).event("evt-1", { type: "email.complained", created_at: "2026-10-10T12:00:00Z", data: { to: ["alex@example.invalid"] } });
    expect(calls.some(c => c.table === "email_suppressions")).toBe(false);
  });
  it("reprocesses a previously incomplete webhook and persists address suppression", async () => {
    const { db, calls } = database([{ data: null, error: { code: "23505", message: "duplicate" } }, ok({ processed_at: null }), ok(), ok()]);
    await new CommunicationsService(db, {}).event("evt-1", { type: "email.bounced", created_at: "2026-10-10T12:00:00Z", data: { to: ["Alex@Example.Invalid"] } });
    expect(calls).toContainEqual({ table: "email_suppressions", method: "upsert", args: [{ email: "alex@example.invalid", reason: "email.bounced" }] });
    expect(calls.some(c => c.table === "email_events" && c.method === "update")).toBe(true);
  });
  it("acknowledges unknown valid event types without interpreting them as a delivery", async () => {
    const { db, calls } = database([ok(), ok()]); await new CommunicationsService(db, {}).event("evt-unknown", { type: "future.type", created_at: "2026-10-10T12:00:00Z", data: {} });
    expect(calls.some(c => c.table === "email_jobs")).toBe(false);
  });
  it("keeps an early delivery webhook pending until its send acknowledgement exists", async () => {
    const { db, calls } = database([ok(), ok(), ok(null)]); await new CommunicationsService(db, {}).event("evt-early", { type: "email.delivered", created_at: "2026-10-10T12:00:00Z", data: { email_id: "provider-id" } });
    expect(calls.some(c => c.table === "email_events" && c.method === "update")).toBe(false);
  });
  it("finishes external SMTP/Broadcast events after the local acknowledgement grace window", async () => {
    const { db, calls } = database([{ data: null, error: { code: "23505", message: "duplicate" } }, ok({ processed_at: null, created_at: "2000-01-01" }), ok(), ok(null), ok()]);
    await new CommunicationsService(db, {}).event("evt-external", { type: "email.delivered", created_at: "2026-10-10T12:00:00Z", data: { email_id: "external-provider-id" } });
    expect(calls.some(c => c.table === "email_events" && c.method === "update")).toBe(true);
  });
  it("emails an authenticated export landing page so queue retries cannot freeze an expiring download URL", async () => {
    const { db } = database([ok(null), ok([]), ok({ status: "ready", object_path: "account-a/export.json", expires_at: "2099-01-01" }), ok({ id: "job-a" }), ok()]);
    const service = new CommunicationsService(db, { AXOM_EMAIL_FROM_ACCOUNT: "AXOM <account@example.invalid>" });
    vi.spyOn(service, "preferenceRows").mockResolvedValue(preferences());
    vi.spyOn(service, "context").mockResolvedValue({ displayName: "Alex", accent: "#c8a96a", theme: "dark", locale: "en", timezone: "UTC", orbUrl: "https://axom.info/icons/axom-orb-512.png" });
    const send = vi.spyOn(service.provider, "sendPrepared").mockResolvedValue("provider-export");
    await service.sendAxomEmail({ ...job, type: "export_ready", category: "data_export", variables: { requestId: "request-a" } });
    expect(db.storage.from).not.toHaveBeenCalled();
    expect(send.mock.calls[0][0].html).toContain('href="https://axom.info/#privacy"');
  });
  it("does not mint a download URL for an expired export", async () => {
    const { db } = database([ok({ status: "ready", object_path: "account-a/export.json", expires_at: "2000-01-01" })]);
    await expect(new CommunicationsService(db, {}).exportLink("account-a", "request-a")).rejects.toThrow("export-expired"); expect(db.storage.from).not.toHaveBeenCalled();
  });
  it("rejects unknown personalization and non-HTTPS editorial links before saving", () => {
    expect(() => validateEditorial({ title: "{{secret}}", excerpt: "A note", url: "https://axom.info" })).toThrow("Unsupported template variable");
    expect(() => validateEditorial({ title: "A note", excerpt: "A note", url: "javascript:alert(1)" })).toThrow("HTTPS");
  });
});


describe("deletion dependency safety", () => {
  it("keeps Auth intact when a linked provider contact cannot be removed without its credential", async () => {
    const { db, calls } = database([ok(), ok(), ok([{ id: "delete-a", user_id: "account-a", kind: "deletion", status: "scheduled", scheduled_for: "2000-01-01" }]), ok({ id: "delete-a" }), ok([]), ok(), ok([]), ok([]), ok(), ok(), ok()]);
    const service = new CommunicationsService(db, { AXOM_ACCOUNT_DELETION_ENABLED: "true" });
    vi.spyOn(service, "identity").mockResolvedValue({ accent: "#c8a96a", theme: "dark", locale: "en", contact_id: "contact-a" });
    db.auth.admin.deleteUser = vi.fn();
    expect(await processPrivacy(service)).toBe(0);
    expect(db.auth.admin.deleteUser).not.toHaveBeenCalled();
    expect(calls).toContainEqual({ table: "privacy_requests", method: "update", args: [{ status: "failed", failure_code: "privacy-processing-failed" }] });
  });
});

describe("post-deletion receipt recovery", () => {
  it.each(["sent", "suppressed", "exhausted", "expired"] as const)("handles %s receipts without re-running account deletion", async outcome => {
    const payload = { from: "AXOM <account@example.invalid>", to: ["alex@example.invalid"], subject: "Account deleted", html: "<p>Confirmed</p>", text: "Confirmed" };
    const receipt = { id: "receipt-a", notification_email: "alex@example.invalid", completion_payload: payload, completion_attempt_at: outcome === "expired" ? "2000-01-01" : new Date().toISOString(), completion_attempts: 4 };
    const { db, calls } = database([ok(), ok(), ok([]), ok([receipt]), ok(outcome === "suppressed" ? { email: "alex@example.invalid" } : null), ok(), ok([]), ok(), ok(), ok()]);
    const service = new CommunicationsService(db, { RESEND_API_KEY: "synthetic-test-key", AXOM_EMAIL_MODE: "live" });
    const send = vi.spyOn(service.provider, "sendPrepared");
    if (outcome === "exhausted") send.mockRejectedValue(new Error("provider-timeout")); else send.mockResolvedValue("receipt-provider-id");
    await expect(processPrivacy(service)).resolves.toBe(0);
    if (outcome === "sent" || outcome === "exhausted") expect(send).toHaveBeenCalledWith(payload, "receipt-a:completed"); else expect(send).not.toHaveBeenCalled();
    const updates = calls.filter(c => c.table === "privacy_requests" && c.method === "update").map(c => c.args[0]);
    if (outcome === "sent" || outcome === "suppressed") expect(updates).toContainEqual({ completed_email_sent: true, notification_email: null, completion_payload: null });
    else expect(updates).toContainEqual(expect.objectContaining({ failure_code: "receipt-reconciliation-required" }));
    if (outcome === "exhausted") expect(updates).toContainEqual(expect.objectContaining({ completion_attempts: 5 }));
  });
});
