import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/**
 * Storage chaos acceptance: real Chromium IndexedDB, quota fallback and
 * independent same-origin tabs. Every test uses a fresh isolated Playwright
 * browser context and a synthetic HTML shell, never a learner account.
 * Workspace bytes and original user files are not read from production.
 */
const probePath = "/__axom_vault_chaos__";

async function probe(context: BrowserContext): Promise<Page> {
  await context.route("**" + probePath, (route) => route.fulfill({
    status: 200,
    contentType: "text/html; charset=utf-8",
    body: "<!doctype html><html><head><title>AXOM vault chaos probe</title></head><body><output id='status'></output></body></html>",
  }));
  const page = await context.newPage();
  await page.goto(probePath);
  return page;
}

function snapshot(label: string, body = ""): string {
  return JSON.stringify({
    state: { profile: { userId: "synthetic-vault-chaos" }, label,
      documents: [{ id: "synthetic-document", rawText: body }] },
    version: 34,
  });
}

test("chunked Unicode workspace: stale second tab cannot overwrite, fresh reload can save", async ({ context }) => {
  test.setTimeout(120_000);
  const a = await probe(context);
  const b = await context.newPage();
  const large = "α🐦".repeat(450_000);
  const initial = snapshot("first", large);
  const winner = snapshot("first-tab-newer", large);
  const stale = snapshot("stale-other-tab", large);
  const final = snapshot("fresh-second-tab", large);

  await a.evaluate(async (value) => {
    const { STORAGE_KEYS } = await import("/src/lib/brand.ts");
    const v = await import("/src/lib/localVault.ts");
    const key = STORAGE_KEYS.persistedState;
    await v.localVaultStorage.getItem(key);
    const checkpoint = v.getVaultWriteCheckpoint();
    await v.localVaultStorage.setItem(key, value);
    await v.flushLocalVaultWrites();
    v.assertVaultWritesSince(checkpoint);
    if ((await v.localVaultStorage.getItem(key)) !== value) throw new Error("Initial chunked workspace did not persist");
  }, initial);

  await b.goto(probePath);
  const bInitial = await b.evaluate(async () => {
    const { STORAGE_KEYS } = await import("/src/lib/brand.ts");
    const v = await import("/src/lib/localVault.ts");
    return await v.localVaultStorage.getItem(STORAGE_KEYS.persistedState);
  });
  expect(bInitial).toBe(initial);

  await a.evaluate(async (value) => {
    const { STORAGE_KEYS } = await import("/src/lib/brand.ts");
    const v = await import("/src/lib/localVault.ts");
    const key = STORAGE_KEYS.persistedState;
    const checkpoint = v.getVaultWriteCheckpoint();
    await v.localVaultStorage.setItem(key, value);
    await v.flushLocalVaultWrites();
    v.assertVaultWritesSince(checkpoint);
  }, winner);

  const bConflict = await b.evaluate(async (value) => {
    const { STORAGE_KEYS } = await import("/src/lib/brand.ts");
    const v = await import("/src/lib/localVault.ts");
    const key = STORAGE_KEYS.persistedState;
    const checkpoint = v.getVaultWriteCheckpoint();
    await v.localVaultStorage.setItem(key, value);
    await v.flushLocalVaultWrites();
    try { v.assertVaultWritesSince(checkpoint); return null; }
    catch (error) { return error instanceof Error ? error.message : String(error); }
  }, stale);
  expect(bConflict).toContain("Another AXOM tab saved a newer workspace");

  const stillWinner = await a.evaluate(async (value) => {
    const { STORAGE_KEYS } = await import("/src/lib/brand.ts");
    const v = await import("/src/lib/localVault.ts");
    return (await v.localVaultStorage.getItem(STORAGE_KEYS.persistedState)) === value;
  }, winner);
  expect(stillWinner).toBe(true);

  await b.reload();
  const bFresh = await b.evaluate(async (value) => {
    const { STORAGE_KEYS } = await import("/src/lib/brand.ts");
    const v = await import("/src/lib/localVault.ts");
    const key = STORAGE_KEYS.persistedState;
    if ((await v.localVaultStorage.getItem(key)) !== value) return false;
    return true;
  }, winner);
  expect(bFresh).toBe(true);

  await b.evaluate(async (value) => {
    const { STORAGE_KEYS } = await import("/src/lib/brand.ts");
    const v = await import("/src/lib/localVault.ts");
    const checkpoint = v.getVaultWriteCheckpoint();
    await v.localVaultStorage.setItem(STORAGE_KEYS.persistedState, value);
    await v.flushLocalVaultWrites();
    v.assertVaultWritesSince(checkpoint);
  }, final);
  await a.reload();
  expect(await a.evaluate(async (value) => {
    const { STORAGE_KEYS } = await import("/src/lib/brand.ts");
    const v = await import("/src/lib/localVault.ts");
    return (await v.localVaultStorage.getItem(STORAGE_KEYS.persistedState)) === value;
  }, final)).toBe(true);
});

test("rapid burst coalesces to newest large workspace and survives fresh reload", async ({ context }) => {
  test.setTimeout(120_000);
  const page = await probe(context);
  const payload = "Ψ".repeat(1_240_000);
  const variants = Array.from({ length: 30 }, (_, index) => snapshot("burst-" + index, payload));
  const result = await page.evaluate(async (values) => {
    const { STORAGE_KEYS } = await import("/src/lib/brand.ts");
    const v = await import("/src/lib/localVault.ts");
    const key = STORAGE_KEYS.persistedState;
    await v.localVaultStorage.getItem(key);
    const checkpoint = v.getVaultWriteCheckpoint();
    await Promise.all(values.map((value) => v.localVaultStorage.setItem(key, value)));
    await v.flushLocalVaultWrites();
    v.assertVaultWritesSince(checkpoint);
    const stored = await v.localVaultStorage.getItem(key);
    return { exact: stored === values[values.length - 1], bytes: stored?.length ?? 0 };
  }, variants);
  expect(result.exact).toBe(true);
  expect(result.bytes).toBeGreaterThan(1_000_000);
  await page.reload();
  expect(await page.evaluate(async (value) => {
    const { STORAGE_KEYS } = await import("/src/lib/brand.ts");
    const v = await import("/src/lib/localVault.ts");
    return (await v.localVaultStorage.getItem(STORAGE_KEYS.persistedState)) === value;
  }, variants[variants.length - 1])).toBe(true);
});

test("IndexedDB outage: newer browser fallback promotes without replacing older work", async ({ context }) => {
  const page = await probe(context);
  const original = snapshot("original-indexeddb");
  const recovered = snapshot("newer-fallback");
  await page.evaluate(async (value) => {
    const { STORAGE_KEYS } = await import("/src/lib/brand.ts");
    const v = await import("/src/lib/localVault.ts");
    const key = STORAGE_KEYS.persistedState;
    await v.localVaultStorage.getItem(key);
    const checkpoint = v.getVaultWriteCheckpoint();
    await v.localVaultStorage.setItem(key, value);
    await v.flushLocalVaultWrites();
    v.assertVaultWritesSince(checkpoint);
  }, original);

  const result = await page.evaluate(async (value) => {
    const { STORAGE_KEYS } = await import("/src/lib/brand.ts");
    const v = await import("/src/lib/localVault.ts");
    const key = STORAGE_KEYS.persistedState;
    const old = Object.getOwnPropertyDescriptor(window, "indexedDB");
    Object.defineProperty(window, "indexedDB", { configurable: true, value: undefined });
    try {
      const checkpoint = v.getVaultWriteCheckpoint();
      await v.localVaultStorage.setItem(key, value);
      await v.flushLocalVaultWrites();
      v.assertVaultWritesSince(checkpoint);
      return { fallback: localStorage.getItem(key) === value };
    } finally {
      if (old) Object.defineProperty(window, "indexedDB", old);
      else Reflect.deleteProperty(window, "indexedDB");
    }
  }, recovered);
  expect(result.fallback).toBe(true);
  expect(await page.evaluate(async (value) => {
    const { STORAGE_KEYS } = await import("/src/lib/brand.ts");
    const v = await import("/src/lib/localVault.ts");
    return (await v.localVaultStorage.getItem(STORAGE_KEYS.persistedState)) === value;
  }, recovered)).toBe(true);
  await page.reload();
  expect(await page.evaluate(async (value) => {
    const { STORAGE_KEYS } = await import("/src/lib/brand.ts");
    const v = await import("/src/lib/localVault.ts");
    return (await v.localVaultStorage.getItem(STORAGE_KEYS.persistedState)) === value;
  }, recovered)).toBe(true);
});

test("double storage failure reports unsaved, retains previously verified workspace across reload", async ({ context }) => {
  const page = await probe(context);
  const original = snapshot("previous-confirmed");
  const rejected = snapshot("must-not-overwrite");
  await page.evaluate(async (value) => {
    const { STORAGE_KEYS } = await import("/src/lib/brand.ts");
    const v = await import("/src/lib/localVault.ts");
    const key = STORAGE_KEYS.persistedState;
    await v.localVaultStorage.getItem(key);
    const checkpoint = v.getVaultWriteCheckpoint();
    await v.localVaultStorage.setItem(key, value);
    await v.flushLocalVaultWrites();
    v.assertVaultWritesSince(checkpoint);
  }, original);

  const outcome = await page.evaluate(async (value) => {
    const { STORAGE_KEYS } = await import("/src/lib/brand.ts");
    const v = await import("/src/lib/localVault.ts");
    const status = await import("/src/lib/vaultActivity.ts");
    const key = STORAGE_KEYS.persistedState;
    const oldDescriptor = Object.getOwnPropertyDescriptor(window, "indexedDB");
    const originalSet = Storage.prototype.setItem;
    Object.defineProperty(window, "indexedDB", { configurable: true, value: undefined });
    Storage.prototype.setItem = function (name: string, content: string) {
      if (name === key) throw new DOMException("Synthetic quota reached", "QuotaExceededError");
      return originalSet.call(this, name, content);
    };
    try {
      const checkpoint = v.getVaultWriteCheckpoint();
      await v.localVaultStorage.setItem(key, value);
      await v.flushLocalVaultWrites();
      let rejectedByAdapter = false;
      try { v.assertVaultWritesSince(checkpoint); }
      catch (error) { rejectedByAdapter = error instanceof Error && /quota/i.test(error.message); }
      return { rejectedByAdapter, failureVisible: status.readVaultWriteFailure() !== null };
    } finally {
      Storage.prototype.setItem = originalSet;
      if (oldDescriptor) Object.defineProperty(window, "indexedDB", oldDescriptor);
      else Reflect.deleteProperty(window, "indexedDB");
    }
  }, rejected);
  expect(outcome).toEqual({ rejectedByAdapter: true, failureVisible: true });
  expect(await page.evaluate(async (value) => {
    const { STORAGE_KEYS } = await import("/src/lib/brand.ts");
    const v = await import("/src/lib/localVault.ts");
    return (await v.localVaultStorage.getItem(STORAGE_KEYS.persistedState)) === value;
  }, original)).toBe(true);
  await page.reload();
  expect(await page.evaluate(async (value) => {
    const { STORAGE_KEYS } = await import("/src/lib/brand.ts");
    const v = await import("/src/lib/localVault.ts");
    return (await v.localVaultStorage.getItem(STORAGE_KEYS.persistedState)) === value;
  }, original)).toBe(true);
});

test("offline writer survives reconnect, a newly opened tab, and another reload", async ({ context }) => {
  const first = await probe(context);
  const prior = snapshot("online-checkpoint");
  const offline = snapshot("offline-newest", "🪶Δ".repeat(100_000));

  await first.evaluate(async (value) => {
    const { STORAGE_KEYS } = await import("/src/lib/brand.ts");
    const vault = await import("/src/lib/localVault.ts");
    await vault.localVaultStorage.getItem(STORAGE_KEYS.persistedState);
    const checkpoint = vault.getVaultWriteCheckpoint();
    await vault.localVaultStorage.setItem(STORAGE_KEYS.persistedState, value);
    await vault.flushLocalVaultWrites();
    vault.assertVaultWritesSince(checkpoint);
  }, prior);

  // Warm the real storage module before disconnecting; no Vite network request
  // should be necessary to save the already-open offline workspace.
  await first.evaluate(async () => { await import("/src/lib/localVault.ts"); });
  await context.setOffline(true);
  try {
    const readBack = await first.evaluate(async (value) => {
      const { STORAGE_KEYS } = await import("/src/lib/brand.ts");
      const vault = await import("/src/lib/localVault.ts");
      const checkpoint = vault.getVaultWriteCheckpoint();
      await vault.localVaultStorage.setItem(STORAGE_KEYS.persistedState, value);
      await vault.flushLocalVaultWrites();
      vault.assertVaultWritesSince(checkpoint);
      return (await vault.localVaultStorage.getItem(STORAGE_KEYS.persistedState)) === value;
    }, offline);
    expect(readBack).toBe(true);
  } finally {
    await context.setOffline(false);
  }

  const second = await context.newPage();
  await second.goto(probePath);
  const read = () => second.evaluate(async () => {
    const { STORAGE_KEYS } = await import("/src/lib/brand.ts");
    const vault = await import("/src/lib/localVault.ts");
    return vault.localVaultStorage.getItem(STORAGE_KEYS.persistedState);
  });
  expect(await read()).toBe(offline);
  await second.reload();
  expect(await read()).toBe(offline);
});

/**
 * Regression for a three-stage two-tab race: a newer localStorage fallback
 * must defeat a stale tab, then a later durable IndexedDB commit must defeat
 * the original fallback writer. Neither tab may claim a false save.
 */
test("two-tab fallback race preserves the latest durable winner across reloads", async ({ context }) => {
  test.setTimeout(120_000);
  const first = await probe(context);
  const second = await context.newPage();
  await second.goto(probePath);
  const initial = snapshot("original-indexeddb");
  const fallback = snapshot("newer-local-fallback");
  const stale = snapshot("rejected-stale-writer");
  const winner = snapshot("later-indexeddb-winner");
  const late = snapshot("rejected-former-fallback-writer");

  await first.evaluate(async (value) => {
    const { STORAGE_KEYS } = await import("/src/lib/brand.ts");
    const vault = await import("/src/lib/localVault.ts");
    const key = STORAGE_KEYS.persistedState;
    await vault.localVaultStorage.getItem(key);
    const checkpoint = vault.getVaultWriteCheckpoint();
    await vault.localVaultStorage.setItem(key, value);
    await vault.flushLocalVaultWrites();
    vault.assertVaultWritesSince(checkpoint);
  }, initial);
  expect(await second.evaluate(async () => {
    const { STORAGE_KEYS } = await import("/src/lib/brand.ts");
    const vault = await import("/src/lib/localVault.ts");
    return vault.localVaultStorage.getItem(STORAGE_KEYS.persistedState);
  })).toBe(initial);

  const hasFallback = await first.evaluate(async (value) => {
    const { STORAGE_KEYS } = await import("/src/lib/brand.ts");
    const vault = await import("/src/lib/localVault.ts");
    const key = STORAGE_KEYS.persistedState;
    const descriptor = Object.getOwnPropertyDescriptor(window, "indexedDB");
    Object.defineProperty(window, "indexedDB", { configurable: true, value: undefined });
    try {
      const checkpoint = vault.getVaultWriteCheckpoint();
      await vault.localVaultStorage.setItem(key, value);
      await vault.flushLocalVaultWrites();
      vault.assertVaultWritesSince(checkpoint);
      return localStorage.getItem(key) === value;
    } finally {
      if (descriptor) Object.defineProperty(window, "indexedDB", descriptor);
      else Reflect.deleteProperty(window, "indexedDB");
    }
  }, fallback);
  expect(hasFallback).toBe(true);

  const staleFailure = await second.evaluate(async (value) => {
    const { STORAGE_KEYS } = await import("/src/lib/brand.ts");
    const vault = await import("/src/lib/localVault.ts");
    const checkpoint = vault.getVaultWriteCheckpoint();
    await vault.localVaultStorage.setItem(STORAGE_KEYS.persistedState, value);
    await vault.flushLocalVaultWrites();
    try { vault.assertVaultWritesSince(checkpoint); return null; }
    catch (error) { return error instanceof Error ? error.message : String(error); }
  }, stale);
  expect(staleFailure).toContain("Another AXOM tab saved a newer workspace");

  // Reload clears only the stale tab's in-memory conflict latch. The legitimate
  // fallback is promoted from localStorage to IndexedDB without replacing data.
  await second.reload();
  expect(await second.evaluate(async () => {
    const { STORAGE_KEYS } = await import("/src/lib/brand.ts");
    const vault = await import("/src/lib/localVault.ts");
    return vault.localVaultStorage.getItem(STORAGE_KEYS.persistedState);
  })).toBe(fallback);
  await second.evaluate(async (value) => {
    const { STORAGE_KEYS } = await import("/src/lib/brand.ts");
    const vault = await import("/src/lib/localVault.ts");
    const checkpoint = vault.getVaultWriteCheckpoint();
    await vault.localVaultStorage.setItem(STORAGE_KEYS.persistedState, value);
    await vault.flushLocalVaultWrites();
    vault.assertVaultWritesSince(checkpoint);
  }, winner);

  const lateFailure = await first.evaluate(async (value) => {
    const { STORAGE_KEYS } = await import("/src/lib/brand.ts");
    const vault = await import("/src/lib/localVault.ts");
    const checkpoint = vault.getVaultWriteCheckpoint();
    await vault.localVaultStorage.setItem(STORAGE_KEYS.persistedState, value);
    await vault.flushLocalVaultWrites();
    try { vault.assertVaultWritesSince(checkpoint); return null; }
    catch (error) { return error instanceof Error ? error.message : String(error); }
  }, late);
  expect(lateFailure).toContain("Another AXOM tab saved a newer workspace");

  await first.reload();
  expect(await first.evaluate(async () => {
    const { STORAGE_KEYS } = await import("/src/lib/brand.ts");
    const vault = await import("/src/lib/localVault.ts");
    return vault.localVaultStorage.getItem(STORAGE_KEYS.persistedState);
  })).toBe(winner);
});
