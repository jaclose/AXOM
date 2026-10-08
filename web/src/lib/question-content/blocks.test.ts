import { describe, expect, it } from "vitest";
import { blockShape, blocksToPlainText, countMedia, inspectRichText, sanitizeRichText, type QuestionBlock } from "./blocks";

describe("rich text", () => {
  it("keeps subscripts, superscripts and emphasis", () => {
    const html = "Na<sup>+</sup> and HCO<sub>3</sub><sup>−</sup>, <b>not</b> <i>K</i><br>next line";
    expect(inspectRichText(html)).toEqual({ html, escaped: false });
  });

  it("turns markup AXOM will not run into text instead of deleting it", () => {
    const inspected = inspectRichText("<script>alert(1)</script><img src=x onerror=alert(1)><b onclick=\"x()\">bold</b>");
    expect(inspected.escaped).toBe(true);
    expect(inspected.html).not.toMatch(/<(script|img|b )/);
    expect(inspected.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(inspected.html).toContain("bold");
  });

  it("never loses a value written with an angle bracket", () => {
    expect(sanitizeRichText("TSH < 0.1 and T<sub>4</sub> > 12")).toBe("TSH &lt; 0.1 and T<sub>4</sub> &gt; 12");
    expect(blocksToPlainText([{ type: "rich_text", html: "TSH < 0.1 and T<sub>4</sub> > 12" }])).toBe("TSH < 0.1 and T4 > 12");
  });

  it("gives the same result when applied twice", () => {
    const once = sanitizeRichText("a < b <SUP>2</SUP> <br/> <em>x</em> <u>y</u> <style>p{}</style>");
    expect(sanitizeRichText(once)).toBe(once);
  });
});

describe("reading blocks as plain text", () => {
  const stem: QuestionBlock[] = [
    { type: "text", text: "A volunteer has the panel below." },
    { type: "table", caption: "Panel", headers: ["Test", "Result"], rows: [["Marker B", "0.2 μU/mL"], ["Marker C", "310 mOsm/kg"]] },
    { type: "divider" },
    { type: "image", assetId: "img-1", alt: "A micrograph" },
    { type: "image", assetId: "img-2" },
    { type: "equation", latex: "t_{1/2} = 2", plainText: "t½ = 2 h" },
    { type: "callout", text: "Values are invented.", tone: "note" },
    { type: "text", text: "Which marker is low?" },
  ];

  it("keeps every block in its place and every unit as written", () => {
    expect(blocksToPlainText(stem)).toBe([
      "A volunteer has the panel below.",
      "Panel\nTest | Result\nMarker B | 0.2 μU/mL\nMarker C | 310 mOsm/kg",
      "[Image: A micrograph]",
      "[Image]",
      "t½ = 2 h",
      "Values are invented.",
      "Which marker is low?",
    ].join("\n\n"));
  });

  it("writes the choice letter beside each row of a shared answer table", () => {
    expect(blocksToPlainText([{ type: "table", headers: ["Signal", "Hormone"], rowKeys: ["A", "B"], rows: [["↑", "↓"], ["↔", "±"]] }]))
      .toBe(" | Signal | Hormone\nA | ↑ | ↓\nB | ↔ | ±");
  });

  it("counts media and reports the order of block kinds", () => {
    expect(countMedia(stem)).toEqual({ images: 2, tables: 1, equations: 1 });
    expect(blockShape(stem)).toEqual(["text", "table", "divider", "image", "image", "equation", "callout", "text"]);
  });
});
