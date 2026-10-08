import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { describeAssets, readImageInfo, sha256 } from "./assets";
import type { PackageQuestion } from "./package";

const png = readFileSync(join(process.cwd(), "..", "fixtures", "qbank", "synthetic", "multimodal-shapes", "assets", "syn-q03-curves.png"));

describe("what a picture file is", () => {
  it("reads the kind and pixel size from the file's own header", () => {
    expect(readImageInfo(png)).toEqual({ mimeType: "image/png", width: 480, height: 320 });
    const gif = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x40, 0x01, 0xf0, 0x00, 0, 0, 0]);
    expect(readImageInfo(gif)).toEqual({ mimeType: "image/gif", width: 320, height: 240 });
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x01, 0x90, 0x03, 0, 0, 0, 0]);
    expect(readImageInfo(jpeg)).toEqual({ mimeType: "image/jpeg", width: 400, height: 300 });
    const webp = new Uint8Array(30);
    webp.set([...new TextEncoder().encode("RIFF"), 0, 0, 0, 0, ...new TextEncoder().encode("WEBPVP8X")]);
    webp.set([0x3f, 0x01, 0x00, 0xef, 0x00, 0x00], 24);
    expect(readImageInfo(webp)).toEqual({ mimeType: "image/webp", width: 320, height: 240 });
  });

  it("names a kind it cannot show, and admits when it does not know", () => {
    const emf = new Uint8Array(48);
    emf.set([1, 0, 0, 0]);
    emf.set(new TextEncoder().encode(" EMF"), 40);
    expect(readImageInfo(emf)).toEqual({ mimeType: "image/emf" });
    expect(readImageInfo(new TextEncoder().encode("not a picture at all"))).toBeUndefined();
  });

  it("fills an asset in from its bytes and names the file after the asset", async () => {
    const question = {
      id: "q1",
      assets: [
        { id: "q1-img-1", filename: "image7.jpeg", mimeType: "image/jpeg", width: 10, height: 10, role: "stem", questionId: "q1" },
        { id: "q1-img-2", filename: "gone.png", mimeType: "image/png", role: "stem", questionId: "q1" },
      ],
    } as unknown as PackageQuestion;
    const files = await describeAssets([question], (asset) => (asset.id === "q1-img-1" ? png : undefined));
    expect(question.assets[0]).toEqual({
      id: "q1-img-1", filename: "q1-img-1.png", mimeType: "image/png", width: 480, height: 320, byteSize: png.length, role: "stem", questionId: "q1",
      checksum: "sha256:60cd6d30cbaef26e653e2ae863ea345e804f69e6fe9cde60c85cbfce11a0e073",
    });
    expect(question.assets[1].filename).toBe("gone.png");
    expect([...files.keys()]).toEqual(["q1-img-1.png"]);
    expect(await sha256(new TextEncoder().encode("abc"))).toBe("sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
