import { expect, test } from "./fixtures";
import { academicCatalogFixture } from "./academicCatalogFixture";

const course = { id: "11111111-1111-4111-8111-111111111111", title: "Community NCRS review",
  module: "NCRS", term: "Term 4", current_revision_id: "22222222-2222-4222-8222-222222222222",
  ready_questions: 8, review_questions: 2, submitted_at: "2026-11-01T12:00:00Z",
  owned: false, status: "unreviewed" };
const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };

for (const width of [1440, 390]) test(`community uploads stay separate, filter by term and preview at ${width}px`, async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (["error", "warning"].includes(message.type())) errors.push(message.text()); });
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  await academicCatalogFixture(page);
  await page.route("**/rpc/academic_community_catalog", route => {
    const body = route.request().postDataJSON() as { term_filter?: string };
    return route.fulfill({ headers, json: body.term_filter && body.term_filter !== "Term 4" ? [] : [course] });
  });
  await page.route("**/rpc/academic_community_preview", route => route.fulfill({ headers, json: {
    id: course.current_revision_id, collection_id: course.id,
    template_text: "T4 - NCRS - Lectures:\nWeek 1:\nSynthetic review [Lecture]",
    ready_questions: 8, review_questions: 2,
  } }));
  await page.getByRole("tab", { name: "Community" }).click();
  const community = page.getByRole("region", { name: "Community Uploads" });
  await expect(community.getByRole("heading", { name: "NCRS" })).toBeVisible();
  await page.screenshot({ path: `/tmp/axom-community-first-${width}.png` });
  await expect(community.getByText("Unreviewed", { exact: true })).toBeVisible();
  await community.getByRole("combobox", { name: "Term" }).selectOption("Term 2");
  await expect(community.getByText("No unreviewed uploads here yet")).toBeVisible();
  await community.getByRole("combobox", { name: "Term" }).selectOption("Term 4");
  const card = community.getByRole("article").filter({ hasText: "Community NCRS review" });
  await card.getByRole("button", { name: "Preview course" }).click();
  await expect(card.getByText("Synthetic review [Lecture]", { exact: false })).toBeVisible();
  await expect(community.getByRole("button", { name: "Choose AXOM folder" })).toBeVisible();
  await expect(community.getByRole("button", { name: "Choose ZIP" })).toBeVisible();
  for (const theme of ["dark", "light"]) {
    await page.locator("html").evaluate((root, value) => root.setAttribute("data-theme", value), theme);
    await page.screenshot({ path: `/tmp/axom-community-${width}-${theme}.png`, fullPage: true });
    expect(await community.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  }
  expect(errors).toEqual([]);
});
