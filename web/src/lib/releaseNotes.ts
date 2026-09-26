import changelog from "../../../CHANGELOG.md?raw";
import { parseReleaseNotes } from "../../../scripts/release-notes.mjs";
import { APP_RELEASE_VERSION, isNewerVersion } from "./brand";
import type { StorageMigrationResult } from "./storageMigrations";

export const RELEASE_HISTORY = parseReleaseNotes(changelog);
export const CURRENT_RELEASE = RELEASE_HISTORY.find((release) => release.version === APP_RELEASE_VERSION);
export const releaseAnnouncementId = (version: string) => `release:${version.replace(/[^a-z0-9._-]/gi, "_")}`;

export function shouldAnnounceRelease(status: StorageMigrationResult | undefined, dismissed: readonly string[]): boolean {
  return Boolean(status?.ok && status.previousBuild && status.buildChanged
    && isNewerVersion(status.currentBuild.version, status.previousBuild.version)
    && !dismissed.includes(releaseAnnouncementId(status.currentBuild.version)));
}
