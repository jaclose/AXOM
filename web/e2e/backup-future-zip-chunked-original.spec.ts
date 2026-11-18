import { createHash } from "node:crypto";
import JSZip from "jszip";
import { test, expect } from "@playwright/test";
import { completeSetup, deferPromisePrompt, QUIET_NUDGES } from "./fixtures";
import type { NoctyriumState } from "../src/lib/types";

// Only synthetic bytes in a local browser. No actual learner files or cloud account.
const DOCUMENT_ID = "synthetic-chunked-original";
const CHUNK_BYTES = 8 * 1024 * 1024;
const LOCAL_SIZE = CHUNK_BYTES + 257;
const INCOMING_SIZE = CHUNK_BYTES + 263;
const LOCAL_SEED = 17;
const INCOMING_SEED = 89;
function syntheticBytes(size: number, seed: number): Buffer {
  const bytes = Buffer.allocUnsafe(size);
  for (let i = 0; i < size; i++) bytes[i] = (i * 31 + (i >>> 11) + seed) & 255;
  return bytes;
}
const incomingBytes = syntheticBytes(INCOMING_SIZE, INCOMING_SEED);
const localDigest = createHash("sha256").update(syntheticBytes(LOCAL_SIZE, LOCAL_SEED)).digest("hex");
const incomingDigest = createHash("sha256").update(incomingBytes).digest("hex");

function futureArchive(schemaVersion: unknown): Promise<Buffer> {
  const bytes = incomingBytes;
  const archive = new JSZip();
  archive.file("originals/0", bytes);
  archive.file("workspace.json", JSON.stringify({
    _app: "AXOM", _backupScope: "complete", _backupFormat: "axom-media-backup", _backupVersion: 2,
    schemaVersion, terms: [], profile: { name: "Must not replace local learner" },
    questions: [], tracker: [], media: [],
    documents: [{ id: DOCUMENT_ID, title: "Alternate synthetic version", fileName: "incoming-large.bin",
      fileType: "application/octet-stream", uploadedAt: "2026-11-18T10:00:00.000Z", sizeBytes: bytes.length,
      checksum: incomingDigest, tags: [], linkedQuestionSetIds: [], libraryOnly: true }],
    originals: [{ file: "originals/0", documentId: DOCUMENT_ID, sha256: incomingDigest,
      byteSize: bytes.length, mimeType: "application/octet-stream" }],
  }));
  return archive.generateAsync({ type: "nodebuffer", compression: "STORE" });
}

test("future-schema ZIP refuses Replace and Merge without touching chunked originals or learner state", async ({ page }) => {
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

  await page.evaluate(async ({ size, seed, digest }) => {
    const sourceUrl = "/src/lib/decode/sources.ts";
    const { saveSourceOriginal } = await import(/* @vite-ignore */ sourceUrl) as typeof import("../src/lib/decode/sources");
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<{
      useStore: { getState: () => NoctyriumState; setState: (patch: Partial<NoctyriumState>) => void };
      flushVault: () => Promise<void>;
    }> }).__AXOM_DEV__;
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) bytes[i] = (i * 31 + (i >>> 11) + seed) & 255;
    const blob = new Blob([bytes], { type: "application/octet-stream" });
    const document = {
      id: "synthetic-chunked-original", title: "Local original to retain", fileName: "local-large.bin",
      fileType: "application/octet-stream", uploadedAt: "2026-11-18T09:00:00.000Z", rawText: "Synthetic verified two-chunk source; do not modify",
      sizeBytes: blob.size, checksum: digest, tags: [], linkedQuestionSetIds: [], libraryOnly: true,
    };
    await saveSourceOriginal(document, blob);
    dev.useStore.setState({ documents: [...dev.useStore.getState().documents, document] });
    await dev.flushVault();
  }, { size: LOCAL_SIZE, seed: LOCAL_SEED, digest: localDigest });

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
      const stored = await readSourceOriginal("synthetic-chunked-original", expected);
      const alternative = await readSourceOriginal("synthetic-chunked-original", other);
      const bytes = stored ? await stored.arrayBuffer() : null;
      const fingerprint = bytes ? Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
        byte => byte.toString(16).padStart(2, "0")).join("") : null;
      // Inspect actual IndexedDB records: a refused restore must retain
      // the checksum-addressed manifest and all chunk identities.
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("axom-decode-originals-v1", 2);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const rows = await new Promise<Array<{ key: IDBValidKey; value: unknown }>>((resolve, reject) => {
        const tx = db.transaction("originals", "readonly");
        const store = tx.objectStore("originals");
        const keys = store.getAllKeys();
        const values = store.getAll();
        tx.oncomplete = () => resolve(keys.result.map((key, i) => ({ key, value: values.result[i] })));
        tx.onerror = () => reject(tx.error);
      }).finally(() => db.close());
      const originals = await Promise.all(rows
        .filter(row => JSON.stringify(row.key).includes("synthetic-chunked-original"))
        .map(async row => {
          const data = row.value instanceof Blob ? await row.value.arrayBuffer() : null;
          return {
            key: JSON.stringify(row.key),
            size: data?.byteLength ?? null,
            sha256: data ? Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", data)),
              byte => byte.toString(16).padStart(2, "0")).join("") : null,
            value: data ? null : row.value,
          };
        }));
      originals.sort((a, b) => a.key.localeCompare(b.key));
      const current = dev.useStore.getState();
      return {
        fingerprint,
        byteSize: bytes?.byteLength ?? null,
        originals,
        alternateCached: Boolean(alternative),
        state: JSON.parse(JSON.stringify({
          ...current, activeDayKey: undefined, lastActiveLocalDate: undefined, lastTimezoneOffset: undefined,
        })) as Omit<NoctyriumState, "activeDayKey" | "lastActiveLocalDate" | "lastTimezoneOffset">,
      };
    }, { expected: localDigest, other: incomingDigest });
  };
  const before = await evidence();
  expect(before.fingerprint).toBe(localDigest);
  expect(before.byteSize).toBe(LOCAL_SIZE);
  const chunks = before.originals.filter(row => row.key.startsWith('["chunk",'));
  expect(chunks).toHaveLength(2);
  expect(chunks.map(row => row.size).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([257, CHUNK_BYTES]);
  expect(chunks.every(row => typeof row.sha256 === "string" && row.sha256.length === 64)).toBe(true);
  expect(before.originals.find(row => row.key.startsWith('["version",'))).toMatchObject({
    value: { kind: "chunked-source-original", version: 1, chunkCount: 2,
      chunkBytes: CHUNK_BYTES, byteSize: LOCAL_SIZE, checksum: localDigest },
  });
  expect(before.alternateCached).toBe(false);
  expect(before.state.documents.some(doc => doc.id === DOCUMENT_ID && doc.checksum === localDigest)).toBe(true);

  // Larger synthetic files require several IndexedDB transactions and checksums.
  test.setTimeout(120_000);
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
