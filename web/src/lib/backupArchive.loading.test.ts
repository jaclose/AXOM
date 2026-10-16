// @vitest-environment node
import { File as NativeFile } from "node:buffer";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("jszip");
  vi.doUnmock("./questionAttachments");
  vi.resetModules();
});

describe("portable backup module availability", () => {
  it.each(["export", "restore"])("can %s after lazy-module delivery becomes unavailable", async (operation) => {
    vi.resetModules();
    let modulesAvailable = true;
    let zipLoads = 0;

    // Reproduce a stale or unavailable lazy chunk after the recovery module loads.
    // Use the real ZIP implementation; the existing archive suite covers image I/O.
    vi.doMock("jszip", async () => {
      zipLoads += 1;
      if (!modulesAvailable) {
        throw new TypeError("Failed to fetch dynamically imported module: jszip");
      }
      return vi.importActual<typeof import("jszip")>("jszip");
    });
    // Isolate persistent storage: this test must never open a learner's workspace.
    vi.doMock("./questionAttachments", () => ({
      ATTACHMENT_EXPORT_KEY: "questionAttachmentPayloads",
      MAX_QUESTION_ATTACHMENT_BYTES: 8 * 1024 * 1024,
      blobToBase64: vi.fn(),
      extractQuestionAttachmentPayloads: vi.fn(() => []),
      getQuestionAttachmentBlob: vi.fn(),
      stageQuestionAttachmentPayloads: vi.fn(async () => ({ restored: 0, skipped: 0, rollback: vi.fn() })),
    }));

    const payload = { _app: "AXOM", terms: [], documents: [{ rawText: "synthetic test data" }] };
    // Restore must work even when no export has warmed the ZIP module cache.
    const { default: FixtureZip } = await vi.importActual<{ default: typeof import("jszip") }>("jszip");
    const fixture = new FixtureZip();
    fixture.file("workspace.json", JSON.stringify({
      ...payload, _backupFormat: "axom-media-backup", _backupVersion: 1, media: [],
    }));
    let bytes = await fixture.generateAsync({ type: "arraybuffer" });
    const { createMediaBackupArchive, readPortableBackup } = await import("./backupArchive");
    modulesAvailable = false;
    if (operation === "export") {
      const exported = await createMediaBackupArchive(payload, []);
      expect(exported.attachmentCount).toBe(0);
      expect(exported.missingBlobKeys).toEqual([]);
      bytes = await exported.blob.arrayBuffer();
    }
    const file = new NativeFile([new Uint8Array(bytes)], "backup.zip") as unknown as File;
    const restored = await readPortableBackup(file);
    expect(JSON.parse(restored.rawText)).toMatchObject(payload);
    expect(await restored.restoreMedia([])).toMatchObject({ restored: 0, skipped: 0 });
    expect(zipLoads).toBe(1);
  });
});
