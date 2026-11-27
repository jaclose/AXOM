// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exportStateWithAttachments } from "./backup";
import { createMediaBackupArchive } from "./backupArchive";
import { collectQuestionAttachmentPayloads, type QuestionImageAttachment } from "./questionAttachments";
import { getQuestionAttachmentScope, resetQuestionAttachmentScopeForTests, setQuestionAttachmentAccount } from "./questionAttachmentScope";
import { materializeState } from "./sync/contentDownloads";
import { makeSeed } from "./seed";
import { STORAGE_KEYS } from "./brand";
import type { QuestionRecord } from "./questions";
import type { SourceDocument } from "./library";

// Keep the real exporter, account generation bridge and download boundary.
// Control the asynchronous media/materialization results, not identity checks.
vi.mock("./questionAttachments", async importOriginal => ({
  ...await importOriginal<typeof import("./questionAttachments")>(),
  collectQuestionAttachmentPayloads: vi.fn(),
}));
vi.mock("./backupArchive", async importOriginal => ({
  ...await importOriginal<typeof import("./backupArchive")>(),
  createMediaBackupArchive: vi.fn(),
}));
vi.mock("./sync/contentDownloads", () => ({ materializeState: vi.fn() }));

const attachment: QuestionImageAttachment = {
  id: "image", blobKey: "image-a", fileName: "image.png", mimeType: "image/png",
  byteSize: 4, altText: "Synthetic image", createdAt: "2026-11-01", updatedAt: "2026-11-01", role: "question",
};
function workspace() {
  const state = makeSeed();
  state.questions = [{ id: "a-question", attachments: [attachment] } as QuestionRecord];
  state.documents = [];
  return state;
}
const collector = vi.mocked(collectQuestionAttachmentPayloads);
const archive = vi.mocked(createMediaBackupArchive);
const materializer = vi.mocked(materializeState);
const createUrl = vi.fn(() => "blob:synthetic-backup");
const click = vi.fn();
function switchAccount(returnToA: boolean) {
  setQuestionAttachmentAccount("b");
  if (returnToA) setQuestionAttachmentAccount("a");
}
beforeEach(() => {
  resetQuestionAttachmentScopeForTests();
  setQuestionAttachmentAccount("a");
  localStorage.removeItem(STORAGE_KEYS.lastBackupAt);
  vi.useFakeTimers();
  createUrl.mockClear(); click.mockClear();
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL = createUrl;
    static revokeObjectURL = vi.fn();
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(click);
  collector.mockReset();
  archive.mockReset();
  materializer.mockReset();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetQuestionAttachmentScopeForTests();
});

describe("portable export account generation", () => {
  it.each(["complete", "saved-work"] as const)("cancels %s JSON rather than swallowing account cancellation as missing media", async scope => {
    const generation = getQuestionAttachmentScope();
    collector.mockImplementationOnce(async () => {
      switchAccount(false);
      throw new Error("The account changed during image access.");
    });
    await expect(exportStateWithAttachments(workspace(), scope)).rejects.toThrow("account changed during export");
    expect(collector.mock.calls[0]?.[1]).toMatchObject({ scope: generation, localOnly: scope === "saved-work" });
    expect(createUrl).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
    expect(localStorage.getItem(STORAGE_KEYS.lastBackupAt)).toBeNull();
  });

  it("rejects a fulfilled JSON collector after A→B→A", async () => {
    collector.mockImplementationOnce(async () => {
      switchAccount(true);
      return { payloads: [], missingBlobKeys: [] };
    });
    await expect(exportStateWithAttachments(workspace())).rejects.toThrow("account changed during export");
    expect(click).not.toHaveBeenCalled();
    expect(createUrl).not.toHaveBeenCalled();
  });

  it("preserves a same-account metadata-only download on storage refusal", async () => {
    collector.mockRejectedValueOnce(new Error("Storage unavailable"));
    await expect(exportStateWithAttachments(workspace(), "saved-work")).resolves.toMatchObject({
      attachmentCount: 0, missingBlobKeys: [attachment.blobKey],
    });
    expect(click).toHaveBeenCalledOnce();
    expect(localStorage.getItem(STORAGE_KEYS.lastBackupAt)).toBeNull();
  });

  it.each(["json", "zip"] as const)("requests a recovery copy of an incompatible %s workspace without marking a complete backup", async format => {
    for (const [collection, identity] of [["tasks", "id"], ["logs", "id"], ["dayPlans", "dayKey"], ["dailyArchives", "date"]] as const) {
      for (const value of [42, " padded "]) {
        const state = workspace();
        if (format === "zip") state.documents = [{ id: "doc", checksum: "a".repeat(64), fileType: "application/pdf" } as SourceDocument];
        const records = [{ [identity]: value }];
        Object.assign(state, { [collection]: records });
        const original = JSON.stringify(state);
        collector.mockResolvedValueOnce({ payloads: [], missingBlobKeys: [] });
        archive.mockResolvedValueOnce({ blob: new Blob(["synthetic archive"]), attachmentCount: 0, missingBlobKeys: [], originalCount: 1, missingOriginalIds: [] });
        click.mockClear();
        await expect(exportStateWithAttachments(state)).resolves.toMatchObject({ workspaceAdmissionFailed: true });
        expect(click).toHaveBeenCalledOnce();
        expect(localStorage.getItem(STORAGE_KEYS.lastBackupAt)).toBeNull();
        expect(JSON.stringify(state)).toBe(original);
        if (format === "zip") {
          expect(archive.mock.calls[0]?.[0][collection]).toEqual(records);
        }
        // Clear unused one-shot responses from the unselected export branch.
        collector.mockReset();
        archive.mockReset();
      }
    }
  });

  it("still downloads a complete JSON export and records its time", async () => {
    collector.mockResolvedValueOnce({ payloads: [{ ...attachment, questionId: "a-question", base64: "QVhPTQ==" }], missingBlobKeys: [] });
    await expect(exportStateWithAttachments(workspace())).resolves.toMatchObject({ attachmentCount: 1, missingBlobKeys: [] });
    expect(click).toHaveBeenCalledOnce();
    expect(localStorage.getItem(STORAGE_KEYS.lastBackupAt)).not.toBeNull();
  });

  it.each([false, true])("rechecks fulfilled ZIP generation immediately before download: %s", async returnToA => {
    const state = workspace();
    state.documents = [{ id: "doc", checksum: "a".repeat(64), fileType: "application/pdf" } as SourceDocument];
    const generation = getQuestionAttachmentScope();
    archive.mockImplementationOnce(async () => {
      switchAccount(returnToA);
      return { blob: new Blob(["synthetic archive"]), attachmentCount: 1, missingBlobKeys: [], originalCount: 1, missingOriginalIds: [] };
    });
    await expect(exportStateWithAttachments(state)).rejects.toThrow("account changed during export");
    expect(archive.mock.calls[0]?.[3]?.scope).toBe(generation);
    expect(createUrl).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
    expect(localStorage.getItem(STORAGE_KEYS.lastBackupAt)).toBeNull();
  });

  it("does not download a deferred export materialized across a generation change", async () => {
    const state = workspace();
    state.deferredContent = { accountId: "a", questions: [], documents: [], sources: [], media: [] };
    materializer.mockImplementationOnce(async () => {
      switchAccount(true);
      return { ...state, deferredContent: undefined };
    });
    await expect(exportStateWithAttachments(state)).rejects.toThrow("account changed during export");
    expect(materializer).toHaveBeenCalledOnce();
    expect(collector).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
  });
});
