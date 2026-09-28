import { describe, expect, it, vi } from "vitest";
import { AnkiError, addressSpaceFor, connectToAnki, createAnkiClient, fetchAnkiSnapshot, isAnkiOffline } from "./ankiConnect";
import { createFakeFetch, FakeAnkiConnect } from "./anki/fake/fakeAnkiConnect";

describe("AnkiConnect client", () => {
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

  it("recognizes loopback and private addresses for Local Network Access", () => {
    expect(addressSpaceFor(new URL("http://127.0.0.1:8765"))).toBe("loopback");
    expect(addressSpaceFor(new URL("http://localhost:8765"))).toBe("loopback");
    expect(addressSpaceFor(new URL("http://[::1]:8765"))).toBe("loopback");
    expect(addressSpaceFor(new URL("http://192.168.1.20:8765"))).toBe("local");
    expect(addressSpaceFor(new URL("http://anki.local:8765"))).toBe("local");
    expect(addressSpaceFor(new URL("https://example.com"))).toBeNull();
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
