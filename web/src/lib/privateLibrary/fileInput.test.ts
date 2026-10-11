// @vitest-environment node
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { folderLibraryReader, zipLibraryReader } from "./fileInput";

const contents = JSON.stringify({ format: "axom-private-library", schemaVersion: 1, id: "synthetic", version: "1", templates: [], sources: [] });
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
function selectedFile(path: string, content: string) {
  const file = new File([content], path.split("/").pop()!);
  Object.defineProperty(file, "webkitRelativePath", { value: path });
  return file;
}
async function zipFile(path = "outer/catalog.json") {
  const zip = new JSZip(); zip.file(path, contents);
  return new File([await zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" })], "example.zip");
}
describe("the file/folder adapters used by the existing installer", () => {
  it("reads a nested catalog via a browser folder selection", async () => {
    const read = folderLibraryReader([selectedFile("Picked/Wrapper/catalog.json", contents)]);
    expect(text(await read("catalog.json"))).toBe(contents);
  });
  it("reads a directly selected catalog file as well as a folder", async () => {
    const read = folderLibraryReader([new File([contents], "catalog.json")]);
    expect(text(await read("catalog.json"))).toBe(contents);
  });
  it("reads a root or wrapped catalog from a real ZIP", async () => {
    for (const name of ["catalog.json", "outer/inner/catalog.json"]) {
      const read = await zipLibraryReader(await zipFile(name));
      expect(text(await read("catalog.json"))).toBe(contents);
    }
  });
  it("rejects unsafe ZIP names before JSZip can sanitize them", async () => {
    await expect(zipLibraryReader(await zipFile("../catalog.json"))).rejects.toThrow("unsafe");
  });
  it("rejects corruption instead of accepting a renamed or damaged manifest", async () => {
    const file = await zipFile("catalog.json"), bytes = new Uint8Array(await file.arrayBuffer());
    const view = new DataView(bytes.buffer), start = view.getUint32(bytes.length - 6, true);
    view.setUint32(start + 16, 0, true); // Force incorrect CRC while leaving content readable.
    const read = await zipLibraryReader(new File([bytes], "corrupted.zip"));
    await expect(read("catalog.json")).rejects.toThrow("integrity");
  });
  it("bounds actual expansion when a ZIP lies about its inflated size", async () => {
    const file = await zipFile("catalog.json"), bytes = new Uint8Array(await file.arrayBuffer());
    const view = new DataView(bytes.buffer), start = view.getUint32(bytes.length - 6, true);
    view.setUint32(start + 24, 1, true);
    const read = await zipLibraryReader(new File([bytes], "bad-size.zip"));
    await expect(read("catalog.json")).rejects.toThrow();
  });
  it("routes plain files to normal QBank import rather than requiring a generated JSON index", () => {
    expect(() => folderLibraryReader([selectedFile("Picked/questions.pdf", "%PDF")])).toThrow("Import files");
  });
});
