import type { Page } from "@playwright/test";
import { expect, seedOnboarded, test } from "./fixtures";

const origin = "https://public-catalog-fixture.invalid";
const GOER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FTM = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const offered = [
  { id: FTM, title: "Foundations reviewed course", module: "FTM 1", term: "Term 1", academic_term: null, cohort: null,
    current_revision_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", ready_questions: 12, has_plan: true },
  { id: GOER, title: "Gastroenterology reviewed course", module: "GOER", term: "Term 5", academic_term: "Reviewed test term", cohort: null,
    current_revision_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", ready_questions: 40, has_plan: true },
];
const plans: Record<string, string> = {
  [GOER]: "T5 - GOER - Lectures:\nWeek 1:\nLecture 01 Synthetic catalog example [Lecture]\nLecture 02 Image interpretation [Lecture]\nWeek 2:\nLecture 03 Synthetic follow-up [Lecture]\n",
  [FTM]: "T1 - FTM 1 - Lectures:\nWeek 1:\nLecture 01 Synthetic foundations [Lecture]\n",
};

/** A browser with no account. Browser contract only: the visitor rules themselves
 * are proven against the real SQL in publicCatalog.pglite.test.ts. */
async function visitorCatalog(page: Page) {
  const unexpected: string[] = [];
  const calls: string[] = [];
  await page.addInitScript(({ origin }) => {
    Object.assign(window, { __AXOM_E2E_ACCOUNT__: { url: origin, key: "sb_publishable_fixture" } });
  }, { origin });
  await page.route(`${origin}/**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    const json = (value: unknown, status = 200) => route.fulfill({ status, headers, json: value });
    const body = (request.postDataJSON() ?? {}) as { search?: string; collection?: string };
    if (path.endsWith("/rpc/academic_public_catalog")) {
      calls.push("catalog");
      const search = (body.search ?? "").toLowerCase();
      return json(offered.filter(course => `${course.title} ${course.module}`.toLowerCase().includes(search)));
    }
    if (path.endsWith("/rpc/academic_public_course")) {
      calls.push("course");
      const course = offered.find(entry => entry.id === body.collection);
      if (!course) return json(null);
      return json({ id: course.id, title: course.title, module: course.module, term: course.term, academic_term: course.academic_term,
        cohort: course.cohort, current_revision_id: course.current_revision_id, ready_questions: course.ready_questions,
        source_revision: "2026-A", template_text: plans[course.id] });
    }
    // A signed-out browser has no business with any account endpoint.
    unexpected.push(`${request.method()} ${path}`);
    return json({ message: "Unexpected fixture request" }, 404);
  });
  await seedOnboarded(page);
  return { unexpected, calls };
}

for (const width of [1440, 390]) test(`a visitor browses the offered course catalog and previews a weekly plan at ${width}px`, async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (["error", "warning"].includes(message.type())) errors.push(message.text()); });
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  const backend = await visitorCatalog(page);
  await page.goto("/#questions");

  const catalog = page.getByRole("region", { name: "Available question banks" });
  await catalog.scrollIntoViewIfNeeded();
  await expect(catalog.getByText("Courses offered to everyone.", { exact: false })).toBeVisible();
  const card = catalog.locator(`[data-course-id="${GOER}"]`);
  await expect(card).toContainText("40 ready questions");
  await expect(catalog.locator("[data-course-id]")).toHaveCount(2);
  expect(await catalog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath(`visitor-catalog-${width}.png`), fullPage: true });

  await catalog.getByRole("searchbox", { name: "Search available banks" }).fill("ftm");
  await expect(catalog.locator("[data-course-id]")).toHaveCount(1);
  await catalog.getByRole("searchbox", { name: "Search available banks" }).fill("");
  await expect(catalog.locator("[data-course-id]")).toHaveCount(2);

  await card.click();
  const plan = page.getByRole("region", { name: "GOER course plan" });
  await expect(plan.getByRole("heading", { name: "Weekly plan" })).toBeVisible();
  await expect(plan).toContainText("40 reviewed questions");
  await expect(plan.getByText("Week 1", { exact: true })).toBeVisible();
  await expect(plan.getByText("Week 2", { exact: true })).toBeVisible();
  // Read-only: a visitor can neither select weeks nor load, download or practise.
  await expect(plan.getByRole("checkbox")).toHaveCount(0);
  await expect(plan.getByRole("button", { name: "Load Course", exact: true })).toHaveCount(0);
  await expect(plan.getByRole("button", { name: /Quiz/ })).toHaveCount(0);
  await plan.getByText("View activities").first().click();
  await expect(plan.getByText("Lecture 02 Image interpretation")).toBeVisible();
  expect(await plan.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath(`visitor-plan-${width}.png`), fullPage: true });

  // The same preview from Course Tracker, reached through the catalog's own link.
  await catalog.getByRole("button", { name: "Open in Course Tracker" }).click();
  await expect(page).toHaveURL(/#tracker$/);
  const trackerPlan = page.getByRole("region", { name: "GOER course plan" });
  await expect(trackerPlan.getByRole("heading", { name: "Weekly plan" })).toBeVisible();
  await trackerPlan.getByRole("button", { name: "All courses" }).click();
  await expect(page.getByText("Offered to everyone + this device")).toBeVisible();
  await expect(page.locator(`[data-course-id="${FTM}"]`)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath(`visitor-course-library-${width}.png`), fullPage: true });

  // Signing in is the one way forward, and it is one click away.
  await page.locator(`[data-course-id="${GOER}"]`).click();
  await page.getByRole("region", { name: "GOER course plan" }).getByRole("button", { name: "Sign in or create an account" }).click();
  await expect(page.getByRole("dialog").first()).toBeVisible();

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(backend.calls).toContain("catalog");
  expect(backend.calls).toContain("course");
  expect(backend.unexpected).toEqual([]);
  expect(errors).toEqual([]);
});
