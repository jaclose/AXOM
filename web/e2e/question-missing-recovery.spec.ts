import type { Page } from "@playwright/test";
import type { QuestionSet } from "../src/lib/library";
import type { QuestionRecord } from "../src/lib/questions";
import { expect, reloadAfterSave, seedOnboarded, test, waitForWorkspace } from "./fixtures";

const originalIds = ["recovery-kept", "recovery-missing-a", "recovery-missing-b"];
const title = "IMCQ recovery fixture";
const source = [
  "1. Which option is labeled Beta?",
  "A. Alpha", "B. Beta", "C. Gamma", "D. Delta", "E. Epsilon",
  "Answer: B. Beta",
  "Explanation: Beta is the explicitly requested label in this synthetic interface fixture.",
].join("\n");

async function restoreOriginal(page: Page, id: string) {
  await page.evaluate(async (questionId) => {
    type Dev = {
      useStore: { getState: () => { addQuestion: (question: Partial<QuestionRecord>) => { ok: boolean } } };
      flushVault: () => Promise<void>;
    };
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<Dev> }).__AXOM_DEV__;
    const result = dev.useStore.getState().addQuestion({
      id: questionId, source: "manual", stem: `Synthetic restored record ${questionId}`,
      options: [{ key: "A", text: "Alpha" }, { key: "B", text: "Beta" }],
      correctKey: "B", status: "unseen", tags: [], attempts: [],
      notes: questionId === "recovery-kept" ? "Keep this learner note unchanged." : undefined,
    });
    if (!result.ok) throw new Error("Exact-ID fixture restoration was refused");
    await dev.flushVault();
  }, id);
}

async function readOriginal(page: Page) {
  return page.evaluate(async () => {
    type Dev = { useStore: { getState: () => { questions: QuestionRecord[]; questionSets: QuestionSet[] } } };
    const { useStore } = await (window as unknown as { __AXOM_DEV__: Promise<Dev> }).__AXOM_DEV__;
    const state = useStore.getState();
    return {
      ids: state.questionSets.find(set => set.id === "recovery-original")?.questionIds,
      keptNote: state.questions.find(question => question.id === "recovery-kept")?.notes,
      missingIds: ["recovery-missing-a", "recovery-missing-b"].filter(id => !state.questions.some(question => question.id === id)),
      imported: state.questionSets.find(set => set.title === "Separate re-import")?.questionIds,
    };
  });
}

for (const width of [1440, 390]) {
  test(`missing-question recovery retains exact identity through import at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (["warning", "error"].includes(message.type())) errors.push(message.text()); });
    await seedOnboarded(page);
    await page.goto("/#questions");
    await waitForWorkspace(page);
    await restoreOriginal(page, "recovery-kept");
    await page.evaluate(async ({ ids, setTitle }) => {
      type Dev = {
        useStore: { getState: () => { addQuestionSet: (set: QuestionSet) => void } };
        flushVault: () => Promise<void>;
      };
      const dev = await (window as unknown as { __AXOM_DEV__: Promise<Dev> }).__AXOM_DEV__;
      dev.useStore.getState().addQuestionSet({
        id: "recovery-original", title: setTitle, questionIds: ids,
        scope: { module: "FTM 1", week: 1 }, sourceDocumentIds: [],
        createdAt: "2026-10-17T00:00:00Z", tags: [], parserWarnings: [], aiEnhanced: false,
      });
      await dev.flushVault();
    }, { ids: originalIds, setTitle: title });
    await page.getByRole("button", { name: "Browse weeks", exact: true }).click();
    const restore = page.getByRole("button", { name: `Import missing source for ${title}`, exact: true });
    await restore.focus();
    await page.keyboard.press("Enter");
    const recovery = page.getByRole("region", { name: "Missing question recovery", exact: true });
    await expect(recovery).toContainText(title);
    await expect(recovery).toContainText(/2.*missing/);
    for (const theme of ["dark", "light"]) {
      await page.locator("html").evaluate((element, value) => element.setAttribute("data-theme", value), theme);
      await page.emulateMedia({ reducedMotion: theme === "light" ? "reduce" : "no-preference" });
      await recovery.scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await recovery.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      await page.screenshot({ path: `/tmp/axom-missing-recovery-${width}-${theme}.png` });
    }
    await recovery.getByText("Recovery details", { exact: true }).click();
    await expect(recovery.getByText("Original missing question IDs: recovery-missing-a, recovery-missing-b", { exact: true })).toBeVisible();
    await recovery.getByText("Recovery details", { exact: true }).click();
    await recovery.getByRole("button", { name: "Cancel recovery", exact: true }).click();
    await expect(recovery).toHaveCount(0);
    await page.getByRole("tab", { name: /Question Sets/ }).click();
    await page.getByRole("button", { name: `Import missing source for ${title}`, exact: true }).click();
    await recovery.getByRole("button", { name: "Back to collection", exact: true }).click();
    await expect(page.getByRole("button", { name: `Import missing source for ${title}`, exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "Import", exact: true }).click();
    await expect(recovery).toContainText(/2.*missing/);

    await page.getByLabel("Choose question files or a ZIP to import").setInputFiles({
      name: "synthetic-recovery.txt", mimeType: "text/plain", buffer: Buffer.from(source),
    });
    await expect(page.getByText("Review 1 parsed question", { exact: false })).toBeVisible();
    await page.getByLabel("Set title").fill("Separate re-import");
    await page.getByRole("button", { name: "Finalize import", exact: true }).click();
    await expect.poll(async () => (await readOriginal(page)).imported?.length).toBe(1);
    await expect(recovery).toContainText(/2.*missing/);
    const afterImport = await readOriginal(page);
    expect(afterImport.ids).toEqual(originalIds);
    expect(afterImport.imported?.some(id => originalIds.includes(id))).toBe(false);
    expect(afterImport.keptNote).toBe("Keep this learner note unchanged.");

    // Deliberately model exact-ID restoration, not a claim that generic file
    // parsing recovers identity. Only canonical records may satisfy recovery.
    await restoreOriginal(page, "recovery-missing-a");
    await expect(recovery).toContainText(/1.*missing/);
    await reloadAfterSave(page);
    await waitForWorkspace(page);
    await page.getByRole("button", { name: "Browse weeks", exact: true }).click();
    await page.getByRole("button", { name: `Import missing source for ${title}`, exact: true }).click();
    await expect(recovery).toContainText(/1.*missing/);
    await restoreOriginal(page, "recovery-missing-b");
    await expect.poll(async () => (await readOriginal(page)).missingIds).toEqual([]);
    await expect(recovery).toContainText("All original question records are present in this workspace.");
    expect((await readOriginal(page)).ids).toEqual(originalIds);
    expect((await readOriginal(page)).keptNote).toBe("Keep this learner note unchanged.");
    await recovery.getByRole("button", { name: "Back to collection", exact: true }).click();
    await expect(page.getByRole("button", { name: `Import missing source for ${title}`, exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: `Practice ${title}`, exact: true })).toBeEnabled();
    expect(errors).toEqual([]);
  });
}
