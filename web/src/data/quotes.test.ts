import { describe, expect, it } from "vitest";
import { AXOM_ORIGINALS_V2, AXOM_ORIGINALS_V3, AXOM_QUOTES, AXOM_QUOTE_LIBRARY_V1 } from "./quotes";

describe("normalized AXOM quote library v1", () => {
  it("pins the exact 100 source entries and stable numbered ids", () => {
    expect(AXOM_QUOTE_LIBRARY_V1).toHaveLength(100);
    expect(AXOM_QUOTE_LIBRARY_V1.map((quote) => quote.id)).toEqual(
      Array.from({ length: 100 }, (_, index) => `quote-${String(index + 1).padStart(3, "0")}`),
    );
    expect(new Set(AXOM_QUOTE_LIBRARY_V1.map((quote) => quote.text)).size).toBe(100);
    expect(fnv1a32(`${AXOM_QUOTE_LIBRARY_V1.map((quote) => quote.text).join("\n")}\n`)).toBe(1_240_300_146);
    expect(AXOM_QUOTE_LIBRARY_V1[0].text).toBe("The person you become is hidden inside the work you’re avoiding.");
    expect(AXOM_QUOTE_LIBRARY_V1[99].text).toBe("Become someone your past self would trust with their dreams.");
  });

  it("appends AXOM Originals v2 with stable ids, unique text, and no guilt category", () => {
    expect(AXOM_QUOTES.slice(0, 100)).toEqual(AXOM_QUOTE_LIBRARY_V1);
    expect(AXOM_ORIGINALS_V2.length).toBeGreaterThanOrEqual(80);
    expect(AXOM_ORIGINALS_V2[0].id).toBe("quote-101");
    expect(new Set(AXOM_QUOTES.map((quote) => quote.id)).size).toBe(AXOM_QUOTES.length);
    expect(new Set(AXOM_QUOTES.map((quote) => quote.text.toLowerCase())).size).toBe(AXOM_QUOTES.length);
    expect(AXOM_ORIGINALS_V2.every((quote) => quote.author === "AXOM" && quote.attributionStatus === "axom-original" && !quote.guilt)).toBe(true);
  });

  it("preserves the six source category ranges and defaults guilt/shame off", () => {
    expect(count("brutal-reality")).toBe(20);
    expect(count("shame-guilt")).toBe(20);
    expect(count("discipline")).toBe(20);
    expect(count("perspective")).toBe(15);
    expect(count("success-ambition")).toBe(15);
    expect(count("axom-original")).toBe(10 + AXOM_ORIGINALS_V2.length + AXOM_ORIGINALS_V3.length);
    expect(AXOM_QUOTES.filter((quote) => quote.guilt).map((quote) => quote.id)).toEqual(
      Array.from({ length: 20 }, (_, index) => `quote-${String(index + 21).padStart(3, "0")}`),
    );
  });

  it("never upgrades unsupported attribution to verified", () => {
    expect(AXOM_QUOTES.filter((quote) => quote.attributionStatus === "verified")).toEqual([]);
    expect(AXOM_QUOTES[4]).toMatchObject({ author: "Abraham Lincoln", attributionStatus: "commonly-attributed" });
    expect(AXOM_QUOTES[12]).toMatchObject({ author: "James Clear", attributionStatus: "paraphrased" });
    expect(AXOM_QUOTES[40]).toMatchObject({ author: "Will Durant", attributionStatus: "paraphrased" });
    expect(AXOM_QUOTES[41]).toMatchObject({ author: "Unattributed", attributionStatus: "unverified" });
    expect(AXOM_QUOTES[60]).toMatchObject({ author: "Theodore Roosevelt", attributionStatus: "unverified" });
    expect(AXOM_QUOTES[90]).toMatchObject({ author: "AXOM", attributionStatus: "axom-original" });
    expect(AXOM_QUOTES.every((quote) => quote.attributionNote.trim().length > 0)).toBe(true);
  });
});

function count(category: (typeof AXOM_QUOTES)[number]["category"]) {
  return AXOM_QUOTES.filter((quote) => quote.category === category).length;
}

function fnv1a32(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}
