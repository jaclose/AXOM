import type { SupabaseClient, User } from "@supabase/supabase-js";
import { TEMPLATE_CATEGORY, preferences, type EmailType, type Preference } from "../model";
import { renderAxomEmail } from "../email";
import { CommunicationsService, required, checked, type Identity } from "./service";
import { hashToken, verifyWebhook, type Env, type ProviderEvent } from "./provider";
import { cancelDeletion, processPrivacy, requestPrivacy } from "./privacy";
import { expandCampaigns, recipients, validateAudience, validateEditorial, type Audience } from "./campaigns";

class RequestError extends Error { constructor(message: string, public status = 400) { super(message); } }
const administrative = new Set(["admin", "campaign-save", "campaign-estimate", "campaign-schedule", "campaign-cancel", "send-test", "broadcast-export", "article-publish"]);
const editorialTypes = ["essay", "product_update", "research", "marketing"];
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });
function admin(user: User, env: Env): boolean { return (env.AXOM_COMMUNICATIONS_ADMINS ?? "").split(",").map(id => id.trim()).includes(user.id); }
function recentLogin(jwt: string): boolean {
  try { const payload = JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as { amr?: { timestamp: number }[] }; return Boolean(payload.amr?.some(item => Date.now() / 1000 - item.timestamp >= 0 && Date.now() / 1000 - item.timestamp <= 600)); } catch { return false; }
}
export function createCommunicationsHandler(db: SupabaseClient, env: Env, fetcher?: typeof fetch) {
  const service = new CommunicationsService(db, env, fetcher);
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get("origin"); const allowed = (env.AXOM_ALLOWED_ORIGINS ?? env.AXOM_PUBLIC_URL ?? "https://axom.info").split(",").map(s => s.trim());
    const cors: Record<string, string> = origin && allowed.includes(origin) ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin", "Access-Control-Allow-Headers": "authorization,content-type,apikey,x-client-info", "Access-Control-Allow-Methods": "POST,GET,OPTIONS" } : {};
    if (request.method === "OPTIONS") return new Response(null, { status: origin && !allowed.includes(origin) ? 403 : 204, headers: cors });
    try {
      const url = new URL(request.url); const action = url.searchParams.get("action") ?? "settings";
      if (action === "unsubscribe") {
        const token = url.searchParams.get("token") ?? ""; if (!/^[0-9a-f]{64}$/.test(token)) throw new RequestError("This unsubscribe link is invalid.");
        const row = checked(await db.from("communication_tokens").select("user_id,category").eq("token_hash", await hashToken(token)).gt("expires_at", new Date().toISOString()).maybeSingle());
        if (!row) throw new RequestError("This link has expired. Sign in to AXOM to manage email preferences.");
        if (request.method === "GET") return new Response('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AXOM email preferences</title><body style="background:#0d0d0e;color:#e6e2d6;font:18px system-ui;max-width:560px;margin:12vh auto;padding:24px"><h1>A quieter inbox.</h1><p>Unsubscribe from this email category. Essential account and security emails remain enabled.</p><form method="post"><button style="padding:16px 24px;font:inherit">Confirm unsubscribe</button></form></body></html>', { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'", "Referrer-Policy": "no-referrer" } });
        if (request.method !== "POST") throw new RequestError("Method not allowed", 405);
        checked(await db.from("communication_preferences").update({ enabled: false, updated_at: new Date().toISOString() }).eq("user_id", row.user_id).eq("category", row.category));
        checked(await db.from("communication_identity").upsert({ user_id: row.user_id, topics_dirty: true, updated_at: new Date().toISOString() }));
        return new Response("You are unsubscribed from this category. Essential account emails remain enabled.", { headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
      }
      if (action === "webhook") {
        if (request.method !== "POST" || !env.RESEND_WEBHOOK_SECRET) throw new RequestError("Webhook unavailable", 503);
        const raw = await request.text(); if (raw.length > 100000) throw new RequestError("Payload too large", 413);
        let event: ProviderEvent;
        try { event = await verifyWebhook(raw, request.headers, env.RESEND_WEBHOOK_SECRET); } catch { throw new RequestError("Invalid webhook signature", 401); }
        await service.event(request.headers.get("svix-id")!, event); return json({ received: true });
      }
      if (request.method !== "POST") throw new RequestError("Method not allowed", 405);
      if (origin && !allowed.includes(origin)) throw new RequestError("Origin not allowed", 403);
      const bearer = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
      if (action === "worker") {
        if (!env.AXOM_COMMUNICATIONS_CRON_SECRET || await hashToken(bearer) !== await hashToken(env.AXOM_COMMUNICATIONS_CRON_SECRET)) throw new RequestError("Unauthorized", 401);
        // A global worker lease avoids overlapping campaigns and privacy sweeps.
        const lease = checked(await db.rpc("acquire_communication_worker"));
        if (!lease) return json({ busy: true });
        try {
        const queued = await service.schedule(); const campaigns = await expandCampaigns(service); const privacy = await processPrivacy(service); const worked = await service.work();
        const dirty = checked(await db.from("communication_identity").select("user_id").eq("topics_dirty", true).limit(20));
        for (const row of dirty ?? []) { try { await service.syncTopics(row.user_id); } catch { checked(await db.from("communication_identity").update({ topics_error: "Synchronization will retry." }).eq("user_id", row.user_id)); } }
        const pending = checked(await db.from("email_events").select("provider_event_id,payload").is("processed_at", null).order("created_at").limit(50));
        for (const row of pending ?? []) await service.event(row.provider_event_id, row.payload as ProviderEvent);
        const campaignsDone = checked(await db.from("email_campaigns").select("id").eq("status", "queued").limit(30)) ?? [];
        for (const campaign of campaignsDone) { const remaining = checked(await db.from("email_jobs").select("id").eq("campaign_id", campaign.id).in("status", ["queued", "scheduled", "processing"]).limit(1)); if (!remaining?.length) checked(await db.from("email_campaigns").update({ status: "completed" }).eq("id", campaign.id).eq("status", "queued")); }
        return json({ queued, campaigns, privacy, ...worked });
        } finally { checked(await db.from("communication_worker_state").update({ lease: null, expires_at: new Date().toISOString() }).eq("id", 1).eq("lease", lease)); }
      }
      if (!bearer) throw new RequestError("Sign in to manage your account communications.", 401);
      const auth = await db.auth.getUser(bearer); if (auth.error || !auth.data.user) throw new RequestError("Sign in again to continue.", 401);
      const user = auth.data.user;
      if (administrative.has(action) && !admin(user, env)) throw new RequestError("Administrator access required.", 403);
      const limit = checked(await db.rpc("consume_communication_limit", { p_key: `${user.id}:${action}`, p_limit: action.startsWith("request-") ? 3 : 60, p_seconds: 3600 }));
      if (!limit) throw new RequestError("Too many requests. Try again later.", 429);
      const raw = await request.text(); if (raw.length > 100000) throw new RequestError("Payload too large", 413);
      let body: Record<string, unknown>; try { body = raw ? JSON.parse(raw) as Record<string, unknown> : {}; if (!body || Array.isArray(body) || typeof body !== "object") throw new Error(); } catch { throw new RequestError("Invalid request body"); }
      if (action === "settings") {
        const [prefs, identity, history, privacy] = await Promise.all([service.preferenceRows(user.id), service.identity(user.id), db.from("email_jobs").select("id,type,status,sent_at,created_at,failure_code").eq("user_id", user.id).order("created_at", { ascending: false }).limit(30), db.from("privacy_requests").select("id,kind,status,scheduled_for,expires_at,created_at,failure_code").eq("user_id", user.id).order("created_at", { ascending: false }).limit(20)]);
        return json({ preferences: prefs, identity, history: checked(history), privacy: checked(privacy), admin: admin(user, env), deliveryMode: env.AXOM_EMAIL_MODE ?? "disabled", deletionEnabled: env.AXOM_ACCOUNT_DELETION_ENABLED === "true", hasProtectedCopy: Boolean(await service.workspace(user.id)) }, 200, cors);
      }
      if (action === "preferences") { await service.savePreferences(user.id, body.preferences as Preference[], body.identity as Identity | undefined); return json({ saved: true }, 200, cors); }
      if (action === "unsubscribe-all") { const prefs = await service.preferenceRows(user.id); await service.savePreferences(user.id, prefs.map(p => ({ ...p, enabled: false }))); return json({ saved: true }, 200, cors); }
      if (action === "request-export") { await requestPrivacy(service, user.id, "export"); return json({ requested: true }, 200, cors); }
      if (action === "export-link") return json({ url: await service.exportLink(user.id, String(body.id)) }, 200, cors);
      if (action === "request-deletion") {
        if (env.AXOM_ACCOUNT_DELETION_ENABLED !== "true") throw new RequestError("Account deletion activation is pending. Your account has not been changed.", 503);
        if (body.confirmation !== "DELETE MY ACCOUNT" || !recentLogin(bearer)) throw new RequestError("Sign in again, then type DELETE MY ACCOUNT to confirm.", 403);
        await requestPrivacy(service, user.id, "deletion"); return json({ requested: true }, 200, cors);
      }
      if (action === "cancel-deletion") {
        const result = await cancelDeletion(service, user.id, String(body.id));
        return json({ cancelled: true, ...result }, 200, cors);
      }
      if (action === "pulse") {
        const year = Number(body.year); if (!Number.isInteger(year) || year < 2020 || year > new Date().getUTCFullYear()) throw new RequestError("Choose a valid year.");
        const context = await service.context(user.id); const end = year === new Date().getUTCFullYear() ? localClockDate(context.timezone) : `${year}-12-31`;
        const snapshot = await service.snapshot(user.id, "year", `${year}-01-01`, end, context.timezone); return json({ snapshot: snapshot?.payload ?? null }, 200, cors);
      }
      if (action === "admin") return json({ campaigns: checked(await db.from("email_campaigns").select("*").order("created_at", { ascending: false }).limit(50)), failures: checked(await db.from("email_jobs").select("id,type,status,failure_code,created_at").in("status", ["failed", "bounced", "complained"]).order("created_at", { ascending: false }).limit(30)), deliveryMode: env.AXOM_EMAIL_MODE ?? "disabled" }, 200, cors);
      if (action === "campaign-save") {
        const type = String(body.type); if (!editorialTypes.includes(type)) throw new RequestError("Choose an editorial or product template.");
        const content = validateEditorial(body.content as Parameters<typeof validateEditorial>[0]); const audience = body.audience as Audience; validateAudience(audience);
        const id = typeof body.id === "string" ? body.id : crypto.randomUUID();
        if (body.id) { const old = required(await db.from("email_campaigns").select("status").eq("id", id).single()); if (old.status !== "draft") throw new RequestError("Only drafts can be edited."); }
        const draft = { type, content, audience, created_by: user.id, status: "draft" };
        if (body.id) required(await db.from("email_campaigns").update(draft).eq("id", id).eq("status", "draft").select("id").single());
        else checked(await db.from("email_campaigns").insert({ id, ...draft }));
        if (type === "essay" && content.body) {
          const article = required(await db.from("axom_articles").upsert({ campaign_id: id, title: content.title, excerpt: content.excerpt, body: content.body, reading_minutes: content.readingMinutes ?? null }, { onConflict: "campaign_id" }).select("id").single());
          content.url = `${service.base}/#essay?id=${article.id}`; checked(await db.from("email_campaigns").update({ content }).eq("id", id));
        }
        return json({ id, content }, 200, cors);
      }
      if (["campaign-estimate", "campaign-schedule", "campaign-cancel", "broadcast-export", "article-publish"].includes(action)) {
        const campaign = required(await db.from("email_campaigns").select("*").eq("id", String(body.id)).single());
        if (action === "campaign-cancel") { checked(await db.from("email_campaigns").update({ status: "cancelled" }).eq("id", campaign.id)); checked(await db.from("email_jobs").update({ status: "cancelled" }).eq("campaign_id", campaign.id).in("status", ["queued", "scheduled"])); return json({ cancelled: true }, 200, cors); }
        if (action === "campaign-estimate") { const batch = await recipients(service, campaign.type, campaign.audience); return json({ eligible: batch.eligible.length, more: batch.scanned.length === 200 }, 200, cors); }
        if (action === "article-publish") {
          if (campaign.type !== "essay" || body.confirmation !== "PUBLISH ESSAY") throw new RequestError("Review the essay and type PUBLISH ESSAY.");
          required(await db.from("axom_articles").update({ published_at: new Date().toISOString() }).eq("campaign_id", campaign.id).select("id").single());
          return json({ published: true, url: campaign.content.url }, 200, cors);
        }
        if (action === "broadcast-export") {
          if (campaign.type === "essay" && campaign.content.body) {
            const article = required(await db.from("axom_articles").select("published_at").eq("campaign_id", campaign.id).single());
            if (!article.published_at || Date.parse(article.published_at) > Date.now()) throw new RequestError("Publish the canonical essay before exporting its delivery email.");
          }
          const context = { ...await service.context(user.id), displayName: "", course: undefined, exam: undefined };
          const email = renderAxomEmail({ type: campaign.type, editorial: campaign.content, context, baseUrl: service.base, unsubscribeUrl: "https://axom.invalid/broadcast-unsubscribe" });
          return json({ ...email, html: email.html.replaceAll("https://axom.invalid/broadcast-unsubscribe", "{{{RESEND_UNSUBSCRIBE_URL}}}"), text: email.text.replaceAll("https://axom.invalid/broadcast-unsubscribe", "{{{RESEND_UNSUBSCRIBE_URL}}}"), note: "Import into a Resend Broadcast and choose the matching opt-in Topic. This generic version omits private course/exam personalization. Do not also schedule this draft in AXOM." }, 200, cors);
        }
        if (body.confirmation !== "SCHEDULE EMAIL" || campaign.status !== "draft") throw new RequestError("Review the draft and type SCHEDULE EMAIL.");
        const date = String(body.scheduledFor); if (!Number.isFinite(Date.parse(date)) || Date.parse(date) < Date.now() + 60000) throw new RequestError("Schedule at least one minute in the future.");
        if (!checked(await db.rpc("schedule_axom_campaign", { p_id: campaign.id, p_at: date }))) throw new RequestError("The draft changed. Reload and review it again.");
        return json({ scheduled: true }, 200, cors);
      }
      if (action === "send-test") {
        const type = String(body.type) as EmailType;
        if (!Object.hasOwn(TEMPLATE_CATEGORY, type) || type.startsWith("deletion") || type.startsWith("export") || type === "auth" || type === "security") throw new RequestError("This template cannot be test-triggered here.");
        const content = body.content ? validateEditorial(body.content as Parameters<typeof validateEditorial>[0]) : undefined;
        await service.enqueue({ userId: user.id, type, key: `test:${user.id}:${crypto.randomUUID()}`, variables: { editorial: content, test: true } }); return json({ queued: true, note: "Test queued for your verified, allowlisted account. Consent and suppression still apply." }, 200, cors);
      }
      throw new RequestError("Unknown action", 404);
    } catch (error) {
      // No secrets, provider payloads, raw SQL errors or personal addresses in responses/logs.
      return json({ error: error instanceof RequestError ? error.message : error instanceof Error && !["database-operation-failed"].includes(error.message) && error.message.length < 160 ? error.message : "This request could not be completed. Try again or contact the operator." }, error instanceof RequestError ? error.status : 400, cors);
    }
  };
}
function localClockDate(timezone: string): string { return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
export { preferences, renderAxomEmail, TEMPLATE_CATEGORY };
