// Synthetic HTTP transport with real frontend import/save paths. This is not
// hosted-account, live RLS, or real-corpus publication acceptance.
import { test, expect, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { completeSetup } from "../scripts/setup-flow.mjs";
const host = "https://catalog-fixture.supabase.test";
const release = "11111111-1111-4111-8111-111111111111";
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const template = Buffer.from("T5 - GOER - Course activities:\nWeek 2:\nSynthetic lecture [Lecture]\nSynthetic practice [PQ]\n");
const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=", "base64");
const stem = "This is a synthetic software test question, not medical teaching material. A learner is shown the small reference image below. The fixture defines option A as the expected answer so that the application can verify its question, image, answer, and persistence pipeline. Which option is specified as the expected answer in this fixture?";
const bank = Buffer.from(JSON.stringify({ pkg: {
  manifest: { schemaVersion: 1, course: { name: "GOER", term: 5, week: 2 }, bank: { id: "cloud-goer-synthetic", title: "Shared sample set", discipline: "General" }, source: { filename: "synthetic-fixture.txt", sourceWeekDeclared: true }, questionsFile: "questions.json", assetsDirectory: "assets/" },
  questions: [{ id: "q1", source: { filename: "synthetic-fixture.txt", page: 1, questionNumber: 1 },
    stem: [{ type: "text", text: stem }, { type: "image", assetId: "img1", alt: "Synthetic reference image" }],
    choices: ["A", "B", "C", "D", "E"].map(label => ({ id: label, label, blocks: [{ type: "text", text: `Option ${label}` }] })),
    correctAnswer: { labels: ["A"], evidence: "reviewer" }, explanation: [{ type: "text", text: "This synthetic fixture explicitly defines A as the correct option. It carries no clinical claim." }],
    assets: [{ id: "img1", filename: "image.png", mimeType: "image/png", width: 1, height: 1, byteSize: image.length, role: "stem", questionId: "q1", checksum: `sha256:${digest(image)}`, derivation: "authored" }],
    provenance: { method: "authored", sourceChecksum: `sha256:${digest(Buffer.from(stem))}` } }],
}, issues: [], sourceText: { rawText: stem }, sourceBytes: Buffer.byteLength(stem), notes: [] }));
const files: Record<string, { bytes: Buffer; mime: string }> = {
  "templates/test.txt": { bytes: template, mime: "text/plain" },
  "banks/test/bank.json": { bytes: bank, mime: "application/json" },
  "banks/test/assets/image.png": { bytes: image, mime: "image/png" },
};
const base = { release_id: release, module: "GOER", term: "Term 5", week: 2, source_label: "synthetic-fixture.txt" };
const entries = [
  { ...base, id: "template-a", kind: "template", title: "GOER course plan", question_count: 0, image_question_count: 0, activity_count: 2, payload_path: "templates/test.txt" },
  { ...base, id: "bank-a", kind: "bank", title: "Shared sample set", question_count: 1, image_question_count: 1, activity_count: 0, payload_path: "banks/test/bank.json" },
];
async function transport(page: Page) {
  await page.addInitScript(({ url }) => {
    (window as unknown as { __AXOM_E2E_ACCOUNT__: { url: string; key: string } }).__AXOM_E2E_ACCOUNT__ = { url, key: "synthetic-anon-test-key" };
  }, { url: host });
  await page.route(`${host}/**`, async route => {
    const request = route.request(), url = new URL(request.url());
    const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "content-type": "application/json" };
    if (request.method() === "OPTIONS") { await route.fulfill({ status: 204, headers }); return; }
    if (url.pathname === "/rest/v1/academic_catalog_releases") { await route.fulfill({ headers, json: [{ id: release, catalog_key: "synthetic", title: "Synthetic test catalog", version: "1", published_at: "2026-10-10T00:00:00Z" }] }); return; }
    if (url.pathname === "/rest/v1/academic_catalog_entries") { await route.fulfill({ headers, json: entries }); return; }
    if (url.pathname === "/rest/v1/academic_catalog_files") {
      const path = (url.searchParams.get("path") ?? "").replace(/^eq\./, ""), file = files[path];
      if (!file) { await route.fulfill({ status: 404, headers, json: { message: "Missing fixture" } }); return; }
      await route.fulfill({ headers, json: { release_id: release, path, storage_path: `${release}/${path}`, sha256: digest(file.bytes), byte_size: file.bytes.length, mime_type: file.mime } }); return;
    }
    const prefix = `/storage/v1/object/sign/academic-catalog/${release}/`;
    if (url.pathname.startsWith(prefix)) {
      const path = decodeURIComponent(url.pathname.slice(prefix.length));
      if (request.method() === "POST") { await route.fulfill({ headers, json: { signedURL: `/object/sign/academic-catalog/${release}/${path}?token=synthetic` } }); return; }
      const file = files[path];
      if (file) { await route.fulfill({ status: 200, headers: { ...headers, "content-type": file.mime }, body: file.bytes }); return; }
    }
    await route.fulfill({ status: 404, headers, json: { message: "Unexpected synthetic request" } });
  });
}
async function open(page: Page) {
  await transport(page);
  await page.goto("/#questions", { waitUntil: "networkidle" });
  await completeSetup(page, "Shared library acceptance");
  await page.goto("/#questions", { waitUntil: "networkidle" });
  const promise = page.getByRole("dialog", { name: "A promise to yourself" });
  if (await promise.isVisible()) await promise.getByRole("button", { name: "Review later", exact: true }).click();
}
async function readState(page: Page) {
  await expect(page.locator(".shell")).toBeAttached();
  return page.evaluate(async () => {
    const { useStore, flushVault } = await (window as unknown as { __AXOM_DEV__: Promise<{ flushVault: () => Promise<void>; useStore: { getState: () => { tracker: { templateKey?: string }[]; questions: { attempts: unknown[]; attachments?: unknown[] }[] } } }> }).__AXOM_DEV__;
    await flushVault(); const s = useStore.getState();
    return { activities: s.tracker.filter(t => t.templateKey).length, questions: s.questions.length, images: s.questions.filter(q => q.attachments?.length).length, attempts: s.questions.reduce((n,q) => n + q.attempts.length, 0) };
  });
}
test("published course and image-rich set work without folder import", async ({ page }, info) => {
  test.setTimeout(120_000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  await page.goto("/#tracker", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Course Library / Load Course", exact: true }).click();
  const courseCatalog = page.getByRole("region", { name: "Published course catalog" });
  await courseCatalog.getByRole("button", { name: /^GOER,/ }).click();
  const book = page.getByRole("dialog", { name: "GOER", exact: true });
  await book.getByRole("button", { name: "Load Course", exact: true }).click();
  await expect(book.getByRole("status")).toContainText("Course loaded", { timeout: 20_000 });
  const loaded = await readState(page); expect(loaded.activities).toBe(2);
  await book.getByRole("button", { name: "Load Course", exact: true }).click();
  await expect(book.getByRole("status")).toContainText("already in your tracker");
  expect((await readState(page)).activities).toBe(loaded.activities);
  await page.screenshot({ path: info.outputPath("course-desktop.png"), fullPage: true });
  await page.goto("/#questions", { waitUntil: "networkidle" });
  const shared = page.getByRole("region", { name: "Published question catalog" });
  await expect(shared.getByRole("button", { name: /^GOER,/ })).toBeVisible();
  await page.screenshot({ path: info.outputPath("catalog-desktop.png"), fullPage: true });
  await shared.getByRole("button", { name: /^GOER,/ }).click();
  await book.getByRole("checkbox").uncheck();
  await expect(book.getByRole("button", { name: "Create Quiz" })).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await book.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath("catalog-mobile.png"), fullPage: true });
  await book.getByRole("checkbox").check();
  await book.getByRole("spinbutton").fill("1");
  await book.getByRole("button", { name: "Create Quiz", exact: true }).click();
  const setup = page.getByRole("dialog", { name: "Set up a tutor block", exact: true });
  await expect(setup).toBeVisible({ timeout: 20_000 });
  await expect(setup.getByRole("region", { name: "Practice source" })).not.toContainText("Whole question bank");
  await setup.getByRole("button", { name: "Start tutor block", exact: true }).click();
  const question = page.getByLabel("Question stem", { exact: true });
  await expect(question).toBeVisible();
  await expect.poll(() => question.locator("img").first().evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await question.focus(); await page.keyboard.press("A"); await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Finish block", exact: true }).click();
  const answered = await readState(page); expect(answered.attempts).toBe(1); expect(answered.images).toBe(1);
  await page.reload({ waitUntil: "networkidle" });
  await expect(shared.getByRole("button", { name: /^GOER,/ })).toBeVisible();
  expect(await readState(page)).toEqual(answered);
  expect(errors).toEqual([]);
});
