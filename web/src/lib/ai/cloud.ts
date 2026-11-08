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

export interface CloudProviderOptions {
  endpoint: string;
  /** Resolves the current session's access token (null when signed out). */
  getAccessToken: () => Promise<string | null>;
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

/** Last known allowance left today (null until a call reports it). */
let lastRemaining: number | null = null;
export function cloudAiRemaining(): number | null {
  return lastRemaining;
}

export function createCloudProvider(options: CloudProviderOptions): AIProvider & { completeJson(req: CloudJsonRequest): Promise<unknown> } {
  const doFetch = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  // Cached providers outlive the Settings panel, including across another tab's
  // verified Off write. Never trust creation-time mode or destination alone.
  const canSend = (): boolean => {
    try { return options.isRequestAllowed() === true; } catch { return false; }
  };
  const consentError = "Cloud AI is off or its trusted connection changed. Check AI settings before retrying.";
  return {
    info: { kind: "anthropic", label: "AXOM Cloud AI (Claude)", local: false, requiresKey: false },
    async available(): Promise<AiAvailability> {
      if (!canSend()) return { ok: false, detail: consentError };
      const token = await options.getAccessToken().catch(() => null);
      if (!canSend()) return { ok: false, detail: consentError };
      return token
        ? { ok: true, detail: lastRemaining !== null ? `Signed in · ${lastRemaining} Cloud AI requests left today.` : "Signed in · Claude via your AXOM account." }
        : { ok: false, detail: "Sign in to your AXOM account to use Cloud AI." };
    },
    async completeJson(req: CloudJsonRequest): Promise<unknown> {
      // Check before invoking auth, then again after the asynchronous token
      // resolution. An Off / destination change during that await must not
      // dispatch any learner token or study text.
      if (!canSend()) throw new Error(consentError);
      const token = await options.getAccessToken();
      if (!canSend()) throw new Error(consentError);
      if (!token) throw new Error("Sign in to your AXOM account to use Cloud AI.");
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
      let payload: { result?: unknown; error?: string; remaining?: number } = {};
      try { payload = await response.json(); } catch { /* handled below */ }
      // Response bodies may be streamed. Revocation during JSON decoding must
      // also suppress both the returned proposal and stale quota state.
      if (!canSend()) throw new Error(consentError);
      if (typeof payload.remaining === "number") lastRemaining = payload.remaining;
      if (!response.ok) {
        if (response.status === 429) lastRemaining = 0;
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
