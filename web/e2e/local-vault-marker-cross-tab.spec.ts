import { expect, test } from "@playwright/test";

/**
 * Real Chromium, two tabs in the same storage partition; no AXOM account,
 * learner state or production storage. Intercept only a synthetic HTML probe
 * so the app's autosave cannot interfere with the exact cross-tab event.
 */
test("local save marker status follows another tab's writes, removal and renewal", async ({ context }) => {
  await context.route("**/__axom_vault_marker_probe__", (route) => route.fulfill({
    status: 200,
    contentType: "text/html; charset=utf-8",
    body: "<!doctype html><html><head><title>Local vault status probe</title></head><body><output id='vault-status'></output></body></html>",
  }));
  const first = await context.newPage();
  const second = await context.newPage();
  await Promise.all([
    first.goto("/__axom_vault_marker_probe__"),
    second.goto("/__axom_vault_marker_probe__"),
  ]);

  await first.evaluate(async () => {
    const { STORAGE_KEYS } = await import("/src/lib/brand.ts");
    const vault = await import("/src/lib/vaultActivity.ts");
    window.localStorage.removeItem(STORAGE_KEYS.lastVaultWriteAt);
    window.localStorage.setItem(STORAGE_KEYS.persistedState, "{\"synthetic\":true}");
    const badge = document.getElementById("vault-status");
    if (!badge) throw new Error("Missing test-only status probe");
    const paint = () => { badge.textContent = vault.readLastVaultWrite() ? "saved" : "waiting"; };
    (window as Window & { __stopAxomMarkerProbe?: () => void }).__stopAxomMarkerProbe =
      vault.subscribeVaultWriteStatus(paint);
    paint();
  });
  await expect(first.locator("#vault-status")).toHaveText("waiting");

  await second.evaluate(async () => {
    const { markVaultWrite } = await import("/src/lib/vaultActivity.ts");
    markVaultWrite("indexeddb", new Date("2026-11-06T20:00:00.000Z"));
  });
  await expect(first.locator("#vault-status")).toHaveText("saved");
  await second.evaluate(async () => {
    const { invalidateVaultWrite } = await import("/src/lib/vaultActivity.ts");
    invalidateVaultWrite();
  });
  await expect(first.locator("#vault-status")).toHaveText("waiting");
  expect(await second.evaluate(async () => {
    const { STORAGE_KEYS } = await import("/src/lib/brand.ts");
    return window.localStorage.getItem(STORAGE_KEYS.persistedState);
  })).toBe('{"synthetic":true}');

  await second.evaluate(async () => {
    const { markVaultWrite } = await import("/src/lib/vaultActivity.ts");
    markVaultWrite("indexeddb", new Date("2026-11-06T20:00:00.200Z"));
  });
  await expect(first.locator("#vault-status")).toHaveText("saved");

  // Settings may unmount before another tab clears the marker. A subsequent
  // snapshot read must fail closed even without a live subscription.
  await first.evaluate(() => {
    (window as Window & { __stopAxomMarkerProbe?: () => void }).__stopAxomMarkerProbe?.();
  });
  await second.evaluate(async () => {
    const { STORAGE_KEYS } = await import("/src/lib/brand.ts");
    window.localStorage.removeItem(STORAGE_KEYS.lastVaultWriteAt);
  });
  const hiddenSnapshot = await first.evaluate(async () => {
    const { readLastVaultWrite } = await import("/src/lib/vaultActivity.ts");
    return readLastVaultWrite();
  });
  expect(hiddenSnapshot).toBeNull();
  await first.close();
  await second.close();
});

test("quota-blocked status metadata still receives real cross-tab invalidation", async ({ context }) => {
  await context.route("**/__axom_vault_marker_probe__", (route) => route.fulfill({
    status: 200,
    contentType: "text/html; charset=utf-8",
    body: "<!doctype html><html><body><output id='vault-status'></output></body></html>",
  }));
  const first = await context.newPage();
  const second = await context.newPage();
  await Promise.all([
    first.goto("/__axom_vault_marker_probe__"),
    second.goto("/__axom_vault_marker_probe__"),
  ]);
  const initial = await first.evaluate(async () => {
    const { STORAGE_KEYS } = await import("/src/lib/brand.ts");
    const vault = await import("/src/lib/vaultActivity.ts");
    window.localStorage.removeItem(STORAGE_KEYS.lastVaultWriteAt);
    window.localStorage.setItem(STORAGE_KEYS.persistedState, '{"synthetic":"untouched"}');
    const badge = document.getElementById("vault-status");
    if (!badge) throw new Error("Missing local status probe");
    const paint = () => { badge.textContent = vault.readLastVaultWrite() ? "saved" : "waiting"; };
    const stop = vault.subscribeVaultWriteStatus(paint);
    const nativeSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key: string, value: string) {
      if (key === STORAGE_KEYS.lastVaultWriteAt) throw new Error("simulated status-only quota");
      return nativeSet.call(this, key, value);
    };
    try { vault.markVaultWrite("indexeddb", new Date("2026-11-06T20:00:00.000Z")); }
    finally { Storage.prototype.setItem = nativeSet; }
    paint();
    (window as Window & { __stopAxomMarkerProbe?: () => void }).__stopAxomMarkerProbe = stop;
    return window.localStorage.getItem(STORAGE_KEYS.lastVaultWriteAt);
  });
  expect(initial).toBeNull();
  await expect(first.locator("#vault-status")).toHaveText("saved");
  await second.evaluate(async () => {
    (await import("/src/lib/vaultActivity.ts")).invalidateVaultWrite();
  });
  await expect(first.locator("#vault-status")).toHaveText("waiting");
  expect(await first.evaluate(async () => {
    const { STORAGE_KEYS } = await import("/src/lib/brand.ts");
    return window.localStorage.getItem(STORAGE_KEYS.persistedState);
  })).toBe('{"synthetic":"untouched"}');
  await first.close();
  await second.close();
});

test("quota-only receipt cannot show saved when BroadcastChannel is absent or throws", async ({ context }) => {
  await context.route("**/__axom_vault_marker_probe__", (route) => route.fulfill({
    status: 200, contentType: "text/html; charset=utf-8",
    body: "<!doctype html><html><body><output id='vault-status'></output></body></html>",
  }));
  for (const mode of ["missing", "throws"] as const) {
    const first = await context.newPage();
    const second = await context.newPage();
    await Promise.all([first.goto("/__axom_vault_marker_probe__"), second.goto("/__axom_vault_marker_probe__")]);
    const result = await first.evaluate(async (channelMode) => {
      Object.defineProperty(window, "BroadcastChannel", {
        configurable: true,
        value: channelMode === "missing" ? undefined : class RejectedChannel {
          constructor() { throw new Error("simulated BroadcastChannel rejection"); }
        },
      });
      const { STORAGE_KEYS } = await import("/src/lib/brand.ts");
      const vault = await import("/src/lib/vaultActivity.ts");
      window.localStorage.removeItem(STORAGE_KEYS.lastVaultWriteAt);
      window.localStorage.setItem(STORAGE_KEYS.persistedState, '{"synthetic":"preserved"}');
      const badge = document.getElementById("vault-status");
      if (!badge) throw new Error("Missing probe output");
      const paint = () => { badge.textContent = vault.readLastVaultWrite() ? "saved" : "waiting"; };
      const stop = vault.subscribeVaultWriteStatus(paint);
      const nativeSet = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key: string, value: string) {
        if (key === STORAGE_KEYS.lastVaultWriteAt) throw new Error("simulated marker quota");
        return nativeSet.call(this, key, value);
      };
      try { vault.markVaultWrite("indexeddb", new Date("2026-11-06T20:00:00.000Z")); }
      finally { Storage.prototype.setItem = nativeSet; }
      paint();
      stop();
      return { marker: window.localStorage.getItem(STORAGE_KEYS.lastVaultWriteAt),
        workspace: window.localStorage.getItem(STORAGE_KEYS.persistedState) };
    }, mode);
    expect(result.marker).toBeNull();
    expect(result.workspace).toBe('{"synthetic":"preserved"}');
    await expect(first.locator("#vault-status")).toHaveText("waiting");
    await second.evaluate(async () => { (await import("/src/lib/vaultActivity.ts")).invalidateVaultWrite(); });
    await expect(first.locator("#vault-status")).toHaveText("waiting");
    await first.close();
    await second.close();
  }
});
