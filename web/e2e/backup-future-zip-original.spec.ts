import { createHash } from "node:crypto";
import JSZip from "jszip";
import { test, expect } from "@playwright/test";
import { completeSetup, deferPromisePrompt, QUIET_NUDGES } from "./fixtures";
import type { NoctyriumState } from "../src/lib/types";

// Only synthetic bytes in a local browser. No actual learner files or cloud account.
const DOCUMENT_ID = "synthetic-immutable-original";
const LOCAL_TEXT = "Synthetic source original retained on this device.";
const INCOMING_TEXT = "Different synthetic source bytes from a newer AXOM backup.";
const checksum = (text: string) => createHash("sha256").update(text).digest("hex");
const localDigest = checksum(LOCAL_TEXT);
const incomingDigest = checksum(INCOMING_TEXT);

function futureArchive(schemaVersion: unknown): Promise<Buffer> {
  const bytes = Buffer.from(INCOMING_TEXT, "utf8");
  const archive = new JSZip();
  archive.file("originals/0", bytes);
  archive.file("workspace.json", JSON.stringify({
    _app: "AXOM", _backupScope: "complete", _backupFormat: "axom-media-backup", _backupVersion: 2,
    schemaVersion, terms: [], profile: { name: "Must not replace local learner" },
    questions: [], tracker: [], media: [],
    documents: [{ id: DOCUMENT_ID, title: "Alternate synthetic version", fileName: "alternate.txt",
      fileType: "text/plain", uploadedAt: "2026-11-18T10:00:00.000Z", sizeBytes: bytes.length,
      checksum: incomingDigest, tags: [], linkedQuestionSetIds: [], libraryOnly: true }],
    originals: [{ file: "originals/0", documentId: DOCUMENT_ID, sha256: incomingDigest,
      byteSize: bytes.length, mimeType: "text/plain" }],
  }));
  return archive.generateAsync({ type: "nodebuffer", compression: "STORE" });
}

test("future-schema ZIP rejects Replace and Merge without touching original bytes or learner state", async ({ page }) => {
  const origin = new URL(process.env.AXOM_E2E_BASE_URL ?? "http://127.0.0.1:5187");
  if (origin.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(origin.hostname)) {
    throw new Error("Synthetic ZIP recovery requires an isolated local AXOM origin.");
  }
  await page.route("**/*", route => new URL(route.request().url()).origin === origin.origin
    ? route.continue() : route.abort());
  await page.addInitScript(entries => {
    for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
  }, QUIET_NUDGES);
  await page.goto("/?app=1#dashboard", { waitUntil: "networkidle" });
  await completeSetup(page, "Synthetic ZIP original guard");
  await deferPromisePrompt(page);

  await page.evaluate(async ({ originalText, digest }) => {
    const sourceUrl = "/src/lib/decode/sources.ts";
    const { saveSourceOriginal } = await import(/* @vite-ignore */ sourceUrl) as typeof import("../src/lib/decode/sources");
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<{
      useStore: { getState: () => NoctyriumState; setState: (patch: Partial<NoctyriumState>) => void };
      flushVault: () => Promise<void>;
    }> }).__AXOM_DEV__;
    const blob = new Blob([originalText], { type: "text/plain" });
    const document = {
      id: "synthetic-immutable-original", title: "Local original to retain", fileName: "local.txt",
      fileType: "text/plain", uploadedAt: "2026-11-18T09:00:00.000Z", rawText: originalText,
      sizeBytes: blob.size, checksum: digest, tags: [], linkedQuestionSetIds: [], libraryOnly: true,
    };
    await saveSourceOriginal(document, blob);
    dev.useStore.setState({ documents: [...dev.useStore.getState().documents, document] });
    await dev.flushVault();
  }, { originalText: LOCAL_TEXT, digest: localDigest });

  // Normalize first-load defaults, then compare both JSON state and true binary bytes.
  await page.reload({ waitUntil: "networkidle" });
  const evidence = async () => {
    await page.waitForFunction(() => Boolean((window as unknown as { __AXOM_DEV__?: unknown }).__AXOM_DEV__));
    return page.evaluate(async ({ expected, other }) => {
      const sourceUrl = "/src/lib/decode/sources.ts";
      const { readSourceOriginal } = await import(/* @vite-ignore */ sourceUrl) as typeof import("../src/lib/decode/sources");
      const dev = await (window as unknown as { __AXOM_DEV__: Promise<{
        useStore: { getState: () => NoctyriumState }; flushVault: () => Promise<void>;
      }> }).__AXOM_DEV__;
      await dev.flushVault();
      const stored = await readSourceOriginal("synthetic-immutable-original", expected);
      const alternative = await readSourceOriginal("synthetic-immutable-original", other);
      const bytes = stored ? await stored.arrayBuffer() : null;
      const fingerprint = bytes ? Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
        byte => byte.toString(16).padStart(2, "0")).join("") : null;
      const current = dev.useStore.getState();
      return {
        fingerprint,
        bytes: bytes ? Array.from(new Uint8Array(bytes)) : null,
        alternateCached: Boolean(alternative),
        state: JSON.parse(JSON.stringify({
          ...current, activeDayKey: undefined, lastActiveLocalDate: undefined, lastTimezoneOffset: undefined,
        })) as Omit<NoctyriumState, "activeDayKey" | "lastActiveLocalDate" | "lastTimezoneOffset">,
      };
    }, { expected: localDigest, other: incomingDigest });
  };
  const before = await evidence();
  expect(before.fingerprint).toBe(localDigest);
  expect(before.alternateCached).toBe(false);
  expect(before.state.documents.some(doc => doc.id === DOCUMENT_ID && doc.checksum === localDigest)).toBe(true);

  await page.getByTitle("Settings", { exact: true }).click();
  await page.getByRole("tab", { name: "Emergency recovery", exact: true }).click();
  const dialogs: string[] = [];
  page.on("dialog", dialog => { dialogs.push(dialog.message()); void dialog.dismiss(); });

  for (const entry of [
    { button: "Choose backup to restore", name: "synthetic-future-original.zip",
      version: 999999, message: "This backup uses a newer AXOM data version. Update AXOM before restoring it." },
    { button: "Choose backup to merge", name: "synthetic-invalid-version-original.zip",
      version: "999999", message: "This backup has an invalid AXOM data version. Verify the file before restoring it." },
  ]) {
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: entry.button, exact: true }).click();
    await (await chooser).setFiles({
      name: entry.name, mimeType: "application/zip", buffer: await futureArchive(entry.version),
    });
    // Messages differ between the two operations, so a stale success or error
    // from Replace cannot satisfy Merge's expected rejection.
    await expect(page.locator(".backup-status[role=status]")).toContainText(`Recovery did not finish. ${entry.message}`);
    expect(dialogs).toEqual([]);
    expect(await evidence()).toEqual(before);
  }

  await page.reload({ waitUntil: "networkidle" });
  expect(await evidence()).toEqual(before);
});
