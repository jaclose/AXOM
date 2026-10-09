import { test, expect, seedOnboarded, reloadAfterSave } from "./fixtures";

for (const width of [1440, 390]) test(`course bank stays focused, builds across weeks and saves answers at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await seedOnboarded(page);
  await page.evaluate(async () => {
    const { useStore, flushVault } = await (window as unknown as { __AXOM_DEV__: Promise<{
      useStore: { getState: () => { addQuestion: (value: unknown) => { ok: boolean }; addQuestionSet: (value: unknown) => void } };
      flushVault: () => Promise<void>;
    }> }).__AXOM_DEV__;
    const store = useStore.getState();
    for (let index = 0; index < 60; index++) {
      const week = Math.floor(index / 12) + 1;
      const questionId = `course-bank-question-${index}`;
      if (!store.addQuestion({ id: questionId, source: "manual", stem: `Sample question ${index + 1}: choose Beta.`, module: "FTM 1", week,
        options: [{ key: "A", text: "Alpha" }, { key: "B", text: "Beta" }, { key: "C", text: "Gamma" }], correctKey: "B", tags: [] }).ok) throw new Error("Question fixture refused");
      store.addQuestionSet({ id: `course-bank-set-${index}`, title: `IMCQ practice ${index + 1}`, scope: { module: "FTM 1", week }, questionIds: [questionId],
        sourceDocumentIds: [], createdAt: new Date().toISOString(), tags: [], parserWarnings: [], aiEnhanced: false });
    }
    await flushVault();
  });
  await page.goto("/#questions");
  await page.getByRole("button", { name: "Browse weeks", exact: true }).click();
  const bank = page.getByRole("region", { name: "Course question bank" });
  await expect(bank.getByRole("heading", { name: "Week 1", exact: true })).toBeVisible();
  await expect(bank.locator(".cb-set-row")).toHaveCount(12);
  await bank.getByRole("button", { name: "Week 2 12", exact: true }).click();
  await expect(bank.getByRole("heading", { name: "Week 2", exact: true })).toBeVisible();
  await bank.getByRole("button", { name: "Practice week", exact: true }).click();
  const setup = page.getByRole("dialog", { name: "Set up a tutor block" });
  await expect(setup.getByRole("region", { name: "Practice source" })).toContainText("12 selected sets");
  await expect(setup.getByRole("region", { name: "Course question bank" })).toHaveCount(0);
  await expect(setup.getByLabel("Category", { exact: true })).not.toBeVisible();
  await setup.getByRole("button", { name: "Change sources" }).click();
  const picker = setup.getByRole("region", { name: "Course question bank" });
  await picker.getByRole("button", { name: "Week 3 12", exact: true }).click();
  await picker.getByRole("button", { name: "Add week", exact: true }).click();
  await expect(picker.getByRole("status")).toHaveText("24 selected");
  await setup.getByRole("button", { name: "Done choosing" }).click();
  await setup.getByLabel("Custom question count").fill("2");
  await setup.getByLabel("Question pool", { exact: true }).selectOption("unused");
  page.once("dialog", (dialog) => void dialog.accept("Weeks 2 and 3, unused"));
  await setup.getByRole("button", { name: "Save as block" }).click();
  await page.screenshot({ path: `/tmp/axom-course-v2-setup-${width}.png` });
  await setup.getByRole("button", { name: "Start tutor block" }).click();
  for (let index = 0; index < 2; index++) {
    await page.getByLabel("Question stem").focus();
    await page.keyboard.press(index === 0 ? "B" : "A");
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: index ? "Finish block" : "Next question", exact: true }).click();
  }
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await reloadAfterSave(page);
  const result = await page.evaluate(async () => {
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<{ useStore: { getState: () => {
      questions: Array<{ week: number; attempts: unknown[] }>; quizBlocks: Array<{ title: string; filters: { setIds: string[] } }>;
    } } }> }).__AXOM_DEV__;
    const state = dev.useStore.getState();
    return { answered: state.questions.filter((question) => question.attempts.length).map((question) => question.week), block: state.quizBlocks.find((block) => block.title === "Weeks 2 and 3, unused") };
  });
  expect(result.answered).toHaveLength(2);
  expect(result.answered.every((week) => week === 2 || week === 3)).toBe(true);
  expect(result.block?.filters.setIds).toHaveLength(24);
  await page.getByRole("button", { name: "Browse weeks", exact: true }).click();
  await bank.getByLabel("Search question sets").fill("IMCQ practice 60");
  await expect(bank.locator(".cb-set-row")).toHaveCount(1);
  await bank.getByLabel("Search question sets").fill("");
  await page.screenshot({ path: `/tmp/axom-course-v2-bank-${width}.png` });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
