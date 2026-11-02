import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, seedOnboarded, test } from "./fixtures";
import { academicPublishFixture } from "./academicPublishFixture";
import { library } from "../src/lib/academicLibrary/publicationFixture.testing";

/** The synthetic prepared library, written as a folder a learner would choose. */
async function libraryFolder() {
  const root = await mkdtemp(join(tmpdir(), "axom-publish-"));
  const folder = join(root, "prepared-library");
  const { files } = await library();
  for (const [path, bytes] of files) {
    await mkdir(dirname(join(folder, path)), { recursive: true });
    await writeFile(join(folder, path), bytes);
  }
  return { folder, cleanup: () => rm(root, { recursive: true, force: true }) };
}

for (const width of [1440, 390]) test(`publishes a prepared library as one course per term and module at ${width}px`, async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (["error", "warning"].includes(message.type())) errors.push(message.text()); });
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  const backend = await academicPublishFixture(page, { reviewer: true });
  const { folder, cleanup } = await libraryFolder();
  try {
    await seedOnboarded(page);
    await page.goto("/?app=1&course-library=1#tracker");
    await expect(page.getByRole("heading", { name: "Course Library", level: 1 })).toBeVisible();
    await page.getByText("Manage sources and custom courses", { exact: true }).click();
    const publisher = page.getByRole("region", { name: "Publish a prepared library" });
    await expect(publisher).toBeVisible();
    await publisher.locator('input[aria-label="Prepared library folder"]').setInputFiles(folder);
    await expect(publisher).toContainText("3 courses found. 2 courses selected to publish.");

    const cpr = publisher.locator("article", { hasText: "CPR 1" });
    await expect(cpr).toContainText("The SGU outline lists CPR 1 in Term 1. Confirm the term to publish this course.");
    await publisher.getByRole("heading", { name: "Publish a prepared library" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `/tmp/axom-publish-review-${width}.png` });
    await expect(cpr.getByRole("checkbox")).toBeDisabled();
    await cpr.getByRole("button", { name: "Confirm Term 1" }).click();
    await expect(publisher).toContainText("3 courses selected to publish.");
    await expect(publisher.getByRole("button", { name: "Publish 3 courses" })).toBeDisabled();
    await publisher.getByRole("checkbox", { name: /Approve sharing now/ }).check();
    await publisher.getByRole("checkbox", { name: /right to share this course material/ }).check();
    expect(await publisher.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    for (const theme of ["dark", "light"]) {
      await page.locator("html").evaluate((root, value) => root.setAttribute("data-theme", value), theme);
      await publisher.screenshot({ path: `/tmp/axom-publish-plan-${width}-${theme}.png` });
    }

    // Checking prepares every course on this device and uploads nothing.
    await publisher.getByRole("button", { name: "Check 3 courses" }).click();
    await expect(publisher.getByText("All 3 courses are ready to publish. Nothing was uploaded.", { exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(publisher.getByText("Ready to publish", { exact: true })).toHaveCount(3);
    expect(backend.calls.filter(call => /academic_create_revision|academic_finish_revision|\/storage\//.test(call))).toEqual([]);
    expect(await publisher.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await publisher.screenshot({ path: `/tmp/axom-publish-checked-${width}.png` });

    await publisher.getByRole("button", { name: "Publish 3 courses" }).click();
    await expect(publisher.getByText("3 courses published and verified.", { exact: true })).toBeVisible({ timeout: 90_000 });
    await expect(publisher.getByText("Shared with everyone", { exact: true })).toHaveCount(3);
    await publisher.screenshot({ path: `/tmp/axom-publish-result-${width}.png` });
    const published = backend.collections();
    expect(published.map(entry => [entry.term, entry.module, entry.visibility, entry.review_status, entry.revision?.status]).sort()).toEqual([
      ["Term 1", "CPR 1", "shared", "approved", "ready"], ["Term 4", "NCRS", "shared", "approved", "ready"],
      ["Term 5", "GOER", "shared", "approved", "ready"],
    ]);
    // Every registered file reached Storage byte-for-byte before activation.
    for (const entry of published) for (const file of entry.revision!.files)
      expect(backend.objects.get(file.object_path)?.length).toBe(file.byte_size);

    // The refreshed catalog lists the published courses by term.
    const sections = page.locator(".course-term-section").filter({ has: page.locator("[data-course-id]") });
    await expect(sections.first()).toBeVisible();
    expect(await sections.locator("h2").allTextContents()).toEqual(["Term 1", "Term 4", "Term 5"]);
    const cprCourse = published.find(entry => entry.module === "CPR 1")!;
    await page.locator(`[data-course-id="${cprCourse.id}"]`).click();
    const plan = page.getByRole("region", { name: "CPR 1 course plan" });
    await expect(plan).toBeVisible();
    await expect(plan.getByRole("checkbox", { name: "Week 1", exact: true })).toBeVisible();
    await expect(plan.getByRole("checkbox", { name: "Week 2", exact: true })).toBeVisible();
    await expect(plan).toContainText("4 activities");
    expect(await plan.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/axom-publish-plan-course-${width}.png`, fullPage: true });

    await plan.getByRole("button", { name: "All courses" }).first().click();
    const ncrs = published.find(entry => entry.module === "NCRS")!;
    await page.locator(`[data-course-id="${ncrs.id}"]`).click();
    const collection = page.getByRole("region", { name: "NCRS question collection" });
    await expect(collection).toContainText("This collection has no weekly plan.");
    await collection.getByRole("button", { name: "Download questions" }).click();
    await expect(collection).toContainText("1 reviewed question is on this device.", { timeout: 30_000 });
    await page.screenshot({ path: `/tmp/axom-publish-collection-${width}.png`, fullPage: true });
    await collection.getByRole("button", { name: "Create Quiz" }).click();
    await expect(page).toHaveURL(/#questions/);
    await expect(page.getByLabel("Question stem", { exact: true })).toContainText("Synthetic stem 1 for NCRS?");
    expect(errors).toEqual([]);
  } finally { await cleanup(); }
});
