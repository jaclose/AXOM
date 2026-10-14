import { describe, expect, it } from "vitest";
import { SGU_CURRICULUM } from "../curricula";
import type { SourceDocument } from "../library";
import type { TrackerItem } from "../types";
import { buildAcademicTemplateCatalog } from "./academicCatalog";
import { buildCurriculumCoverage } from "./curriculumCoverage";

const fixture = (): SourceDocument => ({
  id: "sensitive-document",
  fileName: "PRIVATE-STUDENT-RECORD.txt",
  fileType: "axom-course-template",
  title: "Private proprietary source",
  rawText: "NCRS - Lectures:\nWeek 4:\nNCRS Lecture 01 PRIVATE-PATIENT-FULL-NAME-HERE [Lecture]",
  sizeBytes: 77,
  checksum: "secret-checksum",
  tags: ["course-template"],
  linkedQuestionSetIds: [],
  libraryOnly: true,
  uploadedAt: "2026-10-14T12:00:00.000Z",
});
const tracker: TrackerItem = {
  id: "personal-private-id", label: "PRIVATE-PATIENT-FULL-NAME-HERE",
  path: "Term 4/NCRS/Week 4", templateKey: "ncrs|lecture|1",
  kind: "Lecture", passes: 3, ankiPasses: 2,
  note: "Never share these private patient notes",
  yield: "none", updated: "2026-10-14T12:00:00.000Z",
};

describe("rights-gated academic metadata catalog", () => {
  it("builds stable metadata skeletons for all five terms, not fictitious schedules", () => {
    const coverage = buildCurriculumCoverage(SGU_CURRICULUM, [], []);
    const catalog = buildAcademicTemplateCatalog(SGU_CURRICULUM, coverage);
    expect(catalog).toMatchObject({
      format: "axom-academic-template-catalog", version: 1,
      curriculumId: "sgu-md",
      distribution: {
        intendedAudience: "authorized-students",
        publicationStatus: "not-published", rightsStatus: "not-verified",
        sharingPolicy: "license-and-access-review-required",
        includesSourceDocuments: false, includesQuestionContent: false,
        includesUserProgress: false,
      },
    });
    expect(catalog.terms.map((term) => term.name)).toEqual([
      "Term 1", "Term 2", "Term 3", "Term 4", "Term 5",
    ]);
    const modules = catalog.terms.flatMap((term) => term.courses.flatMap((course) => course.modules));
    expect(modules).toHaveLength(23);
    expect(new Set(modules.map((module) => module.key)).size).toBe(23);
    expect(modules.every((module) => module.expectedOfficialActivityRows === null
      && module.evidence === "outline-only"
      && module.knownTemplateActivityRows === 0)).toBe(true);
  });

  it("does not serialize uploaded filenames, proprietary lecture text or personal progress", () => {
    const coverage = buildCurriculumCoverage(SGU_CURRICULUM, [fixture()], [tracker]);
    const manifest = buildAcademicTemplateCatalog(SGU_CURRICULUM, coverage);
    const ncrs = manifest.terms[3].courses[0].modules.find((module) => module.name === "NCRS")!;
    expect(ncrs).toMatchObject({
      key: "term4/ppm500/ncrs",
      evidence: "private-template-present",
      savedTemplateFiles: 1, knownTemplateActivityRows: 1,
      sourceStatedWeeks: [4], expectedOfficialActivityRows: null,
    });
    const serialized = JSON.stringify(manifest);
    for (const forbidden of [
      "PRIVATE-PATIENT-FULL-NAME-HERE", "PRIVATE-STUDENT-RECORD.txt",
      "secret-checksum", "personal-private-id",
      "Never share these private patient notes",
    ]) expect(serialized).not.toContain(forbidden);
    expect(JSON.stringify(buildAcademicTemplateCatalog(SGU_CURRICULUM, coverage))).toBe(serialized);
  });

  it("refuses a coverage audit that belongs to a different academic outline", () => {
    const coverage = buildCurriculumCoverage(SGU_CURRICULUM, [], []);
    expect(() => buildAcademicTemplateCatalog({
      ...SGU_CURRICULUM, terms: SGU_CURRICULUM.terms.slice(0, 2),
    }, coverage)).toThrow(/does not match/);
  });
});
