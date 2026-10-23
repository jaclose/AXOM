// Private, source-backed GOER native-library acceptance. Original material and
// screenshots remain on the authorized local machine in ignored artifacts.
// The test verifies LOCAL workspace persistence, not private cloud readback.
import { test, expect, seedOnboarded, reloadAfterSave } from "./fixtures";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const sourceDir = process.env.AXOM_PRIVATE_LIBRARY_DIR;
const evidenceDir = process.env.AXOM_PRIVATE_VISUAL_DIR;
test.skip(!sourceDir, "Set AXOM_PRIVATE_LIBRARY_DIR to an authorized original GOER prepared library.");
test.use({ trace: "off", screenshot: "off", video: "off" });

test("five canonical GOER sources install private ready questions and figures, survive reimport", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedOnboarded(page);
  await page.goto("/#questions");
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const library = page.getByRole("region", { name: "Prepared library", exact: true });
  const sourceLink = page.getByText("Local collection transfer and source review", { exact: true });
  if (!await library.isVisible()) await sourceLink.click();

  const install = async (button: string) => {
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: button, exact: true }).click();
    await (await chooser).setFiles(sourceDir!);
    await expect(library.getByRole("status")).toContainText("Library installed.", { timeout: 55_000 });
    await expect(library.getByRole("alert")).toHaveCount(0);
  };

  const snapshot = async () => page.evaluate(async () => {
    type Attachment = { assetId?: string; role?: string; blobKey?: string; byteSize?: number };
    type Q = { id: string; content?: { provenance?: { sourceChecksum?: string } }; attachments?: Attachment[]; attempts: unknown[] };
    type Set = { id: string; scope?: { module?: string; week?: number }; questionIds: string[] };
    type Document = { fileType: string };
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<{
      flushVault: () => Promise<void>;
      useStore: { getState: () => { questions: Q[]; questionSets: Set[]; documents: Document[] } };
    }> }).__AXOM_DEV__;
    await dev.flushVault();
    const state = dev.useStore.getState();
    // PackageQuestion.bankId is optional. Stable question-set membership and
    // source provenance are canonical even when a raw question lacks bankId.
    const goerSets = state.questionSets.filter(s => s.scope?.module?.toUpperCase() === "GOER");
    const ids = new Set(goerSets.flatMap(s => s.questionIds));
    const goer = state.questions.filter(q => ids.has(q.id));
    const assets = goer.flatMap(q => q.attachments ?? []);
    const blobStore = await import("/src/lib/questionAttachments.ts");
    let verifiedLocalImages = 0;
    let decodedLocalImages = 0;
    for (const asset of assets) {
      const record = asset.blobKey && await blobStore.getQuestionAttachmentBlob(asset.blobKey, { localOnly: true });
      if (record?.blob && record.blob.size > 0 && record.blob.size === asset.byteSize) verifiedLocalImages++;
      if (record?.blob) {
        const url = URL.createObjectURL(record.blob);
        try {
          const image = new Image(); image.src = url;
          await image.decode();
          if (image.naturalWidth > 0 && image.naturalHeight > 0) decodedLocalImages++;
        } finally { URL.revokeObjectURL(url); }
      }
    }
    return {
      goerQuestionCount: goer.length,
      goerUniqueIds: new Set(goer.map(q => q.id)).size,
      sourceFingerprints: [...new Set(goer.map(q => q.content?.provenance?.sourceChecksum).filter(Boolean))].sort(),
      setCount: goerSets.length,
      attachments: assets.length,
      attachedQuestionCount: goer.filter(q => q.attachments?.length).length,
      assetsWithIdentity: assets.filter(a => a.assetId && a.blobKey).length,
      verifiedLocalImages,
      decodedLocalImages,
      savedReviewDocs: state.documents.filter(d => d.fileType === "axom-private-bank-review").length,
      attempts: goer.reduce((n, q) => n + q.attempts.length, 0),
    };
  });

  await install("Install prepared folder");
  const first = await snapshot();
  // Five physical package folders, five unique sources; only two sources
  // contain the 28 currently validated answer-ready questions.
  expect(first.goerQuestionCount).toBe(28);
  expect(first.goerUniqueIds).toBe(first.goerQuestionCount);
  expect(first.sourceFingerprints).toHaveLength(2);
  expect(first.setCount).toBe(3);
  expect(first.savedReviewDocs).toBe(5);
  expect(first.attachments).toBeGreaterThan(0);
  expect(first.assetsWithIdentity).toBe(first.attachments);
  expect(first.verifiedLocalImages).toBe(first.attachments);
  expect(first.decodedLocalImages).toBe(first.attachments);
  expect(first.attempts).toBe(0);
  console.log("Verified private GOER local install counts:", JSON.stringify({
    ready: first.goerQuestionCount, sets: first.setCount, sourceFingerprints: first.sourceFingerprints.length,
    reviewSources: first.savedReviewDocs, attachments: first.attachments, verifiedImages: first.verifiedLocalImages,
  }));

  await reloadAfterSave(page);
  expect(await snapshot()).toEqual(first);
  if (evidenceDir) {
    await mkdir(evidenceDir, { recursive: true });
    await page.screenshot({ path: join(evidenceDir, "native-goer-library-installed-1440.png"), fullPage: true });
  }
  if (!await library.isVisible()) await sourceLink.click();
  // Folder and ZIP are separate pickers: use the directory-capable control
  // again rather than trying to pass a folder to the ZIP-only update button.
  await install("Install prepared folder");
  expect(await snapshot()).toEqual(first);
  await page.getByRole("button", { name: "Browse weeks", exact: true }).click();
  const bank = page.getByRole("region", { name: "Course question bank" });
  await bank.getByRole("button", { name: "Practice week", exact: true }).click();
  await page.getByLabel("Custom question count").fill("2");
  await page.getByRole("button", { name: "Start tutor block", exact: true }).click();
  const player = page.locator(".quiz-player-modal");
  await expect(player).toBeVisible();
  await expect(player.getByRole("button", { name: "Questions", exact: true })).toHaveCount(0);
  await expect(player.getByRole("button", { name: "Slides", exact: true })).toHaveCount(0);
  const choices = player.locator(".option-pick");
  await choices.first().click();
  await player.getByRole("button", { name: /^Eliminate option/ }).last().click();
  await player.getByRole("button", { name: "Save & exit", exact: true }).click();
  await expect(player).toHaveCount(0);
  await reloadAfterSave(page);
  await expect(player).toBeVisible();
  await expect(player.getByRole("button", { name: /^Restore option/ })).toHaveCount(1);
  await player.getByRole("button", { name: "Check answer", exact: true }).click();
  await player.getByRole("button", { name: "Next question", exact: true }).click();
  await player.locator(".option-pick").first().click();
  await player.getByRole("button", { name: "Check answer", exact: true }).click();
  if (evidenceDir) {
    await page.screenshot({ path: join(evidenceDir, "goer-weekly-quiz-1440.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: join(evidenceDir, "goer-weekly-quiz-390.png"), fullPage: true });
    expect(await player.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  }
  await player.getByRole("button", { name: "Finish block", exact: true }).click();
  await page.getByRole("button", { name: "Review answers and Decode", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Review saved block", exact: true })).toBeVisible();
  expect((await snapshot()).attempts).toBe(2);
  await reloadAfterSave(page);
  expect((await snapshot()).attempts).toBe(2);
  expect(errors).toEqual([]);
});
