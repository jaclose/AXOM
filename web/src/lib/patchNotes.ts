import type { ReleaseNote } from "../../../scripts/release-notes.mjs";

export type PatchNotesScope = "all" | "current";

export function orderedReleaseNotes(notes: readonly ReleaseNote[]): ReleaseNote[] {
  return notes
    .map((note, index) => ({ note, index }))
    .sort((a, b) => b.note.date.localeCompare(a.note.date) || a.index - b.index)
    .map(({ note }) => note);
}

export function visibleReleaseNotes(
  notes: readonly ReleaseNote[],
  query: string,
  scope: PatchNotesScope,
  currentVersion: string,
): ReleaseNote[] {
  const search = query.trim().toLocaleLowerCase();
  return orderedReleaseNotes(notes).filter((note) => {
    if (scope === "current" && note.version !== currentVersion) return false;
    return !search || [note.version, note.date, note.title, note.body]
      .some((value) => value.toLocaleLowerCase().includes(search));
  });
}

export function releaseHighlights(note: ReleaseNote, count = 3): string[] {
  const bullets = note.body
    .split("\n")
    .filter((line) => line.startsWith("- "))
    .slice(0, count)
    .map((line) => line.slice(2).trim());
  if (bullets.length) return bullets;
  const firstParagraph = note.body.split(/\n\s*\n/).find((part) => part.trim());
  return firstParagraph ? [firstParagraph.trim()] : [];
}
