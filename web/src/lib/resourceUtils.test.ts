import { describe, expect, it } from "vitest";
import { externalLinkHref } from "./resourceUtils";

describe("externalLinkHref", () => {
  it("preserves web destinations and adds HTTPS to a bare domain", () => {
    expect(externalLinkHref("https://www.example.edu/path?usp=sharing")).toBe("https://www.example.edu/path?usp=sharing");
    expect(externalLinkHref("http://example.org")).toBe("http://example.org/");
    expect(externalLinkHref(" drive.google.com/drive/folders/abc ")).toBe("https://drive.google.com/drive/folders/abc");
  });

  it("does not render script, data, local-file, or malformed links", () => {
    for (const link of [
      "javascript:alert(1)",
      " JaVaScRiPt:alert(1)",
      "java\tscript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "not a valid domain",
      "",
      "   ",
      undefined,
    ]) expect(externalLinkHref(link), String(link)).toBeUndefined();
  });
});
