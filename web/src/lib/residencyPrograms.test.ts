import { describe, expect, it } from "vitest";
import { buildResidencyDataset, filterResidencyPrograms, padCode, parseResidencyDataset, programsFromAcgmeRows } from "./residencyPrograms";

const source = { url: "https://acgmecloud.org/analytics/explore-public-data/program-search", title: "ACGME public program listing", retrievedAt: "2026-09-26T12:00:00Z" };
const rows = [
  { AcademicYearRange: "2024-2025", ProgramCode: "140311024", SpecialtyNumericCode: "140", SpecialtyName: "Internal medicine", IsSubspecialty: "0", ProgramName: "Example IM Program", ProgramCity: "Brooklyn", ProgramStateName: "New York", ProgramAccreditationName: "Continued Accreditation", SponsorName: "Example Center", SponsorCode: "12345", ProgramLengthofTraining: "3", PositionsFilledTotal: "54" },
  { AcademicYearRange: "2024-2025", ProgramCode: "1401211001", SpecialtyNumericCode: "141", SpecialtyName: "Cardiovascular disease", IsSubspecialty: "1", ProgramName: "Example Cardiology Fellowship", ProgramCity: "Boston", ProgramStateName: "Massachusetts", ProgramAccreditationName: "Continued Accreditation", SponsorName: "Boston Hospital", SponsorCode: "999", ProgramLengthofTraining: "3", PositionsFilledTotal: "9" },
  { ProgramCode: "", ProgramName: "No code", SpecialtyName: "Surgery" },
  { ProgramCode: "140311024", ProgramName: "Duplicate", SpecialtyName: "Internal medicine" },
];

describe("residency programs", () => {
  it("restores leading zeros that spreadsheets drop and rejects malformed codes", () => {
    expect(padCode("140311024", 10)).toBe("0140311024");
    expect(padCode(20, 3)).toBe("020");
    expect(padCode("12.0", 6)).toBe("000012");
    expect(padCode("12345678901", 10)).toBeUndefined();
    expect(padCode("A12", 3)).toBeUndefined();
  });

  it("imports the ACGME listing with identity from the listing and requirements left Unknown", () => {
    const { programs, skipped } = programsFromAcgmeRows(rows, source);
    expect(skipped).toBe(2);
    expect(programs.map((program) => program.id)).toEqual(["acgme-0140311024", "acgme-1401211001"]);
    expect(programs[0]).toMatchObject({ sponsorCode: "012345", state: "New York", trainingYears: 3, positionsFilled: 54, isSubspecialty: false, verification: "official-listing" });
    expect(programs[1].isSubspecialty).toBe(true);
    expect(Object.values(programs[0].requirements).every((value) => value === "Unknown")).toBe(true);
  });

  it("round-trips through validation and rejects rows without sources or codes", () => {
    const dataset = buildResidencyDataset(programsFromAcgmeRows(rows, source).programs, "2026-09-26T12:00:00Z");
    const parsed = parseResidencyDataset(JSON.parse(JSON.stringify(dataset)), new Date("2026-09-27T00:00:00Z"));
    expect(parsed.ok && parsed.dataset.programs.length).toBe(2);
    expect(parsed.ok && parsed.dataset.academicYear).toBe("2024-2025");
    const broken = parseResidencyDataset({ schemaVersion: 1, programs: [{ acgmeProgramId: "x", programName: "Bad", specialty: "IM", sources: [source] }, { acgmeProgramId: "0140311024", programName: "No source", specialty: "IM", sources: [] }] });
    expect(broken.ok && broken.dataset.programs).toHaveLength(0);
    expect(broken.issues.filter((issue) => issue.severity === "error")).toHaveLength(2);
    expect(parseResidencyDataset({ schemaVersion: 2, programs: [] }).ok).toBe(false);
  });

  it("filters by text, specialty, state, fellowships, and saved programs", () => {
    const { programs } = programsFromAcgmeRows(rows, source);
    const base = { query: "", specialty: "", state: "", coreOnly: false };
    expect(filterResidencyPrograms(programs, { ...base, coreOnly: true })).toHaveLength(1);
    expect(filterResidencyPrograms(programs, { ...base, query: "boston" })[0].id).toBe("acgme-1401211001");
    expect(filterResidencyPrograms(programs, { ...base, state: "New York" })).toHaveLength(1);
    expect(filterResidencyPrograms(programs, { ...base, savedIds: new Set(["acgme-1401211001"]) })).toHaveLength(1);
    expect(filterResidencyPrograms(programs, { ...base, query: "0140311024" })).toHaveLength(1);
  });
});
