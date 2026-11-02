import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, seedOnboarded, test } from "./fixtures";
import { academicPublishFixture } from "./academicPublishFixture";
import { library } from "../src/lib/academicLibrary/publicationFixture.testing";

async function libraryFolder() {
  const root = await mkdtemp(join(tmpdir(), "axom-manage-"));
  const folder = join(root, "prepared-library");
  for (const [path, bytes] of (await library()).files) {
    await mkdir(dirname(join(folder, path)), { recursive: true });
    await writeFile(join(folder, path), bytes);
  }
  return { folder, cleanup: () => rm(root, { recursive: true, force: true }) };
}

for (const width of [1440, 390]) test(`shares and approves every published course at once at ${width}px`, async ({ page }) => {
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
    await page.getByText("Manage sources and custom courses", { exact: true }).click();

    // Publish privately first, as an owner would before reviewer access exists.
    const publisher = page.getByRole("region", { name: "Publish a prepared library" });
    await publisher.locator('input[aria-label="Prepared library folder"]').setInputFiles(folder);
    await expect(publisher).toContainText("2 courses selected to publish.");
    await publisher.getByRole("checkbox", { name: "Share with every signed-in AXOM account" }).uncheck();
    await publisher.getByRole("button", { name: "Publish 2 courses" }).click();
    await expect(publisher.getByText("2 courses published and verified.", { exact: true })).toBeVisible({ timeout: 90_000 });
    expect(backend.collections().map(entry => entry.visibility)).toEqual(["private", "private"]);

    const manager = page.getByRole("region", { name: "Your published courses" });
    await manager.getByRole("button", { name: "Show my courses" }).click();
    await expect(manager.locator(".academic-manager-summary")).toHaveText("2 courses: 2 private.");
    const share = manager.getByRole("button", { name: "Share 2 private courses" });
    await expect(share).toBeDisabled();
    await manager.getByRole("checkbox", { name: /right to share this course material/ }).check();
    await manager.getByRole("checkbox", { name: /Approve them now/ }).check();
    await manager.getByRole("heading", { name: "Your published courses" }).scrollIntoViewIfNeeded();
    for (const theme of ["dark", "light"]) {
      await page.locator("html").evaluate((root, value) => root.setAttribute("data-theme", value), theme);
      await manager.screenshot({ path: `/tmp/axom-manage-ready-${width}-${theme}.png` });
    }
    await share.click();
    await expect(manager.getByRole("status")).toHaveText("2 courses shared and approved. Every signed-in AXOM account can now find them.");
    await expect(manager.locator(".academic-manager-summary")).toHaveText("2 courses: 2 shared with everyone.");
    await manager.getByText("Show all 2 courses").click();
    await expect(manager.getByText("Shared with everyone", { exact: true })).toHaveCount(2);
    expect(await manager.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await manager.screenshot({ path: `/tmp/axom-manage-done-${width}.png` });
    expect(backend.collections().map(entry => [entry.module, entry.visibility, entry.review_status]).sort()).toEqual([
      ["GOER", "shared", "approved"], ["NCRS", "shared", "approved"],
    ]);
    expect(errors).toEqual([]);
  } finally { await cleanup(); }
});
