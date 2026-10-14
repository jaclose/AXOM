// Opt-in LOCAL academic review queue acceptance. Source question content
// remains in ignored authorized private folders; only counts are logged.
// Never infer clinical answer correctness from a derivative TXT Answer: line.
import { test, expect, seedOnboarded, reloadAfterSave } from "./fixtures";

const sourceDir = process.env.AXOM_PRIVATE_LIBRARY_DIR;
test.skip(!sourceDir, "Set AXOM_PRIVATE_LIBRARY_DIR to the private prepared B1 folder.");
test.use({ trace: "off", screenshot: "off", video: "off" });

test("18 B1 sources preserve 349 review-held candidates and originals without false-ready practice", async ({ page }) => {
  test.setTimeout(90_000);
  await seedOnboarded(page);
  await page.goto("/#questions");
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  const panel = page.getByRole("region", { name: "Prepared library", exact: true });
  if (!await panel.isVisible()) await page.getByText("Local collection transfer and source review", { exact: true }).click();

  async function install() {
    if (!await panel.isVisible()) {
      await page.getByText("Local collection transfer and source review", { exact: true }).click();
      await expect(panel).toBeVisible();
    }
    const chooser = page.waitForEvent("filechooser");
    await panel.getByRole("button", { name: "Install prepared folder" }).click();
    await (await chooser).setFiles(sourceDir!);
    await expect(panel.getByRole("status")).toContainText("Library installed.", { timeout: 60_000 });
    await expect(panel.getByRole("alert")).toHaveCount(0);
  }

  async function stats() {
    return page.evaluate(async () => {
      type State = {
        questions: { id: string }[];
        questionSets: { id: string }[];
        documents: { id: string; fileType: string; rawText: string; checksum?: string }[];
      };
      const dev = await (window as unknown as { __AXOM_DEV__: Promise<{
        flushVault: () => Promise<void>;
        useStore: { getState: () => State };
      }> }).__AXOM_DEV__;
      await dev.flushVault();
      const state = dev.useStore.getState();
      const catalog = state.documents.find(d => d.fileType === "axom-private-library-catalog");
      if (!catalog) return { catalog: false, ready: -1, held: -1, reviewDocs: -1, questionCount: -1, sets: -1, originals: -1 };
      const manifest = JSON.parse(catalog.rawText) as { sources: { checksum: string; ready: number; review: number }[] };
      const review = state.documents.filter(d => d.fileType === "axom-private-bank-review");
      const originals = await import("/src/lib/decode/sources.ts");
      let originalsVerified = 0;
      for (const entry of manifest.sources) {
        const id = `private-source-${entry.checksum}`;
        const blob = await originals.readSourceOriginal(id, `sha256:${entry.checksum}`);
        if (blob?.size) originalsVerified++;
      }
      return {
        catalog: true,
        sources: manifest.sources.length,
        ready: manifest.sources.reduce((n, s) => n + s.ready, 0),
        held: manifest.sources.reduce((n, s) => n + s.review, 0),
        reviewDocs: review.length,
        reviewCandidateCount: review.reduce((n, d) => {
          const bank = JSON.parse(d.rawText) as { pkg: { questions: unknown[] } };
          return n + (bank.pkg?.questions?.length ?? 0);
        }, 0),
        questionCount: state.questions.length,
        sets: state.questionSets.length,
        originalsVerified,
      };
    });
  }

  await install();
  const first = await stats();
  expect(first).toMatchObject({
    catalog: true, sources: 18, ready: 0, held: 349, reviewDocs: 18, reviewCandidateCount: 349,
    questionCount: 0, sets: 0, originalsVerified: 18,
  });
  console.log("Verified B1 private review-only local counts:", JSON.stringify(first));
  await reloadAfterSave(page);
  expect(await stats()).toEqual(first);
  await install();
  expect(await stats()).toEqual(first);
  expect(errors).toEqual([]);
});
