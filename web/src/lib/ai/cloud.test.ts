import { describe, expect, it, vi } from "vitest";
import { createCloudProvider, cloudAiRemaining } from "./cloud";
import { aiProxyCorsPolicy, buildAnthropicRequest, parseJsonLoose, readJsonRequest, textFromAnthropic, upstreamError, validateBody } from "../../../../supabase/functions/ai-proxy/core";

function reply(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

describe("AXOM Cloud AI client", () => {
  it("sends the session token, never a model key, and returns the result", async () => {
    const fetchImpl = vi.fn(() => reply(200, { result: { cards: [1] }, remaining: 41 }));
    const provider = createCloudProvider({ endpoint: "https://x.supabase.co/functions/v1/ai-proxy", apiKey: "sb_publishable_x", getAccessToken: async () => "jwt-token", fetchImpl });
    await expect(provider.completeJson({ system: "s", prompt: "p", maxTokens: 300, task: "cards" })).resolves.toEqual({ cards: [1] });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toMatchObject({ Authorization: "Bearer jwt-token", apikey: "sb_publishable_x" });
    expect(JSON.parse(String(init.body))).toMatchObject({ prompt: "p", system: "s", maxTokens: 300, tier: "fast", task: "cards" });
    expect(String(init.body)).not.toMatch(/sk-ant|x-api-key/);
    expect(cloudAiRemaining()).toBe(41);
    await expect(provider.available()).resolves.toMatchObject({ ok: true, detail: expect.stringContaining("41") });
  });

  it("explains signed-out, quota and model-refusal states", async () => {
    const signedOut = createCloudProvider({ endpoint: "e", getAccessToken: async () => null, fetchImpl: vi.fn() });
    await expect(signedOut.completeJson({ prompt: "p" })).rejects.toThrow(/Sign in/);
    await expect(signedOut.available()).resolves.toMatchObject({ ok: false });
    const quota = createCloudProvider({ endpoint: "e", getAccessToken: async () => "t", fetchImpl: vi.fn(() => reply(429, { error: "Today's Cloud AI allowance (60 requests) is used up." })) });
    await expect(quota.completeJson({ prompt: "p" })).rejects.toThrow(/allowance/);
    expect(cloudAiRemaining()).toBe(0);
    const refusal = createCloudProvider({ endpoint: "e", getAccessToken: async () => "t", fetchImpl: vi.fn(() => reply(200, { result: { error: "Source text is empty." } })) });
    await expect(refusal.completeJson({ prompt: "p" })).rejects.toThrow("Source text is empty.");
  });
});

describe("ai-proxy core", () => {
  it("allows only explicit production origins and valid POST preflights", () => {
    const policy = aiProxyCorsPolicy({
      origin: "https://axom.app",
      method: "OPTIONS",
      requestedMethod: "POST",
      requestedHeaders: "authorization, apikey, content-type, x-client-info",
      configuredOrigins: "",
      production: true,
    });
    expect(policy.allowed).toBe(true);
    expect(policy.headers["Access-Control-Allow-Origin"]).toBe("https://axom.app");
    expect(policy.headers.Vary).toBe("Origin");
    expect(policy.headers["Access-Control-Allow-Origin"]).not.toBe("*");
    expect(aiProxyCorsPolicy({ origin: "http://localhost:5173", method: "POST", requestedMethod: null, requestedHeaders: null, configuredOrigins: "", production: true }).allowed).toBe(false);
    expect(aiProxyCorsPolicy({ origin: "https://preview.axom.test", method: "POST", requestedMethod: null, requestedHeaders: null, configuredOrigins: "https://preview.axom.test/", production: true }).allowed).toBe(true);
  });

  it("rejects opaque, malformed, path-bearing origins and invalid preflights", () => {
    for (const origin of ["null", "not an origin", "https://axom.app/path", "https://evil.example"]) {
      expect(aiProxyCorsPolicy({ origin, method: "POST", requestedMethod: null, requestedHeaders: null, configuredOrigins: "", production: true }).allowed).toBe(false);
    }
    expect(aiProxyCorsPolicy({ origin: "https://axom.app", method: "OPTIONS", requestedMethod: "DELETE", requestedHeaders: null, configuredOrigins: "", production: true }).allowed).toBe(false);
    expect(aiProxyCorsPolicy({ origin: "https://axom.app", method: "OPTIONS", requestedMethod: "POST", requestedHeaders: "x-evil", configuredOrigins: "", production: true }).allowed).toBe(false);
    expect(aiProxyCorsPolicy({ origin: "https://sub.axom.app", method: "POST", requestedMethod: null, requestedHeaders: null, configuredOrigins: "https://*.axom.app", production: true }).allowed).toBe(false);
  });

  it("preserves originless native/server requests without emitting wildcard CORS", () => {
    const policy = aiProxyCorsPolicy({ origin: null, method: "POST", requestedMethod: null, requestedHeaders: null, configuredOrigins: "", production: true });
    expect(policy.allowed).toBe(true);
    expect(policy.headers["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("allows only AXOM's exact Tauri webview origins", () => {
    for (const origin of ["tauri://localhost", "http://tauri.localhost"]) {
      const policy = aiProxyCorsPolicy({ origin, method: "POST", requestedMethod: null, requestedHeaders: null, configuredOrigins: "", production: true });
      expect(policy.allowed).toBe(true);
      expect(policy.headers["Access-Control-Allow-Origin"]).toBe(origin);
    }
    expect(aiProxyCorsPolicy({ origin: "custom://localhost", method: "POST", requestedMethod: null, requestedHeaders: null, configuredOrigins: "", production: true }).allowed).toBe(false);
  });

  it("validates and bounds requests", () => {
    expect(validateBody(null)).toMatchObject({ ok: false });
    expect(validateBody({ prompt: "  " })).toMatchObject({ ok: false });
    expect(validateBody({ prompt: "x".repeat(24_001) })).toMatchObject({ ok: false, error: expect.stringContaining("too long") });
    expect(validateBody({ prompt: "hi", maxTokens: 99_999, tier: "quality" })).toMatchObject({ ok: true, body: { maxTokens: 2000, tier: "quality" } });
    expect(validateBody({ prompt: "hi", tier: "opus-please" })).toMatchObject({ ok: true, body: { tier: "fast", maxTokens: 800 } });
    expect(validateBody({ prompt: "hi", schema: { description: "x".repeat(16_001) } })).toMatchObject({ ok: false, error: expect.stringContaining("schema is too large") });
  });

  it("limits raw request bytes and rejects malformed JSON before schema validation", async () => {
    await expect(readJsonRequest(new Request("https://axom.app", { method: "POST", body: "{" }))).resolves.toEqual({ ok: false });
    await expect(readJsonRequest(new Request("https://axom.app", { method: "POST", body: JSON.stringify({ prompt: "ok" }) }))).resolves.toEqual({ ok: true, value: { prompt: "ok" } });
    await expect(readJsonRequest(new Request("https://axom.app", { method: "POST", body: "x".repeat(100) }), 32)).resolves.toEqual({ ok: false });
  });

  it("builds a Claude request with a server-chosen model and optional structured output", () => {
    const models = { fast: "claude-haiku-4-5-20251001", quality: "claude-sonnet-5" };
    const plain = buildAnthropicRequest({ prompt: "p", system: "s", tier: "quality", maxTokens: 500 }, models);
    expect(plain).toMatchObject({ model: "claude-sonnet-5", max_tokens: 500, messages: [{ role: "user", content: "p" }] });
    expect(plain.system).toContain("single JSON value");
    expect("output_config" in plain).toBe(false);
    const schema = { type: "object", properties: { a: { type: "string" } }, required: ["a"], additionalProperties: false };
    expect(buildAnthropicRequest({ prompt: "p", schema }, models)).toMatchObject({ model: "claude-haiku-4-5-20251001", output_config: { format: { type: "json_schema", schema } } });
  });

  it("parses model text and maps upstream failures", () => {
    expect(parseJsonLoose('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonLoose('Here you go: [1,2]')).toEqual([1, 2]);
    expect(parseJsonLoose("no json")).toBeUndefined();
    expect(textFromAnthropic({ content: [{ type: "text", text: "{" }, { type: "tool_use" }, { type: "text", text: "}" }] })).toBe("{}");
    expect(upstreamError(529)).toEqual({ status: 503, error: expect.stringContaining("busy") });
    expect(upstreamError(401).error).toMatch(/misconfigured/);
  });
});
