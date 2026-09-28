// Request handling for the ai-proxy Edge Function. Authentication, the quota
// and the Claude call are injected, so the web test suite drives this exact
// flow without Deno, Supabase or Anthropic; index.ts wires the real services.
import {
  buildAnthropicRequest, LIMITS, parseJsonLoose, stopReasonError, upstreamError, validateBody,
  type AiTier, type AnthropicRequest, type ProxyRequestBody,
} from "./core.ts";
import { buildTask, isTaskId } from "./tasks.ts";

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export interface ProxyUser {
  /** Spends one request of today's allowance; returns what is left, or -1 when it is used up. */
  consumeQuota(dailyLimit: number): Promise<number>;
}

export interface ClaudeReply {
  text: string;
  stopReason: string | null;
  model: string;
  usage?: unknown;
}

/** An upstream failure by HTTP status; 408 means the call timed out. */
export class UpstreamError extends Error {
  constructor(readonly status: number) {
    super(`Anthropic request failed (${status}).`);
  }
}

export interface ProxyDeps {
  configured: boolean;
  models: Record<AiTier, string>;
  dailyLimit: number;
  /** Resolves the caller from their bearer token, or null for an invalid session. */
  authenticate(authorization: string): Promise<ProxyUser | null>;
  /** Sends the Messages API request; throws UpstreamError on HTTP failures. */
  complete(request: AnthropicRequest): Promise<ClaudeReply>;
}

type Resolved = { ok: true; body: ProxyRequestBody; promptVersion?: string } | { ok: false; error: string };

/**
 * `{ task, input }` runs a server-owned task (its prompt, schema, budget and
 * tier come from tasks.ts). Anything else is the original freeform request.
 * Only tasks can carry screenshots, and each task validates its own.
 */
export function resolveRequest(value: unknown): Resolved {
  if (value && typeof value === "object" && !Array.isArray(value) && "input" in value) {
    const { task, input } = value as { task?: unknown; input: unknown };
    if (!isTaskId(task)) return { ok: false, error: "Unknown AI task." };
    const built = buildTask(task, input);
    if (!built.ok) return built;
    const { system, prompt, schema, maxTokens, tier, effort, promptVersion, images } = built.task;
    return {
      ok: true,
      body: { task, system, prompt, schema, maxTokens, tier, effort, ...(images?.length ? { images } : {}) },
      promptVersion,
    };
  }
  return validateBody(value);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

export function createHandler(deps: ProxyDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    if (req.method !== "POST") return json({ error: "Use POST." }, 405);
    if (!deps.configured) return json({ error: "Cloud AI is not configured on this server yet." }, 503);

    const authorization = req.headers.get("Authorization") ?? "";
    if (!authorization.startsWith("Bearer ")) return json({ error: "Sign in to use AXOM Cloud AI." }, 401);
    const user = await deps.authenticate(authorization);
    if (!user) return json({ error: "Your session expired. Sign in again." }, 401);

    // Screenshots make bodies large; refuse an oversized one before reading it.
    const declaredBytes = Number(req.headers.get("Content-Length") ?? 0);
    if (declaredBytes > LIMITS.bodyBytes) {
      return json({ error: "This request is too large. Send fewer or smaller screenshots at a time." }, 413);
    }

    let raw: unknown;
    try { raw = await req.json(); } catch { return json({ error: "Invalid JSON body." }, 400); }
    const resolved = resolveRequest(raw);
    if (!resolved.ok) return json({ error: resolved.error }, 400);

    let left: number;
    try { left = await user.consumeQuota(deps.dailyLimit); } catch { return json({ error: "Could not check your Cloud AI allowance." }, 500); }
    if (left < 0) {
      return json({ error: `Today's Cloud AI allowance (${deps.dailyLimit} requests) is used up. It resets at 00:00 UTC.`, remaining: 0 }, 429);
    }

    let reply: ClaudeReply;
    try {
      reply = await deps.complete(buildAnthropicRequest(resolved.body, deps.models));
    } catch (error) {
      const mapped = upstreamError(error instanceof UpstreamError ? error.status : 0);
      return json({ error: mapped.error, remaining: left }, mapped.status);
    }
    const stopped = stopReasonError(reply.stopReason);
    if (stopped) return json({ error: stopped.error, remaining: left }, stopped.status);
    const result = parseJsonLoose(reply.text);
    if (result === undefined) return json({ error: "The AI reply was not valid JSON. Try again.", remaining: left }, 502);
    return json({
      result,
      model: reply.model,
      remaining: left,
      usage: reply.usage,
      ...(resolved.promptVersion ? { promptVersion: resolved.promptVersion } : {}),
    });
  };
}
