import { createHash } from "node:crypto";
import type { Page } from "@playwright/test";
import { test, expect, seedOnboarded, reloadAfterSave } from "./fixtures";
import type { PreparedBank } from "../src/lib/privateLibrary/types";
interface DevHarness {
  flushVault: () => Promise<void>;
  useStore: { getState: () => {
    documents: Array<{ fileType?: string }>;
    tracker: Array<{ templateKey?: string }>;
    questions: Array<{ attempts: unknown[] }>;
  } };
}
const origin = "https://catalog-test.supabase.co";
const release = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
async function catalogBackend(page: Page) {
  // SDK/browser contract fixture, not hosted Supabase acceptance.
  const template = Buffer.from("T5 - GOER - Lectures:\nWeek 2:\nLecture 01 Synthetic catalog example [Lecture]\n");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const bank: PreparedBank = { pkg: { manifest: { schemaVersion: 1, course: { name: "GOER", term: 5, week: 2 },
    bank: { id: "shared-catalog-test", title: "Synthetic published set", discipline: "Test" },
    source: { filename: "synthetic.txt", sourceWeekDeclared: true }, questionsFile: "questions.json", assetsDirectory: "assets" },
    questions: [{ id: "shared-q1", source: { filename: "synthetic.txt", questionNumber: 1 },
      stem: [{ type: "text", text: "Which label appears first in the ordered pair A, B?" }, { type: "image", assetId: "figure", role: "question", alt: "Synthetic test image" }],
      choices: [{ id: "a", label: "A", blocks: [{ type: "text", text: "A" }] }, { id: "b", label: "B", blocks: [{ type: "text", text: "B" }] }],
      correctAnswer: { labels: ["A"], evidence: "printed-key" }, explanation: [{ type: "text", text: "A precedes B in the supplied pair." }],
      assets: [{ id: "figure", filename: "figure.png", mimeType: "image/png", width: 1, height: 1, role: "question", questionId: "shared-q1", checksum: `sha256:${hash(png)}` }],
      provenance: { method: "authored", sourceChecksum: `sha256:${hash("synthetic-source")}` } }] },
    issues: [], sourceText: { rawText: "A precedes B in the supplied pair." }, sourceBytes: 32, notes: [] };
  const files = new Map([
    ["templates/test.txt", { bytes: template, mime: "text/plain" }],
    ["banks/test/bank.json", { bytes: Buffer.from(JSON.stringify(bank)), mime: "application/json" }],
    ["banks/test/assets/figure.png", { bytes: png, mime: "image/png" }],
  ]);
  const common = { release_id: release, module: "GOER", term: "Term 5", week: 2, source_label: "synthetic.txt" };
  const entries = [
    { ...common, id: "template", kind: "template", title: "GOER lectures", question_count: 0, image_question_count: 0, activity_count: 1, payload_path: "templates/test.txt" },
    { ...common, id: "bank", kind: "bank", title: "Synthetic published set", question_count: 1, image_question_count: 1, activity_count: 0, payload_path: "banks/test/bank.json" },
  ];
  const requests: string[] = [];
  await page.addInitScript(url => {
    (window as Window & { __AXOM_E2E_ACCOUNT__?: { url: string; key: string } }).__AXOM_E2E_ACCOUNT__ = { url, key: "synthetic-public-test-key" };
  }, origin);
  await page.route(`${origin}/**`, async route => {
    const request = route.request(), url = new URL(request.url());
    const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" };
    if (request.method() === "OPTIONS") { await route.fulfill({ status: 204, headers }); return; }
    requests.push(url.pathname);
    const json = (value: unknown, status = 200) => route.fulfill({ status, headers, contentType: "application/json", body: JSON.stringify(value) });
    if (url.pathname.endsWith("/academic_catalog_releases")) { await json([{ id: release, catalog_key: "test", version: "1", title: "Synthetic library", published_at: "2026-10-10T00:00:00Z" }]); return; }
    if (url.pathname.endsWith("/academic_catalog_entries")) { await json(entries); return; }
    if (url.pathname.endsWith("/academic_catalog_files")) {
      const path = (url.searchParams.get("path") ?? "").replace(/^eq\./, ""), file = files.get(path);
      await json(file ? { release_id: release, path, storage_path: `${release}/${path}`, sha256: hash(file.bytes), byte_size: file.bytes.length, mime_type: file.mime } : { message: "Missing fixture file" }, file ? 200 : 404); return;
    }
    const marker = `/${release}/`, index = url.pathname.indexOf(marker);
    if (url.pathname.startsWith("/storage/v1/object/sign/academic-catalog/") && index >= 0) {
      const path = decodeURIComponent(url.pathname.slice(index + marker.length)), file = files.get(path);
      if (!file) { await json({ message: "Missing asset" }, 404); return; }
      if (request.method() === "POST") { await json({ signedURL: `/object/sign/academic-catalog/${release}/${path}?token=synthetic` }); return; }
      await route.fulfill({ status: 200, headers, contentType: file.mime, body: file.bytes }); return;
    }
    await json({ message: "Unexpected test request" }, 404);
  });
  return requests;
}
for (const width of [1440, 390]) test(`shared catalog loads course and image quiz without an import at ${width}px`, async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const requests = await catalogBackend(page);
  await seedOnboarded(page); await page.goto("/#tracker");
  await page.getByRole("button", { name: "Course Library / Load Course", exact: true }).click();
  const courses = page.getByRole("region", { name: "Cloud course bookshelf", exact: true });
  await courses.getByRole("button", { name: /^GOER,/ }).click();
  const book = page.getByRole("dialog", { name: "GOER", exact: true });
  await book.getByRole("button", { name: "Load Course", exact: true }).click();
  await expect(book.getByRole("status")).toContainText("Course loaded");
  await page.goto("/#questions");
  const banks = page.getByRole("region", { name: "Cloud question bookshelf", exact: true });
  await banks.getByRole("button", { name: /^GOER,/ }).click();
  await book.getByRole("button", { name: "Create Quiz", exact: true }).click();
  await page.getByRole("button", { name: "Start tutor block", exact: true }).click();
  const stem = page.getByLabel("Question stem", { exact: true });
  await expect(stem).toContainText("ordered pair");
  await expect.poll(() => stem.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1);
  await stem.focus(); await page.keyboard.press("A"); await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Finish block", exact: true }).click();
  await page.getByRole("button", { name: "Review answers and Decode", exact: true }).click();
  const review = page.getByRole("dialog", { name: "Review saved block", exact: true });
  await expect(review).toContainText("Your answer: A");
  await review.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await reloadAfterSave(page);
  const state = await page.evaluate(async () => {
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<DevHarness> }).__AXOM_DEV__;
    await dev.flushVault(); const s = dev.useStore.getState();
    return { templates: s.documents.filter(d => d.fileType === "axom-course-template").length,
      activities: s.tracker.filter(t => t.templateKey).length,
      questions: s.questions.length, attempts: s.questions.reduce((n, q) => n + q.attempts.length, 0) };
  });
  expect(state).toEqual({ templates: 1, activities: 1, questions: 1, attempts: 1 });
  expect(requests.some(path => path.includes("/object/sign/"))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
