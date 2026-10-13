import { describe, expect, it, vi } from "vitest";
import { makeSeed } from "../seed";
import { validateQuestionRecord } from "../questions";
import { buildCanonicalReportSummary } from "../reports";
import { CATEGORIES, TEMPLATE_CATEGORY, duePeriod, periodBefore, preferences, resolveVariables, suppressionReason, type EmailType, type Personalization } from "./model";
import { examContext } from "./context";
import { buildPulse } from "./snapshot";
import { renderAxomEmail, templateReady } from "./email";
import { ResendProvider, verifyWebhook } from "./server/provider";
import { createCommunicationsHandler } from "./server/handler";
import type { SupabaseClient } from "@supabase/supabase-js";
const context: Personalization = { displayName: "Alex Morgan", accent: "#a89bee", theme: "dark", locale: "en", timezone: "America/Grenada", orbUrl: "https://axom.info/icons/axom-orb-512.png" };

describe("communications consent and schedule", () => {
  it("defaults every optional category off", () => { expect(preferences()).toHaveLength(Object.keys(CATEGORIES).length); expect(preferences().some(p => p.enabled)).toBe(false); });
  it.each(["auth", "security", "account", "privacy", "data_export", "account_deletion"] as const)("optional unsubscribe does not suppress %s", category => {
    expect(suppressionReason(category, { verified: true, addressValid: true, suppressed: false, deletionPending: true })).toBeNull();
  });
  it("fails closed for absent consent, unverified addresses and provider suppression", () => {
    const base = { verified: true, addressValid: true, suppressed: false, deletionPending: false };
    expect(suppressionReason("weekly_report", base)).toBe("not-subscribed");
    expect(suppressionReason("security", { ...base, suppressed: true })).toBe("address-suppressed");
    expect(suppressionReason("account", { ...base, verified: false })).toBe("unverified-address");
    expect(suppressionReason("auth", { ...base, addressValid: false })).toBe("invalid-address");
  });
  it("deduplicates both occurrences of a daylight-saving repeated time", () => {
    const pref = { ...preferences("America/New_York")[0], enabled: true, time: "01:30" };
    expect(duePeriod(pref, new Date("2026-11-01T05:35:00Z"))).toBe("2026-11-01");
    expect(duePeriod(pref, new Date("2026-11-01T06:35:00Z"))).toBe("2026-11-01");
  });
  it("catches up after a nonexistent spring time and respects Grenada local time", () => {
    expect(duePeriod({ ...preferences("America/New_York")[0], enabled: true, time: "02:30" }, new Date("2026-03-08T07:05:00Z"))).toBe("2026-03-08");
    const pref = { ...preferences("America/Grenada")[2], enabled: true };
    expect(duePeriod(pref, new Date("2026-10-11T11:59:00Z"))).toBeNull();
    expect(duePeriod(pref, new Date("2026-10-11T12:00:00Z"))).toBe("2026-10-11");
  });
  it("uses the completed prior month and year", () => {
    expect(periodBefore("2026-10-04", "month")).toEqual({ start: "2026-09-01", end: "2026-09-30" });
    expect(periodBefore("2026-01-01", "year")).toEqual({ start: "2025-01-01", end: "2025-12-31" });
  });
  it("allows only named, inert template variables", () => {
    expect(resolveVariables("Hello {{firstName}}. {{currentCourse}}", context)).toBe("Hello Alex. your course");
    expect(() => resolveVariables("{{password}}", context)).toThrow("Unsupported template variable");
  });
});

describe("canonical exam context", () => {
  it("reuses the persisted board-prep date and route", () => {
    const state = makeSeed(); state.boardPrep.step1.examDate = "2026-10-17";
    expect(examContext(state, "2026-10-10")).toMatchObject({ name: "USMLE Step 1", days: 7, route: "step" });
  });
});

describe("one canonical Pulse snapshot", () => {
  const options = { start: "2026-10-01", end: "2026-10-07", scope: "week" as const, timezone: "UTC", accent: context.accent, now: new Date("2026-10-08T12:00:00Z") };
  it("omits unknown statistics for a new user", () => {
    const state = makeSeed(); state.questions = []; state.logs = []; state.cardReviews = []; state.dailyWordPuzzles = [];
    const pulse = buildPulse(state, options); expect(pulse.metrics).toEqual([]); expect(pulse.systems).toEqual([]); expect(pulse.games).toEqual([]);
  });
  it("reuses signed-correction report totals instead of summing sessions twice", () => {
    const state = makeSeed(); state.logs = [30, -10, -100, 60].map((minutes, i) => ({ id: String(i), dayKey: i < 3 ? "2026-10-05" : "2026-10-06", ts: "2026-10-06T12:00:00Z", type: "Study", minutes, cards: 0 }));
    const pulse = buildPulse(state, options);
    expect(pulse.metrics.find(m => m.id === "minutes")?.value).toBe(buildCanonicalReportSummary({ ...state, activeDayKey: options.end }, 7).metrics.study.numerator);
    expect(pulse.metrics.find(m => m.id === "minutes")?.value).toBe(60);
  });
  it("excludes flag-only events and keeps repeat accuracy separate", () => {
    const state = makeSeed(); const record = validateQuestionRecord({ stem: "A synthetic validation question?", options: [{ key: "A", text: "One" }, { key: "B", text: "Two" }], correctKey: "A", source: "manual" });
    if (!record.value) throw new Error("Fixture invalid");
    state.questions = [{ ...record.value, attempts: [{ at: "2026-10-03T10:00:00Z", status: "incorrect", answerKey: "B", mode: "exam" }, { at: "2026-10-04T10:00:00Z", status: "correct", answerKey: "A", mode: "tutor" }, { at: "2026-10-05T10:00:00Z", status: "flagged" }] }];
    const pulse = buildPulse(state, options); expect(pulse.metrics.find(m => m.id === "questions")?.value).toBe(2); expect(pulse.metrics.find(m => m.id === "accuracy")?.value).toBe(50); expect(pulse.metrics.find(m => m.id === "firstAccuracy")?.value).toBe(0); expect(pulse.comparison?.accuracyDelta).toBeUndefined();
    const email = renderAxomEmail({ type: "pulse", context: { ...context, snapshot: pulse }, baseUrl: "https://axom.info" }); expect(email.html).toContain("50%"); expect(email.text).toContain("2  Questions answered");
  });
});

describe("React email rendering", () => {
  it.each(Object.keys(TEMPLATE_CATEGORY) as EmailType[])("renders %s without broken personalizations", type => {
    const email = renderAxomEmail({ type, context: { ...context, displayName: "" }, baseUrl: "https://axom.info" });
    expect(email.html).not.toMatch(/undefined|NaN|<script|backdrop-filter|<svg/); expect(email.html).toContain('alt="AXOM Orb"'); expect(email.text).not.toContain("undefined");
  });
  it.each(["#9b8bdf", "#5cbac4", "#c89c56", "#bd6678"])("supports accent %s and light mode", accent => {
    const email = renderAxomEmail({ type: "welcome", context: { ...context, accent, theme: "light" }, baseUrl: "https://axom.info" }); expect(email.html).toContain(accent); expect(email.html).toContain("#fffdf9"); expect(email.html).not.toContain("Unsubscribe");
  });
  it("escapes author text and forbids unsafe links", () => {
    const email = renderAxomEmail({ type: "essay", context, baseUrl: "https://axom.info", editorial: { title: "{{firstName}} <script>alert(1)</script>", excerpt: '"<img onerror=alert(1)>', url: "javascript:alert(1)" } }); expect(email.html).toContain("Alex &lt;script&gt;"); expect(email.html).not.toContain('href="javascript:'); expect(email.html).toContain("Manage preferences");
  });
  it("keeps report actions and text isolated from unrelated editorial/game context", () => {
    const email = renderAxomEmail({ type: "pulse", baseUrl: "https://axom.info", context: { ...context, games: [{ name: "Unrelated game", url: "https://axom.info/#daily-word", detail: "A case" }] }, editorial: { title: "Unrelated essay", subject: "Unrelated subject", excerpt: "A note", url: "https://axom.info/#essay", cta: "Read essay" } });
    expect(email.subject).toContain("AXOM Pulse"); expect(email.html).toContain("Open My Pulse");
    expect(email.html).toContain('href="https://axom.info/pulse/'); expect(email.html).not.toContain("Read essay");
    expect(email.text).not.toContain("Unrelated game");
  });
  it("declares missing data before a send is attempted", () => { expect(templateReady({ type: "export_ready", context, baseUrl: "https://axom.info" })).toBe(false); expect(templateReady({ type: "daily_games", context, baseUrl: "https://axom.info" })).toBe(false); });
});

describe("delivery boundary", () => {
  const rendered = renderAxomEmail({ type: "welcome", context, baseUrl: "https://axom.info" });
  it("cannot send by default or to a non-allowlisted test address", async () => {
    const fetcher = vi.fn(); await expect(new ResendProvider({}, fetcher).send("example@example.invalid", rendered, "one")).rejects.toThrow("delivery-disabled");
    await expect(new ResendProvider({ AXOM_EMAIL_MODE: "test", AXOM_EMAIL_TEST_RECIPIENTS: "allowed@example.invalid" }, fetcher).send("blocked@example.invalid", rendered, "one")).rejects.toThrow("recipient-not-allowlisted"); expect(fetcher).not.toHaveBeenCalled();
  });
  it("sends the same idempotency key and optional one-click headers to the sole provider", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ id: "msg-1" }), { status: 200 }));
    const provider = new ResendProvider({ AXOM_EMAIL_MODE: "test", AXOM_EMAIL_TEST_RECIPIENTS: "allowed@example.invalid", RESEND_API_KEY: "synthetic-test-token", AXOM_EMAIL_FROM_ACCOUNT: "AXOM <account@example.invalid>" }, fetcher);
    expect(await provider.send("allowed@example.invalid", rendered, "stable-id", "https://example.invalid/unsubscribe")).toBe("msg-1");
    const init = fetcher.mock.calls[0][1]!; expect(init.headers).toHaveProperty("Idempotency-Key", "stable-id"); expect(JSON.parse(String(init.body)).headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });
  it("rejects forged and stale webhooks but verifies exact raw signed bytes", async () => {
    const raw = JSON.stringify({ type: "email.delivered", created_at: "2026-10-10T12:00:00Z", data: { email_id: "one" } });
    const bytes = new TextEncoder().encode("synthetic-webhook-key-for-tests"); const secret = `whsec_${btoa(String.fromCharCode(...bytes))}`; const timestamp = String(Date.parse("2026-10-10T12:00:00Z") / 1000);
    const key = await crypto.subtle.importKey("raw", bytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const signature = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`event-1.${timestamp}.${raw}`)))));
    const headers = new Headers({ "svix-id": "event-1", "svix-timestamp": timestamp, "svix-signature": `v1,${signature}` });
    await expect(verifyWebhook(raw, headers, secret, Number(timestamp) * 1000)).resolves.toHaveProperty("type", "email.delivered");
    await expect(verifyWebhook(raw + " ", headers, secret, Number(timestamp) * 1000)).rejects.toThrow("invalid-webhook");
    await expect(verifyWebhook(raw, headers, secret, Number(timestamp) * 1000 + 301000)).rejects.toThrow("invalid-webhook");
  });
  it("protects worker and admin APIs before any database mutation", async () => {
    const handler = createCommunicationsHandler({} as SupabaseClient, {});
    expect((await handler(new Request("https://example.invalid/?action=worker", { method: "POST" }))).status).toBe(401);
    expect((await handler(new Request("https://example.invalid/?action=admin", { method: "POST" }))).status).toBe(401);
    expect((await handler(new Request("https://example.invalid/?action=preferences", { method: "POST", headers: { Origin: "https://attacker.invalid" } }))).status).toBe(403);
  });
});
