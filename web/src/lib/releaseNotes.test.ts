import { describe, expect, it } from "vitest";
import { BUILD_INFO } from "./buildInfo";
import { RELEASE_HISTORY, neutralizeLegacyReleaseCopy, releaseAnnouncementId, shouldAnnounceRelease } from "./releaseNotes";
import type { StorageMigrationResult } from "./storageMigrations";

const status = (previous = "0.0.1-prebeta"): StorageMigrationResult => ({
  ok: true, fromVersion: 33, toVersion: 33, backupKey: null, migrated: false,
  buildChanged: true, commitChanged: true, schemaChanged: false,
  currentBuild: { ...BUILD_INFO, version: "0.0.2-prebeta" },
  previousBuild: { ...BUILD_INFO, version: previous },
});
describe("post-update release announcements", () => {
  it("announces an actual version upgrade once", () => {
    expect(shouldAnnounceRelease(status(), [])).toBe(true);
    expect(shouldAnnounceRelease(status(), [releaseAnnouncementId("0.0.2-prebeta")])).toBe(false);
  });
  it("does not mistake first setup or same-version rebuild for an upgrade", () => {
    expect(shouldAnnounceRelease(undefined, [])).toBe(false);
    expect(shouldAnnounceRelease({ ...status(), previousBuild: null }, [])).toBe(false);
    expect(shouldAnnounceRelease(status("0.0.2-prebeta"), [])).toBe(false);
  });
  it("never advertises a downgrade as a new release", () => {
    expect(shouldAnnounceRelease(status("1.0.0"), [])).toBe(false);
  });

  it("projects historical notes into AXOM-owned learner copy", () => {
    const projected = neutralizeLegacyReleaseCopy(
      "SGU shared · St. George's University · AMBOSS · jdabbagh@sgu.edu · SGU course shells",
    );
    expect(projected).toBe(
      "course shared · the source institution · external question bank · the feedback address · term-based course templates",
    );
    expect(JSON.stringify(RELEASE_HISTORY)).not.toMatch(/\b(?:SGU|AMBOSS|St\.?\s*George'?s)\b|@sgu\.edu/i);
  });
});
