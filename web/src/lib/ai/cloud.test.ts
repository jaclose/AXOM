import { describe, expect, it, vi } from "vitest";
import { createCloudProvider, cloudAiRemaining } from "./cloud";
import { buildAnthropicRequest, parseJsonLoose, stopReasonError, supportsEffort, textFromAnthropic, upstreamError, validateBody, type AnthropicRequest } from "../../../../supabase/functions/ai-proxy/core";
import { createHandler, UpstreamError, type ClaudeReply } from "../../../../supabase/functions/ai-proxy/handler";

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
  it("validates and bounds requests", () => {
    expect(validateBody(null)).toMatchObject({ ok: false });
    expect(validateBody({ prompt: "  " })).toMatchObject({ ok: false });
    expect(validateBody({ prompt: "x".repeat(24_001) })).toMatchObject({ ok: false, error: expect.stringContaining("too long") });
    expect(validateBody({ prompt: "hi", maxTokens: 99_999, tier: "quality" })).toMatchObject({ ok: true, body: { maxTokens: 2000, tier: "quality" } });
    expect(validateBody({ prompt: "hi", tier: "opus-please" })).toMatchObject({ ok: true, body: { tier: "fast", maxTokens: 800 } });
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

describe("ai-proxy effort and stop reasons", () => {
  const models = { fast: "claude-haiku-4-5-20251001", quality: "claude-sonnet-5" };

  it("sends effort only to models that accept it", () => {
    expect(supportsEffort("claude-sonnet-5")).toBe(true);
    expect(supportsEffort("claude-opus-5-5")).toBe(true);
    expect(supportsEffort("claude-opus-4-5")).toBe(true);
    expect(supportsEffort("claude-haiku-4-5-20251001")).toBe(false);
    expect(supportsEffort("claude-sonnet-4-5")).toBe(false);
    expect(buildAnthropicRequest({ prompt: "p", tier: "quality", effort: "medium" }, models).output_config).toEqual({ effort: "medium" });
    expect("output_config" in buildAnthropicRequest({ prompt: "p", tier: "fast", effort: "medium" }, models)).toBe(false);
  });

  it("turns refusals, truncation and timeouts into clear errors", () => {
    expect(stopReasonError("end_turn")).toBeNull();
    expect(stopReasonError("refusal")).toMatchObject({ status: 422, error: expect.stringContaining("declined") });
    expect(stopReasonError("max_tokens")).toMatchObject({ status: 502, error: expect.stringContaining("cut off") });
    expect(upstreamError(408)).toMatchObject({ status: 504, error: expect.stringContaining("too long") });
  });
});

describe("ai-proxy handler", () => {
  const models = { fast: "claude-haiku-4-5-20251001", quality: "claude-sonnet-5" };
  const post = (body: unknown, token: string | null = "jwt") => new Request("https://x/functions/v1/ai-proxy", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

  function setup(options: { left?: number; reply?: Partial<ClaudeReply>; error?: unknown; configured?: boolean; user?: boolean } = {}) {
    const consumeQuota = vi.fn(async () => options.left ?? 41);
    const complete = vi.fn(async (_request: AnthropicRequest): Promise<ClaudeReply> => {
      if (options.error) throw options.error;
      return { text: '{"cards":[],"warnings":["thin"]}', stopReason: "end_turn", model: "claude-sonnet-5", ...options.reply };
    });
    const handle = createHandler({
      configured: options.configured ?? true,
      models,
      dailyLimit: 60,
      authenticate: async () => (options.user === false ? null : { consumeQuota }),
      complete,
    });
    return { handle, consumeQuota, complete };
  }

  it("answers preflight and refuses unconfigured, anonymous or expired callers", async () => {
    const { handle } = setup();
    const preflight = await handle(new Request("https://x", { method: "OPTIONS" }));
    expect(preflight.status).toBe(200);
    expect(preflight.headers.get("Access-Control-Allow-Methods")).toContain("POST");
    expect((await setup({ configured: false }).handle(post({ prompt: "p" }))).status).toBe(503);
    expect((await handle(post({ prompt: "p" }, null))).status).toBe(401);
    expect(await (await setup({ user: false }).handle(post({ prompt: "p" }))).json()).toMatchObject({ error: expect.stringContaining("expired") });
  });

  it("runs a server-owned task with its own prompt, schema, budget and tier", async () => {
    const { handle, complete } = setup();
    const response = await handle(post({ task: "cards.generate", input: { material: "Nephrotic syndrome: proteinuria > 3.5 g/day.", maxCards: 4 }, system: "ignored", prompt: "ignored" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ result: { cards: [], warnings: ["thin"] }, remaining: 41, promptVersion: "cardgen-v2" });
    const request = complete.mock.calls[0][0];
    expect(request).toMatchObject({ model: "claude-sonnet-5", max_tokens: 8000, output_config: { effort: "medium", format: { type: "json_schema" } } });
    expect(request.system).toContain("minimum-information principle");
    expect(request.system).not.toContain("ignored");
    expect(request.messages[0].content).toContain("<material>\nNephrotic syndrome");
  });

  it("keeps the freeform path bounded and validates before spending quota", async () => {
    const { handle, complete, consumeQuota } = setup();
    await handle(post({ prompt: "Explain C3b.", maxTokens: 99_999, tier: "quality" }));
    expect(complete.mock.calls[0][0]).toMatchObject({ max_tokens: 2000, model: "claude-sonnet-5" });
    expect(consumeQuota).toHaveBeenCalledTimes(1);
    for (const bad of [{ task: "rewrite.everything", input: {} }, { task: "cards.generate", input: { material: "  " } }, "{nope"]) {
      expect((await handle(post(bad))).status).toBe(400);
    }
    expect(consumeQuota).toHaveBeenCalledTimes(1);
  });

  it("stops at the daily allowance without calling Claude", async () => {
    const { handle, complete } = setup({ left: -1 });
    const response = await handle(post({ prompt: "p" }));
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ remaining: 0, error: expect.stringContaining("allowance") });
    expect(complete).not.toHaveBeenCalled();
  });

  it("maps stop reasons, upstream failures and unparseable replies", async () => {
    const statusFor = async (options: Parameters<typeof setup>[0]) => (await setup(options).handle(post({ prompt: "p" }))).status;
    expect(await statusFor({ reply: { stopReason: "max_tokens", text: '{"cards":[' } })).toBe(502);
    expect(await statusFor({ reply: { stopReason: "refusal", text: "" } })).toBe(422);
    expect(await statusFor({ error: new UpstreamError(429) })).toBe(503);
    expect(await statusFor({ error: new UpstreamError(408) })).toBe(504);
    expect(await statusFor({ error: new Error("socket hang up") })).toBe(502);
    expect(await statusFor({ reply: { text: "Sorry, no JSON here." } })).toBe(502);
  });
});

describe("AXOM Cloud AI tasks from the app", () => {
  it("sends only the task inputs and returns the server's prompt version", async () => {
    const fetchImpl = vi.fn(() => reply(200, { result: { cards: [] }, remaining: 7, promptVersion: "cardgen-v2" }));
    const provider = createCloudProvider({ endpoint: "e", getAccessToken: async () => "t", fetchImpl });
    await expect(provider.runTask("cards.generate", { material: "m", maxCards: 3 })).resolves.toEqual({ result: { cards: [] }, promptVersion: "cardgen-v2" });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ task: "cards.generate", input: { material: "m", maxCards: 3 } });
    expect(cloudAiRemaining()).toBe(7);
  });
});
