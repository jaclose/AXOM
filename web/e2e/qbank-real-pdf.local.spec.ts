// Private, opt-in validation. Always send --output outside Git; failure snapshots contain source text.
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { test, expect, seedOnboarded, reloadAfterSave } from "./fixtures";
const knownBankManifests = ["biostats-epidemiology", "endocrine-pathophysiology", "pharmacodynamics-pk"].map(name => JSON.parse(readFileSync(join(process.cwd(), "../fixtures/qbank/goer/t5/week-02", name, "manifest.json"), "utf8")));
const sourceFolder = process.env.AXOM_QBANK_SOURCES;
test.use({ trace: "off", screenshot: "off", video: "off" });
test.skip(!sourceFolder, "Set AXOM_QBANK_SOURCES to validate private PDFs through the actual app.");

test("three private PDFs through the actual QBank, with uncertain keys excluded and images retained", async ({ page }) => {
  test.setTimeout(180000);
  await seedOnboarded(page);
  await page.goto("/#questions");
  for (const manifest of knownBankManifests) {
    await page.getByRole("tablist", { name: "Question Bank sections" }).getByRole("tab", { name: "Import", exact: true }).click();
    const another = page.getByRole("button", { name: "Choose another file" });
    if (await another.isVisible()) await another.click();
    await page.getByLabel("Choose a question file to import").setInputFiles(join(sourceFolder!, manifest.source.filename));
    const preview = page.getByRole("region", { name: "PDF bank preview" });
    await expect(preview).toBeVisible({ timeout: 120000 });
    await expect(preview.getByLabel("Bank module")).toHaveValue("GOER");
    await expect(preview.getByLabel("Bank term")).toHaveValue("5");
    await expect(preview.getByLabel("Bank week")).toHaveValue("2");
    if (manifest.bank.id.includes("pharmacodynamics")) {
      await expect(preview).toContainText("15 questions · 0 ready · 15 need review");
      await expect(preview.getByRole("button", { name: "Import 0 verified questions" })).toBeDisabled();
    } else {
      const count = manifest.bank.id.includes("biostats") ? 15 : 17;
      await preview.getByRole("button", { name: `Import ${count} verified questions` }).click();
      await expect(preview).toContainText(`${count} questions saved on this device.`);
      await preview.getByRole("button", { name: "Open imported bank" }).click();
    }
  }
  await reloadAfterSave(page);
  const summary = await page.evaluate(async () => {
    type Q = { content?: { bankId: string; stem: { type: string }[] }; attempts: unknown[]; attachments?: { blobKey: string; assetId?: string }[] };
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<{ useStore: { getState: () => { questions: Q[]; questionSets: unknown[] } } }> }).__AXOM_DEV__;
    const state = dev.useStore.getState();
    return { questions: state.questions.length, structured: state.questions.filter(q => q.content).length, tables: state.questions.flatMap(q => q.content?.stem ?? []).filter(b => b.type === "table").length, images: state.questions.flatMap(q => q.attachments ?? []).length, identities: state.questions.flatMap(q => q.attachments ?? []).every(a => a.assetId), sets: state.questionSets.length };
  });
  expect(summary).toMatchObject({ questions: 32, structured: 32, sets: 3, identities: true });
  expect(summary.tables).toBeGreaterThan(0);
  expect(summary.images).toBeGreaterThan(0);
  console.log("Real app import counts:", JSON.stringify(summary));
});
