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
export const MAX_REQUEST_BYTES = 64_000;
export const MAX_SCHEMA_BYTES = 16_000;

const AI_PRODUCTION_ORIGINS = [
  "https://axom.app",
  "https://axom-jacloses-projects.vercel.app",
  "tauri://localhost",
  "http://tauri.localhost",
];
const AI_DEVELOPMENT_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:5187",
  "http://127.0.0.1:5187",
];
const AI_ALLOWED_HEADERS = ["authorization", "apikey", "content-type", "x-client-info", "x-supabase-api-version"];

function canonicalOrigin(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password) return undefined;
    if (parsed.protocol === "tauri:" && parsed.host === "localhost" && ["", "/"].includes(parsed.pathname) && !parsed.search && !parsed.hash) return "tauri://localhost";
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    if (parsed.pathname !== "/" || parsed.search || parsed.hash) return undefined;
    return parsed.origin;
  } catch {
    return undefined;
  }
}

export function aiProxyCorsPolicy(input: {
  origin: string | null;
  method: string;
  requestedMethod: string | null;
  requestedHeaders: string | null;
  configuredOrigins: string;
  production: boolean;
}): { allowed: boolean; headers: Record<string, string> } {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-supabase-api-version",
    "Vary": "Origin",
  };
  if (!input.origin) return { allowed: true, headers };

  const origin = canonicalOrigin(input.origin);
  const configured = input.configuredOrigins.split(",").map((value) => value.trim()).filter(Boolean);
  const defaults = input.production ? AI_PRODUCTION_ORIGINS : [...AI_PRODUCTION_ORIGINS, ...AI_DEVELOPMENT_ORIGINS];
  const allowlist = new Set([...defaults, ...configured.map(canonicalOrigin).filter((value): value is string => Boolean(value))]);
  if (!origin || !allowlist.has(origin)) return { allowed: false, headers };

  headers["Access-Control-Allow-Origin"] = origin;
  if (input.method === "OPTIONS") {
    if (input.requestedMethod && input.requestedMethod !== "POST") return { allowed: false, headers };
    if (input.requestedHeaders && !input.requestedHeaders.split(",").every((name) => AI_ALLOWED_HEADERS.includes(name.trim().toLowerCase()))) {
      return { allowed: false, headers };
    }
  }
  return { allowed: true, headers };
}

export async function readJsonRequest(request: Request, maxBytes = MAX_REQUEST_BYTES): Promise<{ ok: true; value: unknown } | { ok: false }> {
  const contentLength = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) return { ok: false };
  if (!request.body) return { ok: false };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel();
        return { ok: false };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { ok: true, value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown };
  } catch {
    return { ok: false };
  } finally {
    reader.releaseLock();
  }
}

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
  if (schema && new TextEncoder().encode(JSON.stringify(schema)).byteLength > MAX_SCHEMA_BYTES) {
    return { ok: false, error: "Structured output schema is too large." };
  }
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
