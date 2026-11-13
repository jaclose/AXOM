// @vitest-environment jsdom
// Explicit private local fixture. Do not commit the student's source ZIP.
import { readFileSync } from "node:fs";
import { Blob as NativeBlob, File as NativeFile } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "../store";
import { openEmptyWorkspace, closeWorkspace, reloadWorkspace } from "../question-content/persistenceHarness.testing";
import { sha256, readImageInfo } from "../question-content/assets";
import { zipLibraryReader, readCatalog, readPreparedBank, installPrivateLibrary } from "./install";
import { getQuestionAttachmentBlob, setMissingAttachmentLoader } from "../questionAttachments";
import { PRIVATE_REVIEW_DOCUMENT } from "./types";
import { resetLocalBackupRuntimeForTests } from "../localBackup";
import { workspaceMedia } from "../sync/cloudMedia";

const path = process.env.AXOM_BSCE_LOCAL_ZIP;
const readText = (bytes: Uint8Array) => JSON.parse(new TextDecoder().decode(bytes));
beforeEach(async () => {
  await openEmptyWorkspace();
  resetLocalBackupRuntimeForTests();
  vi.stubGlobal("Blob", NativeBlob);
  vi.stubGlobal("File", NativeFile);
  vi.stubGlobal("createImageBitmap", vi.fn(async (blob: Blob) => {
    const info = readImageInfo(new Uint8Array(await blob.arrayBuffer()));
    if (!info) throw new Error("Invalid header");
    return { width: info.width, height: info.height, close: () => {} };
  }));
});
afterEach(async () => {
  resetLocalBackupRuntimeForTests();
  await closeWorkspace();
  vi.unstubAllGlobals();
});

describe.skipIf(!path)("actual private BSCE 49Q visual ZIP import", () => {
  it("imports all 12 immutable figures despite a broken account cloud lookup; reload preserves originals", async () => {
    const raw = readFileSync(path!);
    const read = await zipLibraryReader(new NativeFile([raw], "BSCE_T4_Quiz1_AXOM_Import.zip", { type: "application/zip" }) as unknown as File);
    const catalog = readCatalog(readText(await read("catalog.json")));
    expect(catalog.sources).toHaveLength(1);
    const source = catalog.sources[0];
    expect(source.bankFile).toBeTruthy();
    const bank = readPreparedBank(readText(await read(source.bankFile!)));
    expect(bank.pkg.questions).toHaveLength(49);
    expect(bank.pkg.questions.map(q => q.source.questionNumber)).not.toContain(27);
    const assets = bank.pkg.questions.flatMap(q => q.assets);
    expect(assets).toHaveLength(12);
    expect(bank.pkg.questions.every(q => q.flags?.some(flag => flag.type === "answer_needs_review"))).toBe(true);

    const unregister = setMissingAttachmentLoader(async () => {
      throw new Error("Questions reference conflicting image originals. The workspace has not been marked protected.");
    });
    try {
      const result = await installPrivateLibrary(read);
      expect(result.status, result.warnings.join(" | ")).toBe("complete");
      expect(result.questionIds).toHaveLength(0); // Proposed keys remain held.
      let heldDocuments = useStore.getState().documents.filter(d => d.fileType === PRIVATE_REVIEW_DOCUMENT);
      expect(heldDocuments).toHaveLength(1);
      let storedBank = readPreparedBank(JSON.parse(heldDocuments[0].rawText));
      expect(storedBank.pkg.questions).toHaveLength(49);
      expect(storedBank.pkg.questions.flatMap(q => q.assets)).toHaveLength(12);

      await reloadWorkspace();
      heldDocuments = useStore.getState().documents.filter(d => d.fileType === PRIVATE_REVIEW_DOCUMENT);
      expect(heldDocuments).toHaveLength(1);
      storedBank = readPreparedBank(JSON.parse(heldDocuments[0].rawText));
      for (const asset of storedBank.pkg.questions.flatMap(q => q.assets)) {
        const record = await getQuestionAttachmentBlob(`private-library:${asset.checksum}`, { localOnly: true });
        expect(record?.byteSize, asset.filename).toBe(asset.byteSize);
        expect(await sha256(new Uint8Array(await record!.blob.arrayBuffer())), asset.filename).toBe(asset.checksum);
      }
      expect(workspaceMedia(useStore.getState()).size).toBe(12);
    } finally { unregister(); }
  });
});
