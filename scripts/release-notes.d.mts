export interface ReleaseNote {
  version: string;
  date: string;
  title: string;
  body: string;
}

export function parseReleaseNotes(changelog: string): ReleaseNote[];

export function requireReleaseNotes(
  changelog: string,
  version: string
): ReleaseNote;

export function formatReleaseNotes(
  release: ReleaseNote
): string;
