type JsonRecord = Record<string, unknown>;

export interface ApiRequest {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, string | string[] | undefined>;
  body?: unknown;
}

export interface ApiResponse {
  setHeader(name: string, value: string): void;
  status(code: number): ApiResponse;
  json(body: unknown): void;
  end(body?: string): void;
}

type Handler = (req: ApiRequest, res: ApiResponse) => Promise<void> | void;

const buckets = new Map<string, { resetAt: number; count: number }>();

const DEVELOPMENT_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:5187",
  "http://127.0.0.1:5187",
];

const PRODUCTION_ORIGINS = [
  "https://axom-jacloses-projects.vercel.app",
  "https://axom.app",
  "tauri://localhost",
  "http://tauri.localhost",
];

function getAllowedOrigins(): Set<string> {
  const isProduction = process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
  const configured = [process.env.AXOM_ALLOWED_ORIGINS, process.env.ALLOWED_ORIGINS]
    .filter(Boolean)
    .join(",")
    .split(",")
    .map(normalizeConfiguredOrigin)
    .filter((value): value is string => Boolean(value));
  const defaults = isProduction ? PRODUCTION_ORIGINS : [...PRODUCTION_ORIGINS, ...DEVELOPMENT_ORIGINS];
  return new Set([...defaults, ...configured]);
}

function normalizeOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
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

function normalizeConfiguredOrigin(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes("*") || trimmed === "null") return undefined;
  try {
    const parsed = new URL(trimmed);
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password) return undefined;
    if (parsed.pathname !== "/" || parsed.search || parsed.hash) return undefined;
    return parsed.origin;
  } catch {
    return undefined;
  }
}

function isAllowedOrigin(origin: string | undefined): boolean {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  return getAllowedOrigins().has(normalized);
}

function isAllowedPreflight(req: ApiRequest, methods: string[]): boolean {
  const requestedMethod = header(req, "access-control-request-method");
  if (requestedMethod && !methods.includes(requestedMethod)) return false;
  const requestedHeaders = header(req, "access-control-request-headers");
  if (!requestedHeaders) return true;
  const allowedHeaders = new Set(["content-type", "authorization", "x-requested-with"]);
  return requestedHeaders.split(",").every((name) => allowedHeaders.has(name.trim().toLowerCase()));
}

export class ApiError extends Error {
  status: number;
  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function withApi(methods: string[], handler: Handler, options: { rateLimit?: number } = {}) {
  return async function route(req: ApiRequest, res: ApiResponse) {
    applySecurityHeaders(res, methods);

    const origin = header(req, "origin");
    const normalizedOrigin = normalizeOrigin(origin);

    if (origin !== undefined && (!normalizedOrigin || !isAllowedOrigin(origin))) {
      res.status(403).json({ error: "origin_not_allowed", message: "This origin is not allowed to call AXOM API endpoints." });
      return;
    }

    if (normalizedOrigin) {
      res.setHeader("Access-Control-Allow-Origin", normalizedOrigin);
    }

    if (req.method === "OPTIONS") {
      if (normalizedOrigin && !isAllowedPreflight(req, methods)) {
        res.status(403).json({ error: "preflight_not_allowed", message: "This preflight request is not allowed." });
        return;
      }
      res.status(204).end();
      return;
    }

    if (!req.method || !methods.includes(req.method)) {
      res.setHeader("Allow", methods.join(", "));
      res.status(405).json({ error: "method_not_allowed", message: "Method not allowed." });
      return;
    }

    try {
      checkRateLimit(req, options.rateLimit ?? 80);
      await handler(req, res);
    } catch (error) {
      if (error instanceof ApiError) {
        res.status(error.status).json({ error: "api_error", message: error.message, details: error.details });
        return;
      }
      console.error("Noctyrium API error:", safeError(error));
      res.status(500).json({ error: "internal_error", message: "Noctyrium cloud backend error." });
    }
  };
}

export function sendJson(res: ApiResponse, body: unknown, status = 200) {
  res.status(status).json(body);
}

export function requireBodyObject(req: ApiRequest, maxBytes = 6_000_000): JsonRecord {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    throw new ApiError(400, "Expected a JSON object body.");
  }
  if (new TextEncoder().encode(JSON.stringify(req.body)).byteLength > maxBytes) {
    throw new ApiError(413, "Request body is too large.");
  }
  return req.body as JsonRecord;
}

export function requireString(body: JsonRecord, key: string, options: { min?: number; max?: number } = {}) {
  const value = body[key];
  const text = typeof value === "string" ? value.trim() : "";
  const min = options.min ?? 1;
  const max = options.max ?? 512;
  if (text.length < min) throw new ApiError(400, `${key} is required.`);
  if (text.length > max) throw new ApiError(400, `${key} is too long.`);
  return text;
}

export function optionalString(body: JsonRecord, key: string, max = 512) {
  const value = body[key];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new ApiError(400, `${key} must be a string.`);
  const text = value.trim();
  if (text.length > max) throw new ApiError(400, `${key} is too long.`);
  return text || undefined;
}

export function requireInteger(body: JsonRecord, key: string) {
  const value = body[key];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new ApiError(400, `${key} must be an integer.`);
  }
  return value;
}

export function requireJsonObject(body: JsonRecord, key: string) {
  const value = body[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, `${key} must be a JSON object.`);
  }
  const bytes = new TextEncoder().encode(JSON.stringify(value)).length;
  if (bytes > 6_000_000) throw new ApiError(413, `${key} is too large for this sync endpoint.`);
  return value as JsonRecord;
}

export function getParam(req: ApiRequest, key: string) {
  const text = getOptionalParam(req, key);
  if (!text) throw new ApiError(400, `Missing ${key}.`);
  return text;
}

export function getOptionalParam(req: ApiRequest, key: string) {
  const value = req.query?.[key];
  const text = Array.isArray(value) ? value[0] : value;
  if (text) return text;

  if (req.url) {
    try {
      const parsed = new URL(req.url, "http://noctyrium.local");
      const queryValue = parsed.searchParams.get(key);
      if (queryValue) return queryValue;
    } catch {
      // Ignore malformed local URLs and fall through to undefined.
    }
  }

  return undefined;
}

export function assertUuid(value: string, label = "id") {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new ApiError(400, `Invalid ${label}.`);
  }
  return value;
}

function applySecurityHeaders(res: ApiResponse, methods: string[]) {
  const allowedMethods = [...new Set([...methods.filter((method) => method !== "OPTIONS"), "OPTIONS"])];
  res.setHeader("Access-Control-Allow-Methods", allowedMethods.join(", "));
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  res.setHeader("Vary", "Origin");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
}

function checkRateLimit(req: ApiRequest, max: number) {
  const now = Date.now();
  const ip = header(req, "x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const key = `${ip}:${req.method}`;
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { resetAt: now + 60_000, count: 1 });
    return;
  }
  bucket.count += 1;
  if (bucket.count > max) throw new ApiError(429, "Too many requests. Try again in a minute.");
}

function header(req: ApiRequest, name: string) {
  const value = req.headers[name] ?? req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function safeError(error: unknown) {
  if (error instanceof Error) return { name: error.name, message: error.message, stack: error.stack };
  return { message: String(error) };
}
