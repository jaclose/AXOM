import changelog from "../../../CHANGELOG.md?raw";
import { parseReleaseNotes } from "../../../scripts/release-notes.mjs";
import { APP_RELEASE_VERSION, isNewerVersion } from "./brand";
import type { StorageMigrationResult } from "./storageMigrations";

/**
 * Historical notes preserve the repository record while the in-app history
 * uses AXOM-owned language. This projection runs before Markdown parsing so
 * the raw changelog remains untouched and useful for release audits.
 */
export function neutralizeLegacyReleaseCopy(value: string): string {
  return value
    .replace(/\b[\w.+-]+@sgu\.edu\b/gi, "the feedback address")
    .replace(/\bSt\.?\s+George(?:'|’)?s(?:\s+University)?\b/gi, "the source institution")
    .replace(/\bSGU\s+shared\b/gi, "course shared")
    .replace(/\bSGU\s+course shells\b/gi, "term-based course templates")
    .replace(/\bSGU\b/gi, "course-specific")
    .replace(/\bAMBOSS\b/gi, "external question bank");
}

export const RELEASE_HISTORY = parseReleaseNotes(neutralizeLegacyReleaseCopy(changelog));
export const CURRENT_RELEASE = RELEASE_HISTORY.find((release) => release.version === APP_RELEASE_VERSION);
export const releaseAnnouncementId = (version: string) => `release:${version.replace(/[^a-z0-9._-]/gi, "_")}`;

export function shouldAnnounceRelease(status: StorageMigrationResult | undefined, dismissed: readonly string[]): boolean {
  return Boolean(status?.ok && status.previousBuild && status.buildChanged
    && isNewerVersion(status.currentBuild.version, status.previousBuild.version)
    && !dismissed.includes(releaseAnnouncementId(status.currentBuild.version)));
}
