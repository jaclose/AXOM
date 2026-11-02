import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, seedOnboarded, test } from "./fixtures";
import { academicPublishFixture, learnerCatalog } from "./academicPublishFixture";
import { library } from "../src/lib/academicLibrary/publicationFixture.testing";
import type { PreparedBank } from "../src/lib/privateLibrary/types";

async function libraryFolder() {
  const root = await mkdtemp(join(tmpdir(), "axom-manage-"));
  const folder = join(root, "prepared-library");
  for (const [path, sourceBytes] of (await library()).files) {
    let bytes = sourceBytes;
    if (path.endsWith("/bank.json")) {
      const prepared = JSON.parse(new TextDecoder().decode(sourceBytes)) as PreparedBank;
      for (const question of prepared.pkg.questions)
        question.explanation = [{ type: "text", text: "Synthetic rationale checked against the invented source." }];
      bytes = new TextEncoder().encode(JSON.stringify(prepared));
    }
    await mkdir(dirname(join(folder, path)), { recursive: true });
    await writeFile(join(folder, path), bytes);
  }
  return { folder, cleanup: () => rm(root, { recursive: true, force: true }) };
}

for (const width of [1440, 390]) test(`shares courses for review before exact-revision approval at ${width}px`, async ({ page }) => {
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
    await publisher.getByRole("checkbox", { name: "Submit for academic review to share with every signed-in AXOM account" }).uncheck();
    await publisher.getByRole("button", { name: "Publish 2 courses" }).click();
    await expect(publisher.getByText("2 courses published and verified.", { exact: true })).toBeVisible({ timeout: 90_000 });
    expect(backend.collections().map(entry => entry.visibility)).toEqual(["private", "private"]);

    const manager = page.getByRole("region", { name: "Your published courses" });
    await manager.getByRole("button", { name: "Show my courses" }).click();
    await expect(manager.locator(".academic-manager-summary")).toHaveText("2 courses: 2 private.");
    const share = manager.getByRole("button", { name: "Share 2 private courses" });
    await expect(share).toBeDisabled();
    await manager.getByRole("checkbox", { name: /right to share this course material/ }).check();
    await expect(manager.getByRole("button", { name: "Check stored explanations" })).toHaveCount(0);
    await manager.getByRole("heading", { name: "Your published courses" }).scrollIntoViewIfNeeded();
    for (const theme of ["dark", "light"]) {
      await page.locator("html").evaluate((root, value) => root.setAttribute("data-theme", value), theme);
      await manager.screenshot({ path: `/tmp/axom-manage-ready-${width}-${theme}.png` });
    }
    await share.click();
    await expect(manager.getByRole("status")).toHaveText("2 courses shared for review. Other accounts can find them only after academic approval.");
    expect(backend.collections().map(entry => [entry.visibility, entry.review_status])).toEqual([["shared", "pending"], ["shared", "pending"]]);
    expect(backend.calls.filter(call => call.endsWith("/rpc/academic_review"))).toEqual([]);
    expect(await learnerCatalog(page)).toEqual([]);
    const approve = manager.getByRole("button", { name: "Approve 2 courses" });
    await expect(approve).toBeDisabled();
    await manager.getByRole("button", { name: "Check stored explanations" }).click();
    await expect(manager.getByRole("status")).toContainText("Explanation readback complete: 0 ready questions without an explanation.");
    await manager.getByRole("checkbox", { name: /I checked every stored explanation/ }).check();
    await approve.click();
    await expect(manager.getByRole("status")).toHaveText("2 courses approved. Every signed-in AXOM account can now find them.");
    await expect(manager.locator(".academic-manager-summary")).toHaveText("2 courses: 2 shared with everyone.");
    await manager.getByText("Show all 2 courses").click();
    await expect(manager.getByText("Shared with everyone", { exact: true })).toHaveCount(2);
    expect(await manager.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await manager.screenshot({ path: `/tmp/axom-manage-done-${width}.png` });
    expect(backend.collections().map(entry => [entry.module, entry.visibility, entry.review_status]).sort()).toEqual([
      ["GOER", "shared", "approved"], ["NCRS", "shared", "approved"],
    ]);
    expect((await learnerCatalog(page)).map(entry => entry.id).sort()).toEqual(backend.collections().map(entry => entry.id).sort());
    expect(errors).toEqual([]);
  } finally { await cleanup(); }
});
