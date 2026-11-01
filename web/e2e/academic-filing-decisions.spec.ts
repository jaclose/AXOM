import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, seedOnboarded, test } from "./fixtures";
import { academicPublishFixture } from "./academicPublishFixture";
import { library } from "../src/lib/academicLibrary/publicationFixture.testing";
import type { PrivateLibraryCatalog } from "../src/lib/privateLibrary/types";

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** The synthetic library, matching review worksheet and decisions export. */
async function reviewedLibrary() {
  const root = await mkdtemp(join(tmpdir(), "axom-filing-"));
  const folder = join(root, "prepared-library");
  const { files } = await library();
  for (const [path, bytes] of files) {
    await mkdir(dirname(join(folder, path)), { recursive: true });
    await writeFile(join(folder, path), bytes);
  }
  const catalog = JSON.parse(new TextDecoder().decode(files.get("catalog.json"))) as PrivateLibraryCatalog;
  const source = catalog.sources.find(entry => entry.name === "unfiled-pq.pdf")!;
  const bankSha256 = sha(files.get(source.bankFile!)!);
  const catalogSha256 = sha(files.get("catalog.json")!);
  const worksheet = join(root, "AXOM-unfiled-review-worksheet.json");
  await writeFile(worksheet, JSON.stringify({ format: "axom-private-filing-proposals", schemaVersion: 1, catalogSha256,
    sources: [{ sourceId: source.id, sourceChecksum: source.checksum, bankFile: source.bankFile,
      originalFile: source.originalFile, bankSha256, proposedTerm: "Term 4", proposedModule: "NCRS" }] }));
  const decisions = join(root, "AXOM-unfiled-decisions.json");
  await writeFile(decisions, JSON.stringify({ format: "axom-private-filing-decisions", schemaVersion: 2,
    catalogSha256, sourceCount: 1, exportedAtUtc: "2026-10-30T17:29:40Z",
    decisions: [{ sourceId: source.id, sourceChecksum: source.checksum, bankSha256,
      action: "accept", term: "Term 4", module: "NCRS", note: "", decidedAtUtc: "2026-10-30T17:19:00Z" }] }));
  return { folder, worksheet, decisions, cleanup: () => rm(root, { recursive: true, force: true }) };
}

for (const width of [1440, 390]) test(`files reviewed sources from a decisions file before publishing at ${width}px`, async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (["error", "warning"].includes(message.type())) errors.push(message.text()); });
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  const backend = await academicPublishFixture(page, { reviewer: true });
  const { folder, worksheet, decisions, cleanup } = await reviewedLibrary();
  try {
    await seedOnboarded(page);
    await page.goto("/?app=1&course-library=1#tracker");
    await page.getByText("Manage sources and custom courses", { exact: true }).click();
    const publisher = page.getByRole("region", { name: "Publish a prepared library" });
    await publisher.locator('input[aria-label="Prepared library folder"]').setInputFiles(folder);
    await expect(publisher).toContainText("3 courses found. 2 courses selected to publish.");
    await expect(publisher).toContainText("Reviewed the unfiled sources?");
    const count = publisher.locator(".academic-publisher-ledger");
    await expect(count).toContainText("6 questions in 5 question sets: 4 in courses (4 ready, 0 awaiting review), 2 of them waiting for a confirmed term, and 2 staying on this device.");
    await expect(count).toContainText("Every question is counted once.");

    await publisher.locator('input[aria-label="Unfiled review worksheet"]').setInputFiles(worksheet);
    await publisher.locator('input[aria-label="Filing decisions file"]').setInputFiles(decisions);
    await expect(publisher).toContainText("1 source filed as you decided. The library on this device is unchanged.");
    await expect(publisher).toContainText("3 courses found. 2 courses selected to publish.");
    await expect(count).toContainText("6 questions in 5 question sets: 5 in courses (5 ready, 0 awaiting review), 2 of them waiting for a confirmed term, and 1 staying on this device.");
    await expect(count).toContainText("Every question is counted once.");
    const ncrs = publisher.locator("article", { hasText: "NCRS" });
    await expect(ncrs).toContainText("2 ready questions");
    await expect(ncrs).toContainText("2 question sets");
    await publisher.getByRole("heading", { name: "Publish a prepared library" }).scrollIntoViewIfNeeded();
    await publisher.screenshot({ path: `/tmp/axom-filing-decisions-${width}.png` });
    expect(await publisher.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);

    // The filed courses pass the same on-device check publishing runs, and nothing uploads.
    await publisher.getByRole("button", { name: "Check 2 courses" }).click();
    await expect(publisher.getByText("All 2 courses are ready to publish. Nothing was uploaded.", { exact: true })).toBeVisible({ timeout: 60_000 });
    expect(backend.calls.filter(call => /academic_create_revision|academic_finish_revision|\/storage\//.test(call))).toEqual([]);

    await publisher.getByRole("button", { name: "Remove decisions" }).click();
    await expect(publisher).toContainText("3 courses found. 2 courses selected to publish.");
    expect(errors).toEqual([]);
  } finally { await cleanup(); }
});
