import type { Page } from "@playwright/test";
import { expect, reloadAfterSave, seedOnboarded, test } from "./fixtures";

// Several files at once. The ones that leave nothing to decide are accepted in
// one action and saved the way a reviewed file is; the one that needs an answer
// is held for the learner. Adding the same folder again adds nothing: accepted
// files are known, and a skipped file stays skipped. Invented content.

const question = (number: number, stem: string, options: string[], answer?: string, why?: string) => [
  `${number}. ${stem}`, ...options, ...(answer ? [`Answer: ${answer}`] : []), ...(why ? [`Explanation: ${why}`] : []),
].join("\n");

const THORAX = [
  question(1, "Which vessel carries oxygenated blood from the lungs to the heart?", ["A. Pulmonary vein", "B. Pulmonary artery", "C. Aorta", "D. Vena cava"], "A", "The pulmonary veins return oxygenated blood to the left atrium."),
  question(2, "Which nerve supplies the diaphragm?", ["A. Vagus nerve", "B. Phrenic nerve", "C. Intercostal nerve", "D. Accessory nerve"], "B", "The phrenic nerve arises from the third to fifth cervical roots."),
].join("\n\n");
const ENDOCRINE = question(1, "Which hormone lowers the concentration of glucose in blood?", ["A. Glucagon", "B. Cortisol", "C. Insulin", "D. Adrenaline"], "C", "Insulin moves glucose into muscle and fat.");
const UNANSWERED = question(1, "Which bone forms the heel of the foot?", ["A. Talus", "B. Calcaneus", "C. Navicular", "D. Cuboid"]);

const FILES = [
  { name: "FTM 1 Week 2 Quiz 1.txt", mimeType: "text/plain", buffer: Buffer.from(THORAX) },
  { name: "FTM 1 Week 3 Quiz 2.txt", mimeType: "text/plain", buffer: Buffer.from(ENDOCRINE) },
  { name: "FTM 1 Week 4 Quiz 3.txt", mimeType: "text/plain", buffer: Buffer.from(UNANSWERED) },
];

async function openQueue(page: Page) {
  await page.goto("/#questions");
  await page.getByRole("button", { name: "Add your own material", exact: true }).click();
  await page.getByRole("button", { name: "High-volume batch queue", exact: true }).click();
}

async function addFiles(page: Page, files: typeof FILES) {
  await page.getByLabel("Choose multiple question files").setInputFiles(files);
  await page.getByRole("button", { name: "Import files" }).click();
  await expect(page.getByText(`Processed ${files.length}/${files.length}`)).toBeVisible();
}

const row = (page: Page, name: string) => page.locator(".import-draft").filter({ hasText: name });

async function library(page: Page) {
  return page.evaluate(async () => {
    type State = {
      questions?: Array<{ module?: string; week?: number; correctKey?: string }>;
      questionSets?: Array<{ title: string; scope?: { module?: string; week?: number }; questionIds: string[] }>;
      documents?: Array<{ fileName: string }>;
    };
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<{ useStore: { getState: () => State } }> }).__AXOM_DEV__;
    const state = dev.useStore.getState();
    return {
      questions: (state.questions ?? []).length,
      sets: (state.questionSets ?? []).map((set) => ({ title: set.title, scope: set.scope, size: set.questionIds.length })).sort((a, b) => a.title.localeCompare(b.title)),
      documents: (state.documents ?? []).map((document) => document.fileName).sort(),
    };
  });
}

test("valid files are accepted together, and adding the same folder again adds nothing", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await seedOnboarded(page);
  await openQueue(page);
  await addFiles(page, FILES);

  // Each file says where it belongs, and the one that cannot be accepted says why.
  await expect(row(page, "FTM 1 Week 2 Quiz 1.txt")).toContainText("ready to accept");
  await expect(row(page, "FTM 1 Week 2 Quiz 1.txt")).toContainText("Mapped automatically");
  await expect(row(page, "FTM 1 Week 4 Quiz 3.txt")).toContainText("needs review");
  await expect(row(page, "FTM 1 Week 4 Quiz 3.txt")).toContainText("1 question has no certain answer.");
  await expect(row(page, "FTM 1 Week 4 Quiz 3.txt").getByRole("button", { name: /^Accept / })).toHaveCount(0);

  await page.getByRole("button", { name: "Accept all valid (2)" }).click();
  await expect(page.getByText("Accepted 2")).toBeVisible();
  await expect(row(page, "FTM 1 Week 2 Quiz 1.txt")).toContainText("2 questions saved");
  await expect(row(page, "FTM 1 Week 3 Quiz 2.txt")).toContainText("1 question saved");

  // Skip the one that is left. It is a decision, so it is remembered.
  await row(page, "FTM 1 Week 4 Quiz 3.txt").getByRole("button", { name: "Skip FTM 1 Week 4 Quiz 3.txt" }).click();
  await expect(row(page, "FTM 1 Week 4 Quiz 3.txt")).toContainText("skipped");

  await reloadAfterSave(page);
  const saved = await library(page);
  expect(saved.questions).toBe(3);
  expect(saved.sets).toEqual([
    { title: "FTM 1 Week 2 Quiz 1", scope: { courseId: expect.any(String), module: "FTM 1", week: 2 }, size: 2 },
    { title: "FTM 1 Week 3 Quiz 2", scope: { courseId: expect.any(String), module: "FTM 1", week: 3 }, size: 1 },
  ]);
  expect(saved.documents).toEqual(["FTM 1 Week 2 Quiz 1.txt", "FTM 1 Week 3 Quiz 2.txt"]);

  // The same folder, added again in a new session.
  await openQueue(page);
  await addFiles(page, FILES);
  await expect(row(page, "FTM 1 Week 2 Quiz 1.txt")).toContainText("already imported");
  await expect(row(page, "FTM 1 Week 3 Quiz 2.txt")).toContainText("already imported");
  await expect(row(page, "FTM 1 Week 4 Quiz 3.txt")).toContainText("skipped");
  await expect(row(page, "FTM 1 Week 4 Quiz 3.txt").getByRole("button", { name: "Review FTM 1 Week 4 Quiz 3.txt anyway" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Accept all valid/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Accept FTM/ })).toHaveCount(0);

  // Opening an already imported file shows its questions unselected, with the reason.
  await row(page, "FTM 1 Week 2 Quiz 1.txt").getByRole("button", { name: "Edit FTM 1 Week 2 Quiz 1.txt" }).click();
  await expect(page.getByText(/This file was imported on \d{4}-\d{2}-\d{2} as "FTM 1 Week 2 Quiz 1"\. Every question here is already in your bank, so none is selected\./)).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Include question 1" })).not.toBeChecked();
  await expect(page.getByRole("button", { name: "Finalize import" })).toBeDisabled();

  expect(await library(page)).toEqual(saved);
  expect(errors).toEqual([]);
});

for (const width of [1440, 390]) {
  test(`pending acceptance retains rows through failure and retry (${width}px)`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => {
      if (["error", "warning"].includes(message.type())) errors.push(message.text());
    });
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: width === 390 ? "light" : "dark" });
    await page.addInitScript(theme => localStorage.setItem("axom.theme", theme), width === 390 ? "light" : "dark");
    // Delay only this fresh test context's save boundary. Successful releases
    // still execute the unchanged canonical save and real IndexedDB writes.
    await page.route("**/src/lib/questionImportSave.ts*", async route => {
      const response = await route.fetch();
      const source = await response.text();
      const declaration = "export async function saveReviewedImport(prepared, store, images = []) {";
      expect(source).toContain(declaration);
      await route.fulfill({ response, body: source.replace(declaration, `${declaration}
        const gate = window.__AXOM_IMPORT_TEST_GATE__;
        if (gate) {
          delete window.__AXOM_IMPORT_TEST_GATE__;
          await gate.promise;
          if (gate.fail) return { ok: false, message: "Synthetic write failed", rollbackFailures: [] };
        }`) });
    });
    const arm = (fail: boolean) => page.evaluate(shouldFail => {
      const target = window as unknown as {
        __AXOM_IMPORT_TEST_GATE__?: { promise: Promise<void>; fail: boolean };
        __AXOM_RELEASE_IMPORT__?: () => void;
      };
      target.__AXOM_IMPORT_TEST_GATE__ = {
        fail: shouldFail,
        promise: new Promise<void>(resolve => { target.__AXOM_RELEASE_IMPORT__ = resolve; }),
      };
    }, fail);
    const release = () => page.evaluate(() => {
      (window as unknown as { __AXOM_RELEASE_IMPORT__: () => void }).__AXOM_RELEASE_IMPORT__();
    });

    await seedOnboarded(page);
    await openQueue(page);
    await addFiles(page, FILES.slice(0, 2));
    const first = FILES[0].name;
    const second = FILES[1].name;
    const removeFirst = page.getByRole("button", { name: `Remove ${first}` });
    const removeSecond = page.getByRole("button", { name: `Remove ${second}` });
    await arm(true);
    await page.getByRole("button", { name: "Accept all valid (2)" }).click();
    await expect(row(page, first)).toContainText("saving");
    await expect(removeFirst).toBeDisabled();
    await expect(removeSecond).toBeDisabled();
    await removeFirst.evaluate(button => (button as HTMLButtonElement).click());
    await expect(row(page, first)).toBeVisible();
    expect((await library(page)).questions).toBe(0);
    await row(page, second).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`pending-${width}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    await release();
    await expect(page.getByText("Accepted 1", { exact: true })).toBeVisible();
    await expect(row(page, first)).toContainText("Synthetic write failed");
    await expect(page.getByRole("button", { name: `Edit ${first}` })).toBeEnabled();
    await expect(removeFirst).toBeEnabled();
    expect((await library(page)).questions).toBe(1);

    await arm(false);
    await page.getByRole("button", { name: `Accept ${first}` }).click();
    await expect(removeFirst).toBeDisabled();
    await expect(removeSecond).toBeDisabled();
    await release();
    await expect(page.getByText("Accepted 2", { exact: true })).toBeVisible();
    await expect(removeFirst).toBeEnabled();
    await removeFirst.focus();
    await page.keyboard.press("Enter");
    await expect(row(page, first)).toHaveCount(0);
    const saved = await library(page);
    expect(saved.questions).toBe(3);
    expect(saved.sets).toHaveLength(2);
    await reloadAfterSave(page);
    expect(await library(page)).toEqual(saved);
    expect(errors).toEqual([]);
  });
}
