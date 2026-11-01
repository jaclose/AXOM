import type { Page } from "@playwright/test";
import type { NoctyriumState } from "../src/lib/types";
import type { QuestionRecord } from "../src/lib/questions";
import { STORAGE_KEYS } from "../src/lib/brand";
import { academicPublishFixture } from "./academicPublishFixture";
import { expect, reloadAfterSave, seedOnboarded, test } from "./fixtures";

type Dev = {
  useStore: { getState: () => NoctyriumState & { updateQuestion: (id: string, patch: Partial<QuestionRecord>) => void } };
  flushVault: () => Promise<void>;
};

async function savedState(page: Page) {
  return page.evaluate(async () => {
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<Dev> }).__AXOM_DEV__;
    await dev.flushVault();
    const state = dev.useStore.getState();
    return {
      tracker: state.tracker.map(item => item.id).sort(),
      questions: state.questions.map(question => ({ id: question.id, sourceId: question.content?.id })),
      references: state.documents.filter(document => document.fileType === "axom-academic-reference").map(document => {
        const reference = JSON.parse(document.rawText) as { accountId: string; collectionId: string; questionIds: string[]; pendingWeeks?: number[] };
        return { ...reference, id: document.id };
      }),
    };
  });
}

for (const width of [1440, 390]) test(`downloads and practices a complete term with stop, retry and saved receipts at ${width}px`, async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (["error", "warning"].includes(message.type())) errors.push(message.text()); });
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const backend = await academicPublishFixture(page);
  const unrelated = backend.seedCourse({ title: "Other term", module: "NCRS", term: 4 });
  const courses = Array.from({ length: 26 }, (_, index) => backend.seedCourse({
    title: `Term course ${String(index + 1).padStart(2, "0")}`, module: "GOER", term: 5,
    withPlan: index === 1, reviewQuestions: index === 3 ? 1 : 0,
  }));
  backend.corruptDownload(courses[2].id);
  await seedOnboarded(page);
  await page.goto("/?app=1&course-library=1#tracker");
  await expect(page.getByRole("heading", { name: "Course Library", level: 1 })).toBeVisible();

  // These real single-course downloads establish an existing on-device course
  // to skip and an unrelated term that must not enter the practice selection.
  for (const course of [unrelated, courses[0]]) {
    await page.locator(`[data-course-id="${course.id}"]`).click();
    const collection = page.getByRole("region", { name: `${course.module} question collection` });
    await collection.getByRole("button", { name: "Download questions", exact: true }).click();
    await expect(collection).toContainText("1 reviewed question is on this device.", { timeout: 30_000 });
    await collection.getByRole("button", { name: "All courses", exact: true }).click();
  }
  const baseline = await savedState(page);
  const section = page.locator(".course-term-section").filter({ has: page.getByRole("heading", { name: "Term 5", exact: true }) });
  const download = section.getByRole("button", { name: "Download Term 5", exact: true });
  const practice = section.getByRole("button", { name: "Practice Term 5", exact: true });
  await expect(download).toBeVisible();
  await expect(practice).toBeEnabled();
  const release = backend.holdDownload(courses[1].id);
  const initialAttempts = backend.downloadAttempts.length;
  try {
    // The keyboard path starts the operation; stopping waits safely for its
    // current course and never queues the next course behind it.
    await download.focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => backend.downloadAttempts.slice(initialAttempts)).toEqual([courses[1].id]);
    await expect(section).toContainText(/Downloading \d+ of \d+: GOER/);
    expect(backend.catalogRequests).toContainEqual({ search: "", term: "Term 5", afterId: courses[23].id });
    for (const theme of ["dark", "light"]) {
      await page.locator("html").evaluate((root, value) => root.setAttribute("data-theme", value), theme);
      await section.getByRole("heading", { name: "Term 5", exact: true }).scrollIntoViewIfNeeded();
      expect(await section.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      await page.screenshot({ path: `/tmp/axom-term-progress-${width}-${theme}.png` });
    }
    await section.getByRole("button", { name: "Stop", exact: true }).click();
    release();
    await expect(download).toBeEnabled();
    expect(backend.downloadAttempts.slice(initialAttempts)).toEqual([courses[1].id]);
    await expect.poll(async () => (await savedState(page)).references.length).toBe(3);
  } finally { release(); }

  await download.click();
  await expect.poll(async () => (await savedState(page)).references.length, { timeout: 60_000 }).toBe(26);
  await expect(download).toBeEnabled();
  await expect(section).toContainText("A course file failed its integrity check.");
  expect(backend.downloadAttempts.filter(id => id === courses[0].id)).toHaveLength(1);
  expect(backend.downloadAttempts.filter(id => id === courses[1].id)).toHaveLength(1);
  expect(backend.downloadAttempts).toContain(courses[25].id);
  expect((await savedState(page)).tracker).toEqual(baseline.tracker);
  expect(backend.calls.filter(call => call.endsWith("/rpc/academic_enroll"))).toEqual([]);
  await section.getByRole("heading", { name: "Term 5", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `/tmp/axom-term-failure-${width}.png` });

  // Only the failed course downloads again. The receipt and question identity
  // checks are repeated after a real IndexedDB save and browser reload.
  backend.recoverDownload(courses[2].id);
  const retryStart = backend.downloadAttempts.length;
  await download.click();
  await expect.poll(async () => (await savedState(page)).references.length, { timeout: 30_000 }).toBe(27);
  await expect(download).toBeEnabled();
  expect(backend.downloadAttempts.slice(retryStart)).toEqual([courses[2].id]);
  const saved = await savedState(page);
  expect(saved.questions).toHaveLength(27);
  expect(new Set(saved.questions.map(question => question.id)).size).toBe(27);
  expect(saved.references.every(reference => reference.accountId === "dddddddd-dddd-4ddd-8ddd-dddddddddddd" && !reference.pendingWeeks)).toBe(true);
  await reloadAfterSave(page);
  await expect(download).toBeVisible();
  expect(await savedState(page)).toEqual(saved);
  const repeatStart = backend.downloadAttempts.length;
  await download.click();
  await expect(download).toBeEnabled();
  expect(backend.downloadAttempts.slice(repeatStart)).toEqual([]);

  // A formerly ready question is now held for review. Term practice consults
  // its current readiness, not the catalog's old ready count or its receipt.
  const heldId = saved.questions.find(question => question.sourceId === courses[0].readyQuestionIds[0])!.id;
  await page.evaluate(async id => {
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<Dev> }).__AXOM_DEV__;
    dev.useStore.getState().updateQuestion(id, { needsReview: true });
    await dev.flushVault();
  }, heldId);
  const expectedIds = saved.references.filter(reference => reference.collectionId !== unrelated.id)
    .flatMap(reference => reference.questionIds).filter(id => id !== heldId).sort();
  expect(expectedIds).toHaveLength(25);
  for (const theme of ["dark", "light"]) {
    await page.locator("html").evaluate((root, value) => root.setAttribute("data-theme", value), theme);
    await practice.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `/tmp/axom-term-ready-${width}-${theme}.png` });
  }
  await practice.click();
  await expect(page).toHaveURL(/#questions/);
  await expect(page.getByLabel("Question stem", { exact: true })).toContainText("GOER");
  await expect.poll(() => page.evaluate(key => {
    const active = JSON.parse(localStorage.getItem(key) ?? "null") as { poolIds?: string[] } | null;
    return [...(active?.poolIds ?? [])].sort();
  }, STORAGE_KEYS.quizActiveSession)).toEqual(expectedIds);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("keeps a term download locked while an in-flight course finishes after preview navigation", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (["error", "warning"].includes(message.type())) errors.push(message.text()); });
  const backend = await academicPublishFixture(page);
  const first = backend.seedCourse({ title: "First course", module: "GOER", term: 5 });
  const second = backend.seedCourse({ title: "Second course", module: "GOER", term: 5 });
  const release = backend.holdDownload(first.id);
  await seedOnboarded(page);
  await page.goto("/?app=1&course-library=1#tracker");
  const download = page.getByRole("button", { name: "Download Term 5", exact: true });
  try {
    await download.click();
    await expect.poll(() => backend.downloadAttempts).toEqual([first.id]);
    await page.locator(`[data-course-id="${second.id}"]`).click();
    const preview = page.getByRole("region", { name: "GOER question collection" });
    await expect(preview).toBeVisible();
    await preview.getByRole("button", { name: "All courses", exact: true }).click();
    await expect(download).toBeDisabled();
    expect(backend.downloadAttempts).toEqual([first.id]);
    release();
    await expect(download).toBeEnabled();
    expect(backend.downloadAttempts).toEqual([first.id]);
    await expect.poll(async () => (await savedState(page)).references.length).toBe(1);
    await download.click();
    await expect.poll(async () => (await savedState(page)).references.length).toBe(2);
    await expect(download).toBeEnabled();
    expect(backend.downloadAttempts).toEqual([first.id, second.id]);
    expect(backend.calls.filter(call => call.endsWith("/rpc/academic_enroll"))).toEqual([]);
    expect(errors).toEqual([]);
  } finally { release(); }
});
