import { describe, expect, it } from "vitest";
import { externalLinkHref } from "./resourceUtils";

describe("externalLinkHref", () => {
  it("keeps web links as written and gives a bare domain https", () => {
    expect(externalLinkHref("https://www.example.edu/path?usp=sharing")).toBe("https://www.example.edu/path?usp=sharing");
    expect(externalLinkHref("http://example.org")).toBe("http://example.org/");
    expect(externalLinkHref(" drive.google.com/drive/folders/abc ")).toBe("https://drive.google.com/drive/folders/abc");
  });

  it("refuses script, data and every other scheme", () => {
    for (const link of [
      "javascript:alert(1)", " JaVaScRiPt:alert(1)", "java\tscript:alert(1)", "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)", "file:///etc/passwd", "", "   ", undefined,
    ]) expect(externalLinkHref(link), String(link)).toBeUndefined();
  });
});
