import { expect, reloadAfterSave, seedOnboarded, test } from "./fixtures";

for (const width of [1440, 390]) test(`existing tracker completes SGU map at ${width}px`, async ({ page }) => {
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
      terms: [{ id: "saved-t1", name: "T1" }, { id: "saved-t2", name: "Term 2" }],
      courses: [
        { id: "saved-bpm500", termId: "saved-t1", code: "BPM500", name: "My edited BPM", files: 4,
          modules: [{ id: "saved-ftm", name: "FTM1" }, { id: "saved-bsce", name: "BSCE T1" }] },
        { id: "saved-local", termId: "saved-t2", code: "LOCAL 101", name: "My local course", files: 1,
          modules: [{ id: "saved-local-module", name: "My module" }] },
      ],
      tracker: Array.from({ length: 59 }, (_, index) => ({
        id: `saved-row-${index}`, path: "Term 1/BPM 500/FTM 1/Week 1", label: `Saved activity ${index}`,
        kind: "Lecture", passes: index % 3, ankiPasses: 0, yield: "none", updated: "2026-11-01T00:00:00.000Z",
      })),
    });
  });
  await reloadAfterSave(page);
  await page.goto("/#tracker");
  const before = await page.evaluate(async () => {
    const dev = await (window as unknown as {
      __AXOM_DEV__: Promise<{ useStore: { getState: () => { terms: unknown[]; courses: unknown[]; tracker: unknown[] } } }>;
    }).__AXOM_DEV__;
    const { terms, courses, tracker } = dev.useStore.getState();
    return { terms: terms.length, courses: courses.length, tracker: JSON.stringify(tracker) };
  });
  expect(before.terms).toBe(2);
  expect(before.courses).toBe(2);

  const prompt = page.getByRole("region", { name: "Complete SGU course map" });
  await expect(prompt.getByText("4 terms · 6 courses · 28 modules to add")).toBeVisible();
  for (const theme of ["dark", "light"]) {
    await page.locator("html").evaluate((root, value) => root.setAttribute("data-theme", value), theme);
    await prompt.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `/tmp/axom-sgu-map-setup-${width}-${theme}.png` });
  }

  const button = prompt.getByRole("button", { name: "Complete SGU course map" });
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(prompt).toHaveCount(0);
  const after = await page.evaluate(async () => {
    const dev = await (window as unknown as {
      __AXOM_DEV__: Promise<{ useStore: { getState: () => { terms: { id: string }[]; courses: { id: string; modules: unknown[] }[]; tracker: unknown[] } } }>;
    }).__AXOM_DEV__;
    const { terms, courses, tracker } = dev.useStore.getState();
    return { terms: terms.length, courses: courses.length, modules: courses.reduce((sum, course) => sum + course.modules.length, 0),
      ids: courses.map(course => course.id), tracker: JSON.stringify(tracker) };
  });
  expect(after).toMatchObject({ terms: 6, courses: 8, modules: 31 });
  expect(after.ids).toEqual(expect.arrayContaining(["saved-bpm500", "saved-local"]));
  expect(after.tracker).toBe(before.tracker);
  await reloadAfterSave(page);
  await expect(page.getByRole("region", { name: "Complete SGU course map" })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(issues).toEqual([]);
});
