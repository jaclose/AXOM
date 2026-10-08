import { describe, expect, it } from "vitest";
import { ASSET_ROLES, type AssetRole, type QuestionBlock } from "./blocks";
import { effectiveRole, isAssetVisible, visibleBlocks, type ContentViewMode } from "./visibility";

const MODES: ContentViewMode[] = ["question", "answered", "review"];

describe("which images a learner may see", () => {
  it("always shows what is part of the question", () => {
    for (const mode of MODES) {
      for (const role of ["question", "stem", "choice"] as AssetRole[]) expect(isAssetVisible(role, mode)).toBe(true);
    }
  });

  it("never shows an answer-marked copy while the question is open", () => {
    expect(isAssetVisible("answer_reveal", "question")).toBe(false);
  });

  it("shows nothing but the question's own images while the question is open, whatever the role", () => {
    const shown = ASSET_ROLES.filter((role) => isAssetVisible(role, "question"));
    expect(shown).not.toContain("answer_reveal");
    expect(shown).not.toContain("explanation");
  });

  it("lets an answer-reveal marking on either the placement or the asset win", () => {
    expect(effectiveRole("stem", "answer_reveal", "stem")).toBe("answer_reveal");
    expect(effectiveRole("answer_reveal", "stem", "stem")).toBe("answer_reveal");
    expect(effectiveRole(undefined, undefined, "choice")).toBe("choice");
    expect(effectiveRole("reference", "stem", "stem")).toBe("reference");
  });

  it("drops a mislabelled answer-marked image from the stem in question mode and keeps the order of the rest", () => {
    const stem: QuestionBlock[] = [
      { type: "text", text: "The graph shows two compounds." },
      { type: "image", assetId: "clean" },
      { type: "image", assetId: "marked" },
      { type: "table", rows: [["1", "2"]] },
      { type: "text", text: "Which statement is supported?" },
    ];
    const roles: Record<string, AssetRole> = { clean: "stem", marked: "answer_reveal" };
    const shown = visibleBlocks(stem, "question", (block) => effectiveRole(block.role, roles[block.assetId], "stem"));
    expect(shown).toEqual([stem[0], stem[1], stem[3], stem[4]]);
  });

  it.todo("supporting roles (explanation, answer reveal after answering, reference, source page) follow the policy JD sets");
});
