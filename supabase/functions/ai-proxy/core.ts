// Pure request/response logic for the ai-proxy Edge Function. No Deno or
// network APIs here, so the web test suite can exercise it directly.

export type AiTier = "fast" | "quality";

export interface ProxyRequestBody {
  task?: string;
  system?: string;
  prompt: string;
  maxTokens?: number;
  tier?: AiTier;
  /** Optional JSON Schema; enables Claude structured outputs (guaranteed JSON). */
  schema?: Record<string, unknown>;
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

export function buildAnthropicRequest(body: ProxyRequestBody, models: Record<AiTier, string>) {
  return {
    model: models[body.tier ?? "fast"],
    max_tokens: body.maxTokens ?? 800,
    system: [body.system, JSON_RULE].filter(Boolean).join("\n\n"),
    messages: [{ role: "user", content: body.prompt }],
    ...(body.schema ? { output_config: { format: { type: "json_schema", schema: body.schema } } } : {}),
  };
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
  if (status === 429 || status === 529) return { status: 503, error: "The AI service is busy. Try again in a moment." };
  if (status === 400) return { status: 502, error: "The AI service rejected this request." };
  if (status === 401 || status === 403) return { status: 503, error: "Cloud AI is misconfigured on the server." };
  return { status: 502, error: "The AI service is unavailable right now." };
}
