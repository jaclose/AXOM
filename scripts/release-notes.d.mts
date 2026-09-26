export interface ReleaseNotesEntry {
  version: string;
  date: string;
  title: string;
  body: string;
}
export function parseReleaseNotes(changelog: string): ReleaseNotesEntry[];
export function requireReleaseNotes(changelog: string, version: string): ReleaseNotesEntry;
export function formatReleaseNotes(release: ReleaseNotesEntry): string;
