// ===========================================================================
// ai-proxy — AXOM Cloud AI. Signed-in users call Claude through this Edge
// Function; the Anthropic key lives only in Supabase secrets, never in the
// app. Each call spends one unit of a per-user daily quota
// (public.consume_ai_quota, counted against the caller's own JWT).
//
// Deploy:   supabase functions deploy ai-proxy
// Secrets:  supabase secrets set ANTHROPIC_API_KEY=... [AI_DAILY_LIMIT=60]
//           [AI_MODEL_FAST=claude-haiku-4-5-20251001] [AI_MODEL_QUALITY=claude-sonnet-5]
// ===========================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildAnthropicRequest, parseJsonLoose, textFromAnthropic, upstreamError, validateBody } from "./core.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODELS = {
  fast: Deno.env.get("AI_MODEL_FAST") ?? "claude-haiku-4-5-20251001",
  quality: Deno.env.get("AI_MODEL_QUALITY") ?? "claude-sonnet-5",
};
const DAILY_LIMIT = Number(Deno.env.get("AI_DAILY_LIMIT") ?? "60") || 60;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "Cloud AI is not configured on this server yet." }, 503);

  const authorization = req.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return json({ error: "Sign in to use AXOM Cloud AI." }, 401);
  const publicKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, publicKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await supabase.auth.getUser(authorization.slice("Bearer ".length));
  if (userError || !userData?.user) return json({ error: "Your session expired. Sign in again." }, 401);

  let raw: unknown;
  try { raw = await req.json(); } catch { return json({ error: "Invalid JSON body." }, 400); }
  const parsed = validateBody(raw);
  if (!parsed.ok) return json({ error: parsed.error }, 400);

  const { data: left, error: quotaError } = await supabase.rpc("consume_ai_quota", { p_daily_limit: DAILY_LIMIT });
  if (quotaError) return json({ error: "Could not check your Cloud AI allowance." }, 500);
  if (typeof left === "number" && left < 0) {
    return json({ error: `Today's Cloud AI allowance (${DAILY_LIMIT} requests) is used up. It resets at 00:00 UTC.` }, 429);
  }

  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(buildAnthropicRequest(parsed.body, MODELS)),
  });
  if (!upstream.ok) {
    console.error("anthropic", upstream.status, (await upstream.text()).slice(0, 500));
    const mapped = upstreamError(upstream.status);
    return json({ error: mapped.error }, mapped.status);
  }
  const data = await upstream.json();
  const result = parseJsonLoose(textFromAnthropic(data));
  if (result === undefined) return json({ error: "The AI reply was not valid JSON. Try again." }, 502);
  return json({ result, model: data.model, remaining: left, usage: data.usage });
});
