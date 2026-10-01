import { describe, expect, it } from "vitest";
import { imageNameKey, matchNamedImages, namedImages } from "./questionImportImages";

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

  it("reports a name no file answers", () => {
    expect(matchNamedImages(["missing.png"], [file("other.png")])).toEqual([{ name: "missing.png", file: undefined }]);
  });

  it("lists each named image once across the drafts", () => {
    expect(namedImages([{ attachmentNames: ["a.png"] }, {}, { attachmentNames: ["A.PNG", "b.jpg"] }])).toEqual(["a.png", "b.jpg"]);
  });
});
