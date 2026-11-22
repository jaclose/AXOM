import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrivateLibraryCatalog } from "../privateLibrary/types";
import type { LibraryInstallScope } from "../privateLibrary/install";
import { downloadAcademicSourcePdf, listAcademicSourcePdfs, type AcademicSourcePdf } from "./sourcePdfs";

const mocks = vi.hoisted(() => ({ client: vi.fn(), reader: vi.fn(), download: vi.fn() }));
vi.mock("./client", () => ({ academicClient: mocks.client, academicLibraryReader: mocks.reader }));
vi.mock("./contentReferences", () => ({ downloadAcademicAsset: mocks.download }));
const revisionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const checksum = "a".repeat(64);
const client = {};
const scope = (): LibraryInstallScope => ({ key: "learner", assertCurrent: vi.fn() });
const source = (id: string, patch: Partial<PrivateLibraryCatalog["sources"][number]> = {}): PrivateLibraryCatalog["sources"][number] => ({
  id, name: `${id}.pdf`, sourcePath: `${id}.pdf`, originalFile: `originals/${id}.pdf`, checksum,
  status: "prepared", reason: "Synthetic source", ready: 1, review: 0, ...patch,
});
function reader(sources: PrivateLibraryCatalog["sources"], files = sources.filter(s => s.originalFile).map(s => ({
  path: s.originalFile!, sha256: checksum, byte_size: 4096, mime_type: "application/pdf",
}))) {
  const catalog: PrivateLibraryCatalog = { format: "axom-private-library", schemaVersion: 1, id: "synthetic", version: "1", templates: [], sources };
  return Object.assign(vi.fn().mockResolvedValue(new TextEncoder().encode(JSON.stringify(catalog))), { files });
}
beforeEach(() => { vi.resetAllMocks(); mocks.client.mockResolvedValue(client); });

describe("individual original PDFs", () => {
  it("reads only the exact revision catalog and lists declared, matching originals", async () => {
    const read = reader([source("lecture"), source("again", { originalFile: "originals/lecture.pdf" }),
      source("missing", { originalFile: undefined }), source("notes", { name: "Notes.txt", sourcePath: "notes.txt", originalFile: "originals/notes.txt" })], [
      { path: "originals/lecture.pdf", sha256: checksum, byte_size: 4096, mime_type: "application/pdf" },
      { path: "originals/notes.txt", sha256: checksum, byte_size: 100, mime_type: "text/plain" },
      { path: "originals/unlisted.pdf", sha256: checksum, byte_size: 400, mime_type: "application/pdf" },
    ]);
    mocks.reader.mockResolvedValue(read);
    const account = scope();
    expect(await listAcademicSourcePdfs(revisionId, account)).toEqual([
      { id: "lecture:0", name: "lecture.pdf", available: true, fileName: "lecture.pdf", byteSize: 4096,
        asset: { revisionId, path: "originals/lecture.pdf", sha256: checksum } },
      { id: "missing:2", name: "missing.pdf", available: false },
    ]);
    expect(mocks.client).toHaveBeenCalledWith("learner");
    expect(mocks.reader).toHaveBeenCalledWith(client, revisionId);
    expect(read.mock.calls).toEqual([["catalog.json"]]);
    expect(mocks.download).not.toHaveBeenCalled();
  });
  it("does not offer originals with mismatched checksums, MIME types or absent files", async () => {
    mocks.reader.mockResolvedValue(reader([source("hash"), source("mime"), source("absent")], [
      { path: "originals/hash.pdf", sha256: "b".repeat(64), byte_size: 4096, mime_type: "application/pdf" },
      { path: "originals/mime.pdf", sha256: checksum, byte_size: 4096, mime_type: "text/plain" },
    ]));
    expect((await listAcademicSourcePdfs(revisionId, scope())).map(pdf => pdf.available)).toEqual([false, false, false]);
  });
  it("stops on failed catalog integrity and does not read other files", async () => {
    const read = reader([source("lecture")]);
    read.mockRejectedValue(new Error("Integrity check failed")); mocks.reader.mockResolvedValue(read);
    await expect(listAcademicSourcePdfs(revisionId, scope())).rejects.toThrow("Integrity check failed");
    expect(read.mock.calls).toEqual([["catalog.json"]]); expect(mocks.download).not.toHaveBeenCalled();
  });
  it("downloads one verified asset with a named PDF result", async () => {
    mocks.reader.mockResolvedValue(reader([source("lecture", { name: "Course/Original: lecture" })]));
    const account = scope();
    const [pdf] = await listAcademicSourcePdfs(revisionId, account);
    expect(pdf).toMatchObject({ available: true, fileName: "Original_ lecture.pdf" });
    mocks.download.mockResolvedValue(new Blob(["%PDF-synthetic"]));
    const blob = await downloadAcademicSourcePdf(pdf, account);
    expect(mocks.download).toHaveBeenCalledWith(client, { revisionId, path: "originals/lecture.pdf", sha256: checksum });
    expect(blob.type).toBe("application/pdf"); expect(await blob.text()).toBe("%PDF-synthetic");
  });
  it("refuses unavailable originals", async () => {
    await expect(downloadAcademicSourcePdf({ id: "missing", name: "Missing.pdf", available: false }, scope())).rejects.toThrow("unavailable");
    expect(mocks.client).not.toHaveBeenCalled(); expect(mocks.download).not.toHaveBeenCalled();
  });
  it("discards a catalog returned after the account changed", async () => {
    let changed = false;
    const account = { key: "learner", assertCurrent: () => { if (changed) throw new Error("Account changed"); } };
    const read = reader([source("lecture")]);
    read.mockImplementation(async () => { changed = true; return new Uint8Array(); }); mocks.reader.mockResolvedValue(read);
    await expect(listAcademicSourcePdfs(revisionId, account)).rejects.toThrow("Account changed");
  });
  it("discards downloaded bytes if the account changes while they are being read", async () => {
    let changed = false;
    const account = { key: "learner", assertCurrent: () => { if (changed) throw new Error("Account changed"); } };
    const pdf: AcademicSourcePdf = { id: "lecture", name: "Lecture.pdf", fileName: "Lecture.pdf", available: true,
      byteSize: 4096, asset: { revisionId, path: "originals/lecture.pdf", sha256: checksum } };
    mocks.download.mockImplementation(async () => { changed = true; return new Blob(["%PDF"]); });
    await expect(downloadAcademicSourcePdf(pdf, account)).rejects.toThrow("Account changed");
  });
});
