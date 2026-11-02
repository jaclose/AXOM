import { expect, seedOnboarded, reloadAfterSave, test } from "./fixtures";

for (const width of [1440, 390]) test(`course map separates saved legacy courses at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const issues: string[] = [];
  page.on("pageerror", error => issues.push(error.message));
  page.on("console", message => {
    if (message.type() === "error" || message.type() === "warning") issues.push(message.text());
  });

  await seedOnboarded(page);
  await page.evaluate(async () => {
    const dev = await (window as unknown as {
      __AXOM_DEV__: Promise<{ useStore: { setState: (patch: object) => void } }>;
    }).__AXOM_DEV__;
    dev.useStore.setState({
      terms: [1, 2, 4, 5].map(number => ({ id: `term-${number}`, name: `Term ${number}` })),
      courses: [
        { id: "course-1", termId: "term-1", code: "BPM 500", name: "Basic Principles of Medicine I", files: 0, modules: [{ id: "legacy-1", name: "BSCE T1" }] },
        { id: "course-2", termId: "term-2", code: "BPM 501", name: "Basic Principles of Medicine II", files: 0, modules: [{ id: "legacy-2", name: "BSCE T2" }] },
        { id: "course-4", termId: "term-4", code: "PPM 500", name: "Principles & Practice of Medicine I", files: 0, modules: [{ id: "legacy-3", name: "FTCM (pending)" }, { id: "legacy-4", name: "BSCE T4" }] },
        { id: "course-5", termId: "term-5", code: "PPM 501", name: "Principles & Practice of Medicine II", files: 0, modules: [{ id: "legacy-5", name: "CBSE" }] },
      ],
    });
  });
  await reloadAfterSave(page);
  const before = await page.evaluate(async () => {
    const dev = await (window as unknown as {
      __AXOM_DEV__: Promise<{ useStore: { getState: () => { terms: unknown; courses: unknown; tracker: unknown } } }>;
    }).__AXOM_DEV__;
    const { terms, courses, tracker } = dev.useStore.getState();
    return JSON.stringify({ terms, courses, tracker });
  });

  await page.goto("/#tracker");
  await page.getByRole("button", { name: "Course Library / Load Course", exact: true }).click();
  await page.getByRole("button", { name: "Course map", exact: true }).click();
  await expect(page.getByRole("status", { name: "" }).filter({ hasText: "34 courses in the course map" })).toBeVisible();
  const term1 = page.locator(".course-term-section").filter({ has: page.getByRole("heading", { name: "Term 1", exact: true }) });
  const other = page.locator(".course-term-section").filter({ has: page.getByRole("heading", { name: "Other local courses", exact: true }) });
  await expect(term1.getByRole("button", { name: /^Preview / })).toHaveCount(6);
  await expect(other.getByRole("button", { name: /^Preview / })).toHaveCount(5);

  await page.getByRole("combobox", { name: "Filter by term" }).selectOption({ label: "Term 4" });
  const term4 = page.locator(".course-term-section").filter({ has: page.getByRole("heading", { name: "Term 4", exact: true }) });
  await expect(term4.getByRole("button", { name: /^Preview / })).toHaveCount(5);
  await expect(other.getByRole("button", { name: /^Preview / })).toHaveCount(2);
  await page.getByRole("searchbox", { name: "Search courses" }).fill("pending");
  await expect(term4).toHaveCount(0);
  await expect(other.getByRole("button", { name: /^Preview / })).toHaveCount(1);
  await page.getByRole("searchbox", { name: "Search courses" }).fill("");
  await page.getByRole("combobox", { name: "Filter by term" }).selectOption({ label: "All terms" });
  await other.locator(".course-term-heading").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `/tmp/axom-course-map-${width}.png` });

  const legacy = other.getByRole("button", { name: "Preview BSCE T1, Term 1" });
  await legacy.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: "BSCE T1 course plan" })).toBeVisible();
  await page.getByRole("button", { name: "All courses" }).click();
  const after = await page.evaluate(async () => {
    const dev = await (window as unknown as {
      __AXOM_DEV__: Promise<{ useStore: { getState: () => { terms: unknown; courses: unknown; tracker: unknown } } }>;
    }).__AXOM_DEV__;
    const { terms, courses, tracker } = dev.useStore.getState();
    return JSON.stringify({ terms, courses, tracker });
  });
  expect(after).toBe(before);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(issues).toEqual([]);
});
