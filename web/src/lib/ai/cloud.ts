// ===========================================================================
// AXOM Cloud AI — Claude through the ai-proxy Supabase Edge Function. The
// Anthropic key stays server-side; the app only sends the signed-in user's
// session token, and the server meters a per-user daily allowance.
// ===========================================================================
import type { AIProvider, AiAvailability, AiJsonRequest } from "./types";

export interface CloudProviderOptions {
  endpoint: string;
  /** Resolves the current session's access token (null when signed out). */
  getAccessToken: () => Promise<string | null>;
  /** Public client key for the Supabase gateway (publishable / anon). */
  apiKey?: string;
  tier?: "fast" | "quality";
  fetchImpl?: typeof fetch;
}

export interface CloudJsonRequest extends AiJsonRequest {
  task?: string;
  schema?: Record<string, unknown>;
  tier?: "fast" | "quality";
}

/** Last known allowance left today (null until a call reports it). */
let lastRemaining: number | null = null;
export function cloudAiRemaining(): number | null {
  return lastRemaining;
}

export function createCloudProvider(options: CloudProviderOptions): AIProvider & { completeJson(req: CloudJsonRequest): Promise<unknown> } {
  const doFetch = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  return {
    info: { kind: "anthropic", label: "AXOM Cloud AI (Claude)", local: false, requiresKey: false },
    async available(): Promise<AiAvailability> {
      const token = await options.getAccessToken().catch(() => null);
      return token
        ? { ok: true, detail: lastRemaining !== null ? `Signed in · ${lastRemaining} Cloud AI requests left today.` : "Signed in · Claude via your AXOM account." }
        : { ok: false, detail: "Sign in to your AXOM account to use Cloud AI." };
    },
    async completeJson(req: CloudJsonRequest): Promise<unknown> {
      const token = await options.getAccessToken();
      if (!token) throw new Error("Sign in to your AXOM account to use Cloud AI.");
      const response = await doFetch(options.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          ...(options.apiKey ? { apikey: options.apiKey } : {}),
        },
        body: JSON.stringify({
          task: req.task,
          system: req.system,
          prompt: req.prompt,
          maxTokens: req.maxTokens,
          tier: req.tier ?? options.tier ?? "fast",
          schema: req.schema,
        }),
      });
      let payload: { result?: unknown; error?: string; remaining?: number } = {};
      try { payload = await response.json(); } catch { /* handled below */ }
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
