import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import { test, expect, seedOnboarded, reloadAfterSave } from "./fixtures";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg==", "base64");
const ORIGINAL = "Synthetic private source bytes for portable ZIP recovery.\n";
const QUESTION_ID = "r105-zip-synthetic-question";
const DOCUMENT_ID = "r105-zip-synthetic-source";
const BLOB_KEY = "r105-zip-synthetic-figure";
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Actual Chromium ZIP download and recovery with fabricated local-only bytes.
 * No production account, network service, private study material or seeded user data.
 * This complements the separate user-authorized private-backup acceptance test.
 */
test("complete ZIP downloads exact image and source bytes and restores both after reload", async ({ page, context, browser }) => {
  test.setTimeout(150_000);
  const origin = new URL(process.env.AXOM_E2E_BASE_URL ?? "http://127.0.0.1:5187").origin;
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
    throw new Error("ZIP browser acceptance requires an isolated loopback app.");
  }
  const blockExternal = (route: import("@playwright/test").Route) =>
    new URL(route.request().url()).origin === origin ? route.continue() : route.abort();
  await context.route("**/*", blockExternal);

  await page.goto(`${origin}/?app=1#dashboard`, { waitUntil: "networkidle" });
  await seedOnboarded(page, { name: "Synthetic ZIP source" });
  const note = "Synthetic ZIP notes survive separate-profile restoration";
  const checksum = sha256(Buffer.from(ORIGINAL));
  await page.evaluate(async ({ png, originalText, checksum, note }) => {
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<{
      useStore: { getState: () => { questions: { id: string }[]; documents: { id: string }[] }; setState: (patch: Record<string, unknown>) => void };
      flushVault: () => Promise<void>;
    }> }).__AXOM_DEV__;
    const { useStore, flushVault } = dev;
    const createdAt = "2026-11-14T00:00:00.000Z";
    const pngBytes = Uint8Array.from(atob(png), character => character.charCodeAt(0));
    const attachment = {
      id: "r105-figure", blobKey: "r105-zip-synthetic-figure", fileName: "fabricated.png",
      mimeType: "image/png", byteSize: pngBytes.length, altText: "Fabricated image",
      createdAt, updatedAt: createdAt, role: "question",
    };
    const document = {
      id: "r105-zip-synthetic-source", title: "Fabricated source", fileName: "fabricated.txt",
      fileType: "text/plain", uploadedAt: "2026-11-14", rawText: originalText,
      sizeBytes: new TextEncoder().encode(originalText).length, checksum,
      tags: [], linkedQuestionSetIds: [], libraryOnly: true,
    };
    const question = {
      id: "r105-zip-synthetic-question", stem: "Fabricated question",
      options: [{ key: "A", text: "Fabricated answer" }], correctKey: "A",
      source: "manual", status: "unseen", tags: [], attempts: [],
      notes: note, attachments: [attachment], createdAt, updatedAt: createdAt,
    };
    useStore.setState({
      questions: [...useStore.getState().questions.filter(q => q.id !== question.id), question],
      documents: [...useStore.getState().documents.filter(d => d.id !== document.id), document],
    });
    const attachmentsPath = "/src/lib/questionAttachments.ts";
    const originalsPath = "/src/lib/decode/sources.ts";
    const { putQuestionAttachmentBlob } = await import(/* @vite-ignore */ attachmentsPath);
    const { saveSourceOriginal } = await import(/* @vite-ignore */ originalsPath);
    await putQuestionAttachmentBlob(attachment.blobKey, {
      blob: new Blob([pngBytes], { type: "image/png" }), mimeType: "image/png",
      byteSize: pngBytes.length, questionId: question.id, updatedAt: createdAt,
    });
    await saveSourceOriginal(document, new Blob([originalText], { type: "text/plain" }));
    await flushVault();
  }, { png: PNG.toString("base64"), originalText: ORIGINAL, checksum, note });
  await reloadAfterSave(page);

  await page.getByTitle("Settings", { exact: true }).click();
  await page.getByRole("tab", { name: "Emergency recovery", exact: true }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export complete backup", exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^axom-backup-\d{4}-\d{2}-\d{2}\.zip$/);
  const path = await download.path();
  if (!path) throw new Error("Chromium did not save a physical ZIP download.");
  const zipBytes = await readFile(path);
  expect(zipBytes.length).toBeGreaterThan(PNG.length + Buffer.byteLength(ORIGINAL));
  const zip = await JSZip.loadAsync(zipBytes, { checkCRC32: true });
  const workspaceFile = zip.file("workspace.json");
  if (!workspaceFile) throw new Error("Exported ZIP has no workspace.json.");
  const exported = JSON.parse(await workspaceFile.async("string")) as {
    _backupScope: string;
    questions: { id: string; notes?: string }[];
    documents: { id: string; checksum: string }[];
    media: { file: string; metadata: { blobKey: string } }[];
    originals: { file: string; documentId: string; sha256: string; byteSize: number }[];
  };
  expect(exported._backupScope).toBe("complete");
  expect(exported.questions.find(q => q.id === QUESTION_ID)?.notes).toBe(note);
  expect(exported.documents.find(d => d.id === DOCUMENT_ID)?.checksum).toBe(checksum);
  const image = exported.media.find(m => m.metadata.blobKey === BLOB_KEY);
  const source = exported.originals.find(o => o.documentId === DOCUMENT_ID);
  expect(exported.media).toHaveLength(1);
  expect(exported.originals).toHaveLength(1);
  expect(image).toBeDefined();
  expect(source).toMatchObject({ sha256: checksum, byteSize: Buffer.byteLength(ORIGINAL) });
  expect(sha256(await zip.file(image!.file)!.async("uint8array"))).toBe(sha256(PNG));
  expect(sha256(await zip.file(source!.file)!.async("uint8array"))).toBe(checksum);
  await expect(page.locator(".backup-status")).toContainText("Check that the file exists");
  const lastCompleteExport = await page.evaluate(async () => {
    const { lastBackupAt } = await import(/* @vite-ignore */ "/src/lib/backup.ts");
    return lastBackupAt();
  });
  expect(lastCompleteExport).toMatch(/^\d{4}-\d{2}-\d{2}T/);

  const recovery = await browser.newContext({ acceptDownloads: true, reducedMotion: "reduce" });
  try {
    await recovery.route("**/*", blockExternal);
    const restored = await recovery.newPage();
    await restored.goto(`${origin}/?app=1#dashboard`, { waitUntil: "networkidle" });
    await seedOnboarded(restored, { name: "Distinct synthetic ZIP recovery target" });
    const inspect = () => restored.evaluate(async ({ questionId, documentId, blobKey }) => {
      const dev = await (window as unknown as { __AXOM_DEV__: Promise<{
        useStore: { getState: () => {
          questions: { id: string; notes?: string }[];
          documents: { id: string; checksum?: string }[];
        } };
      }> }).__AXOM_DEV__;
      const state = dev.useStore.getState();
      const question = state.questions.find(q => q.id === questionId);
      const document = state.documents.find(d => d.id === documentId);
      const attachmentsPath = "/src/lib/questionAttachments.ts";
      const originalsPath = "/src/lib/decode/sources.ts";
      const { getQuestionAttachmentBlob } = await import(/* @vite-ignore */ attachmentsPath);
      const { readSourceOriginal } = await import(/* @vite-ignore */ originalsPath);
      const image = await getQuestionAttachmentBlob(blobKey, { localOnly: true });
      const source = document ? await readSourceOriginal(document.id, document.checksum) : null;
      const hash = async (blob: Blob | undefined | null) => blob
        ? Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())),
          value => value.toString(16).padStart(2, "0")).join("") : null;
      return { note: question?.notes ?? null, documentChecksum: document?.checksum ?? null,
        imageSha: await hash(image?.blob), originalSha: await hash(source) };
    }, { questionId: QUESTION_ID, documentId: DOCUMENT_ID, blobKey: BLOB_KEY });
    expect(await inspect()).toEqual({ note: null, documentChecksum: null, imageSha: null, originalSha: null });
    await restored.getByTitle("Settings", { exact: true }).click();
    await restored.getByRole("tab", { name: "Emergency recovery", exact: true }).click();
    const chooser = restored.waitForEvent("filechooser");
    await restored.getByRole("button", { name: "Choose backup to restore", exact: true }).click();
    restored.once("dialog", dialog => void dialog.accept());
    await (await chooser).setFiles({
      name: download.suggestedFilename(), mimeType: "application/zip", buffer: zipBytes,
    });
    await expect(restored.locator(".backup-status")).toContainText("Saved on this device.", { timeout: 60_000 });
    const expected = { note, documentChecksum: checksum, imageSha: sha256(PNG), originalSha: checksum };
    expect(await inspect()).toEqual(expected);
    await reloadAfterSave(restored);
    expect(await inspect()).toEqual(expected);
  } finally {
    await recovery.close();
  }
});


test("a ZIP with a missing original discloses the gap before and after separate-profile recovery", async ({ page, context, browser }) => {
  test.setTimeout(75_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const origin = new URL(process.env.AXOM_E2E_BASE_URL ?? "http://127.0.0.1:5187").origin;
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
    throw new Error("Incomplete ZIP acceptance requires an isolated loopback app.");
  }
  await context.route("**/*", route =>
    new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto(`${origin}/?app=1#dashboard`, { waitUntil: "networkidle" });
  await seedOnboarded(page, { name: "Synthetic missing-original source" });
  const missingSourceText = "Original deliberately not stored";
  const sourceHash = sha256(Buffer.from(missingSourceText));
  await page.evaluate(async ({ checksum, sourceText }) => {
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<{
      useStore: { getState: () => { documents: { id: string }[] }; setState: (patch: Record<string, unknown>) => void };
      flushVault: () => Promise<void>;
    }> }).__AXOM_DEV__;
    const doc = {
      id: "r105-uncached-original", title: "Uncached fabricated file", fileName: "not-cached.txt",
      fileType: "text/plain", uploadedAt: "2026-11-14", rawText: sourceText,
      sizeBytes: new TextEncoder().encode(sourceText).byteLength, checksum, tags: [], linkedQuestionSetIds: [], libraryOnly: true,
    };
    const { useStore, flushVault } = dev;
    useStore.setState({ documents: [...useStore.getState().documents.filter(d => d.id !== doc.id), doc] });
    await flushVault();
  }, { checksum: sourceHash, sourceText: missingSourceText });
  await reloadAfterSave(page);
  await page.getByRole("button", { name: "Open navigation menu" }).click();
  await page.locator(".server-header").click();
  await page.getByRole("combobox", { name: "Settings section" }).selectOption("backup");
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export complete backup", exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(/\.zip$/);
  const file = await download.path();
  if (!file) throw new Error("The partial ZIP was not saved by Chromium.");
  const zip = await JSZip.loadAsync(await readFile(file), { checkCRC32: true });
  const workspace = zip.file("workspace.json");
  if (!workspace) throw new Error("Partial ZIP has no workspace manifest.");
  const payload = JSON.parse(await workspace.async("string")) as {
    _backupScope: string;
    documents: { id: string; checksum: string }[];
    originals: { documentId: string }[];
  };
  expect(payload._backupScope).toBe("complete");
  expect(payload.documents).toContainEqual(expect.objectContaining({ id: "r105-uncached-original", checksum: sourceHash }));
  expect(payload.originals.some(original => original.documentId === "r105-uncached-original")).toBe(false);
  await expect(page.locator(".backup-status")).toContainText("This copy is incomplete, not a verified full backup.");
  await expect(page.locator(".backup-status")).toContainText("1 original files were unavailable");
  const timestamp = await page.evaluate(async () => {
    const path = "/src/lib/backup.ts";
    const { lastBackupAt } = await import(/* @vite-ignore */ path);
    return lastBackupAt();
  });
  expect(timestamp).toBeNull();

  const restoreProfile = await browser.newContext({ acceptDownloads: true, reducedMotion: "reduce", viewport: { width: 390, height: 844 } });
  try {
    await restoreProfile.route("**/*", route =>
      new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const restored = await restoreProfile.newPage();
    await restored.goto(`${origin}/?app=1#dashboard`, { waitUntil: "networkidle" });
    await seedOnboarded(restored, { name: "Fresh partial ZIP recovery target" });
    const inspect = () => restored.evaluate(async () => {
      const dev = await (window as unknown as { __AXOM_DEV__: Promise<{
        useStore: { getState: () => { documents: { id: string; checksum?: string }[] } };
      }> }).__AXOM_DEV__;
      const document = (await dev).useStore.getState().documents.find(d => d.id === "r105-uncached-original");
      const { readSourceOriginal } = await import(/* @vite-ignore */ "/src/lib/decode/sources.ts");
      return { checksum: document?.checksum ?? null,
        originalPresent: !!(document && await readSourceOriginal(document.id, document.checksum)) };
    });
    expect(await inspect()).toEqual({ checksum: null, originalPresent: false });
    await restored.getByRole("button", { name: "Open navigation menu" }).click();
    await restored.locator(".server-header").click();
    await restored.getByRole("combobox", { name: "Settings section" }).selectOption("backup");
    const chooser = restored.waitForEvent("filechooser");
    await restored.getByRole("button", { name: "Choose backup to restore", exact: true }).click();
    const confirmations: string[] = [];
    restored.on("dialog", dialog => {
      confirmations.push(dialog.message());
      void dialog.accept();
    });
    await (await chooser).setFiles({
      name: download.suggestedFilename(), mimeType: "application/zip", buffer: await readFile(file),
    });
    await expect(restored.locator(".backup-status")).toContainText("Saved on this device.", { timeout: 60_000 });
    expect(confirmations).toHaveLength(1);
    expect(confirmations[0]).toContain("This ZIP is incomplete: 0 referenced image attachment(s) and 1 original file(s)");
    await expect(restored.locator(".backup-status")).toContainText("This ZIP is incomplete");
    await expect(restored.locator(".backup-status")).toContainText("their bytes cannot be restored from this copy");
    expect(await inspect()).toEqual({ checksum: sourceHash, originalPresent: false });
    await reloadAfterSave(restored);
    expect(await inspect()).toEqual({ checksum: sourceHash, originalPresent: false });
  } finally {
    await restoreProfile.close();
  }
});
