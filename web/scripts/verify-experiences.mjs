// Opt-in live audit. No credentials, no source rewriting, no CSP bypass.
// node scripts/verify-experiences.mjs [output-directory]
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const catalog = JSON.parse(await readFile(new URL("../src/data/experiences/catalog.json", import.meta.url), "utf8"));
const output = resolve(process.argv[2] ?? "/tmp/axom-experiences-audit");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
try {
  for (const site of catalog) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const result = { id: site.id, url: site.url, checkedAt: new Date().toISOString(), errors };
    try {
      await page.route("http://127.0.0.1:53493/audit.html", (route) => route.fulfill({ contentType: "text/html", body: '<!doctype html><style>body{margin:0;background:#222}iframe{border:0;width:100vw;height:100vh}</style><iframe title="Experience audit" sandbox="allow-scripts allow-same-origin allow-pointer-lock" allow="camera \'none\'; microphone \'none\'; geolocation \'none\'; payment \'none\'; fullscreen \'none\'; autoplay \'none\'" referrerpolicy="no-referrer"></iframe>' }));
      await page.goto("http://127.0.0.1:53493/audit.html");
      const responsePromise = page.waitForResponse((response) => response.request().isNavigationRequest() && response.url().startsWith(new URL(site.url).origin), { timeout: 25_000 });
      await page.locator("iframe").evaluate((frame, url) => { frame.src = url; }, site.url);
      const response = await responsePromise;
      result.status = response.status();
      const headers = await response.allHeaders();
      result.frameOptions = headers["x-frame-options"] ?? null;
      result.frameAncestors = headers["content-security-policy"]?.match(/frame-ancestors[^;]*/)?.[0] ?? null;
      const frame = await page.locator("iframe").contentFrame();
      await frame.locator("body").waitFor({ state: "attached", timeout: 20_000 });
      await page.waitForFunction(() => document.querySelector("iframe")?.contentWindow !== null);
      // Asset loading must finish before screenshots; long-lived analytics are excluded.
      const child = page.frames().find((item) => item !== page.mainFrame());
      await child.waitForLoadState("load", { timeout: 20_000 }).catch(() => {});
      // WebGL and WASM applications often initialize after window.load.
      await page.waitForTimeout(6000);
      result.document = await child.evaluate(() => ({ title: document.title, canvas: document.querySelectorAll("canvas").length, text: document.body.innerText.slice(0, 220), controls: document.querySelectorAll("button,input,select,a").length }));
      result.loaded = result.status < 400 && !result.frameOptions && !result.frameAncestors && child.url().startsWith("https://") && errors.length === 0;
      await page.screenshot({ path: resolve(output, `${site.id}.png`) });
    } catch (error) { result.loaded = false; result.failure = String(error); }
    results.push(result);
    console.log(`${site.id}: ${result.loaded ? "LOADED" : "FAILED"} (${result.status ?? "no response"}) ${result.failure ?? ""}`);
    await context.close();
  }
} finally { await browser.close(); }
await writeFile(resolve(output, "report.json"), JSON.stringify(results, null, 2));
await writeFile(resolve(output, "index.html"), `<!doctype html><title>AXOM experience audit</title><style>body{background:#1d2024;color:#eee;font:14px system-ui;display:grid;grid-template-columns:repeat(4,1fr);gap:16px}figure{margin:0}img{width:100%}figcaption{padding:8px}</style>${results.map((row) => `<figure><img src="${row.id}.png"><figcaption>${row.id}: ${row.loaded ? "loaded" : "failed"}</figcaption></figure>`).join("")}`);
if (results.some((row) => !row.loaded)) process.exitCode = 1;
