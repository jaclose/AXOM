// Opt in with AXOM_PRIVATE_BUNDLE. No workspace seeding: first-run setup and
// the production library installer are the only writes preceding acceptance.
import { test as base, expect } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NoctyriumState } from "../src/lib/types";
// Incognito contexts have a separate, memory-based quota. A clean persistent
// profile exercises the same durable storage class as the user's normal app.
const test = base.extend({ context: async ({ playwright }, use) => {
  const profile = process.env.AXOM_PRIVATE_PROFILE ?? await mkdtemp(join(tmpdir(), "axom-private-acceptance-"));
  console.log("Acceptance profile", profile);
  const context = await playwright.chromium.launchPersistentContext(profile, {
    channel: process.env.AXOM_E2E_CHANNEL, headless: true, reducedMotion: "reduce",
    ...(process.env.AXOM_E2E_SOFTWARE_GRAPHICS === "1" ? { args: ["--disable-gpu"] } : {}),
    baseURL: process.env.AXOM_E2E_BASE_URL ?? "http://127.0.0.1:5187",
  });
  try { await use(context); } finally { await context.close(); }
} });
import { completeSetup } from "../scripts/setup-flow.mjs";
const folder = process.env.AXOM_PRIVATE_LIBRARY_DIR;
const bundle = folder ?? process.env.AXOM_PRIVATE_BUNDLE;
test.skip(!bundle, "Provide the prepared private bundle.");
test.use({ trace: "off", screenshot: "off", video: "off" });

test("prepared private collection installs through first run and remains usable after reload", async ({ page }) => {
  test.setTimeout(900_000);
  page.setDefaultTimeout(15_000);
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", e => { if (["error", "warning"].includes(e.type())) errors.push(e.text()); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#questions", { waitUntil: "networkidle" });
  await completeSetup(page, "Private library acceptance", { ifVisible: Boolean(process.env.AXOM_PRIVATE_PROFILE) });
  console.log("First-run setup complete");
  await page.evaluate(async () => { const dev = await (window as unknown as { __AXOM_DEV__: Promise<{ flushVault: () => Promise<void> }> }).__AXOM_DEV__; await dev.flushVault(); });
  await page.goto("/#questions");
  const promise = page.getByRole("dialog", { name: "A promise to yourself" });
  if (await promise.isVisible()) await promise.getByRole("button", { name: "Review later", exact: true }).click();
  const done = page.getByRole("button", { name: "Done", exact: true });
  if (await done.isVisible()) await done.click();
  // An optional real, exported workspace is restored through Settings into this
  // isolated profile. The user's browser database is never opened or edited.
  const backup = process.env.AXOM_PRIVATE_WORKSPACE_BACKUP;
  const progress = () => page.evaluate(async () => {
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<{ useStore: { getState: () => NoctyriumState } }> }).__AXOM_DEV__;
    const s = dev.useStore.getState();
    return { questions: s.questions.map(q => ({ id: q.id, stem: q.stem, notes: q.notes, attempts: q.attempts })), tracker: s.tracker };
  });
  if (backup) {
    await page.getByTitle("Settings", { exact: true }).click();
    await page.getByRole("tab", { name: "Emergency recovery", exact: true }).click();
    const input = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Import / restore", exact: true }).click();
    page.once("dialog", dialog => dialog.accept());
    await (await input).setFiles(backup);
    await expect(page.getByRole("dialog", { name: "Your AXOM Setup" })).toContainText("Restored", { timeout: 60_000 });
    await page.getByRole("button", { name: "Done", exact: true }).click();
  }
  const original = await progress();
  await page.getByText("Local collection transfer and source review", { exact: true }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: folder ? "Install prepared folder" : "Install prepared library", exact: true }).click();
  await (await chooser).setFiles(bundle!);
  console.log("Private bundle selected through file chooser");
  const library = page.getByRole("region", { name: "Prepared library", exact: true });
  let reportedBatch = -1;
  await expect.poll(async () => {
    const failure = (await library.getByRole("alert").allTextContents()).join(" ");
    if (failure) throw new Error(failure);
    const status = (await library.getByRole("status").allTextContents()).join(" ");
    const batch = Math.floor(Number(status.match(/(\d+) of/)?.[1] ?? -1) / 100);
    if (batch !== reportedBatch) { console.log(status); reportedBatch = batch; }
    return status;
  }, { timeout: 480_000, intervals: [1000] }).toContain("Library installed. Choose a course or create a quiz.");
  const installed = await progress();
  for (const question of original.questions) expect(installed.questions.find(q => q.id === question.id)).toEqual(question);
  for (const activity of original.tracker) expect(installed.tracker.find(t => t.id === activity.id)).toEqual(activity);
  if (backup) console.log("Existing workspace preserved", JSON.stringify({ questions: original.questions.length, activities: original.tracker.length, attempts: original.questions.reduce((n, q) => n + q.attempts.length, 0) }));
  const counts = async () => {
    await expect(page.locator(".shell")).toBeAttached();
    await expect(page.getByRole("heading", { name: "AXOM could not finish opening" })).toHaveCount(0);
    await page.waitForFunction(async () => {
      const dev = await (window as unknown as { __AXOM_DEV__: Promise<{ useStore: { persist: { hasHydrated: () => boolean } } }> }).__AXOM_DEV__;
      return dev.useStore.persist.hasHydrated();
    }, undefined, { timeout: 30_000 });
    return page.evaluate(async () => {
    type S = { documents: { fileType: string }[]; questions: { id: string; attachments?: unknown[]; attempts: unknown[] }[]; questionSets: unknown[]; tracker: { templateKey?: string }[] };
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<{ useStore: { getState: () => S; persist: { hasHydrated: () => boolean; onFinishHydration: (callback: () => void) => () => void } }; flushVault: () => Promise<void> }> }).__AXOM_DEV__;
    await dev.flushVault(); const s = dev.useStore.getState();
    return { templates: s.documents.filter(d => d.fileType === "axom-course-template").length, questions: s.questions.length, sets: s.questionSets.length, media: s.questions.filter(q => q.attachments?.length).length, activities: s.tracker.filter(t => t.templateKey).length, attempts: s.questions.reduce((n,q) => n+q.attempts.length,0) };
    });
  };
  const before = await counts();
  expect(before.templates).toBeGreaterThan(20); expect(before.questions).toBeGreaterThan(32); if (!process.env.AXOM_PRIVATE_PROFILE && !backup) expect(before.activities).toBe(0); expect(before.media).toBeGreaterThan(0);
  await page.screenshot({ path: "/tmp/axom-private-qbank-desktop.png" });
  await page.goto("/#tracker");
  await page.getByRole("button", { name: "Course Library / Load Course", exact: true }).click();
  await page.getByRole("button", { name: /^FTM 1,/ }).click();
  const course = page.getByRole("dialog", { name: "FTM 1", exact: true });
  await expect(course).toContainText("Template version");
  await expect(course.getByText("Week 1", { exact: true })).toBeVisible();
  await course.getByTestId("load-course").click();
  await expect(course.getByRole("status")).toContainText(/Saved on this device|Already in your Course Tracker/);
  const loaded = await counts(); expect(loaded.activities).toBeGreaterThan(0);
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Course Library / Load Course", exact: true }).click();
  await page.getByRole("button", { name: /^FTM 1,/ }).click();
  await course.getByTestId("load-course").click();
  expect((await counts()).activities).toBe(loaded.activities);
  await page.screenshot({ path: "/tmp/axom-private-course-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(course.getByTestId("load-course")).toBeInViewport();
  await page.screenshot({ path: "/tmp/axom-private-course-mobile.png" });
  await page.goto("/#questions");
  await page.getByRole("button", { name: /^GOER,/ }).click();
  const bank = page.getByRole("dialog", { name: "GOER", exact: true });
  const single = (await bank.getByRole("checkbox").all());
  let selected = false;
  for (const box of single) if (await box.isEnabled()) { if (!selected) { await box.check(); selected = true; } else await box.uncheck(); }
  await bank.getByTestId("start-practice").click();
  const setup = page.getByRole("dialog", { name: "Set up a tutor block" });
  await expect(setup.getByRole("region", { name: "Practice source" })).not.toContainText("Whole question bank");
  await setup.getByLabel("Custom question count").fill("1");
  await setup.getByRole("button", { name: "Start tutor block", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Set up a tutor block" })).toHaveCount(0);
  await page.screenshot({ path: "/tmp/axom-private-quiz-mobile.png" });
  await page.getByLabel("Question stem", { exact: true }).focus();
  await page.keyboard.press("A"); await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Finish block", exact: true }).click();
  await page.getByRole("button", { name: "Review answers and Decode", exact: true }).click();
  const review = page.getByRole("dialog", { name: "Review saved block", exact: true });
  await expect(review).toContainText("Your answer: A");
  await review.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await counts(); await page.reload({ waitUntil: "networkidle" });
  expect((await counts()).attempts).toBe(before.attempts + 1);
  const selection = await page.evaluate(async () => {
    type Q = { id: string; module?: string; attachments?: { role?: string }[] };
    type BankSet = { title: string; questionIds: string[]; scope?: { module?: string } };
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<{ useStore: { getState: () => { questions: Q[]; questionSets: BankSet[] } } }> }).__AXOM_DEV__;
    const state = dev.useStore.getState();
    const sets = state.questionSets.filter(s => s.scope?.module === "GOER");
    const media = sets.find(s => s.questionIds.some(id => state.questions.find(q => q.id === id)?.attachments?.some(a => ["question", "stem", "choice"].includes(a.role ?? ""))));
    if (!media) throw new Error("The prepared GOER bank has no question figures.");
    const other = sets.find(s => s !== media)!;
    return { titles: [media.title, other.title], count: new Set([...media.questionIds,...other.questionIds]).size };
  });
  await page.getByRole("button", { name: /^GOER,/ }).click();
  const boxes = bank.getByRole("checkbox");
  for (const box of await boxes.all()) if (await box.isEnabled()) await box.uncheck();
  for (const title of selection.titles) await bank.getByLabel(`Practise from ${title}`, { exact: true }).check();
  await bank.getByRole("spinbutton").fill(String(selection.count));
  await bank.getByTestId("start-practice").click();
  await expect(setup.getByRole("region", { name: "Practice source" })).toContainText("2 selected sets");
  await setup.getByLabel("Custom question count").fill(String(selection.count));
  await setup.getByRole("button", { name: "Start tutor block", exact: true }).click();
  let imageSeen = false;
  for (let index = 0; index < selection.count; index++) {
    const stem = page.getByLabel("Question stem", { exact: true });
    await expect(stem).toBeVisible();
    await expect(stem.getByText("Loading figure…", { exact: true })).toHaveCount(0);
    if (await stem.locator("img").count()) {
      imageSeen = true;
      await expect.poll(() => stem.locator("img").first().evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
      await page.screenshot({ path: "/tmp/axom-private-image-question-mobile.png" });
    }
    await stem.focus(); await page.keyboard.press("A"); await page.keyboard.press("Enter");
    await page.getByRole("button", { name: index === selection.count - 1 ? "Finish block" : "Next question", exact: true }).click();
  }
  expect(imageSeen).toBe(true);
  await page.getByRole("button", { name: "Review answers and Decode", exact: true }).click();
  await expect(review).toContainText("Your answer: A");
  await page.screenshot({ path: "/tmp/axom-private-results-mobile.png" });
  await review.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  const studied = await counts(); console.log("Study results saved", JSON.stringify(studied)); await page.reload({ waitUntil: "networkidle" });
  expect((await counts()).attempts).toBe(studied.attempts);
  expect(studied.attempts).toBe(before.attempts + selection.count + 1);
  const repeat = page.waitForEvent("filechooser");
  if (!await library.isVisible()) await page.getByText("Local collection transfer and source review", { exact: true }).click();
  await page.getByRole("button", { name: folder ? "Install prepared folder" : "Update library", exact: true }).click();
  await (await repeat).setFiles(bundle!);
  await expect(library.getByRole("status")).toContainText("Library installed.", { timeout: 300_000 });
  expect(await counts()).toEqual(studied);
  expect(errors).toEqual([]);
  console.log("Private library acceptance counts", JSON.stringify(await counts()));
});
