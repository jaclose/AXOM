import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/**
 * Offline and real navigation lifecycle: synthetic same-origin HTML, Chromium
 * with actual browser IndexedDB. No AXOM sign-in or learner data is accessed.
 */
const path = "/__axom_vault_offline_lifecycle__";
async function makeProbe(context: BrowserContext): Promise<Page> {
  await context.route("**" + path + "**", (route) => route.fulfill({
    status: 200, contentType: "text/html; charset=utf-8",
    body: "<!doctype html><html><head><title>AXOM offline lifecycle probe</title></head><body></body></html>",
  }));
  const page = await context.newPage();
  await page.goto(path);
  return page;
}
const workspace = (tag: string) => JSON.stringify({
  version: 34,
  state: { profile: { userId: "synthetic-offline-probe" }, tag,
    documents: [{ id: "qa-document", rawText: "Ω🌲".repeat(4096) }] },
});

test("two loaded tabs reject stale offline writes and retain latest IndexedDB bytes after reconnect/reload", async ({ context }) => {
  const a = await makeProbe(context);
  const b = await context.newPage();
  await b.goto(path);
  const original = workspace("initial");
  const updated = workspace("saved-while-offline");
  const stale = workspace("stale-offline-tab");

  await a.evaluate(async (bytes) => {
    const { STORAGE_KEYS } = await import("/src/lib/brand.ts");
    const vault = await import("/src/lib/localVault.ts");
    const key = STORAGE_KEYS.persistedState;
    await vault.localVaultStorage.getItem(key);
    const checkpoint = vault.getVaultWriteCheckpoint();
    await vault.localVaultStorage.setItem(key, bytes);
    await vault.flushLocalVaultWrites();
    vault.assertVaultWritesSince(checkpoint);
  }, original);
  expect(await b.evaluate(async () => {
    const { STORAGE_KEYS } = await import("/src/lib/brand.ts");
    const vault = await import("/src/lib/localVault.ts");
    return vault.localVaultStorage.getItem(STORAGE_KEYS.persistedState);
  })).toBe(original);

  await context.setOffline(true);
  expect(await a.evaluate(() => navigator.onLine)).toBe(false);
  await a.evaluate(async (bytes) => {
    const { STORAGE_KEYS } = await import("/src/lib/brand.ts");
    const vault = await import("/src/lib/localVault.ts");
    const checkpoint = vault.getVaultWriteCheckpoint();
    await vault.localVaultStorage.setItem(STORAGE_KEYS.persistedState, bytes);
    await vault.flushLocalVaultWrites();
    vault.assertVaultWritesSince(checkpoint);
  }, updated);
  const staleAttempt = await b.evaluate(async (bytes) => {
    const { STORAGE_KEYS } = await import("/src/lib/brand.ts");
    const vault = await import("/src/lib/localVault.ts");
    const checkpoint = vault.getVaultWriteCheckpoint();
    await vault.localVaultStorage.setItem(STORAGE_KEYS.persistedState, bytes);
    await vault.flushLocalVaultWrites();
    try { vault.assertVaultWritesSince(checkpoint); return "incorrect-success"; }
    catch (error) { return error instanceof Error ? error.message : String(error); }
  }, stale);
  expect(staleAttempt).toContain("Another AXOM tab saved a newer workspace");
  expect(await a.evaluate(async () => {
    const { STORAGE_KEYS } = await import("/src/lib/brand.ts");
    const vault = await import("/src/lib/localVault.ts");
    return vault.localVaultStorage.getItem(STORAGE_KEYS.persistedState);
  })).toBe(updated);
  await context.setOffline(false);
  await Promise.all([a.reload(), b.reload()]);
  for (const page of [a, b]) {
    expect(await page.evaluate(async () => {
      const { STORAGE_KEYS } = await import("/src/lib/brand.ts");
      const vault = await import("/src/lib/localVault.ts");
      return vault.localVaultStorage.getItem(STORAGE_KEYS.persistedState);
    })).toBe(updated);
  }
});

test("actual navigation retires unpersisted quota-only saved badge but keeps workspace bytes", async ({ context }) => {
  const page = await makeProbe(context);
  const bytes = workspace("preserve-before-navigation");
  const initial = await page.evaluate(async (value) => {
    const { STORAGE_KEYS } = await import("/src/lib/brand.ts");
    const storage = await import("/src/lib/localVault.ts");
    const activity = await import("/src/lib/vaultActivity.ts");
    await storage.localVaultStorage.getItem(STORAGE_KEYS.persistedState);
    const checkpoint = storage.getVaultWriteCheckpoint();
    await storage.localVaultStorage.setItem(STORAGE_KEYS.persistedState, value);
    await storage.flushLocalVaultWrites();
    storage.assertVaultWritesSince(checkpoint);
    activity.invalidateVaultWrite();
    const originalSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, data: string) {
      if (key === STORAGE_KEYS.lastVaultWriteAt) throw new DOMException("synthetic metadata quota", "QuotaExceededError");
      return originalSet.call(this, key, data);
    };
    try { activity.markVaultWrite("indexeddb", new Date()); }
    finally { Storage.prototype.setItem = originalSet; }
    window.addEventListener("pagehide", (e) => {
      sessionStorage.setItem("__qa_pagehide", String(e.persisted));
    });
    window.addEventListener("pageshow", (e) => {
      sessionStorage.setItem("__qa_pageshow", String(e.persisted));
    });
    return {
      saved: activity.readLastVaultWrite() !== null,
      marker: localStorage.getItem(STORAGE_KEYS.lastVaultWriteAt),
    };
  }, bytes);
  expect(initial).toEqual({ saved: true, marker: null });

  // This is an actual browser navigation, not a synthetic PageTransitionEvent.
  // Browser cache eligibility varies; do not claim BFCache was used unless
  // pageshow.persisted was observed as true.
  await page.goto(path + "?detour=1");
  await page.goBack();
  const restored = await page.evaluate(async () => {
    const { STORAGE_KEYS } = await import("/src/lib/brand.ts");
    const storage = await import("/src/lib/localVault.ts");
    const activity = await import("/src/lib/vaultActivity.ts");
    return {
      saved: activity.readLastVaultWrite() !== null,
      marker: localStorage.getItem(STORAGE_KEYS.lastVaultWriteAt),
      bytes: await storage.localVaultStorage.getItem(STORAGE_KEYS.persistedState),
      pagehidePersisted: sessionStorage.getItem("__qa_pagehide"),
      pageshowPersisted: sessionStorage.getItem("__qa_pageshow"),
    };
  });
  expect(restored.saved).toBe(false);
  expect(restored.marker).toBeNull();
  expect(restored.bytes).toBe(bytes);
  expect(restored.pagehidePersisted).not.toBeNull();
  // An actual BFCache restore must produce a persisted=true pageshow on the
  // returning document. A normal history navigation can pass the durability
  // assertions but is NOT BFCache acceptance.
  expect(
    restored.pageshowPersisted,
    `BFCache was not observed (pagehide.persisted=${restored.pagehidePersisted}, pageshow.persisted=${restored.pageshowPersisted}); a passing navigation test cannot be reported as BFCache coverage.`,
  ).toBe("true");
});

test("offline burst with both storage backends exhausted fails closed, preserves prior save, and recovers", async ({ context }) => {
  const page = await makeProbe(context);
  const keyValue = workspace("confirmed-before-dual-exhaustion");
  const recovered = workspace("recovered-after-dual-exhaustion");
  await page.evaluate(async (value) => {
    const { STORAGE_KEYS } = await import("/src/lib/brand.ts");
    const vault = await import("/src/lib/localVault.ts");
    const key = STORAGE_KEYS.persistedState;
    await vault.localVaultStorage.getItem(key);
    const checkpoint = vault.getVaultWriteCheckpoint();
    await vault.localVaultStorage.setItem(key, value);
    await vault.flushLocalVaultWrites();
    vault.assertVaultWritesSince(checkpoint);
  }, keyValue);

  await context.setOffline(true);
  const failed = await page.evaluate(async (attempts) => {
    const { STORAGE_KEYS } = await import("/src/lib/brand.ts");
    const vault = await import("/src/lib/localVault.ts");
    const activity = await import("/src/lib/vaultActivity.ts");
    const key = STORAGE_KEYS.persistedState;
    const idbDescriptor = Object.getOwnPropertyDescriptor(window, "indexedDB");
    const originalSet = Storage.prototype.setItem;
    Object.defineProperty(window, "indexedDB", { configurable: true, value: undefined });
    Storage.prototype.setItem = function (name: string, value: string) {
      if (name === key) throw new DOMException("Synthetic storage exhausted", "QuotaExceededError");
      return originalSet.call(this, name, value);
    };
    try {
      const checkpoint = vault.getVaultWriteCheckpoint();
      for (const attempt of attempts) await vault.localVaultStorage.setItem(key, attempt);
      await vault.flushLocalVaultWrites();
      let acknowledged = false;
      let error = "";
      try { vault.assertVaultWritesSince(checkpoint); acknowledged = true; }
      catch (caught) { error = caught instanceof Error ? caught.message : String(caught); }
      return { acknowledged, error, failureVisible: activity.readVaultWriteFailure() !== null };
    } finally {
      Storage.prototype.setItem = originalSet;
      if (idbDescriptor) Object.defineProperty(window, "indexedDB", idbDescriptor);
      else Reflect.deleteProperty(window, "indexedDB");
    }
  }, Array.from({ length: 12 }, (_, i) => workspace("unsaved-offline-burst-" + i)));
  expect(failed.acknowledged).toBe(false);
  expect(failed.error).toMatch(/IndexedDB|fallback|quota/i);
  expect(failed.failureVisible).toBe(true);

  await context.setOffline(false);
  expect(await page.evaluate(async () => {
    const { STORAGE_KEYS } = await import("/src/lib/brand.ts");
    const vault = await import("/src/lib/localVault.ts");
    return vault.localVaultStorage.getItem(STORAGE_KEYS.persistedState);
  })).toBe(keyValue);

  await page.evaluate(async (value) => {
    const { STORAGE_KEYS } = await import("/src/lib/brand.ts");
    const vault = await import("/src/lib/localVault.ts");
    const checkpoint = vault.getVaultWriteCheckpoint();
    await vault.localVaultStorage.setItem(STORAGE_KEYS.persistedState, value);
    await vault.flushLocalVaultWrites();
    vault.assertVaultWritesSince(checkpoint);
  }, recovered);
  await page.reload();
  expect(await page.evaluate(async () => {
    const { STORAGE_KEYS } = await import("/src/lib/brand.ts");
    const vault = await import("/src/lib/localVault.ts");
    return vault.localVaultStorage.getItem(STORAGE_KEYS.persistedState);
  })).toBe(recovered);
});
