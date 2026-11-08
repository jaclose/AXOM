// ===========================================================================
// AXOM Cloud AI — Claude through the ai-proxy Supabase Edge Function. The
// Anthropic key stays server-side; the app only sends the signed-in user's
// session token, and the server meters a per-user daily allowance.
// ===========================================================================
import type { AIProvider, AiAvailability, AiJsonRequest } from "./types";

/**
 * A signed-in Cloud AI request carries the user's bearer token and source text.
 * A persisted device preference is NOT an authority to change its destination.
 * Permit only this build's exact Supabase ai-proxy endpoint. The local Supabase
 * emulator is supported solely in development builds.
 */
export function trustedCloudAiEndpoint(
  configuredProjectUrl: string | undefined,
  persistedOverride?: string,
  allowLocalDev = false,
): string | null {
  if (!configuredProjectUrl) return null;
  try {
    const project = new URL(configuredProjectUrl);
    if (project.username || project.password || project.search || project.hash || project.pathname !== "/") return null;
    const hosted = project.protocol === "https:"
      && /^[a-z0-9]{20}\.supabase\.co$/.test(project.hostname) && project.port === "";
    const localDev = allowLocalDev && project.protocol === "http:"
      && (project.hostname === "localhost" || project.hostname === "127.0.0.1");
    if (!hosted && !localDev) return null;

    const expected = new URL("/functions/v1/ai-proxy", project).href;
    if (!persistedOverride) return expected;
    if (persistedOverride !== persistedOverride.trim()) return null;
    const requested = new URL(persistedOverride);
    if (requested.username || requested.password || requested.search || requested.hash) return null;
    return requested.href === expected ? expected : null;
  } catch {
    return null;
  }
}

export interface CloudAuthSnapshot {
  userId: string;
  accessToken: string;
}

export interface CloudProviderOptions {
  endpoint: string;
  /** Resolves the current session's access token (null when signed out). */
  getAccessToken: () => Promise<string | null>;
  /** Synchronous, fail-closed account/token snapshot, pinned to provider's initial user. */
  getAuthSnapshot: () => CloudAuthSnapshot | null;
  /** Revalidate the currently persisted learner consent at every request boundary. */
  isRequestAllowed: () => boolean;
  /** Public client key for the Supabase gateway (publishable / anon). */
  apiKey?: string;
  tier?: "fast" | "quality";
  fetchImpl?: typeof fetch;
}

export interface CloudJsonRequest extends AiJsonRequest {
  task?: string;
  tier?: "fast" | "quality";
}

/** Last known allowance is an account-scoped receipt, never a device-wide value.
 * A signed-out/unknown caller receives null instead of the prior learner's quota.
 */
let lastRemaining: { userId: string; utcDay: string; remaining: number } | null = null;
function currentUtcQuotaDay(): string {
  return new Date().toISOString().slice(0, 10);
}
export function cloudAiRemaining(userId?: string): number | null {
  return userId && lastRemaining?.userId === userId && lastRemaining.utcDay === currentUtcQuotaDay()
    ? lastRemaining.remaining
    : null;
}

export function createCloudProvider(options: CloudProviderOptions): AIProvider & { completeJson(req: CloudJsonRequest): Promise<unknown> } {
  const doFetch = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  // Cached providers outlive the Settings panel, including across another tab's
  // verified Off write. Never trust creation-time mode or destination alone.
  const canSend = (): boolean => {
    try { return options.isRequestAllowed() === true; } catch { return false; }
  };
  const consentError = "Cloud AI is off or its trusted connection changed. Check AI settings before retrying.";
  const identityError = "The signed-in account or session changed. Cloud AI stopped; reopen the request and retry.";
  // Copy both scalar values: a mutable auth-store object must not alter the
  // initiating identity while getSession(), fetch() or response.json() awaits.
  const snapshot = (): CloudAuthSnapshot | null => {
    try {
      const current = options.getAuthSnapshot();
      if (!current || typeof current.userId !== "string" || !current.userId ||
        typeof current.accessToken !== "string" || !current.accessToken) return null;
      return { userId: current.userId, accessToken: current.accessToken };
    } catch {
      return null; // Unknown / unreadable auth storage is never permission to send.
    }
  };
  const sameSession = (started: CloudAuthSnapshot): boolean => {
    const current = snapshot();
    return current !== null && current.userId === started.userId && current.accessToken === started.accessToken;
  };
  return {
    info: { kind: "anthropic", label: "AXOM Cloud AI (Claude)", local: false, requiresKey: false },
    async available(): Promise<AiAvailability> {
      if (!canSend()) return { ok: false, detail: consentError };
      const started = snapshot();
      if (!started) return { ok: false, detail: identityError };
      const token = await options.getAccessToken().catch(() => null);
      if (!canSend()) return { ok: false, detail: consentError };
      if (!sameSession(started) || (token && token !== started.accessToken)) return { ok: false, detail: identityError };
      const remaining = cloudAiRemaining(started.userId);
      return token
        ? { ok: true, detail: remaining !== null ? `Signed in · ${remaining} Cloud AI requests left today.` : "Signed in · Claude via your AXOM account." }
        : { ok: false, detail: "Sign in to your AXOM account to use Cloud AI." };
    },
    async completeJson(req: CloudJsonRequest): Promise<unknown> {
      // Check before invoking auth, then again after the asynchronous token
      // resolution. An Off / destination change during that await must not
      // dispatch any learner token or study text.
      if (!canSend()) throw new Error(consentError);
      const started = snapshot();
      if (!started) throw new Error(identityError);
      const token = await options.getAccessToken();
      if (!canSend()) throw new Error(consentError);
      if (!sameSession(started) || (token && token !== started.accessToken)) throw new Error(identityError);
      if (!token) throw new Error("Sign in to your AXOM account to use Cloud AI.");
      // Daily server allowance resets at 00:00 UTC. Attribute an in-flight
      // response to its dispatch day, not the day the response happens to land.
      const requestUtcDay = currentUtcQuotaDay();
      const response = await doFetch(options.endpoint, {
        method: "POST",
        // Never forward a signed-in learner token or source text on HTTP 3xx.
        redirect: "error",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          ...(options.apiKey ? { apikey: options.apiKey } : {}),
        },
        signal: req.signal,
        body: JSON.stringify({
          task: req.task,
          system: req.system,
          prompt: req.prompt,
          maxTokens: req.maxTokens,
          tier: req.tier ?? options.tier ?? "fast",
          schema: req.schema,
        }),
      });
      // A response from an already-sent request cannot be un-sent. Avoid
      // returning its content or updating quota UI after consent changes.
      if (!canSend()) throw new Error(consentError);
      if (!sameSession(started)) throw new Error(identityError);
      let payload: { result?: unknown; error?: string; remaining?: number } = {};
      try { payload = await response.json(); } catch { /* handled below */ }
      // Response bodies may be streamed. Revocation during JSON decoding must
      // also suppress both the returned proposal and stale quota state.
      if (!canSend()) throw new Error(consentError);
      if (!sameSession(started)) throw new Error(identityError);
      if (typeof payload.remaining === "number" && Number.isFinite(payload.remaining) && payload.remaining >= 0) {
        lastRemaining = { userId: started.userId, utcDay: requestUtcDay, remaining: payload.remaining };
      }
      if (!response.ok) {
        if (response.status === 429) lastRemaining = { userId: started.userId, utcDay: requestUtcDay, remaining: 0 };
        throw new Error(payload.error || `Cloud AI failed (${response.status}).`);
      }
      if (payload.result === undefined) throw new Error("Cloud AI returned an empty reply.");
      const result = payload.result as { error?: unknown };
      if (result && typeof result === "object" && !Array.isArray(result) && typeof result.error === "string" && Object.keys(result).length === 1) {
        throw new Error(result.error);
      }
      return payload.result;
    },
  };
}
