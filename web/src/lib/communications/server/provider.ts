import type { RenderedEmail } from "../model";
export type Env = Record<string, string | undefined>;
export interface DeliveryPayload { from: string; to: string[]; subject: string; html: string; text: string; reply_to?: string; headers?: Record<string, string> }
export class ProviderError extends Error { constructor(public status: number) { super(`provider-${status}`); } }
export class ResendProvider {
  constructor(private env: Env, private fetcher: typeof fetch = fetch) {}
  async request<T>(path: string, method = "GET", body?: unknown, key?: string): Promise<T> {
    if (!this.env.RESEND_API_KEY) throw new Error("Resend is not configured.");
    const response = await this.fetcher(`https://api.resend.com${path}`, { method, headers: { Authorization: `Bearer ${this.env.RESEND_API_KEY}`, "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new ProviderError(response.status);
    return await response.json() as T;
  }
  prepare(to: string, email: RenderedEmail, unsubscribe?: string): DeliveryPayload {
    const from = email.category === "essays_from_jafar" ? this.env.AXOM_EMAIL_FROM_EDITORIAL : ["auth", "security", "account", "privacy", "data_export", "account_deletion"].includes(email.category) ? this.env.AXOM_EMAIL_FROM_ACCOUNT : this.env.AXOM_EMAIL_FROM_REPORTS;
    if (!from || /[\r\n]/.test(from)) throw new Error("verified-sender-required");
    return { from, to: [to], subject: email.subject, html: email.html, text: email.text, ...(this.env.AXOM_EMAIL_REPLY_TO ? { reply_to: this.env.AXOM_EMAIL_REPLY_TO } : {}), ...(unsubscribe ? { headers: { "List-Unsubscribe": `<${unsubscribe}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } } : {}) };
  }
  private checkDelivery(to: string[], test: boolean): void {
    const mode = this.env.AXOM_EMAIL_MODE ?? "disabled";
    const allowed = (this.env.AXOM_EMAIL_TEST_RECIPIENTS ?? "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
    if (!["live", "test"].includes(mode) || ((mode === "test" || test) && to.some(address => !allowed.includes(address.toLowerCase())))) throw new Error("delivery-disabled-or-recipient-not-allowlisted");
  }
  async sendPrepared(payload: DeliveryPayload, key: string, test = false): Promise<string> {
    this.checkDelivery(payload.to, test);
    const result = await this.request<{ id: string }>("/emails", "POST", payload, key);
    if (!result.id) throw new Error("provider-missing-message-id");
    return result.id;
  }
  async send(to: string, email: RenderedEmail, key: string, unsubscribe?: string, test = false): Promise<string> {
    this.checkDelivery([to], test);
    return this.sendPrepared(this.prepare(to, email, unsubscribe), key, test);
  }
}
export async function hashToken(value: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map(b => b.toString(16).padStart(2, "0")).join("");
}
export interface ProviderEvent { type: string; created_at: string; data: { email_id?: string; id?: string; email?: string; to?: string[]; unsubscribed?: boolean; topics?: { id: string; subscription: "opt_in" | "opt_out" }[] } }
/** Svix v1 signs the unmodified body and timestamp. WebCrypto verifies in constant time. */
export async function verifyWebhook(raw: string, headers: Headers, secret: string, now = Date.now()): Promise<ProviderEvent> {
  const id = headers.get("svix-id"); const timestamp = headers.get("svix-timestamp"); const signature = headers.get("svix-signature");
  if (!id || !timestamp || !/^\d+$/.test(timestamp) || !signature || Math.abs(now / 1000 - Number(timestamp)) > 300) throw new Error("invalid-webhook");
  const decode = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", decode(secret.replace(/^whsec_/, "")), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const signed = new TextEncoder().encode(`${id}.${timestamp}.${raw}`);
  let verified = false;
  for (const part of signature.split(" ")) { const [version, value] = part.split(","); if (version === "v1" && value) { try { if (await crypto.subtle.verify("HMAC", key, decode(value), signed)) verified = true; } catch { /* Other signatures may use a rotated key. */ } } }
  if (!verified) throw new Error("invalid-webhook");
  const event = JSON.parse(raw) as ProviderEvent;
  if (typeof event.type !== "string" || !event.data || !Number.isFinite(Date.parse(event.created_at))) throw new Error("invalid-webhook-payload");
  return event;
}
