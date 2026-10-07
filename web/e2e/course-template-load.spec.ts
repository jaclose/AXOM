import { expect, reloadAfterSave, seedOnboarded, test } from "./fixtures";

// A course template lays a module out week by week in the tracker, says which
// weeks it worked out, and adds nothing when it is loaded a second time.
// Invented titles throughout.
const LECTURES = [
  "FTM 1 - Lectures + DLAs:",
  "",
  "FTM Lecture 01 First sample topic [Lecture]",
  "DLA 01 Sample reading [DLA]",
  "",
  "FTM Lecture 02 Second sample topic [Flipped Lecture]",
  "",
  "FTM Lecture 03 Third sample topic [Lecture]",
  "",
  "FTM Lecture 04 Fourth sample topic [Lecture]",
].join("\n");

const ACTIVITIES = [
  "FTM 1 - Small Groups + IMCQs + ESoft:",
  "",
  "FTM SG 01 Sample group [Small Group]",
  "FTM IMCQ 01 [IMCQ]",
  "FTM ESoft Quiz 01 [ESoft]",
  "",
  "FTM SG 02 Sample cases [Small Group]",
  "FTM ESoft Quiz 02 [ESoft]",
].join("\n");

const FILES = [
  { name: "13_FTM1_Lectures_DLA.txt", mimeType: "text/plain", buffer: Buffer.from(LECTURES) },
  { name: "14_FTM1_Activities.txt", mimeType: "text/plain", buffer: Buffer.from(ACTIVITIES) },
];

test("a course template fills the tracker week by week and is safe to load twice", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await seedOnboarded(page);
  await page.goto("/#tracker");

  await page.getByRole("button", { name: "Load course template" }).click();
  const dialog = page.getByRole("dialog", { name: "Load a course template" });
  await dialog.getByLabel("Choose course template files").setInputFiles(FILES);

  const preview = dialog.getByRole("region", { name: "Template for FTM 1" });
  await expect(preview).toContainText("2 weeks · 10 items");
  await expect(preview).toContainText("2 ESoft quizzes");
  await expect(preview).toContainText("1 IMCQ");
  // The module's course already sits in a term, so that is chosen for the learner.
  await expect(preview.getByLabel("Term for FTM 1")).toHaveValue("term-1");
  // Lecture weeks are not in the template: AXOM says it worked them out.
  await expect(preview.getByRole("note")).toContainText("5 items: The template does not give weeks for these.");
  await preview.getByLabel("FTM 1 starts in week").fill("3");
  await dialog.getByRole("button", { name: "Add 10 items" }).click();
  await expect(dialog).toHaveCount(0);

  await reloadAfterSave(page);
  const rows = await page.evaluate(async () => {
    type Row = { path: string; label: string; kind: string; activity?: string; templateKey?: string; passes: number };
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<{ useStore: { getState: () => { tracker: Row[] } } }> }).__AXOM_DEV__;
    return dev.useStore.getState().tracker.filter((row) => row.templateKey);
  });
  expect(rows).toHaveLength(10);
  // Weekly activities take their group's week, counted from where the module starts.
  expect(rows.filter((row) => row.activity === "esoft").map((row) => row.path)).toEqual([
    "Term 1/FTM 1/Week 3", "Term 1/FTM 1/Week 4",
  ]);
  expect(rows.find((row) => row.label === "FTM SG 01 Sample group")).toMatchObject({ kind: "Requirement", activity: "small-group", path: "Term 1/FTM 1/Week 3" });
  expect(rows.find((row) => row.label.startsWith("FTM Lecture 04"))).toMatchObject({ kind: "Lecture", path: "Term 1/FTM 1/Week 4", passes: 0 });
  expect(rows.find((row) => row.label.startsWith("FTM Lecture 02"))).toMatchObject({ activity: "flipped-lecture", templateKey: "ftm1|lecture|2" });

  // --- the week view reads those rows, attempts and absences ------------------
  await page.evaluate(async () => {
    type Dev = { useStore: { getState: () => { addQuestion: (input: unknown) => { ok: boolean } } }; flushVault: () => Promise<void> };
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<Dev> }).__AXOM_DEV__;
    // One answered question filed under the same module and week: nothing else ties it to the tracker.
    dev.useStore.getState().addQuestion({
      id: "week-question", source: "imported", stem: "Sample stem?", options: [{ key: "A", text: "One" }, { key: "B", text: "Two" }],
      correctKey: "A", module: "FTM 1", week: 3, status: "correct", tags: [],
      attempts: [{ at: new Date().toISOString(), status: "correct", answerKey: "A" }],
    });
    await dev.flushVault();
  });
  const weeks = page.locator(".week-overview");
  const ftm = weeks.getByRole("region", { name: "FTM 1 by week" });
  await expect(ftm).toContainText("Term 1 · 2 weeks · 0 of 10 done");
  const week3 = ftm.locator("li.week-row").filter({ hasText: "Week 3" });
  await expect(week3).toContainText("Current");
  await expect(week3).toContainText("Questions: 1 of 1 answered, 100% right first time");
  await week3.getByRole("button", { name: /Week 3/ }).click();
  await week3.getByRole("checkbox", { name: "FTM Lecture 01 First sample topic" }).check();
  await week3.getByRole("button", { name: "Missed FTM SG 01 Sample group" }).click();
  await expect(ftm).toContainText("1 of 10 done");
  await expect(week3).toContainText("1 missed");
  await weeks.getByText("Term 1 absences").click();
  await weeks.getByLabel("Small group absences allowed").fill("10");
  await expect(weeks.locator(".week-absences summary")).toContainText("Small group: 1 missed of 10 allowed");

  await reloadAfterSave(page);
  await expect(page.locator(".week-absences summary")).toContainText("Small group: 1 missed of 10 allowed");

  // A lecture AXOM placed can be moved; the learner's choice is then the record.
  const ftmAgain = page.locator(".week-overview").getByRole("region", { name: "FTM 1 by week" });
  const week4 = ftmAgain.locator("li.week-row").filter({ hasText: "Week 4" });
  await expect(week4).toContainText("placed by AXOM");
  await week4.getByRole("button", { name: /Week 4/ }).click();
  await week4.getByLabel("Week for FTM Lecture 04 Fourth sample topic").selectOption("3");
  await expect(ftmAgain.locator("li.week-row").first()).toContainText("1 of 7 done");

  // Loading the same files again finds everything already there.
  await page.getByRole("button", { name: "Load course template" }).click();
  await dialog.getByLabel("Choose course template files").setInputFiles(FILES);
  await preview.getByLabel("FTM 1 starts in week").fill("3");
  // The moved lecture is not pulled back to the week AXOM first gave it.
  await expect(preview).toContainText("0 new, 10 already in your tracker.");
  await expect(dialog.getByRole("button", { name: "Nothing to add" })).toBeDisabled();
  expect(errors).toEqual([]);
});
