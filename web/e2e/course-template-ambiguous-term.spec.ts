import { test, expect, seedOnboarded, reloadAfterSave } from "./fixtures";

/** Invented source text: verify repeated module labels cannot cross academic terms. */
const template = "FTM 1 - Lectures:\nWeek 1:\nLecture 01 Sample cell anatomy [Lecture]";
for (const width of [1440, 390]) test(`ambiguous cross-term course template requires term confirmation at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await seedOnboarded(page);
  await page.goto("/#tracker");
  await reloadAfterSave(page);
  await page.waitForFunction(() => Boolean((window as unknown as { __AXOM_DEV__?: unknown }).__AXOM_DEV__));
  const duplicate = await page.evaluate(async () => {
    type Course = { id: string; termId: string; modules: { name: string }[] };
    type Dev = { useStore: { getState: () => { courses: Course[]; terms: { id: string; name: string }[];
        addCourse: (course: { termId: string; code: string; name: string; files: number; modules: string[] }) => void } };
        flushVault: () => Promise<void> };
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<Dev> }).__AXOM_DEV__;
    const store = dev.useStore.getState();
    const original = store.courses.find(course => course.modules.some(m => m.name.replace(/[^a-z0-9]/gi, "").toLowerCase() === "ftm1"));
    const otherTerm = store.terms.find(t => t.id !== original?.termId && /term\s*2/i.test(t.name));
    if (!original || !otherTerm) throw new Error("Default seeded FTM 1 and Term 2 are required.");
    store.addCourse({ termId: otherTerm.id, code: "FTM1 DUP", name: "Duplicate FTM1", files: 0, modules: ["FTM 1"] });
    await dev.flushVault();
    return otherTerm.id;
  });
  const scopeCheck = await page.evaluate(async () => {
    const { useStore } = await (window as unknown as { __AXOM_DEV__: Promise<{ useStore: { getState: () => { courses: { termId: string; modules: {name: string}[] }[] } } }> }).__AXOM_DEV__;
    return useStore.getState().courses.filter(course => course.modules.some(m => m.name.replace(/[^a-z0-9]/gi, "").toLowerCase() === "ftm1")).map(course => course.termId);
  });
  expect(new Set(scopeCheck).size).toBe(2);
  await page.getByRole("button", { name: "Course Library / Load Course" }).click();
  await page.getByText("Manage sources and custom courses", { exact: true }).click();
  await page.getByRole("button", { name: "Saved templates and imports", exact: true }).click();
  const dialog = page.getByRole("region", { name: "Load a course template", exact: true });
  await dialog.getByLabel("Choose course template files").setInputFiles({
    name: "FTM1-example.txt", mimeType: "text/plain", buffer: Buffer.from(template),
  });
  const preview = dialog.getByRole("region", { name: "Template for FTM 1" });
  await expect(preview.getByRole("alert")).toContainText("more than one term");
  await expect(preview.getByLabel("Term for FTM 1")).toHaveValue("");
  await expect(dialog.getByRole("button", { name: "Add 1 item" })).toBeDisabled();
  await page.screenshot({
    path: `../artifacts/qbank-6way-20261014/lead-round2/ambiguous-term-${width}.png`,
    fullPage: true,
  });
  await preview.getByLabel("Term for FTM 1").selectOption(duplicate);
  await expect(preview.getByRole("alert")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Add 1 item" }).click();
  await reloadAfterSave(page);
  const result = await page.evaluate(async () => {
    type Dev = { useStore: { getState: () => { tracker: { label: string; path: string; templateKey?: string }[] } } };
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<Dev> }).__AXOM_DEV__;
    return dev.useStore.getState().tracker.filter(item => item.templateKey && item.label.includes("Sample cell anatomy"));
  });
  expect(result).toHaveLength(1);
  expect(result[0].path).toMatch(/^Term 2\/FTM1 DUP\/FTM 1\/Week 1$/);
  expect(pageErrors).toEqual([]);
});

for (const width of [1440, 390]) test(`same-term duplicate modules require explicit course ownership at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  await seedOnboarded(page);
  await page.goto("/#tracker");
  await reloadAfterSave(page);
  const target = await page.evaluate(async () => {
    type Dev = { useStore: { getState: () => {
      courses: { termId: string; modules: { name: string }[] }[];
      addCourse: (course: { termId: string; code: string; name: string; files: number; modules: string[] }) => void;
    } }; flushVault: () => Promise<void> };
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<Dev> }).__AXOM_DEV__;
    const state = dev.useStore.getState();
    const first = state.courses.find(c => c.modules.some(m => m.name.replace(/[^a-z0-9]/gi,"").toLowerCase() === "ftm1"));
    if (!first) throw new Error("Fixture missing FTM 1");
    state.addCourse({ termId: first.termId, code: "ALT 500", name: "Second sample course", files: 0, modules: ["FTM 1"] });
    await dev.flushVault();
    return first.termId;
  });
  await page.getByRole("button", { name: "Course Library / Load Course" }).click();
  await page.getByText("Manage sources and custom courses", { exact: true }).click();
  await page.getByRole("button", { name: "Saved templates and imports", exact: true }).click();
  const loader = page.getByRole("region", { name: "Load a course template", exact: true });
  await loader.getByLabel("Choose course template files").setInputFiles({
    name: "FTM1-ambiguous-example.txt", mimeType: "text/plain", buffer: Buffer.from(template),
  });
  const preview = loader.getByRole("region", { name: "Template for FTM 1" });
  await expect(preview.getByLabel("Term for FTM 1")).toHaveValue(target);
  await expect(preview.getByRole("alert")).toContainText("more than one course");
  await expect(loader.getByRole("button", { name: "Add 1 item" })).toBeDisabled();
  const coursePicker = preview.getByLabel("Course for FTM 1");
  await expect(coursePicker.locator("option")).toHaveCount(3);
  await page.screenshot({
    path: `../artifacts/qbank-6way-20261014/lead-round2/ambiguous-course-${width}.png`,
    fullPage: true,
  });
  await coursePicker.selectOption({ label: "ALT 500 · Second sample course" });
  await expect(preview.getByRole("alert")).toHaveCount(0);
  await expect(loader.getByRole("button", { name: "Add 1 item" })).toBeEnabled();
  await loader.getByRole("button", { name: "Add 1 item" }).click();
  await reloadAfterSave(page);
  const saved = await page.evaluate(async () => {
    type Dev = { useStore: { getState: () => { tracker: { templateKey?: string; path: string; label: string }[] } } };
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<Dev> }).__AXOM_DEV__;
    return dev.useStore.getState().tracker.filter(r => r.templateKey && r.label.includes("Sample cell anatomy"));
  });
  expect(saved).toHaveLength(1);
  expect(saved[0].path).toBe("Term 1/ALT 500/FTM 1/Week 1");
});
