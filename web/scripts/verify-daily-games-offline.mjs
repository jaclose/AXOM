/* global URL, caches, fetch, localStorage, navigator, performance, process, setTimeout, window */
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { chromium } from "@playwright/test";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const port = Number(process.env.AXOM_OFFLINE_VERIFY_PORT ?? 5191);
const origin = `http://127.0.0.1:${port}`;
const vite = join(root, "node_modules", "vite", "bin", "vite.js");
const distIndex = join(root, "dist", "index.html");

await access(distIndex).catch(() => {
  throw new Error("Offline verification requires a production build. Run npm run build first.");
});

const preview = spawn(process.execPath, [vite, "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
});
let previewOutput = "";
preview.stdout.on("data", (chunk) => { previewOutput += String(chunk); });
preview.stderr.on("data", (chunk) => { previewOutput += String(chunk); });

let browser;
try {
  await waitForServer(origin);
  browser = await chromium.launch({ headless: true, ...(process.env.AXOM_BROWSER_CHANNEL ? { channel: process.env.AXOM_BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto(`${origin}/#daily-word`, { waitUntil: "networkidle" });
  await completeOnboarding(page);
  await page.evaluate(() => { window.location.hash = "daily-word"; });
  await page.getByRole("heading", { level: 1, name: "AXOM Daily Word" }).waitFor();

  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // The accepted worker is installed by the initial bootstrap, so that first
  // navigation predates worker control. One online controlled navigation is
  // the honest boundary before asserting offline reopening of fetched assets.
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));

  await page.keyboard.type("FOXES");
  await page.keyboard.press("Enter");
  await page.getByRole("gridcell", { name: /Row 1, column 1, letter F/ }).waitFor();

  // Cache writes are intentionally best-effort and happen just after the
  // successful network response, so observe their completion before going
  // offline instead of racing the fetch handler's CacheStorage promise.
  await page.waitForFunction(async () => {
    const assets = performance.getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((name) => /DailyWordPage-.*\.js$|dailyWordWords-.*\.js$/.test(name));
    if (assets.length < 2) return false;
    return (await Promise.all(assets.map((url) => caches.match(url, { ignoreVary: true })))).every(Boolean);
  });

  const cached = await page.evaluate(async () => {
    const assets = performance.getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((name) => /DailyWordPage-.*\.(?:js|css)$|dailyWordWords-.*\.js$/.test(name));
    const checks = await Promise.all(assets.map(async (url) => ({
      url,
      cached: Boolean(await caches.match(url, { ignoreVary: true })),
    })));
    const cacheNames = await caches.keys();
    const cacheEntries = Object.fromEntries(await Promise.all(cacheNames.map(async (name) => {
      const cache = await caches.open(name);
      return [name, (await cache.keys()).map((request) => request.url)];
    })));
    return { cacheNames, cacheEntries, checks };
  });
  const engine = cached.checks.find((entry) => /DailyWordPage-.*\.js$/.test(entry.url));
  const words = cached.checks.find((entry) => /dailyWordWords-.*\.js$/.test(entry.url));
  if (!engine?.cached || !words?.cached) {
    throw new Error(`Lazy Daily Word assets were not cached after first load: ${JSON.stringify(cached)}`);
  }

  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { level: 1, name: "AXOM Daily Word" }).waitFor();
  await page.getByRole("gridcell", { name: /Row 1, column 1, letter F/ }).waitFor();

  const privacy = await page.evaluate(() => ({
    offline: navigator.onLine === false,
    workspaceKeys: Object.keys(localStorage).filter((key) => key === "noctyrium-state" || key.startsWith("noctyrium-state:user:")),
  }));
  if (!privacy.offline || privacy.workspaceKeys.length) {
    throw new Error(`Offline/privacy verification failed: ${JSON.stringify(privacy)}`);
  }

  process.stdout.write(`Daily Games offline reopening: ${JSON.stringify({
    cacheNames: cached.cacheNames,
    assets: cached.checks.map((entry) => new URL(entry.url).pathname.split("/").at(-1)),
    submittedGuessRestored: true,
    workspaceLocalStorageKeys: privacy.workspaceKeys,
  })}\n`);
  await context.setOffline(false);
  await context.close();
} catch (error) {
  if (preview.exitCode !== null) {
    throw new Error(`Production preview exited early.\n${previewOutput}`, { cause: error });
  }
  throw error;
} finally {
  await browser?.close();
  preview.kill("SIGTERM");
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (preview.exitCode !== null) throw new Error(`Production preview failed to start.\n${previewOutput}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Preview is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 125));
  }
  throw new Error(`Timed out waiting for production preview.\n${previewOutput}`);
}

async function completeOnboarding(page) {
  const name = page.getByLabel("Display name (optional)");
  if (!await name.isVisible().catch(() => false)) return;
  await name.fill("AXOM Offline Verification");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Finish setup", exact: true }).click();
}
