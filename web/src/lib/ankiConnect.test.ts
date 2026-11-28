import { describe, expect, it, vi } from "vitest";
import { AnkiError, addressSpaceFor, connectToAnki, createAnkiClient, fetchAnkiSnapshot, isAnkiOffline } from "./ankiConnect";
import { createFakeFetch, FakeAnkiConnect } from "./anki/fake/fakeAnkiConnect";

describe("AnkiConnect client", () => {
  it("does not replay possibly applied writes or multi batches after a hinted connection failure", async () => {
    // Simulate a browser which accepts the Chrome Local Network Access hint.
    // The mocked Anki endpoint applies the command, then loses the response.
    class HintRequest extends Request {
      readonly targetAddressSpace?: string;
      constructor(input: RequestInfo | URL, init?: RequestInit & { targetAddressSpace?: string }) {
        super(input, init);
        this.targetAddressSpace = init?.targetAddressSpace;
      }
    }
    vi.stubGlobal("Request", HintRequest);
    vi.stubGlobal("window", { location: { href: "https://www.axom.info/", origin: "https://www.axom.info", protocol: "https:" } });
    try {
      const applied: string[] = [];
      const ambiguousFetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { action: string };
        applied.push(body.action);
        throw new TypeError("connection dropped after Anki applied the action");
      });
      const client = createAnkiClient({ endpoint: "http://127.0.0.1:8765", fetchImpl: ambiguousFetch });
      const uncertainWrite = await client.call("addNote", { note: { deckName: "AXOM", modelName: "Basic", fields: { Front: "a", Back: "b" } } }).catch((error: unknown) => error);
      expect(uncertainWrite).toMatchObject({ kind: "local-network-blocked", message: expect.stringContaining("may already have applied") });
      // Keep sync.ts's offline-safe path: do not immediately retry an ambiguous add.
      expect(isAnkiOffline(uncertainWrite)).toBe(true);
      await expect(client.call("addNotes", { notes: [{ deckName: "AXOM", modelName: "Basic", fields: { Front: "c", Back: "d" } }] }))
        .rejects.toMatchObject({ message: expect.stringContaining("may already have applied") });
      await expect(client.multi([{ action: "addNote", params: { note: { deckName: "AXOM" } } }]))
        .rejects.toMatchObject({ message: expect.stringContaining("may already have applied") });
      expect(applied).toEqual(["addNote", "addNotes", "multi"]);
      expect(ambiguousFetch).toHaveBeenCalledTimes(3);
      expect((ambiguousFetch.mock.calls[0] as unknown as [string, RequestInit & { targetAddressSpace?: string }])[1].targetAddressSpace).toBe("loopback");

      const readFetch = vi.fn()
        .mockRejectedValueOnce(new TypeError("hint blocked before read"))
        .mockResolvedValueOnce(new Response(JSON.stringify({ result: 6, error: null })));
      await expect(createAnkiClient({ endpoint: "http://127.0.0.1:8765", fetchImpl: readFetch }).call("version")).resolves.toBe(6);
      expect(readFetch).toHaveBeenCalledTimes(2);
      const first = (readFetch.mock.calls[0] as unknown as [string, RequestInit & { targetAddressSpace?: string }])[1];
      const second = (readFetch.mock.calls[1] as unknown as [string, RequestInit & { targetAddressSpace?: string }])[1];
      expect(first).toMatchObject({ targetAddressSpace: "loopback", redirect: "error" });
      expect(second).toMatchObject({ redirect: "error" });
      expect(second.targetAddressSpace).toBeUndefined();

      // AXOM's source-relink lookup uses multi([findNotes]); preserve its
      // compatibility fallback, without ever replaying a mixed mutation batch.
      const readBatchFetch = vi.fn()
        .mockRejectedValueOnce(new TypeError("hint blocked before read-only multi"))
        .mockResolvedValueOnce(new Response(JSON.stringify({
          result: [{ result: [123], error: null }], error: null,
        })));
      await expect(createAnkiClient({ endpoint: "http://127.0.0.1:8765", fetchImpl: readBatchFetch }).multi([
        { action: "findNotes", params: { query: "tag:AXOM" } },
      ])).resolves.toEqual([{ ok: true, result: [123] }]);
      expect(readBatchFetch).toHaveBeenCalledTimes(2);
      expect((readBatchFetch.mock.calls[0] as unknown as [string, RequestInit & { targetAddressSpace?: string }])[1].targetAddressSpace).toBe("loopback");
      expect((readBatchFetch.mock.calls[1] as unknown as [string, RequestInit & { targetAddressSpace?: string }])[1].targetAddressSpace).toBeUndefined();

      const mixedFetch = vi.fn(async () => { throw new TypeError("after mixed batch applied"); });
      await expect(createAnkiClient({ endpoint: "http://127.0.0.1:8765", fetchImpl: mixedFetch }).multi([
        { action: "findNotes", params: { query: "tag:AXOM" } },
        { action: "addNote", params: { note: { deckName: "AXOM" } } },
      ])).rejects.toMatchObject({ message: expect.stringContaining("may already have applied") });
      expect(mixedFetch).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  describe("immutable replay and response deadlines", () => {
    // Use the same supported LNA hint as the production client. The first
    // transport is deliberately ambiguous, not a real Anki operation.
    function hintBrowser() {
      class HintRequest extends Request {
        readonly targetAddressSpace?: string;
        constructor(input: RequestInfo | URL, init?: RequestInit & { targetAddressSpace?: string }) {
          super(input, init);
          this.targetAddressSpace = init?.targetAddressSpace;
        }
      }
      vi.stubGlobal("Request", HintRequest);
      vi.stubGlobal("window", { location: { href: "https://www.axom.info/", origin: "https://www.axom.info", protocol: "https:" } });
    }

    it.each([
      { sent: "addNote", after: "version", retry: false },
      { sent: "version", after: "addNote", retry: true },
    ])("bases replay on the original wire, not a deferred mutation ($sent)", async ({ sent, after, retry }) => {
      hintBrowser();
      try {
        let fail!: (reason: unknown) => void;
        const first = new Promise<Response>((_, reject) => { fail = reject; });
        const fetchImpl = vi.fn()
          .mockReturnValueOnce(first)
          .mockResolvedValueOnce(new Response(JSON.stringify({ result: [6], error: null })));
        const payload = { actions: [{ action: sent, version: 6, params: {} }] };
        const client = createAnkiClient({ fetchImpl, endpoint: "http://127.0.0.1:8765" });
        const operation = client.call("multi", payload);
        const firstInit = fetchImpl.mock.calls[0][1] as RequestInit & { targetAddressSpace?: string };
        expect(firstInit.targetAddressSpace).toBe("loopback");
        expect(JSON.parse(String(firstInit.body)).params.actions[0].action).toBe(sent);
        payload.actions[0].action = after;
        fail(new TypeError("response lost"));
        if (retry) {
          await expect(operation).resolves.toEqual([6]);
          expect(fetchImpl).toHaveBeenCalledTimes(2);
          const secondInit = fetchImpl.mock.calls[1][1] as RequestInit & { targetAddressSpace?: string };
          expect(secondInit.body).toBe(firstInit.body);
          expect(secondInit.targetAddressSpace).toBeUndefined();
          expect(secondInit.redirect).toBe("error");
        } else {
          await expect(operation).rejects.toMatchObject({ message: expect.stringContaining("may already have applied") });
          expect(fetchImpl).toHaveBeenCalledOnce();
        }
      } finally { vi.unstubAllGlobals(); }
    });

    it("does not replay an action serialized as a write by a toJSON hook", async () => {
      hintBrowser();
      try {
        const fetchImpl = vi.fn(async () => { throw new TypeError("response lost"); });
        const entry = { action: "version", version: 6, params: {},
          toJSON: () => ({ action: "addNote", version: 6, params: {} }) };
        await expect(createAnkiClient({ endpoint: "http://127.0.0.1:8765", fetchImpl }).call("multi", { actions: [entry] }))
          .rejects.toMatchObject({ message: expect.stringContaining("may already have applied") });
        expect(fetchImpl).toHaveBeenCalledOnce();
        const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
        expect(JSON.parse(String(init.body)).params.actions[0].action).toBe("addNote");
      } finally { vi.unstubAllGlobals(); }
    });

    it("does not automatically repeat permission prompts, malformed or unknown batches", async () => {
      hintBrowser();
      try {
        const cases: [string, Record<string, unknown>][] = [
          ["requestPermission", {}],
          ["multi", { actions: [{ action: "requestPermission", version: 6, params: {} }] }],
          ["multi", { actions: [{ action: "version", version: 6, params: null }] }],
          ["multi", { actions: [{ action: "version", version: 5, params: {} }] }],
          ["multi", { actions: [{ action: "unknown", version: 6, params: {} }] }],
          ["multi", { actions: [{ action: "multi", version: 6, params: { actions: [] } }] }],
          ["multi", { actions: [] }],
        ];
        for (const [action, params] of cases) {
          const fetchImpl = vi.fn(async () => { throw new TypeError("response lost"); });
          await expect(createAnkiClient({ endpoint: "http://127.0.0.1:8765", fetchImpl }).call(action, params))
            .rejects.toMatchObject({ message: expect.stringContaining("may already have applied") });
          expect(fetchImpl).toHaveBeenCalledOnce();
        }
      } finally { vi.unstubAllGlobals(); }
    });

    it.each(["version", "addNote"])("enforces the deadline through body consumption (%s)", async (action) => {
      vi.useFakeTimers();
      try {
        const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
          const response = new Response("");
          vi.spyOn(response, "json").mockImplementation(() => new Promise((resolve, reject) => {
            const finish = setTimeout(() => resolve({ result: 6, error: null }), 100);
            // Emulate fetch body cancellation; some implementations reject with TypeError.
            init?.signal?.addEventListener("abort", () => {
              clearTimeout(finish);
              reject(new TypeError("body aborted"));
            }, { once: true });
          }));
          return response;
        });
        const result = createAnkiClient({ endpoint: "http://127.0.0.1:8765", timeoutMs: 10, fetchImpl }).call(action)
          .catch((error: unknown) => error);
        await vi.advanceTimersByTimeAsync(100);
        const outcome = await result;
        expect(outcome).toMatchObject({ kind: "endpoint-unreachable", message: expect.stringContaining("did not answer") });
        if (action === "addNote") {
          expect(outcome).toMatchObject({ message: expect.stringContaining("may already have applied") });
          expect(isAnkiOffline(outcome)).toBe(true);
        }
        expect(fetchImpl).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
      } finally { vi.useRealTimers(); }
    });

    it("separates malformed, interrupted and denied responses without replaying writes", async () => {
      hintBrowser();
      try {
        const malformed = vi.fn(async () => new Response("<html>not JSON</html>"));
        await expect(createAnkiClient({ fetchImpl: malformed, endpoint: "http://127.0.0.1:8765" }).call("addNote"))
          .rejects.toMatchObject({ kind: "anki-connect-absent", message: expect.stringContaining("may already have applied") });
        expect(malformed).toHaveBeenCalledOnce();
        const response = new Response("");
        vi.spyOn(response, "json").mockRejectedValue(new TypeError("response interrupted"));
        const interrupted = vi.fn(async () => response);
        await expect(createAnkiClient({ fetchImpl: interrupted, endpoint: "http://127.0.0.1:8765" }).call("addNote"))
          .rejects.toMatchObject({ kind: "network", message: expect.stringContaining("may already have applied") });
        expect(interrupted).toHaveBeenCalledOnce();
        const denied = vi.fn(async () => new Response("", { status: 403 }));
        const denial = await createAnkiClient({ fetchImpl: denied, endpoint: "http://127.0.0.1:8765" }).call("requestPermission")
          .catch((error: unknown) => error);
        expect(denial).toMatchObject({ kind: "permission-denied" });
        expect((denial as AnkiError).message).not.toContain("may already have applied");
        expect(denied).toHaveBeenCalledOnce();
      } finally { vi.unstubAllGlobals(); }
    });
  });

  it("sends simple CORS requests: a JSON string body with no custom headers", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ result: 6, error: null })));
    const client = createAnkiClient({ endpoint: "http://127.0.0.1:8765", fetchImpl });
    await expect(client.call("version")).resolves.toBe(6);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:8765/");
    expect(init.headers).toBeUndefined();
    expect(init).toMatchObject({ method: "POST", mode: "cors", credentials: "omit" });
    expect(JSON.parse(String(init.body))).toEqual({ action: "version", version: 6, params: {} });
  });

  it("reaches requestPermission from an origin AnkiConnect does not trust yet", async () => {
    const fake = new FakeAnkiConnect();
    const client = createAnkiClient({ fetchImpl: createFakeFetch(fake, { origin: "https://axom.example" }) });
    await expect(connectToAnki(client)).resolves.toEqual({ version: 6, requireApiKey: false });
    expect(fake.permissionPrompts).toEqual(["https://axom.example"]);
    await expect(client.call("deckNames")).resolves.toEqual(["Default"]);
  });

  it("explains a denied permission and a missing API key", async () => {
    const denied = new FakeAnkiConnect({ answerPermission: () => "no" });
    await expect(connectToAnki(createAnkiClient({ fetchImpl: createFakeFetch(denied, { origin: "https://axom.example" }) })))
      .rejects.toMatchObject({ kind: "permission-denied" });

    const keyed = new FakeAnkiConnect({ apiKey: "s3cret" });
    const withoutKey = createAnkiClient({ fetchImpl: createFakeFetch(keyed) });
    await expect(connectToAnki(withoutKey)).rejects.toMatchObject({ kind: "api-key" });
    await expect(withoutKey.call("deckNames")).rejects.toMatchObject({ kind: "api-key" });
    const withKey = createAnkiClient({ apiKey: "s3cret", fetchImpl: createFakeFetch(keyed) });
    await expect(connectToAnki(withKey, { hasApiKey: true })).resolves.toMatchObject({ requireApiKey: true });
    await expect(withKey.multi([{ action: "version" }, { action: "deckNames" }])).resolves.toEqual([
      { ok: true, result: 6 }, { ok: true, result: ["Default"] },
    ]);
  });

  it("returns per-action results from multi and keeps errors separate", async () => {
    const fake = new FakeAnkiConnect();
    const client = createAnkiClient({ fetchImpl: createFakeFetch(fake) });
    const results = await client.multi([{ action: "createDeck", params: { deck: "AXOM" } }, { action: "modelFieldNames", params: { modelName: "Nope" } }, { action: "bogusAction" }]);
    expect(results[0]).toEqual({ ok: true, result: expect.any(Number) });
    expect(results[1]).toEqual({ ok: false, error: "model was not found: Nope" });
    expect(results[2]).toMatchObject({ ok: false, error: expect.stringContaining("does not support") });
  });

  it("classifies failures so the UI can explain them", async () => {
    const offline = new FakeAnkiConnect();
    offline.offline = true;
    const error = await createAnkiClient({ fetchImpl: createFakeFetch(offline) }).call("version").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AnkiError);
    expect((error as AnkiError).kind).toBe("endpoint-unreachable");
    expect(isAnkiOffline(error)).toBe(true);

    const refused = createAnkiClient({ fetchImpl: createFakeFetch(new FakeAnkiConnect(), { origin: null }), endpoint: "http://127.0.0.1:8765" });
    const forbidden = createAnkiClient({ fetchImpl: vi.fn(async () => new Response("", { status: 403 })) });
    await expect(forbidden.call("version")).rejects.toMatchObject({ kind: "permission-denied" });
    await expect(refused.call("version")).resolves.toBe(6);

    const notAnki = createAnkiClient({ fetchImpl: vi.fn(async () => new Response("<html>router</html>")) });
    await expect(notAnki.call("version")).rejects.toMatchObject({ kind: "anki-connect-absent" });
    await expect(createAnkiClient({ endpoint: "nonsense" }).call("version")).rejects.toMatchObject({ kind: "malformed-endpoint" });
    const timeout = createAnkiClient({ timeoutMs: 5, fetchImpl: vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })) });
    await expect(timeout.call("findCards", { query: "deck:X" })).rejects.toMatchObject({ kind: "endpoint-unreachable", message: expect.stringContaining("did not answer") });
  });

  it("blocks public endpoints and hostname-prefix spoofing before transmitting an Anki API key", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ result: 6, error: null })));
    for (const endpoint of [
      "https://anki.example.com:8765",
      "http://8.8.8.8:8765",
      "http://127.0.0.1.attacker.example:8765",
      "http://10.attacker.example:8765",
      "http://192.168.attacker.example:8765",
      "http://172.16.attacker.example:8765",
      "http://169.254.attacker.example:8765",
      "http://user:pass@127.0.0.1:8765",
    ]) {
      await expect(createAnkiClient({ endpoint, apiKey: "device-secret", fetchImpl }).call("version"))
        .rejects.toMatchObject({ kind: "malformed-endpoint" });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("prevents API-key POST redirects while preserving local/private-LAN transport", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ result: 6, error: null })));
    for (const endpoint of ["http://127.0.0.1:8765", "http://192.168.1.20:8765"]) {
      const client = createAnkiClient({ endpoint, apiKey: "device-secret", fetchImpl });
      await expect(client.call("version")).resolves.toBe(6);
    }
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchImpl.mock.calls as unknown as [string, RequestInit][]) {
      expect(init).toMatchObject({
        method: "POST", mode: "cors", credentials: "omit", redirect: "error",
      });
      expect(JSON.parse(String(init.body))).toMatchObject({ key: "device-secret", action: "version" });
    }
  });

  it("recognizes loopback and private addresses for Local Network Access", () => {
    expect(addressSpaceFor(new URL("http://127.0.0.1:8765"))).toBe("loopback");
    expect(addressSpaceFor(new URL("http://localhost:8765"))).toBe("loopback");
    expect(addressSpaceFor(new URL("http://[::1]:8765"))).toBe("loopback");
    expect(addressSpaceFor(new URL("http://192.168.1.20:8765"))).toBe("local");
    expect(addressSpaceFor(new URL("http://anki.local:8765"))).toBe("local");
    expect(addressSpaceFor(new URL("https://example.com"))).toBeNull();
    expect(addressSpaceFor(new URL("http://127.attacker.example:8765"))).toBeNull();
    expect(addressSpaceFor(new URL("http://10.attacker.example:8765"))).toBeNull();
    expect(addressSpaceFor(new URL("http://192.168.attacker.example:8765"))).toBeNull();
    expect(addressSpaceFor(new URL("http://172.16.attacker.example:8765"))).toBeNull();
    expect(addressSpaceFor(new URL("http://169.254.attacker.example:8765"))).toBeNull();
  });

  it("classifies the entire IPv6 link-local /10 boundary without admitting public or deprecated-site addresses", async () => {
    // RFC 4291 reserves fe80::/10 (fe80 through febf); fe80::/64 alone is too narrow.
    for (const address of ["fe80::1", "fe8f::12", "fe90::1", "fea0::21", "febf::ffff"]) {
      expect(addressSpaceFor(new URL(`http://[${address}]:8765`))).toBe("local");
    }
    for (const address of ["fe7f::1", "fec0::1", "fdff::ffff", "2001:4860:4860::8888", "::ffff:808:808"]) {
      expect(addressSpaceFor(new URL(`http://[${address}]:8765`)))
        .toBe(address === "fdff::ffff" ? "local" : null);
    }

    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ result: 6, error: null })));
    await expect(createAnkiClient({ endpoint: "http://[fe90::12]:8765", apiKey: "device-secret", fetchImpl }).call("version")).resolves.toBe(6);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].redirect).toBe("error");
    for (const endpoint of [
      "http://[fe7f::1]:8765", "http://[fec0::1]:8765",
      "http://[2001:4860:4860::8888]:8765", "http://[::ffff:8.8.8.8]:8765",
    ]) {
      await expect(createAnkiClient({ endpoint, apiKey: "device-secret", fetchImpl }).call("version"))
        .rejects.toMatchObject({ kind: "malformed-endpoint" });
    }
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("reads a review snapshot in chart order", async () => {
    const fake = new FakeAnkiConnect();
    const [cid] = fake.seedPremadeDeck("Deck", [{ text: "{{c1::x}}", tags: [] }]);
    fake.answer(cid, 3, fake.nowMs() - 86_400_000);
    fake.answer(cid, 3);
    const snapshot = await fetchAnkiSnapshot(createAnkiClient({ fetchImpl: createFakeFetch(fake) }));
    expect(snapshot.today).toBe(1);
    expect(snapshot.byDay.map(([day]) => day)).toEqual([...snapshot.byDay.map(([day]) => day)].sort());
    expect(snapshot.decks.map((deck) => deck.name)).toContain("Deck");
  });
});
