import { describe, expect, it, vi } from "vitest";
import { createCloudProvider, cloudAiRemaining, trustedCloudAiEndpoint } from "./cloud";
import { aiProxyCorsPolicy, buildAnthropicRequest, cloudAllowance, parseJsonLoose, readJsonRequest, textFromAnthropic, upstreamError, validateBody } from "../../../../supabase/functions/ai-proxy/core";

function reply(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}


describe("Cloud AI credential destination", () => {
  const base = "https://abcdefghijklmnopqrst.supabase.co";
  const expected = base + "/functions/v1/ai-proxy";

  it("uses only the build-configured Supabase function and accepts its exact saved value", () => {
    expect(trustedCloudAiEndpoint(base)).toBe(expected);
    expect(trustedCloudAiEndpoint(base + "/", expected)).toBe(expected);
    expect(trustedCloudAiEndpoint(base, expected)).toBe(expected);
  });

  it("rejects malicious or stale saved endpoints rather than silently routing prompts elsewhere", () => {
    for (const override of [
      "https://attacker.example/functions/v1/ai-proxy",
      "https://abcdefghijklmnopqrst.supabase.co.attacker.example/functions/v1/ai-proxy",
      "https://abcdefghijklmnopqrst.supabase.co@attacker.example/functions/v1/ai-proxy",
      "http://abcdefghijklmnopqrst.supabase.co/functions/v1/ai-proxy",
      "https://abcdefghijklmnopqrst.supabase.co:8443/functions/v1/ai-proxy",
      expected + "?next=https://attacker.example",
      expected + "#sneaky",
      expected + "/other",
      base + "/functions/v1/another-proxy",
      base + "/functions/v1/%61i-proxy",
      "//attacker.example/functions/v1/ai-proxy",
      "javascript:alert(1)",
      " " + expected,
      "https://otherproject1234567.supabase.co/functions/v1/ai-proxy",
    ]) {
      expect(trustedCloudAiEndpoint(base, override), override).toBeNull();
    }
  });

  it("fails closed on untrusted build configuration and keeps the local emulator dev-only", () => {
    for (const invalid of [
      undefined,
      "not-a-url",
      "http://abcdefghijklmnopqrst.supabase.co",
      "https://attacker.example",
      "https://abcdefghijklmnopqrst.supabase.co:8443",
      "https://user@abcdefghijklmnopqrst.supabase.co",
      base + "/other",
      base + "?debug=1",
      base + "#frag",
    ]) {
      expect(trustedCloudAiEndpoint(invalid), String(invalid)).toBeNull();
    }
    const local = "http://127.0.0.1:54321";
    expect(trustedCloudAiEndpoint(local)).toBeNull();
    expect(trustedCloudAiEndpoint(local, undefined, true)).toBe(local + "/functions/v1/ai-proxy");
    expect(trustedCloudAiEndpoint(local, local + "/functions/v1/ai-proxy", true)).toBe(local + "/functions/v1/ai-proxy");
    expect(trustedCloudAiEndpoint(local, "https://attacker.example", true)).toBeNull();
  });

  it("refuses to construct an authenticated provider when a saved cloud destination is untrusted", async () => {
    const { cloudEndpoint, resolveActiveProvider } = await import("./index");
    vi.stubEnv("VITE_SUPABASE_URL", base);
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_dummy");
    try {
      const settings = { mode: "cloud" as const, localEndpoint: "http://localhost:11434", cloudProxyUrl: "https://attacker.example" };
      expect(cloudEndpoint(settings)).toBeNull();
      expect(resolveActiveProvider(settings)).toBeNull();
      expect(resolveActiveProvider({ ...settings, cloudProxyUrl: expected })).not.toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("AXOM Cloud AI client", () => {
  it("sends the session token, never a model key, and returns the result", async () => {
    const fetchImpl = vi.fn(() => reply(200, { result: { cards: [1] }, remaining: 41 }));
    const provider = createCloudProvider({ endpoint: "https://x.supabase.co/functions/v1/ai-proxy", apiKey: "sb_publishable_x", getAccessToken: async () => "jwt-token", isRequestAllowed: () => true, fetchImpl });
    await expect(provider.completeJson({ system: "s", prompt: "p", maxTokens: 300, task: "cards" })).resolves.toEqual({ cards: [1] });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toMatchObject({ Authorization: "Bearer jwt-token", apikey: "sb_publishable_x" });
    expect(init.redirect).toBe("error");
    expect(JSON.parse(String(init.body))).toMatchObject({ prompt: "p", system: "s", maxTokens: 300, tier: "fast", task: "cards" });
    expect(String(init.body)).not.toMatch(/sk-ant|x-api-key/);
    expect(cloudAiRemaining()).toBe(41);
    await expect(provider.available()).resolves.toMatchObject({ ok: true, detail: expect.stringContaining("41") });
  });

  it("explains signed-out, quota and model-refusal states", async () => {
    const signedOut = createCloudProvider({ endpoint: "e", getAccessToken: async () => null, isRequestAllowed: () => true, fetchImpl: vi.fn() });
    await expect(signedOut.completeJson({ prompt: "p" })).rejects.toThrow(/Sign in/);
    await expect(signedOut.available()).resolves.toMatchObject({ ok: false });
    const quota = createCloudProvider({ endpoint: "e", getAccessToken: async () => "t", isRequestAllowed: () => true, fetchImpl: vi.fn(() => reply(429, { error: "Today's Cloud AI allowance (60 requests) is used up." })) });
    await expect(quota.completeJson({ prompt: "p" })).rejects.toThrow(/allowance/);
    expect(cloudAiRemaining()).toBe(0);
    const refusal = createCloudProvider({ endpoint: "e", getAccessToken: async () => "t", isRequestAllowed: () => true, fetchImpl: vi.fn(() => reply(200, { result: { error: "Source text is empty." } })) });
    await expect(refusal.completeJson({ prompt: "p" })).rejects.toThrow("Source text is empty.");
  });
});


describe("cached Cloud AI provider request-time consent", () => {
  it("does not resolve a token or dispatch a request after Cloud is turned off", async () => {
    let allowed = true;
    const getAccessToken = vi.fn(async () => "private-jwt");
    const fetchImpl = vi.fn(() => reply(200, { result: { text: "unused" } }));
    const provider = createCloudProvider({ endpoint: "https://example.test/ai", getAccessToken, fetchImpl, isRequestAllowed: () => allowed });
    allowed = false;
    await expect(provider.available()).resolves.toMatchObject({ ok: false });
    await expect(provider.completeJson({ prompt: "private study material" })).rejects.toThrow(/Cloud AI is off/);
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a cached provider when consent changes while a token is resolving", async () => {
    let allowed = true;
    let releaseToken!: (token: string | null) => void;
    const getAccessToken = vi.fn(() => new Promise<string | null>((resolve) => { releaseToken = resolve; }));
    const fetchImpl = vi.fn(() => reply(200, { result: { text: "unused" } }));
    const provider = createCloudProvider({ endpoint: "https://example.test/ai", getAccessToken, fetchImpl, isRequestAllowed: () => allowed });
    const request = provider.completeJson({ prompt: "sensitive question text" });
    expect(getAccessToken).toHaveBeenCalledTimes(1);
    allowed = false; // Another tab confirmed Off while the auth promise was pending.
    releaseToken("stale-jwt");
    await expect(request).rejects.toThrow(/Cloud AI is off/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not return a completed result after an already-dispatched request is opted out", async () => {
    let allowed = true;
    let releaseReply!: (response: Response) => void;
    const fetchImpl = vi.fn(() => new Promise<Response>((resolve) => { releaseReply = resolve; }));
    const provider = createCloudProvider({
      endpoint: "https://example.test/ai", getAccessToken: async () => "private-jwt",
      fetchImpl, isRequestAllowed: () => allowed,
    });
    const request = provider.completeJson({ prompt: "sensitive question text" });
    // Let the access-token await finish before switching modes.
    await Promise.resolve();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    allowed = false;
    releaseReply(new Response(JSON.stringify({ result: { text: "obsolete" }, remaining: 12 }), { status: 200 }));
    await expect(request).rejects.toThrow(/Cloud AI is off/);
  });

  it("discards a response if consent is revoked during asynchronous JSON decoding", async () => {
    let allowed = true;
    let finishParsing!: (value: unknown) => void;
    let parsingStarted!: () => void;
    const parsing = new Promise<void>((resolve) => { parsingStarted = resolve; });
    const fetchSpy = vi.fn(async () => ({
      ok: true, status: 200,
      json: () => new Promise<unknown>((resolve) => {
        finishParsing = resolve;
        parsingStarted();
      }),
    }));
    const provider = createCloudProvider({
      endpoint: "https://example.test/ai", getAccessToken: async () => "private-jwt",
      isRequestAllowed: () => allowed,
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });
    const request = provider.completeJson({ prompt: "sensitive question text" });
    await parsing;
    expect(fetchSpy).toHaveBeenCalledTimes(1); // Request already left before opt-out.
    allowed = false;
    finishParsing({ result: { text: "obsolete" }, remaining: 12 });
    await expect(request).rejects.toThrow(/Cloud AI is off/);
  });

  it("fails closed when consent verification itself throws", async () => {
    const fetchImpl = vi.fn(() => reply(200, { result: { text: "unused" } }));
    const provider = createCloudProvider({
      endpoint: "https://example.test/ai", getAccessToken: async () => "private-jwt",
      fetchImpl, isRequestAllowed: () => { throw new Error("storage denied"); },
    });
    await expect(provider.completeJson({ prompt: "no egress" })).rejects.toThrow(/Cloud AI is off/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("checks current saved mode and exact trusted endpoint, not the creation-time snapshot", async () => {
    const base = "https://abcdefghijklmnopqrst.supabase.co";
    const endpoint = base + "/functions/v1/ai-proxy";
    let stored: Record<string, unknown> = { mode: "cloud", localEndpoint: "http://localhost:11434" };
    vi.stubEnv("VITE_SUPABASE_URL", base);
    vi.stubGlobal("localStorage", { getItem: () => JSON.stringify(stored) });
    try {
      const { cloudRequestIsCurrentlyAllowed } = await import("./index");
      expect(cloudRequestIsCurrentlyAllowed(endpoint)).toBe(true);
      stored = { mode: "off", localEndpoint: "http://localhost:11434" };
      expect(cloudRequestIsCurrentlyAllowed(endpoint)).toBe(false);
      stored = { mode: "local", localEndpoint: "http://localhost:11434" };
      expect(cloudRequestIsCurrentlyAllowed(endpoint)).toBe(false);
      stored = { mode: "cloud", localEndpoint: "http://localhost:11434", cloudProxyUrl: "https://attacker.example" };
      expect(cloudRequestIsCurrentlyAllowed(endpoint)).toBe(false);
      expect(cloudRequestIsCurrentlyAllowed("https://attacker.example")).toBe(false);
      vi.stubGlobal("localStorage", { getItem: () => { throw new Error("denied"); } });
      expect(cloudRequestIsCurrentlyAllowed(endpoint)).toBe(false);
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
});

describe("Cloud AI account/session epoch isolation", () => {
  const accountA = { userId: "account-a", accessToken: "token-a" };
  const accountB = { userId: "account-b", accessToken: "token-b" };

  for (const returnedToken of ["token-a", "token-b"]) {
    it(`never posts account A study text after an A-to-B switch while auth returns ${returnedToken}`, async () => {
      let current = accountA;
      let finishAuth!: (token: string) => void;
      const getAccessToken = vi.fn(() => new Promise<string>((resolve) => { finishAuth = resolve; }));
      const fetchImpl = vi.fn(() => reply(200, { result: { text: "must not send" } }));
      const options = {
        endpoint: "https://example.test/ai", isRequestAllowed: () => true,
        getAuthSnapshot: () => current, getAccessToken, fetchImpl,
      };
      const provider = createCloudProvider(options);
      const request = provider.completeJson({ prompt: "account A private study note" });
      expect(getAccessToken).toHaveBeenCalledTimes(1);
      current = accountB;
      finishAuth(returnedToken);
      await expect(request).rejects.toThrow(/account.*changed|session.*changed/i);
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  }

  it("blocks sign-out and same-account token rotation before posting", async () => {
    for (const after of [null, { userId: "account-a", accessToken: "refreshed-token" }]) {
      let current: typeof accountA | null = accountA;
      let finishAuth!: (token: string) => void;
      const getAccessToken = () => new Promise<string>((resolve) => { finishAuth = resolve; });
      const fetchImpl = vi.fn(() => reply(200, { result: { text: "must not send" } }));
      const options = {
        endpoint: "https://example.test/ai", isRequestAllowed: () => true,
        getAuthSnapshot: () => current, getAccessToken, fetchImpl,
      };
      const request = createCloudProvider(options).completeJson({ prompt: "account A study text" });
      current = after;
      finishAuth("token-a");
      await expect(request).rejects.toThrow(/account.*changed|session.*changed/i);
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  });

  it("does not reuse an account A provider after switching accounts before its first action", async () => {
    let storedAccount = accountA;
    const boundAccountId = storedAccount.userId;
    const fetchImpl = vi.fn(() => reply(200, { result: { text: "must not send" } }));
    const getAccessToken = vi.fn(async () => "token-b");
    const options = {
      endpoint: "https://example.test/ai", isRequestAllowed: () => true,
      getAuthSnapshot: () => storedAccount.userId === boundAccountId ? storedAccount : null,
      getAccessToken, fetchImpl,
    };
    const cachedProvider = createCloudProvider(options);
    storedAccount = accountB;
    await expect(cachedProvider.completeJson({ prompt: "stale component text" })).rejects.toThrow(/account.*changed|session.*changed|Sign in/i);
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("drops an already-sent reply and its quota update after an identity switch during JSON parsing", async () => {
    let current = accountA;
    let finishParsing!: (value: unknown) => void;
    let parsingStarted!: () => void;
    const parsing = new Promise<void>((resolve) => { parsingStarted = resolve; });
    const fetchImpl = vi.fn(async () => ({
      ok: true, status: 200,
      json: () => new Promise<unknown>((resolve) => { finishParsing = resolve; parsingStarted(); }),
    }));
    const options = {
      endpoint: "https://example.test/ai", isRequestAllowed: () => true,
      getAuthSnapshot: () => current, getAccessToken: async () => "token-a",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    };
    const request = createCloudProvider(options).completeJson({ prompt: "account A text" });
    await parsing;
    expect(fetchImpl).toHaveBeenCalledTimes(1); // Already transmitted; cannot retract.
    current = accountB;
    finishParsing({ result: { text: "stale" }, remaining: 8 });
    await expect(request).rejects.toThrow(/account.*changed|session.*changed/i);
  });

  it("keeps a legitimate same-account, unchanged-token Cloud request operational", async () => {
    const fetchImpl = vi.fn(() => reply(200, { result: { text: "safe" } }));
    const options = {
      endpoint: "https://example.test/ai", isRequestAllowed: () => true,
      getAuthSnapshot: () => accountA, getAccessToken: async () => "token-a", fetchImpl,
    };
    await expect(createCloudProvider(options).completeJson({ prompt: "source text" })).resolves.toEqual({ text: "safe" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("ai-proxy core", () => {
  it("fails closed on missing, malformed, unavailable or denied quota policy", () => {
    for (const value of [null, undefined, "59", {}, [], NaN, Infinity, -2, 0.5, 1000]) {
      expect(cloudAllowance(value)).toMatchObject({ allowed: false, status: 503 });
    }
    expect(cloudAllowance(59, true)).toMatchObject({ allowed: false, status: 503 });
    expect(cloudAllowance(-1)).toMatchObject({ allowed: false, status: 429 });
    expect(cloudAllowance(0)).toEqual({ allowed: true, remaining: 0 });
    expect(cloudAllowance(999)).toEqual({ allowed: true, remaining: 999 });
  });
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
