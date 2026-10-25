import { describe, expect, it } from "vitest";
import biostatsFixture from "../../../fixtures/qbank/goer/t5/week-02/biostats-epidemiology/manifest.json";
import endocrineFixture from "../../../fixtures/qbank/goer/t5/week-02/endocrine-pathophysiology/manifest.json";
import pharmaFixture from "../../../fixtures/qbank/goer/t5/week-02/pharmacodynamics-pk/manifest.json";
import { BLUEPRINTS as STUDY_BLUEPRINTS } from "./blueprints";
import { BLUEPRINTS as APPLICATION_BLUEPRINTS, BLUEPRINT_LANES } from "./blueprintCatalog";
import { CURRICULA } from "./curricula";
import { FOCUS_OPTIONS } from "./experience";
import { SGU_DRIVES } from "./seed";
import { PATH_OPTIONS, TOOL_OPTIONS } from "./setupPlan";
import { EDUCATION_TRACKS } from "./tracks";
import { knownBankManifests } from "./question-content/knownBanks";

const NON_VISIBLE_KEYS = new Set([
  "id", "trackIds", "audience", "tags", "url", "sourceUrl", "focusId",
  "laneId", "blueprintId", "code", "termId", "courseId",
]);

function collectVisibleStrings(value: unknown, key = ""): string[] {
  if (NON_VISIBLE_KEYS.has(key)) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap((item) => collectVisibleStrings(item, key));
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([entryKey, entry]) => collectVisibleStrings(entry, entryKey));
}

describe("AXOM-owned learner catalog branding", () => {
  it("keeps course, setup, resource, focus, and blueprint display copy institution-neutral", () => {
    const learnerCatalog = [
      CURRICULA,
      FOCUS_OPTIONS,
      PATH_OPTIONS,
      TOOL_OPTIONS,
      EDUCATION_TRACKS,
      SGU_DRIVES,
      STUDY_BLUEPRINTS,
      BLUEPRINT_LANES,
      APPLICATION_BLUEPRINTS,
    ];
    const visibleCopy = collectVisibleStrings(learnerCatalog).join("\n");
    expect(visibleCopy).not.toMatch(/\b(?:SGU|AMBOSS|St\.?\s*George'?s)\b/i);
  });

  it("keeps source institutions out of bundled learner bank manifests", () => {
    const projectedFixtures = [biostatsFixture, endocrineFixture, pharmaFixture].map((manifest) => {
      const { institution, ...source } = manifest.source;
      expect(institution).toBeTypeOf("string");
      return { ...manifest, source };
    });
    expect(knownBankManifests.every((manifest) => !("institution" in manifest.source))).toBe(true);
    expect(JSON.stringify(knownBankManifests)).not.toMatch(/\b(?:SGU|AMBOSS|St\.?\s*George'?s)\b/i);
    expect(knownBankManifests).toEqual(projectedFixtures);
  });
});
