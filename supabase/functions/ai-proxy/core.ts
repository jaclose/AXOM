// Pure request/response logic for the ai-proxy Edge Function. No Deno or
// network APIs here, so the web test suite can exercise it directly.

export type AiTier = "fast" | "quality";
export type AiEffort = "low" | "medium" | "high";

export interface ProxyRequestBody {
  task?: string;
  system?: string;
  prompt: string;
  maxTokens?: number;
  tier?: AiTier;
  /** Optional JSON Schema; enables Claude structured outputs (guaranteed JSON). */
  schema?: Record<string, unknown>;
  /** Set only by server-owned tasks; sent only to models that accept it. */
  effort?: AiEffort;
}

/** The Messages API request this proxy sends (a subset of the SDK's params). */
export interface AnthropicRequest {
  model: string;
  max_tokens: number;
  system: string;
  messages: Array<{ role: "user"; content: string }>;
  output_config?: {
    format?: { type: "json_schema"; schema: Record<string, unknown> };
    effort?: AiEffort;
  };
}

export const LIMITS = { promptChars: 24_000, systemChars: 6_000, maxTokens: 2_000, taskChars: 64 } as const;

export const JSON_RULE =
  "Reply with a single JSON value only: no prose, no markdown fences. " +
  "If the request cannot be satisfied, reply with {\"error\": \"<short reason>\"}.";

export function validateBody(value: unknown): { ok: true; body: ProxyRequestBody } | { ok: false; error: string } {
  if (!value || typeof value !== "object") return { ok: false, error: "Send a JSON object." };
  const record = value as Record<string, unknown>;
  const prompt = typeof record.prompt === "string" ? record.prompt.trim() : "";
  if (!prompt) return { ok: false, error: "A prompt is required." };
  if (prompt.length > LIMITS.promptChars) return { ok: false, error: `Prompt is too long (max ${LIMITS.promptChars} characters).` };
  const system = typeof record.system === "string" ? record.system : undefined;
  if (system && system.length > LIMITS.systemChars) return { ok: false, error: "System prompt is too long." };
  const tier: AiTier = record.tier === "quality" ? "quality" : "fast";
  const maxTokens = Math.min(LIMITS.maxTokens, Math.max(64, Number(record.maxTokens) || 800));
  const schema = record.schema && typeof record.schema === "object" && !Array.isArray(record.schema) ? record.schema as Record<string, unknown> : undefined;
  const task = typeof record.task === "string" ? record.task.slice(0, LIMITS.taskChars) : undefined;
  return { ok: true, body: { prompt, system, tier, maxTokens, schema, task } };
}

/**
 * Effort works on current Opus, Sonnet and Fable models. Haiku 4.5 and older
 * Sonnet/Opus models reject it, and the tier models are configurable secrets.
 */
export function supportsEffort(model: string): boolean {
  return /^claude-(opus-(4-[5-9]|[5-9])|sonnet-(4-[6-9]|[5-9])|fable|mythos)/.test(model);
}

export function buildAnthropicRequest(body: ProxyRequestBody, models: Record<AiTier, string>): AnthropicRequest {
  const model = models[body.tier ?? "fast"];
  const outputConfig: NonNullable<AnthropicRequest["output_config"]> = {
    ...(body.schema ? { format: { type: "json_schema" as const, schema: body.schema } } : {}),
    ...(body.effort && supportsEffort(model) ? { effort: body.effort } : {}),
  };
  return {
    model,
    max_tokens: body.maxTokens ?? 800,
    system: [body.system, JSON_RULE].filter(Boolean).join("\n\n"),
    messages: [{ role: "user", content: body.prompt }],
    ...(Object.keys(outputConfig).length ? { output_config: outputConfig } : {}),
  };
}

/**
 * A reply that did not finish normally has no trustworthy JSON: a refusal may
 * not match the schema, and a max_tokens stop truncates it mid-value.
 */
export function stopReasonError(stopReason: string | null | undefined): { status: number; error: string } | null {
  if (stopReason === "refusal") return { status: 422, error: "Claude declined this request. Try different material or wording." };
  if (stopReason === "max_tokens") return { status: 502, error: "The AI reply was cut off before it finished. Ask for fewer items or send shorter material." };
  return null;
}

/** Parse model text as JSON, tolerating stray code fences or leading prose. */
export function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(trimmed); } catch { /* fall through */ }
  const start = trimmed.search(/[[{]/);
  if (start < 0) return undefined;
  const open = trimmed[start];
  const close = open === "{" ? "}" : "]";
  const end = trimmed.lastIndexOf(close);
  if (end <= start) return undefined;
  try { return JSON.parse(trimmed.slice(start, end + 1)); } catch { return undefined; }
}

export function textFromAnthropic(data: unknown): string {
  const content = (data as { content?: Array<{ type?: string; text?: string }> })?.content;
  return Array.isArray(content) ? content.filter((block) => block?.type === "text").map((block) => block.text ?? "").join("") : "";
}

/** Map upstream failures to messages that are safe and useful to show a learner. */
export function upstreamError(status: number): { status: number; error: string } {
  if (status === 408) return { status: 504, error: "The AI service took too long to answer. Ask for fewer items or send shorter material." };
  if (status === 429 || status === 529) return { status: 503, error: "The AI service is busy. Try again in a moment." };
  if (status === 400) return { status: 502, error: "The AI service rejected this request." };
  if (status === 401 || status === 403) return { status: 503, error: "Cloud AI is misconfigured on the server." };
  return { status: 502, error: "The AI service is unavailable right now." };
}
