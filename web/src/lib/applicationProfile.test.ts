import { describe, expect, it } from "vitest";
import {
  APPLICATION_REGIONS, applicationCycleLabel, experienceLogHours, isApplicationProfileEmpty,
  normalizeApplicationProfile, resolveRegion, type ApplicationProfile,
} from "./applicationProfile";
import { mergeStates, parseImport, toPortableState } from "./backup";
import { makeSeed } from "./seed";
import { migratePersistedState } from "./store";
import type { PremedExperienceEntry, PremedExperienceKind } from "./types";

const profile: ApplicationProfile = {
  plannedMatriculationYear: 2027, cumulativeGpa: 3.72, scienceGpa: 3.61, mcatTotal: 511, mcatTestDate: "2026-04",
  mcatLowestSection: 126, mcatAttempts: 1, citizenship: "us-citizen", stateOfResidence: "Alabama",
  degreeStatus: "in-progress", degreeExpectedDate: "2027-05", semesterHoursCompleted: 96,
  coursework: {
    biology: { status: "completed", semesterHours: 8 },
    organicChemistry: { status: "in-progress", semesterHours: 4, passFail: true, online: false },
    english: { status: "planned", communityCollege: true, apCredit: true },
  },
  activityHours: { research: 420, shadowing: 0, leadership: 75.5 },
  updatedAt: "2026-09-23T12:00:00.000Z",
};

const logEntry = (kind: PremedExperienceKind, hours: number): PremedExperienceEntry => ({
  id: `${kind}-${hours}`, date: "2026-09-01", kind, title: kind, organization: "Clinic", hours,
  verified: false, reflection: "", created: "2026-09-01T00:00:00Z",
});

describe("application profile normalization", () => {
  it("keeps a valid profile unchanged", () => {
    expect(normalizeApplicationProfile(profile)).toEqual(profile);
    expect(normalizeApplicationProfile(JSON.parse(JSON.stringify(profile)))).toEqual(profile);
  });

  it("drops out-of-range, non-numeric and non-integer values instead of clamping", () => {
    const result = normalizeApplicationProfile({
      plannedMatriculationYear: 2019, cumulativeGpa: 4.01, scienceGpa: -0.1, mcatTotal: 529, mcatLowestSection: 117,
      mcatAttempts: 0, semesterHoursCompleted: 401, citizenship: "us-citizen", coursework: {},
      activityHours: { research: 20001, shadowing: -1, leadership: 20000 },
    });
    expect(result).toEqual({ citizenship: "us-citizen", coursework: {}, activityHours: { leadership: 20000 } });
    expect(normalizeApplicationProfile({ plannedMatriculationYear: 2041, mcatTotal: 471, mcatLowestSection: 133, mcatAttempts: 11 })).toBeUndefined();
    expect(normalizeApplicationProfile({ plannedMatriculationYear: 2027.5, mcatTotal: 510.5, mcatAttempts: 1.5, mcatLowestSection: 125.5 })).toBeUndefined();
    expect(normalizeApplicationProfile({ plannedMatriculationYear: 2020, cumulativeGpa: 0, mcatTotal: 472, mcatLowestSection: 132, mcatAttempts: 10 }))
      .toEqual({ plannedMatriculationYear: 2020, cumulativeGpa: 0, mcatTotal: 472, mcatLowestSection: 132, mcatAttempts: 10, coursework: {}, activityHours: {} });
  });

  it("drops strings, NaN, Infinity and booleans in numeric fields", () => {
    expect(normalizeApplicationProfile({
      cumulativeGpa: "3.8", scienceGpa: Number.NaN, mcatTotal: "510", mcatAttempts: Number.POSITIVE_INFINITY,
      plannedMatriculationYear: "2027", semesterHoursCompleted: true, activityHours: { research: "100", shadowing: Number.NaN },
    })).toBeUndefined();
  });

  it("keeps GPAs as entered after the range check, so rounding never clears a minimum", () => {
    expect(normalizeApplicationProfile({ cumulativeGpa: 3.456, scienceGpa: 3.999 })).toEqual({
      cumulativeGpa: 3.456, scienceGpa: 3.999, coursework: {}, activityHours: {},
    });
    expect(normalizeApplicationProfile({ cumulativeGpa: 3.499 })?.cumulativeGpa).toBe(3.499);
    expect(normalizeApplicationProfile({ cumulativeGpa: 4.004 })).toBeUndefined();
  });

  it("drops unknown enum values and unknown categories", () => {
    expect(normalizeApplicationProfile({
      citizenship: "citizen", degreeStatus: "done", stateOfResidence: "Grenada",
      coursework: { biology: { status: "finished", semesterHours: 8 }, anatomy: { status: "completed" } },
      activityHours: { volunteering: 100 },
    })).toBeUndefined();
    expect(normalizeApplicationProfile({ citizenship: "daca", degreeStatus: "not-started" }))
      .toEqual({ citizenship: "daca", degreeStatus: "not-started", coursework: {}, activityHours: {} });
  });

  it("requires a valid status on coursework entries and drops invalid entry fields", () => {
    expect(normalizeApplicationProfile({
      coursework: {
        physics: { semesterHours: 8 },
        biochemistry: { status: "not-planned", semesterHours: 401, passFail: "yes", online: true },
        mathStatistics: "completed",
      },
    })).toEqual({ coursework: { biochemistry: { status: "not-planned", online: true } }, activityHours: {} });
  });

  it("accepts yyyy-MM and truncates yyyy-MM-dd, dropping other date shapes", () => {
    expect(normalizeApplicationProfile({ mcatTestDate: "2026-04-18", degreeExpectedDate: "2027-05" }))
      .toEqual({ mcatTestDate: "2026-04", degreeExpectedDate: "2027-05", coursework: {}, activityHours: {} });
    for (const date of ["2026-13", "2026-4", "04/2026", "2026-04-32", "2026-04-18T00:00:00Z", 202604, ""]) {
      expect(normalizeApplicationProfile({ mcatTestDate: date })).toBeUndefined();
    }
  });

  it("canonicalizes the state of residence and keeps only ISO update stamps", () => {
    expect(normalizeApplicationProfile({ stateOfResidence: " washington, d.c. ", updatedAt: "yesterday" }))
      .toEqual({ stateOfResidence: "District of Columbia", coursework: {}, activityHours: {} });
    expect(normalizeApplicationProfile({ stateOfResidence: "tx", updatedAt: "2026-09-23T12:00:00Z" }))
      .toEqual({ stateOfResidence: "Texas", updatedAt: "2026-09-23T12:00:00Z", coursework: {}, activityHours: {} });
  });

  it("returns undefined, never throws, for input without usable data", () => {
    for (const value of [undefined, null, "profile", 42, [], {}, { coursework: {}, activityHours: {} },
      { updatedAt: "2026-09-23T12:00:00Z", coursework: {}, activityHours: {} }, { coursework: [], activityHours: null },
      { coursework: { biology: null }, activityHours: { research: undefined } }]) {
      expect(normalizeApplicationProfile(value)).toBeUndefined();
    }
  });

  it("reports emptiness without counting the update stamp or empty maps", () => {
    expect(isApplicationProfileEmpty(undefined)).toBe(true);
    expect(isApplicationProfileEmpty({ coursework: {}, activityHours: {} })).toBe(true);
    expect(isApplicationProfileEmpty({ coursework: {}, activityHours: {}, updatedAt: "2026-09-23T12:00:00Z", mcatTotal: undefined })).toBe(true);
    expect(isApplicationProfileEmpty({ coursework: {}, activityHours: { research: 0 } })).toBe(false);
    expect(isApplicationProfileEmpty({ coursework: { english: { status: "planned" } }, activityHours: {} })).toBe(false);
    expect(isApplicationProfileEmpty(profile)).toBe(false);
  });
});

describe("application regions", () => {
  it("lists every US state, DC, five territories and 13 Canadian regions with unique codes", () => {
    expect(APPLICATION_REGIONS.filter(region => region.country === "US")).toHaveLength(56);
    expect(APPLICATION_REGIONS.filter(region => region.country === "CA")).toHaveLength(13);
    expect(new Set(APPLICATION_REGIONS.map(region => region.code)).size).toBe(APPLICATION_REGIONS.length);
    expect(APPLICATION_REGIONS.every(region => /^[A-Z]{2}$/.test(region.code))).toBe(true);
  });

  it("resolves every region by its own name and code, using roster spellings", () => {
    for (const region of APPLICATION_REGIONS) {
      expect(resolveRegion(region.name)).toBe(region);
      expect(resolveRegion(region.code)).toBe(region);
    }
    for (const name of ["Alabama", "District of Columbia", "Puerto Rico", "Georgia", "Washington", "West Virginia", "New York"]) {
      expect(resolveRegion(name)?.name).toBe(name);
    }
  });

  it("matches codes and names regardless of case, whitespace and punctuation", () => {
    expect(resolveRegion("AL")?.name).toBe("Alabama");
    expect(resolveRegion("  alabama ")?.code).toBe("AL");
    expect(resolveRegion("NEW   york")?.code).toBe("NY");
    expect(resolveRegion("north-carolina")?.code).toBe("NC");
    expect(resolveRegion("pr")?.name).toBe("Puerto Rico");
    expect(resolveRegion("Hawaiʻi")?.code).toBe("HI");
    expect(resolveRegion("U.S. Virgin Islands")?.code).toBe("VI");
    expect(resolveRegion("on")?.name).toBe("Ontario");
  });

  it("resolves common aliases and surrounding wording", () => {
    for (const alias of ["Washington DC", "Washington, D.C.", "D.C.", "dc", "District of Columbia"]) {
      expect(resolveRegion(alias)?.code).toBe("DC");
    }
    expect(resolveRegion("Québec")).toEqual({ code: "QC", name: "Quebec", country: "CA" });
    expect(resolveRegion("quebec")?.code).toBe("QC");
    expect(resolveRegion("USVI")?.code).toBe("VI");
    expect(resolveRegion("Newfoundland")?.code).toBe("NL");
    expect(resolveRegion("the State of New York")?.code).toBe("NY");
    expect(resolveRegion("Washington State")?.code).toBe("WA");
    expect(resolveRegion("Commonwealth of Puerto Rico")?.code).toBe("PR");
    expect(resolveRegion("Texas, USA")?.code).toBe("TX");
    expect(resolveRegion("Ontario, Canada")?.code).toBe("ON");
    expect(resolveRegion("Ontario, USA")).toBeUndefined();
  });

  it("does not resolve Caribbean countries, partial names or empty input", () => {
    for (const value of ["Grenada", "British Virgin Islands", "Virgin Islands", "Dominica", "Dominican Republic", "Saint Kitts and Nevis",
      "St. Kitts", "Saint Lucia", "Saint Vincent and the Grenadines", "Sint Maarten", "Saba", "Aruba", "Curaçao", "Cayman Islands",
      "The Bahamas", "Antigua and Barbuda", "Jamaica", "Barbados", "Cuba", "Belize", "Guyana", "Montserrat", "Nevis",
      "Turks and Caicos Islands", "Trinidad and Tobago", "FL panhandle", "Carolina", "Canada", "USA", "", "   ", undefined]) {
      expect(resolveRegion(value)).toBeUndefined();
    }
  });
});

describe("application cycle and experience log", () => {
  it("labels the application cycle with an en dash", () => {
    expect(applicationCycleLabel(2027)).toBe("2026–27 cycle · entering 2027");
    expect(applicationCycleLabel(2030)).toBe("2029–30 cycle · entering 2030");
    expect(applicationCycleLabel(2100)).toBe("2099–00 cycle · entering 2100");
  });

  it("maps unambiguous log kinds, keeps clinical hours unsplit and ignores invalid hours", () => {
    expect(experienceLogHours([
      logEntry("Research", 100.26), logEntry("Research", 20.1), logEntry("Shadowing", 12), logEntry("Leadership", 0),
      logEntry("Service", 30.04), logEntry("Clinical", 40.07), logEntry("Clinical", 9.99),
      logEntry("Research", -5), logEntry("Shadowing", Number.NaN), logEntry("Service", Number.POSITIVE_INFINITY),
      { ...logEntry("Research", 1), hours: "50" as unknown as number },
    ])).toEqual({
      mapped: { research: 120.4, shadowing: 12, leadership: 0, nonclinicalVolunteer: 30 },
      clinicalUnsplit: 50.1,
    });
    expect(experienceLogHours([])).toEqual({ mapped: {}, clinicalUnsplit: 0 });
    expect(experienceLogHours([logEntry("Clinical", 5)]).mapped).toEqual({});
  });
});

describe("application profile persistence", () => {
  it("survives migration and a backup round trip", () => {
    const seed = makeSeed();
    seed.profile.applicationProfile = profile;
    const migrated = migratePersistedState(seed, seed.schemaVersion);
    expect(migrated.profile.applicationProfile).toEqual(profile);
    const restored = parseImport(JSON.stringify({ _app: "AXOM", ...toPortableState(migrated) }));
    expect(restored.profile.applicationProfile).toEqual(profile);
  });

  it("normalizes corrupt persisted and imported profiles", () => {
    const seed = makeSeed();
    (seed.profile as unknown as Record<string, unknown>).applicationProfile = { cumulativeGpa: 9, coursework: "none" };
    expect(migratePersistedState(seed, seed.schemaVersion).profile.applicationProfile).toBeUndefined();
    const portable = toPortableState(makeSeed()) as unknown as { profile: Record<string, unknown> };
    portable.profile.applicationProfile = { mcatTotal: 512, mcatTestDate: "2026-04-18", citizenship: "martian" };
    expect(parseImport(JSON.stringify({ _app: "AXOM", ...portable })).profile.applicationProfile)
      .toEqual({ mcatTotal: 512, mcatTestDate: "2026-04", coursework: {}, activityHours: {} });
  });

  it("keeps the current profile on merge and falls back to the imported one", () => {
    const current = makeSeed(); const incoming = makeSeed();
    const other: ApplicationProfile = { cumulativeGpa: 3.1, coursework: {}, activityHours: { research: 10 } };
    current.profile.applicationProfile = profile;
    incoming.profile.applicationProfile = other;
    expect(mergeStates(current, incoming).profile.applicationProfile).toEqual(profile);
    current.profile.applicationProfile = undefined;
    expect(mergeStates(current, incoming).profile.applicationProfile).toEqual(other);
    incoming.profile.applicationProfile = undefined;
    expect(mergeStates(current, incoming).profile.applicationProfile).toBeUndefined();
  });
});
