import { test, expect, waitForWorkspace } from "./fixtures";
import { completeSetup } from "../scripts/setup-flow.mjs";
import type { NoctyriumState } from "../src/lib/types";

const bundle = process.env.AXOM_ACADEMIC_PILOT;
test.skip(!bundle, "Provide the private reviewed FTM1 pilot bundle.");
test.use({ trace: "off", screenshot: "off", video: "off" });

test("reviewed FTM1 plan loads selected weeks and opens its image-rich quiz", async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (["error", "warning"].includes(message.type())) errors.push(message.text()); });
  await page.goto("/#questions");
  await completeSetup(page, "Course acceptance");
  const read = async () => {
    await waitForWorkspace(page);
    return page.evaluate(async () => {
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<{ useStore: { getState: () => NoctyriumState }; flushVault: () => Promise<void> }> }).__AXOM_DEV__;
    await dev.flushVault(); const s = dev.useStore.getState();
    return { questions: s.questions, tracker: s.tracker, sets: s.questionSets };
    });
  };
  await read();
  await page.goto("/#questions");
  const promise = page.getByRole("dialog", { name: "A promise to yourself" });
  if (await promise.isVisible()) await promise.getByRole("button", { name: "Review later", exact: true }).click();
  const done = page.getByRole("button", { name: "Done", exact: true });
  if (await done.isVisible()) await done.click();
  const later = page.getByRole("button", { name: "Later", exact: true });
  if (await later.isVisible()) await later.click();
  await page.getByText("Local collection transfer and source review", { exact: true }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Install prepared library", exact: true }).click();
  await (await chooser).setFiles(bundle!);
  await expect(page.getByRole("region", { name: "Prepared library", exact: true }).getByRole("status")).toContainText("Library installed.", { timeout: 60_000 });
  const before = await read();
  expect(before.questions).toHaveLength(25);
  const open = async () => {
    await page.goto("/#tracker");
    await page.getByRole("button", { name: "Course Library / Load Course", exact: true }).click();
    await page.getByRole("button", { name: "Preview FTM 1, Term 1", exact: true }).click();
  };
  await open();
  const plan = page.getByRole("region", { name: "FTM 1 course plan", exact: true });
  if (await later.isVisible()) await later.click();
  await expect(plan).toContainText("Fall 2026");
  await expect(plan.locator(".course-week")).toHaveCount(3);
  await expect(plan).toContainText("2 activities have no confirmed week");
  await plan.getByRole("checkbox", { name: "Week 1", exact: true }).uncheck();
  await plan.getByRole("checkbox", { name: "Week 3", exact: true }).uncheck();
  await plan.getByRole("button", { name: "Load Course", exact: true }).click();
  await expect(plan.getByRole("status")).toContainText("Course added");
  const loaded = await read();
  expect(loaded.tracker.filter(item => item.templateKey)).toHaveLength(30);
  expect(loaded.tracker.filter(item => item.templateKey).every(item => item.path.endsWith("Week 2"))).toBe(true);
  for (const [width, height] of [[1440, 900], [390, 844], [1440, 540]]) {
    await page.setViewportSize({ width, height });
    for (const theme of ["dark", "light"]) {
      await page.locator("html").evaluate((root, value) => root.setAttribute("data-theme", value), theme);
      await plan.getByRole("heading", { name: "FTM 1", exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `/tmp/axom-course-plan-${width}-${height}-${theme}.png`, fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator("html").evaluate(root => root.style.zoom = "2");
  await plan.getByRole("button", { name: "Load Course", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/axom-course-plan-zoom.png" });
  await expect(plan.getByRole("button", { name: "Load Course", exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator("html").evaluate(root => root.style.zoom = "1");
  await page.reload({ waitUntil: "networkidle" });
  await expect(plan).toBeVisible();
  await plan.getByRole("checkbox", { name: "Week 1", exact: true }).uncheck();
  await plan.getByRole("checkbox", { name: "Week 3", exact: true }).uncheck();
  await plan.getByRole("button", { name: "Load Course", exact: true }).click();
  await expect(plan.getByRole("status")).toContainText("already in My Courses");
  expect((await read()).tracker).toEqual(loaded.tracker);
  await plan.getByRole("button", { name: "Quiz week 2", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Question 1 of 11", exact: true })).toBeAttached();
  // Navigate the actual pool until an image-bearing question, without reading keys.
  let imageSeen = false;
  for (let i = 0; i < 11; i++) {
    await expect(page.getByRole("heading", { name: `Question ${i + 1} of 11`, exact: true })).toBeAttached();
    const figures = page.locator(".tutor-question-region figure");
    const images = page.locator(".tutor-question-region img");
    if (await figures.count()) {
      await expect(images.first()).toBeVisible();
      await expect.poll(() => images.first().evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
      imageSeen = true;
    }
    await page.getByLabel("Question stem", { exact: true }).focus();
    await page.keyboard.press("A"); await page.keyboard.press("Enter");
    if (i < 10) await page.getByRole("button", { name: "Next question", exact: true }).click();
  }
  expect(imageSeen).toBe(true);
  await page.getByRole("button", { name: "Finish block", exact: true }).click();
  await page.getByRole("button", { name: "Review answers and Decode", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Review saved block", exact: true })).toBeVisible();
  const answered = await read();
  expect(answered.questions.reduce((n, q) => n + q.attempts.length, 0)).toBe(11);
  expect(answered.tracker).toEqual(loaded.tracker);
  await page.reload();
  await expect.poll(async () => (await read()).questions.length).toBe(25);
  const restored = await read();
  expect(restored.questions.map(q => [q.id, q.attempts])).toEqual(answered.questions.map(q => [q.id, q.attempts]));
  expect(errors).toEqual([]);
});
