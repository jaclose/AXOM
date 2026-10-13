import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { NoctyriumState } from "../../types";
import { examContext } from "../context";
import { attemptEvents } from "../../learning-intelligence/attempts";
import { buildPulse } from "../snapshot";
import { renderAxomEmail, templateReady } from "../email";
import { CATEGORIES, TEMPLATE_CATEGORY, duePeriod, firstName, localClock, optional, periodBefore, preferences, safeAccent, suppressionReason, validatePreference, type Editorial, type EmailInput, type EmailType, type OptionalCategory, type Personalization, type Preference, type PulseData } from "../model";
import { hashToken, ProviderError, ResendProvider, type Env, type DeliveryPayload, type ProviderEvent } from "./provider";

export function checked<T>(result: { data: T; error: { message: string } | null }): T { if (result.error) throw new Error("database-operation-failed"); return result.data; }
export function required<T>(result: { data: T; error: { message: string } | null }): NonNullable<T> { const data = checked(result); if (data == null) throw new Error("record-unavailable"); return data; }
export interface EmailJob { id: string; user_id: string; type: EmailType; category: string; idempotency_key: string; status: string; attempts: number; variables: { editorial?: Editorial; actionUrl?: string; date?: string; requestId?: string; test?: boolean }; snapshot_id?: string; created_at: string; provider_id?: string; campaign_id?: string; delivery_payload?: DeliveryPayload; first_attempt_at?: string }
export interface Identity { accent: string; theme: "dark" | "light"; locale: string; contact_id?: string; updated_at?: string }
export class CommunicationsService {
  provider: ResendProvider;
  base: string;
  constructor(public db: SupabaseClient, public env: Env, fetcher?: typeof fetch) { this.provider = new ResendProvider(env, fetcher); this.base = env.AXOM_PUBLIC_URL ?? "https://axom.info"; }
  async user(id: string): Promise<User> { const result = await this.db.auth.admin.getUserById(id); if (result.error || !result.data.user) throw new Error("account-unavailable"); const data = result.data; if (!data.user) throw new Error("account-unavailable"); return data.user; }
  async preferenceRows(id: string): Promise<Preference[]> { const rows = checked(await this.db.from("communication_preferences").select("category,enabled,time,weekday,timezone").eq("user_id", id)) as Preference[]; return preferences().map(p => rows.find(r => r.category === p.category) ?? p); }
  async identity(id: string): Promise<Identity> { return checked(await this.db.from("communication_identity").select("accent,theme,locale,contact_id,updated_at").eq("user_id", id).maybeSingle()) ?? { accent: "#c8a96a", theme: "dark", locale: "en" }; }
  async workspace(id: string): Promise<{ state: NoctyriumState; at: string; hash: string } | null> {
    const w = checked(await this.db.from("workspaces").select("current_revision").eq("user_id", id).maybeSingle()); if (!w) return null;
    const r = checked(await this.db.from("workspace_revisions").select("snapshot_payload,created_at,content_hash").eq("user_id", id).eq("revision", w.current_revision).neq("reason", "conflict").maybeSingle());
    if (!r) return null;
    const s = r.snapshot_payload as NoctyriumState;
    if (!s.profile || !Array.isArray(s.questions) || !Array.isArray(s.logs)) throw new Error("protected-copy-needs-upgrade");
    return { state: s, at: r.created_at, hash: r.content_hash };
  }
  async context(id: string): Promise<Personalization> {
    const [user, profile, identity, workspace, prefs] = await Promise.all([this.user(id), this.db.from("account_profiles").select("display_name").eq("user_id", id).maybeSingle(), this.identity(id), this.workspace(id), this.preferenceRows(id)]);
    const displayName = checked(profile)?.display_name || workspace?.state.profile.name || "";
    const state = workspace?.state; const timezone = prefs.find(p => p.enabled)?.timezone ?? "UTC";
    const today = localClock(new Date(), timezone).day;
    const exam = state ? examContext(state, today) : undefined;
    const hidden = new Set(state?.profile.hiddenNav ?? []);
    const gameLinks = [{ id: "doctordle", name: "DoctorDle", route: "doctordle" }, { id: "daily-word", name: "DailyWord", route: "daily-word" }];
    return { displayName: displayName || firstName(user.user_metadata?.display_name ?? ""), accent: safeAccent(identity.accent), theme: identity.theme, locale: identity.locale, timezone,
      orbUrl: `${this.base}/icons/axom-orb-512.png`, course: state?.courses[0]?.name,
      games: state?.profile.experimentalFlags?.dailyGames ? gameLinks.filter(g => !hidden.has(g.id)).map(g => ({ name: g.name, url: `${this.base}/#${g.route}`, detail: "Open the latest available case. External results are not tracked automatically." })) : [],
      exam,
    };
  }
  async snapshot(id: string, scope: PulseData["scope"], start: string, end: string, timezone: string): Promise<{ id: string; payload: PulseData } | null> {
    const period_key = `${start}/${end}`;
    const existing = checked(await this.db.from("pulse_snapshots").select("id,payload").eq("user_id", id).eq("scope", scope).eq("period_key", period_key).maybeSingle());
    if (existing) return existing;
    const [workspace, identity] = await Promise.all([this.workspace(id), this.identity(id)]); if (!workspace) return null;
    const payload = buildPulse(workspace.state, { scope, start, end, timezone, accent: identity.accent, source: "protected-copy", sourceUpdatedAt: workspace.at });
    const result = await this.db.from("pulse_snapshots").insert({ user_id: id, scope, period_key, payload, source_hash: workspace.hash }).select("id,payload").single();
    if (result.error?.code === "23505") return required(await this.db.from("pulse_snapshots").select("id,payload").eq("user_id", id).eq("scope", scope).eq("period_key", period_key).single());
    return checked(result);
  }
  async enqueue(input: { userId: string; type: EmailType; key: string; variables?: EmailJob["variables"]; snapshotId?: string; scheduledFor?: string; campaignId?: string }): Promise<void> {
    const category = TEMPLATE_CATEGORY[input.type]; if (!category) throw new Error("unsupported-email-type");
    const result = await this.db.from("email_jobs").insert({ user_id: input.userId, type: input.type, category, idempotency_key: input.key, variables: input.variables ?? {}, snapshot_id: input.snapshotId, campaign_id: input.campaignId, scheduled_for: input.scheduledFor ?? new Date().toISOString(), status: input.scheduledFor ? "scheduled" : "queued" });
    if (result.error?.code !== "23505") checked(result);
  }
  async unsubscribeUrl(id: string, category: OptionalCategory, jobId: string): Promise<string> {
    // Stable secret-keyed capability across retries; only its hash is stored.
    if (!this.env.AXOM_COMMUNICATIONS_TOKEN_SECRET) throw new Error("unsubscribe-token-secret-required");
    const token = await hashToken(`${this.env.AXOM_COMMUNICATIONS_TOKEN_SECRET}:${id}:${category}:${jobId}`);
    checked(await this.db.from("communication_tokens").upsert({ token_hash: await hashToken(token), user_id: id, category, expires_at: new Date(Date.now() + 400 * 86400000).toISOString() }));
    return `${this.env.SUPABASE_URL}/functions/v1/communications?action=unsubscribe&token=${token}`;
  }
  async sendAxomEmail(job: EmailJob): Promise<void> {
    if (job.campaign_id) { const campaign = required(await this.db.from("email_campaigns").select("status").eq("id", job.campaign_id).single()); if (campaign.status === "cancelled") { checked(await this.db.from("email_jobs").update({ status: "cancelled" }).eq("id", job.id)); return; } }
    const user = await this.user(job.user_id); const category = TEMPLATE_CATEGORY[job.type];
    const [prefs, suppression, deletion, context] = await Promise.all([this.preferenceRows(job.user_id), this.db.from("email_suppressions").select("email").eq("email", (user.email ?? "").toLowerCase()).maybeSingle(), this.db.from("privacy_requests").select("id").eq("user_id", job.user_id).eq("kind", "deletion").in("status", ["scheduled", "processing", "failed"]).limit(1), this.context(job.user_id)]);
    const reason = suppressionReason(category, { verified: Boolean(user.email_confirmed_at), addressValid: Boolean(user.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email)), suppressed: Boolean(checked(suppression)), deletionPending: (checked(deletion) ?? []).length > 0, preference: prefs.find(p => p.category === category) });
    // Signup profiles can exist before email verification. Defer the welcome instead of losing it.
    if (reason === "unverified-address" && job.type === "welcome" && Date.now() - Date.parse(job.created_at) < 30 * 86400000) {
      checked(await this.db.from("email_jobs").update({ status: "queued", attempts: Math.max(0, job.attempts - 1), scheduled_for: new Date(Date.now() + 3600000).toISOString(), failure_code: "awaiting-verification" }).eq("id", job.id)); return;
    }
    if (reason) { checked(await this.db.from("email_jobs").update({ status: "suppressed", failure_code: reason }).eq("id", job.id)); return; }
    if (job.snapshot_id) { const row = required(await this.db.from("pulse_snapshots").select("payload").eq("id", job.snapshot_id).eq("user_id", job.user_id).single()); context.snapshot = row.payload; }
    let payload = job.delivery_payload;
    if (payload && payload.to[0]?.toLowerCase() !== user.email?.toLowerCase()) {
      checked(await this.db.from("email_jobs").update({ status: "suppressed", failure_code: "recipient-changed" }).eq("id", job.id)); return;
    }
    if (!payload) {
      const unsubscribe = optional(category) ? await this.unsubscribeUrl(job.user_id, category, job.id) : undefined;
      let actionUrl = job.variables.actionUrl;
      if (job.type === "export_ready" && job.variables.requestId) { await this.exportRecord(job.user_id, job.variables.requestId); actionUrl = `${this.base}/#privacy`; }
      const input: EmailInput = { type: job.type, context, baseUrl: this.base, unsubscribeUrl: unsubscribe, actionUrl, date: job.variables.date, editorial: job.variables.editorial };
      if (!templateReady(input)) { checked(await this.db.from("email_jobs").update({ status: "suppressed", failure_code: "missing-source-data" }).eq("id", job.id)); return; }
      payload = this.provider.prepare(user.email!, renderAxomEmail(input), unsubscribe);
      // Persist before I/O: changing a retry body would violate provider idempotency.
      required(await this.db.from("email_jobs").update({ delivery_payload: payload, first_attempt_at: new Date().toISOString() }).eq("id", job.id).eq("status", "processing").select("id").single());
    }
    const providerId = await this.provider.sendPrepared(payload, job.idempotency_key, job.variables.test);
    checked(await this.db.from("email_jobs").update({ status: "sent", provider_id: providerId, sent_at: new Date().toISOString(), failure_code: null }).eq("id", job.id).eq("status", "processing"));
    checked(await this.db.from("email_send_log").upsert({ job_id: job.id, attempt: job.attempts, outcome: "sent", provider_id: providerId }, { onConflict: "job_id,attempt" }));
  }
  async work(): Promise<{ processed: number }> {
    if (!this.env.RESEND_API_KEY || !["test", "live"].includes(this.env.AXOM_EMAIL_MODE ?? "")) return { processed: 0 };
    const jobs = checked(await this.db.rpc("claim_axom_email_jobs", { p_limit: 20 })) as EmailJob[];
    for (const job of jobs) {
      try {
        // Resend remembers keys for 24 hours. Never guess whether an old ambiguous send landed.
        if (job.first_attempt_at && Date.now() - Date.parse(job.first_attempt_at) > 23 * 3600000) throw new Error("delivery-reconciliation-required");
        await this.sendAxomEmail(job);
      } catch (error) {
        const code = error instanceof ProviderError ? error.message : error instanceof Error && ["delivery-reconciliation-required", "delivery-disabled-or-recipient-not-allowlisted", "verified-sender-required"].includes(error.message) ? error.message : "processing-failed";
        const retry = code !== "delivery-reconciliation-required" && job.attempts < 5 && (!(error instanceof ProviderError) || error.status === 429 || error.status >= 500);
        checked(await this.db.from("email_jobs").update({ status: retry ? "queued" : "failed", failure_code: code, scheduled_for: new Date(Date.now() + Math.pow(2, job.attempts) * 60000).toISOString() }).eq("id", job.id).eq("status", "processing"));
        checked(await this.db.from("email_send_log").upsert({ job_id: job.id, attempt: job.attempts, outcome: code }, { onConflict: "job_id,attempt" }));
      }
    }
    return { processed: jobs.length };
  }
  async savePreferences(id: string, rows: Preference[], identity?: Identity): Promise<void> {
    if (!Array.isArray(rows) || rows.length !== Object.keys(CATEGORIES).length || new Set(rows.map(p => p.category)).size !== rows.length) throw new Error("Supply each email category once.");
    rows.forEach(validatePreference); const now = new Date().toISOString();
    checked(await this.db.from("communication_preferences").upsert(rows.map(p => ({ ...p, user_id: id, updated_at: now, consent_at: p.enabled ? now : null }))));
    checked(await this.db.from("communication_identity").upsert({ user_id: id, ...(identity ? { accent: safeAccent(identity.accent), theme: identity.theme === "light" ? "light" : "dark", locale: "en" } : {}), topics_dirty: true, updated_at: now }));
  }
  async schedule(now = new Date()): Promise<number> {
    let queued = 0;
    const cursor = required(await this.db.from("communication_worker_state").select("schedule_offset").eq("id", 1).single());
    const offset = cursor.schedule_offset as number;
    {
      const rows = checked(await this.db.from("communication_preferences").select("*").eq("enabled", true).order("user_id").order("category").range(offset, offset + 199)) as (Preference & { user_id: string })[];
      for (const p of rows) {
        const period = duePeriod(p, now); if (!period) continue;
        const local = localClock(now, p.timezone); let snapshotId: string | undefined;
        if (["weekly_report", "monthly_report", "annual_pulse"].includes(p.category)) {
          const scope = p.category === "weekly_report" ? "week" : p.category === "monthly_report" ? "month" : "year";
          const dates = scope === "year" ? { start: `${period}-01-01`, end: `${period}-12-31` } : periodBefore(local.day, scope);
          const snapshot = await this.snapshot(p.user_id, scope, dates.start, dates.end, p.timezone); if (!snapshot) continue; snapshotId = snapshot.id;
        }
        let type: EmailType = p.category === "annual_pulse" ? "pulse" : p.category === "exam_reminders" ? "exam_reminder" : p.category as EmailType;
        if (type === "daily_learning") {
          const workspace = await this.workspace(p.user_id);
          const last = workspace ? [...workspace.state.logs.map(log => log.dayKey), ...attemptEvents(workspace.state.questions).map(event => localClock(new Date(event.at), p.timezone).day)].sort().at(-1) : undefined;
          if (!last) continue;
          if (Date.parse(local.day) - Date.parse(last) >= 14 * 86400000) {
            // One calm return email per month, never daily streak pressure.
            type = "inactivity";
            await this.enqueue({ userId: p.user_id, type, key: `${p.user_id}:inactivity:${local.day.slice(0, 7)}` }); queued++; continue;
          }
        }
        if (type === "exam_reminder") { const exam = (await this.context(p.user_id)).exam; if (!exam || ![1, 3, 7, 14].includes(exam.days)) continue; }
        await this.enqueue({ userId: p.user_id, type, key: `${p.user_id}:${type}:${period}`, snapshotId }); queued++;
      }
      checked(await this.db.from("communication_worker_state").update({ schedule_offset: rows.length < 200 ? 0 : offset + 200 }).eq("id", 1));
    }
    return queued;
  }
  async syncTopics(id: string): Promise<void> {
    if (!this.env.RESEND_TOPIC_IDS || !this.env.RESEND_API_KEY || this.env.AXOM_EMAIL_MODE !== "live") return;
    const [user, prefs, identity] = await Promise.all([this.user(id), this.preferenceRows(id), this.identity(id)]);
    if (!user.email_confirmed_at || !user.email) return;
    const map = JSON.parse(this.env.RESEND_TOPIC_IDS) as Partial<Record<OptionalCategory, string>>;
    const topics = prefs.filter(p => map[p.category]).map(p => ({ id: map[p.category]!, subscription: p.enabled ? "opt_in" : "opt_out" }));
    let contactId = identity.contact_id;
    if (!contactId) {
      try { contactId = (await this.provider.request<{ id: string }>(`/contacts/${encodeURIComponent(user.email)}`)).id; } catch (error) { if (!(error instanceof ProviderError) || error.status !== 404) throw error; }
      if (!contactId) contactId = (await this.provider.request<{ id: string }>("/contacts", "POST", { email: user.email, first_name: firstName(user.user_metadata?.display_name ?? ""), unsubscribed: !prefs.some(p => p.enabled), topics })).id;
      checked(await this.db.from("communication_identity").update({ contact_id: contactId }).eq("user_id", id));
    }
    await this.provider.request(`/contacts/${contactId}`, "PATCH", { unsubscribed: !prefs.some(p => p.enabled) });
    if (topics.length) await this.provider.request(`/contacts/${contactId}/topics`, "PATCH", topics);
    // A newer user change must stay dirty and be synchronized on the next worker pass.
    checked(await this.db.from("communication_identity").update({ topics_dirty: false, topics_error: null }).eq("user_id", id).eq("updated_at", identity.updated_at ?? ""));
  }
  async event(eventId: string, event: ProviderEvent): Promise<void> {
    let receivedAt = new Date().toISOString();
    const insert = await this.db.from("email_events").insert({ provider_event_id: eventId, provider_id: event.data.email_id, type: event.type, event_at: event.created_at, payload: event });
    if (insert.error?.code === "23505") { const old = required(await this.db.from("email_events").select("processed_at,created_at").eq("provider_event_id", eventId).single()); if (old.processed_at) return; receivedAt = old.created_at ?? receivedAt; } else checked(insert);
    if (["email.bounced", "email.complained", "email.suppressed"].includes(event.type)) {
      for (const email of event.data.to ?? []) checked(await this.db.from("email_suppressions").upsert({ email: email.toLowerCase(), reason: event.type }));
    }
    const statuses: Record<string, string> = { "email.sent": "sent", "email.delivered": "delivered", "email.bounced": "bounced", "email.complained": "complained", "email.failed": "failed", "email.suppressed": "suppressed" };
    if (event.data.email_id && statuses[event.type]) {
      const status = statuses[event.type]; let query = this.db.from("email_jobs").update({ status }).eq("provider_id", event.data.email_id);
      query = status === "sent" ? query.in("status", ["processing", "queued", "sent"]) : status === "delivered" ? query.in("status", ["sent", "processing", "queued", "delivered"]) : status === "bounced" ? query.neq("status", "complained") : status === "suppressed" ? query.not("status", "in", "(bounced,complained)") : status === "failed" ? query.not("status", "in", "(bounced,complained,suppressed)") : query;
      checked(await query);
      const job = checked(await this.db.from("email_jobs").select("id").eq("provider_id", event.data.email_id).maybeSingle());
      // A webhook can beat the send acknowledgement. Keep it pending for reconciliation.
      if (!job && Date.now() - Date.parse(receivedAt) < 15 * 60000) return;
    }
    if (event.type.startsWith("contact.") && event.data.email) {
      const contact = event.data.id ? { id: event.data.id } : await this.provider.request<{ id: string }>(`/contacts/${encodeURIComponent(event.data.email)}`);
      const owner = checked(await this.db.from("communication_identity").select("user_id").eq("contact_id", contact.id).maybeSingle());
      if (owner) {
        if (event.data.unsubscribed === true) checked(await this.db.from("communication_preferences").update({ enabled: false, updated_at: event.created_at }).eq("user_id", owner.user_id).lte("updated_at", event.created_at));
        const map = JSON.parse(this.env.RESEND_TOPIC_IDS ?? "{}") as Record<string, string>;
        for (const topic of event.data.topics ?? []) {
          const category = Object.keys(map).find(key => map[key] === topic.id);
          // Provider opt-outs are authoritative. Provider opt-ins never manufacture AXOM consent.
          if (category && topic.subscription === "opt_out") checked(await this.db.from("communication_preferences").update({ enabled: false, updated_at: event.created_at }).eq("user_id", owner.user_id).eq("category", category).lte("updated_at", event.created_at));
        }
      }
    }
    checked(await this.db.from("email_events").update({ processed_at: new Date().toISOString() }).eq("provider_event_id", eventId));
  }
  async exportRecord(id: string, requestId: string) {
    const row = required(await this.db.from("privacy_requests").select("object_path,expires_at,status").eq("id", requestId).eq("user_id", id).eq("kind", "export").single());
    if (row.status !== "ready" || !row.object_path || Date.parse(row.expires_at) <= Date.now()) throw new Error("export-expired-request-again");
    return row;
  }
  async exportLink(id: string, requestId: string): Promise<string> {
    const row = await this.exportRecord(id, requestId);
    return required(await this.db.storage.from("communications-exports").createSignedUrl(row.object_path, 900)).signedUrl;
  }
}
