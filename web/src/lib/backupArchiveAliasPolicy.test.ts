// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Blob as NativeBlob, File as NativeFile } from "node:buffer";
import JSZip from "jszip";
import { sha256Hex } from "./checksum";
import { createMediaBackupArchive, readPortableBackup } from "./backupArchive";
import { readSourceOriginal, saveSourceOriginal, SOURCE_ORIGINALS_DB } from "./decode/sources";
import { closeWorkspace, openEmptyWorkspace } from "./question-content/persistenceHarness.testing";
import type { SourceDocument } from "./library";

/**
 * R120 review contract: matching SHA-256 authenticates archive member bytes,
 * not the truth of mutable source metadata. Until a supervised, non-destructive
 * salvage path is designed, contradictory *eligible* root/deferred claims are
 * quarantined before Replace/Merge, even when the original bytes are intact.
 * This fixture does not approve clinical source rights or claim cloud recovery.
 */
beforeEach(async () => {
  await openEmptyWorkspace();
  vi.stubGlobal("Blob", NativeBlob);
  vi.stubGlobal("File", NativeFile);
});

afterEach(async () => {
  await new Promise<void>(resolve => {
    const request = indexedDB.deleteDatabase(SOURCE_ORIGINALS_DB);
    request.onsuccess = () => resolve();
  });
  await closeWorkspace();
  vi.unstubAllGlobals();
});

async function verifiedArchiveFixture() {
  const bytes = new Blob(["Fabricated original document bytes for archive verification."], {
    type: "text/plain",
  });
  const digest = await sha256Hex(await bytes.arrayBuffer());
  const document: SourceDocument = {
    id: "r121b-policy-original", title: "Synthetic source", fileName: "study.txt",
    fileType: "text/plain", uploadedAt: "2026-11-15", rawText: "Fabricated only",
    sizeBytes: bytes.size, checksum: digest, tags: [],
    linkedQuestionSetIds: [], libraryOnly: true,
  };
  await saveSourceOriginal(document, bytes);
  const exported = await createMediaBackupArchive(
    { _app: "AXOM", _backupScope: "complete", documents: [document] },
    [], [document],
  );
  expect(exported.originalCount).toBe(1);
  expect(exported.missingOriginalIds).toEqual([]);
  const zip = await JSZip.loadAsync(new Uint8Array(await exported.blob.arrayBuffer()));
  const manifest = JSON.parse(await zip.file("workspace.json")!.async("string")) as {
    documents: SourceDocument[];
    deferredContent?: { documents: SourceDocument[] };
    originals: { file: string; documentId: string; sha256: string; byteSize: number }[];
  };
  expect(manifest.originals).toHaveLength(1);
  const original = manifest.originals[0];
  const archiveBytes = await zip.file(original.file)!.async("uint8array");
  expect(archiveBytes.byteLength).toBe(bytes.size);
  expect(await sha256Hex(archiveBytes)).toBe(digest);
  expect(original.sha256).toBe(digest);
  expect(original.byteSize).toBe(bytes.size);
  return { document, bytes, digest, zip, manifest };
}

async function withDeferredMirror(
  fixture: Awaited<ReturnType<typeof verifiedArchiveFixture>>,
  alias: SourceDocument,
) {
  fixture.manifest.deferredContent = { documents: [alias] };
  fixture.zip.file("workspace.json", JSON.stringify(fixture.manifest));
  return new File([await fixture.zip.generateAsync({ type: "blob" })], "original-alias-policy.zip");
}

describe("checksum-bound original alias metadata recovery policy", () => {
  it.each(["sizeBytes", "fileType"] as const)(
    "refuses a real-byte ZIP with same-digest conflicting %s before recovery consent",
    async mismatch => {
      const fixture = await verifiedArchiveFixture();
      const alias = {
        ...fixture.document,
        title: "User-renamed mirror", fileName: "mirror.txt",
        ...(mismatch === "sizeBytes"
          ? { sizeBytes: fixture.bytes.size + 1 }
          : { fileType: "application/pdf" }),
      };
      const archive = await withDeferredMirror(fixture, alias);
      await expect(readPortableBackup(archive)).rejects.toThrow(
        mismatch === "sizeBytes"
          ? /conflicting source-document size.*No workspace data has been changed/
          : /conflicting source-document file type.*No workspace data has been changed/,
      );
      // Parsing a rejected archive has not replaced the pre-existing cache.
      const unchanged = await readSourceOriginal(fixture.document.id, fixture.digest);
      expect(await unchanged?.text()).toBe(await fixture.bytes.text());
    },
  );

  it.each(["sizeBytes", "fileType"] as const)(
    "rejects same-digest contradictory %s in a metadata-only JSON without inventing original bytes",
    async mismatch => {
      const fixture = await verifiedArchiveFixture();
      const alias = {
        ...fixture.document,
        ...(mismatch === "sizeBytes"
          ? { sizeBytes: fixture.document.sizeBytes + 1 }
          : { fileType: "application/pdf" }),
      };
      const json = new File([JSON.stringify({
        _app: "AXOM", _backupScope: "complete",
        documents: [fixture.document], deferredContent: { documents: [alias] },
        questionAttachmentPayloads: [],
      })], "metadata-only.json", { type: "application/json" });
      await expect(readPortableBackup(json)).rejects.toThrow(
        mismatch === "sizeBytes" ? /conflicting source-document size/
          : /conflicting source-document file type/,
      );
      // The ZIP exporter embedded real source bytes; this JSON carries no such
      // member, even though its records assert the same checksum.
      expect(JSON.parse(await json.text()).originals).toBeUndefined();
    },
  );

  it("accepts verified ZIP bytes with compatible extension/MIME mirrors and mutable labels", async () => {
    const fixture = await verifiedArchiveFixture();
    const alias: SourceDocument = {
      ...fixture.document, checksum: `sha256:${fixture.digest}`,
      fileType: "txt", title: "Renamed by learner", fileName: "renamed-source.txt",
      tags: ["synthetic-mirror"],
    };
    const archive = await withDeferredMirror(fixture, alias);
    const recovered = await readPortableBackup(archive);
    expect(recovered.omissions).toEqual({ missingBlobKeys: [], missingOriginalIds: [] });
    const workspace = JSON.parse(recovered.rawText);
    expect(workspace.deferredContent.documents[0]).toMatchObject({
      id: fixture.document.id, checksum: `sha256:${fixture.digest}`,
      fileType: "txt", title: "Renamed by learner",
    });
    expect(await (await readSourceOriginal(fixture.document.id, fixture.digest))?.text())
      .toBe(await fixture.bytes.text());
  });
});
