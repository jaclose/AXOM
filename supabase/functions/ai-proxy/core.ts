// Pure request/response logic for the ai-proxy Edge Function. No Deno or
// network APIs here, so the web test suite can exercise it directly.

export type AiTier = "fast" | "quality";
export type AiEffort = "low" | "medium" | "high";

/** Image formats Claude reads. The proxy checks that the bytes match the declared type. */
export const IMAGE_MEDIA_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export type ImageMediaType = (typeof IMAGE_MEDIA_TYPES)[number];

/** One screenshot sent with a task: base64 bytes without a `data:` prefix. */
export interface TaskImage {
  mediaType: ImageMediaType;
  data: string;
}

/**
 * Screenshot limits. The app downscales every image to a 1568 px long edge
 * (Claude's recommended size; larger costs more tokens without reading better)
 * and batches bigger sets, so one request stays well under a few MB.
 */
export const IMAGE_LIMITS = {
  maxImages: 4,
  /** Base64 characters per image (about 0.9 MB of JPEG). */
  maxImageChars: 1_200_000,
  /** Base64 characters across one request's images (about 2.25 MB). */
  maxTotalImageChars: 3_000_000,
  recommendedLongEdge: 1568,
} as const;

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
  /** Set only by server-owned tasks that accept screenshots; freeform requests never carry images. */
  images?: TaskImage[];
}

export type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: ImageMediaType; data: string } };

/** The Messages API request this proxy sends (a subset of the SDK's params). */
export interface AnthropicRequest {
  model: string;
  max_tokens: number;
  system: string;
  messages: Array<{ role: "user"; content: string | AnthropicContentBlock[] }>;
  output_config?: {
    format?: { type: "json_schema"; schema: Record<string, unknown> };
    effort?: AiEffort;
  };
}

/** `bodyBytes` bounds a task request with its screenshots before the body is parsed. */
export const LIMITS = { promptChars: 24_000, systemChars: 6_000, maxTokens: 2_000, taskChars: 64, bodyBytes: 4_000_000 } as const;

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
    messages: [{ role: "user", content: userContent(body.prompt, body.images) }],
    ...(Object.keys(outputConfig).length ? { output_config: outputConfig } : {}),
  };
}

/**
 * Plain text stays a string. With screenshots, each image comes first under a
 * neutral "Screenshot n of m" label (never the file name, which the learner
 * controls), then the task prompt, as Claude reads images best before text.
 */
export function userContent(prompt: string, images: readonly TaskImage[] = []): string | AnthropicContentBlock[] {
  if (!images.length) return prompt;
  const blocks: AnthropicContentBlock[] = [];
  images.forEach((image, index) => {
    blocks.push({ type: "text", text: `Screenshot ${index + 1} of ${images.length}:` });
    blocks.push({ type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } });
  });
  blocks.push({ type: "text", text: prompt });
  return blocks;
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const MEDIA_LABEL: Record<ImageMediaType, string> = { "image/png": "PNG", "image/jpeg": "JPEG", "image/webp": "WebP", "image/gif": "GIF" };

/** The real format of base64 image bytes, from their magic numbers. */
export function sniffImageType(base64: string): ImageMediaType | undefined {
  let head: string;
  try { head = atob(base64.slice(0, 16)); } catch { return undefined; }
  const byte = (index: number) => head.charCodeAt(index);
  if (byte(0) === 0x89 && head.slice(1, 4) === "PNG") return "image/png";
  if (byte(0) === 0xff && byte(1) === 0xd8 && byte(2) === 0xff) return "image/jpeg";
  if (head.startsWith("GIF87a") || head.startsWith("GIF89a")) return "image/gif";
  if (head.startsWith("RIFF") && head.slice(8, 12) === "WEBP") return "image/webp";
  return undefined;
}

export type ImagesResult = { ok: true; images: TaskImage[] } | { ok: false; error: string };

/**
 * Validates screenshots for tasks that accept them: count, media type, base64
 * shape, per-image and total size, and that the bytes are the declared format
 * (Claude rejects a mismatch, which would otherwise spend the learner's quota).
 */
export function validateTaskImages(value: unknown): ImagesResult {
  if (value === undefined || value === null) return { ok: true, images: [] };
  if (!Array.isArray(value)) return { ok: false, error: "Send screenshots as a list." };
  if (value.length > IMAGE_LIMITS.maxImages) {
    return { ok: false, error: `Send at most ${IMAGE_LIMITS.maxImages} screenshots at a time.` };
  }
  const images: TaskImage[] = [];
  let total = 0;
  for (const [index, entry] of value.entries()) {
    const label = `Screenshot ${index + 1}`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return { ok: false, error: `${label} is not an image.` };
    const { mediaType, data } = entry as Record<string, unknown>;
    if (!IMAGE_MEDIA_TYPES.includes(mediaType as ImageMediaType)) return { ok: false, error: `${label} must be a PNG, JPEG, WebP or GIF image.` };
    if (typeof data !== "string" || !data) return { ok: false, error: `${label} has no image data.` };
    if (data.length > IMAGE_LIMITS.maxImageChars) return { ok: false, error: `${label} is too large. Use a smaller or cropped screenshot.` };
    if (data.length % 4 !== 0 || !BASE64.test(data)) return { ok: false, error: `${label} is not valid image data.` };
    const actual = sniffImageType(data);
    if (actual !== mediaType) {
      return { ok: false, error: `${label} is not a ${MEDIA_LABEL[mediaType as ImageMediaType]} image${actual ? ` (it is ${MEDIA_LABEL[actual]})` : ""}.` };
    }
    total += data.length;
    if (total > IMAGE_LIMITS.maxTotalImageChars) return { ok: false, error: "These screenshots are too large together. Send fewer at a time." };
    images.push({ mediaType: mediaType as ImageMediaType, data });
  }
  return { ok: true, images };
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
