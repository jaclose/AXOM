import { afterEach, describe, expect, it, vi } from "vitest";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import { sha256Hex } from "./checksum";
import { attachNamedImages, imageNameKey, matchNamedImages, namedImages } from "./questionImportImages";
import {
  deleteQuestionAttachmentBlobs,
  getQuestionAttachmentBlob,
  listQuestionAttachmentBlobKeys,
  putQuestionAttachmentBlob,
} from "./questionAttachments";

afterEach(() => { vi.unstubAllGlobals(); });

const file = (name: string) => ({ name });

describe("images named by an import", () => {
  it("matches on the file name alone: no folders, no case", () => {
    expect(imageNameKey("Figures/ECG-12.PNG")).toBe("ecg-12.png");
    const matches = matchNamedImages(["ecg-12.png", "slide.jpg"], [file("SLIDE.JPG"), file("ECG-12.png")]);
    expect(matches.map((match) => match.file?.name)).toEqual(["ECG-12.png", "SLIDE.JPG"]);
  });

  it("falls back to the name without its extension only when one file fits", () => {
    expect(matchNamedImages(["figure-2.png"], [file("figure-2.jpg")])[0].file?.name).toBe("figure-2.jpg");
    expect(matchNamedImages(["figure-2.png"], [file("figure-2.jpg"), file("figure-2.webp")])[0].file).toBeUndefined();
    expect(matchNamedImages(["figure-2.png"], [file("figure-2.jpg"), file("figure-2.png")])[0].file?.name).toBe("figure-2.png");
  });

  it("does not silently select the first anatomy image when ZIP paths collide by basename", () => {
    const images = [file("FTCM/Week1/images/figure.png"), file("FTCM/Week2/images/figure.png")];
    expect(matchNamedImages(["figure.png"], images)[0].file).toBeUndefined();
    expect(matchNamedImages(["Week1/images/figure.png"], images)[0].file?.name).toBe(images[0].name);
    expect(matchNamedImages(["FTCM/Week2/images/figure.png"], images)[0].file?.name).toBe(images[1].name);
    expect(namedImages([{ attachmentNames: ["Week1/images/figure.png", "Week2/images/figure.png"] }]))
      .toEqual(["Week1/images/figure.png", "Week2/images/figure.png"]);
  });

  it("reports a name no file answers", () => {
    expect(matchNamedImages(["missing.png"], [file("other.png")])).toEqual([{ name: "missing.png", file: undefined }]);
  });

  it("lists each named image once across the drafts", () => {
    expect(namedImages([{ attachmentNames: ["a.png"] }, {}, { attachmentNames: ["A.PNG", "b.jpg"] }])).toEqual(["a.png", "b.jpg"]);
  });

  it("keeps per-question metadata while reusing one verified private-library blob", async () => {
    vi.stubGlobal("indexedDB", indexedDB);
    vi.stubGlobal("IDBKeyRange", IDBKeyRange);
    const bytes = new TextEncoder().encode("same verified image bytes");
    const digest = await sha256Hex(bytes);
    const checksum = `sha256:${digest}`;
    const blobKey = `private-library:${checksum}`;
    const storedBlob = new Blob([bytes], { type: "image/png" });
    const supplied = new File([bytes], "shared-source-page.png", { type: "image/png" });
    const asset = {
      id: "source-page",
      filename: supplied.name,
      mimeType: supplied.type,
      byteSize: supplied.size,
      role: "source_page" as const,
      questionId: "source-question",
      checksum,
    };
    await putQuestionAttachmentBlob(blobKey, {
      blob: storedBlob,
      mimeType: "image/png",
      byteSize: storedBlob.size,
      questionId: "private-review",
      updatedAt: "2026-10-15T00:00:00.000Z",
    });
    try {
      const first = await attachNamedImages({
        names: [supplied.name], files: [supplied], questionId: "ready-one", contentAssets: [asset],
      });
      const second = await attachNamedImages({
        names: [supplied.name], files: [supplied], questionId: "ready-two", contentAssets: [{ ...asset, id: "source-page-two", questionId: "source-question-two" }],
      });
      expect(first.problems).toEqual([]);
      expect(second.problems).toEqual([]);
      expect(first.attachments[0]).toMatchObject({ blobKey, fileName: supplied.name, byteSize: supplied.size });
      expect(second.attachments[0]).toMatchObject({ blobKey, fileName: supplied.name, byteSize: supplied.size });
      expect(first.attachments[0].id).not.toBe(second.attachments[0].id);
      expect((await listQuestionAttachmentBlobKeys()).filter((key) => key === blobKey)).toEqual([blobKey]);
    } finally {
      await deleteQuestionAttachmentBlobs([blobKey]);
    }
  });

  it("refuses supplied bytes that differ from the reviewed package checksum", async () => {
    vi.stubGlobal("indexedDB", indexedDB);
    vi.stubGlobal("IDBKeyRange", IDBKeyRange);
    const canonicalBytes = new TextEncoder().encode("AAAA");
    const suppliedBytes = new TextEncoder().encode("BBBB");
    const checksum = `sha256:${await sha256Hex(canonicalBytes)}`;
    const blobKey = `private-library:${checksum}`;
    const canonical = new Blob([canonicalBytes], { type: "image/png" });
    const supplied = new File([suppliedBytes], "same-name.png", { type: "image/png" });
    await putQuestionAttachmentBlob(blobKey, {
      blob: canonical,
      mimeType: "image/png",
      byteSize: canonical.size,
      questionId: "private-review",
      updatedAt: "2026-10-15T00:00:00.000Z",
    });
    try {
      const result = await attachNamedImages({
        names: [supplied.name],
        files: [supplied],
        questionId: "ordinary-import",
        contentAssets: [{
          id: "untrusted",
          filename: supplied.name,
          mimeType: supplied.type,
          byteSize: supplied.size,
          role: "question",
          questionId: "ordinary-import",
          checksum,
        }],
      });
      expect(result.attachments).toEqual([]);
      expect(result.problems).toEqual([expect.stringMatching(/does not match the reviewed package checksum/)]);
      expect(await (await getQuestionAttachmentBlob(blobKey))?.blob.text()).toBe("AAAA");
    } finally {
      await deleteQuestionAttachmentBlobs([blobKey]);
    }
  });

  it.each([
    { field: "mime type", asset: { mimeType: "image/jpeg" }, problem: /declares image\/jpeg/ },
    { field: "byte size", asset: { byteSize: 999 }, problem: /declares 999/ },
    { field: "checksum syntax", asset: { checksum: "sha256:not-a-digest" }, problem: /invalid reviewed SHA-256 identity/ },
  ])("refuses a file whose declared $field does not match", async ({ asset, problem }) => {
    const supplied = new File(["image bytes"], "figure.png", { type: "image/png" });
    const result = await attachNamedImages({
      names: [supplied.name],
      files: [supplied],
      questionId: "q1",
      contentAssets: [{
        id: "figure",
        filename: supplied.name,
        mimeType: "image/png",
        byteSize: supplied.size,
        role: "question",
        questionId: "q1",
        ...asset,
      }],
    });
    expect(result.attachments).toEqual([]);
    expect(result.problems).toEqual([expect.stringMatching(problem)]);
  });

  it("refuses conflicting package identities for one supplied image", async () => {
    const supplied = new File(["image bytes"], "figure.png", { type: "image/png" });
    const result = await attachNamedImages({
      names: [supplied.name],
      files: [supplied],
      questionId: "q1",
      contentAssets: ["a", "b"].map((id, index) => ({
        id,
        filename: supplied.name,
        mimeType: supplied.type,
        byteSize: supplied.size,
        role: "question" as const,
        questionId: "q1",
        checksum: `sha256:${String(index).repeat(64)}`,
      })),
    });
    expect(result.attachments).toEqual([]);
    expect(result.problems).toEqual([expect.stringMatching(/conflicting reviewed image identities/)]);
  });
});
