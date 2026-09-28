// ===========================================================================
// ai-proxy — AXOM Cloud AI. Signed-in users call Claude through this Edge
// Function; the Anthropic key lives only in Supabase secrets, never in the
// app. Each call spends one unit of a per-user daily quota
// (public.consume_ai_quota, counted against the caller's own JWT). Request
// handling lives in handler.ts; server-owned task prompts in tasks.ts.
//
// Deploy:   supabase functions deploy ai-proxy
// Secrets:  supabase secrets set ANTHROPIC_API_KEY=... [AI_DAILY_LIMIT=60]
//           [AI_MODEL_FAST=claude-haiku-4-5-20251001] [AI_MODEL_QUALITY=claude-sonnet-5]
// ===========================================================================
import Anthropic from "npm:@anthropic-ai/sdk@0.128.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { textFromAnthropic, type AiTier } from "./core.ts";
import { createHandler, UpstreamError } from "./handler.ts";

const MODELS: Record<AiTier, string> = {
  fast: Deno.env.get("AI_MODEL_FAST") ?? "claude-haiku-4-5-20251001",
  quality: Deno.env.get("AI_MODEL_QUALITY") ?? "claude-sonnet-5",
};
const DAILY_LIMIT = Number(Deno.env.get("AI_DAILY_LIMIT") ?? "60") || 60;
const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
// One retry and a deadline that leaves room inside the Edge Function's
// 150 s request limit, so a slow reply becomes a clear error, not a 504.
const anthropic = apiKey ? new Anthropic({ apiKey, maxRetries: 1, timeout: 120_000 }) : null;

Deno.serve(createHandler({
  configured: anthropic !== null,
  models: MODELS,
  dailyLimit: DAILY_LIMIT,

  async authenticate(authorization) {
    const publicKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, publicKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase.auth.getUser(authorization.slice("Bearer ".length));
    if (error || !data?.user) return null;
    return {
      async consumeQuota(dailyLimit) {
        const { data: left, error: quotaError } = await supabase.rpc("consume_ai_quota", { p_daily_limit: dailyLimit });
        if (quotaError || typeof left !== "number") throw quotaError ?? new Error("Unexpected quota reply.");
        return left;
      },
    };
  },

  async complete(request) {
    try {
      // Streaming keeps long generations (question sets) from idling out.
      const message = await anthropic!.messages.stream(request).finalMessage();
      return { text: textFromAnthropic(message), stopReason: message.stop_reason, model: message.model, usage: message.usage };
    } catch (error) {
      if (error instanceof Anthropic.APIConnectionTimeoutError) throw new UpstreamError(408);
      if (error instanceof Anthropic.APIError) {
        console.error("anthropic", error.status, error.message.slice(0, 500));
        throw new UpstreamError(error.status ?? 0);
      }
      throw error;
    }
  },
}));
