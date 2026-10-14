// @vitest-environment node
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { rawAcademicFolder, rawAcademicZip } from "./rawAcademicInput";

function folderFile(path: string, content: string) {
  const file = new File([content], path.split("/").pop()!);
  Object.defineProperty(file, "webkitRelativePath", { value: `Picked/${path}` });
  return file;
}
async function archive(input: Record<string, string>): Promise<File> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(input)) zip.file(path, content, { createFolders: false });
  return new File([await zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" })], "questions.zip");
}

describe("raw academic ZIP and folder input", () => {
  it("imports ordinary sources without catalog.json, keeps original paths and sibling images", async () => {
    const raw = await rawAcademicZip(await archive({
      "Term 4/PQs/Questions 1.txt": "1. Which?\\nA. First\\nB. Second\\nAnswer: A",
      "Term 4/Answer key.txt": "1. A",
      "Term 4/figures/histo.png": "image-data",
      "Term 4/Readme.exe": "not a question",
    }));
    expect(raw.sources.map(file => file.name)).toEqual(["Term 4/PQs/Questions 1.txt", "Term 4/Answer key.txt"]);
    expect(raw.images[0].name).toBe("Term 4/figures/histo.png");
    expect(raw.skipped).toContainEqual({ path: "Term 4/Readme.exe", reason: "Unsupported format; no question extraction attempted." });
    expect(await raw.sources[0].text()).toContain("Which?");
  });
  it("does not import byte-identical source questions twice", async () => {
    const content = "1. Repeated question? A. One B. Two";
    const result = await rawAcademicFolder([folderFile("a/questions.txt", content), folderFile("b/questions-copy.txt", content)]);
    expect(result.sources).toHaveLength(1);
    expect(result.duplicateCount).toBe(1);
    expect(result.skipped[0].reason).toContain("duplicate");
  });
  it("rejects traversal, case-conflicting paths, corrupted CRC and inflated-size lies", async () => {
    await expect(rawAcademicZip(await archive({ "../evil.txt": "x" }))).rejects.toThrow(/unsafe/);
    await expect(rawAcademicZip(await archive({ "A.txt": "a", "a.txt": "b" }))).rejects.toThrow(/conflicting/);
    const packed = new Uint8Array(await (await archive({ "Q.txt": "valid" })).arrayBuffer());
    const eocd = new DataView(packed.buffer).getUint32(packed.length - 6, true);
    new DataView(packed.buffer).setUint32(eocd + 16, 0, true);
    await expect(rawAcademicZip(new File([packed], "bad.zip"))).rejects.toThrow(/integrity/);
    const wrong = new Uint8Array(await (await archive({ "Q.txt": "valid" })).arrayBuffer());
    const central = new DataView(wrong.buffer).getUint32(wrong.length - 6, true);
    new DataView(wrong.buffer).setUint32(central + 24, 1, true);
    await expect(rawAcademicZip(new File([wrong], "badsize.zip"))).rejects.toThrow(/declared size/);
  });
  it("does not confuse native packages with raw sources", async () => {
    await expect(rawAcademicZip(await archive({ "bank/manifest.json": "{}", "bank/questions.json": "{}" })))
      .rejects.toThrow(/prepared AXOM package/);
    await expect(rawAcademicFolder([folderFile("bank/manifest.json", "{}"), folderFile("bank/questions.json", "{}")]))
      .rejects.toThrow(/prepared-package/);
  });
  it("rejects large archives before reading the file bytes", async () => {
    const selection = { size: 260 * 1024 * 1024, arrayBuffer: async () => { throw new Error("read"); } };
    // Avoid allocating a 260 MB fixture: the filename-independent size gate is an explicit input check.
    await expect(rawAcademicZip(selection as unknown as File)).rejects.toThrow(/256 MB/);
  });
});
