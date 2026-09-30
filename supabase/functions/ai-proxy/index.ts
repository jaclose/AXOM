// ===========================================================================
// ai-proxy — AXOM Cloud AI. Signed-in users call Claude through this Edge
// Function; the Anthropic key lives only in Supabase secrets, never in the
// app. Each call spends one unit of a per-user daily quota
// (public.consume_ai_quota, counted against the caller's own JWT).
//
// Deploy:   supabase functions deploy ai-proxy
// Secrets:  supabase secrets set ANTHROPIC_API_KEY=...
//           [AI_MODEL_FAST=claude-haiku-4-5-20251001] [AI_MODEL_QUALITY=claude-sonnet-5]
// ===========================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import { aiProxyCorsPolicy, buildAnthropicRequest, parseJsonLoose, readJsonRequest, textFromAnthropic, upstreamError, validateBody } from "./core.ts";

const MODELS = {
  fast: Deno.env.get("AI_MODEL_FAST") ?? "claude-haiku-4-5-20251001",
  quality: Deno.env.get("AI_MODEL_QUALITY") ?? "claude-sonnet-5",
};

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  const cors = aiProxyCorsPolicy({
    origin: req.headers.get("Origin"),
    method: req.method,
    requestedMethod: req.headers.get("Access-Control-Request-Method"),
    requestedHeaders: req.headers.get("Access-Control-Request-Headers"),
    configuredOrigins: [Deno.env.get("AXOM_ALLOWED_ORIGINS"), Deno.env.get("ALLOWED_ORIGINS")].filter(Boolean).join(","),
    production: Deno.env.get("AXOM_ENV") !== "development"
      && !/^(https?:\/\/)?(localhost|127\.0\.0\.1)(:\d+)?$/i.test(Deno.env.get("SUPABASE_URL") ?? ""),
  });
  const respond = (body: unknown, status = 200) => json(body, status, cors.headers);
  if (req.method === "OPTIONS") {
    return cors.allowed ? new Response(null, { status: 204, headers: cors.headers }) : respond({ error: "Preflight not allowed." }, 403);
  }
  if (!cors.allowed) return respond({ error: "Origin not allowed." }, 403);
  if (req.method !== "POST") return respond({ error: "Use POST." }, 405);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return respond({ error: "Cloud AI is not configured on this server yet." }, 503);

  const authorization = req.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return respond({ error: "Sign in to use AXOM Cloud AI." }, 401);
  const publicKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, publicKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await supabase.auth.getUser(authorization.slice("Bearer ".length));
  if (userError || !userData?.user) return respond({ error: "Your session expired. Sign in again." }, 401);

  const raw = await readJsonRequest(req);
  if (!raw.ok) return respond({ error: "Invalid or oversized JSON body." }, 400);
  const parsed = validateBody(raw.value);
  if (!parsed.ok) return respond({ error: parsed.error }, 400);

  const { data: left, error: quotaError } = await supabase.rpc("consume_ai_quota");
  if (quotaError) return respond({ error: "Could not check your Cloud AI allowance." }, 500);
  if (typeof left === "number" && left < 0) {
    return respond({ error: "Today's Cloud AI allowance is used up. It resets at 00:00 UTC." }, 429);
  }

  let upstream: Response;
  try {
    upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(buildAnthropicRequest(parsed.body, MODELS)),
      signal: AbortSignal.any([req.signal, AbortSignal.timeout(45_000)]),
    });
  } catch {
    console.error("anthropic upstream request failed or timed out");
    return respond({ error: "The AI service is unavailable right now." }, 503);
  }
  if (!upstream.ok) {
    console.error("anthropic upstream status", upstream.status);
    const mapped = upstreamError(upstream.status);
    return respond({ error: mapped.error }, mapped.status);
  }
  let data: { content?: Array<{ type?: string; text?: string }>; model?: string; usage?: unknown };
  try {
    data = await upstream.json();
  } catch {
    return respond({ error: "The AI service returned an invalid reply." }, 502);
  }
  const result = parseJsonLoose(textFromAnthropic(data));
  if (result === undefined) return respond({ error: "The AI reply was not valid JSON. Try again." }, 502);
  return respond({ result, model: data.model, remaining: left, usage: data.usage });
});
