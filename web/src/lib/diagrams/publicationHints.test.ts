import { describe, expect, it } from "vitest";
import { canEmbedMedicalAsset, MEDICAL_IMAGE_SOURCE_CATALOG, planMedicalVisual } from "./publicationHints";

describe("medical visual planning for published Question Sets", () => {
  it("indexes explicit pathology topics without requesting or inventing an image", () => {
    const result = planMedicalVisual({
      stem: "A lesion contains a fibrous cap and lipid-rich necrotic core. Identify the process.",
      topic: "Atherosclerosis", category: "Pathology", system: "Cardiovascular", tags: [],
    });
    expect(result.kind).toBe("pathology-comparison");
    expect(result.keywords).toContain("atherosclerosis");
    expect(result.requiresMedicalReview).toBe(true);
    expect(result.assetId).toBeNull();
  });

  it("chooses a microscopy hint for explicit histology and retains specific vocabulary", () => {
    const result = planMedicalVisual({
      stem: "A photomicrograph shows chondrocytes in lacunae among thick collagen bundles.",
      topic: "Fibrocartilage", category: "Histology", tags: [],
    });
    expect(result.kind).toBe("histology-micrograph");
    expect(result.keywords).toContain("fibrocartilage");
    expect(result.keywords).toContain("chondrocytes");
  });

  it("suggests an anatomical schematic from explicit anatomy, not clinical guesswork", () => {
    const result = planMedicalVisual({
      stem: "Which nerve arises from the posterior cord of the brachial plexus?",
      topic: "Brachial plexus", category: "Anatomy", tags: [],
    });
    expect(result.kind).toBe("anatomical-schematic");
    expect(result.keywords).toContain("brachial plexus");
  });

  it("does not infer a diagnosis or illustration from vague symptoms", () => {
    const result = planMedicalVisual({ stem: "A patient has cough and fever.", tags: [] });
    expect(result.kind).toBe("none");
    expect(result.keywords).toEqual([]);
  });

  it("fails closed on external image licenses, even when a source is free to view", () => {
    expect(MEDICAL_IMAGE_SOURCE_CATALOG.length).toBeGreaterThanOrEqual(3);
    expect(MEDICAL_IMAGE_SOURCE_CATALOG.every(item => item.licenseStatus === "per-asset-review")).toBe(true);
    expect(canEmbedMedicalAsset({ rightsReviewed: false, redistributionAllowed: true, modificationsAllowed: true, attribution: "Source" })).toBe(false);
    expect(canEmbedMedicalAsset({ rightsReviewed: true, redistributionAllowed: false, modificationsAllowed: true, attribution: "Source" })).toBe(false);
    expect(canEmbedMedicalAsset({ rightsReviewed: true, redistributionAllowed: true, modificationsAllowed: true, attribution: "" })).toBe(false);
    expect(canEmbedMedicalAsset({ rightsReviewed: true, redistributionAllowed: true, modificationsAllowed: true, attribution: "Approved asset" })).toBe(true);
  });
});
