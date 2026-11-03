import { describe, expect, it } from "vitest";
import { orderedReleaseNotes, releaseHighlights, visibleReleaseNotes } from "./patchNotes";
import type { ReleaseNote } from "../../../scripts/release-notes.mjs";

const notes: ReleaseNote[] = [
  { version: "0.0.1", date: "2026-06-12", title: "First steps", body: "- Study plan: open your day.\n- Backups: save locally." },
  { version: "0.0.2", date: "2026-11-01", title: "Safer practice", body: "- Question review: source evidence stays visible.\n- Course map: clearer scope." },
  { version: "0.0.3", date: "2026-11-01", title: "Small repair", body: "One focused change." },
];

describe("patch notes projection", () => {
  it("orders by date without changing the canonical source order or ties", () => {
    expect(orderedReleaseNotes(notes).map((note) => note.version)).toEqual(["0.0.2", "0.0.3", "0.0.1"]);
    expect(notes[0].version).toBe("0.0.1");
  });

  it("searches version, title, and body within the selected scope", () => {
    expect(visibleReleaseNotes(notes, "  QUESTION  ", "all", "0.0.3").map((note) => note.version)).toEqual(["0.0.2"]);
    expect(visibleReleaseNotes(notes, "practice", "current", "0.0.3")).toEqual([]);
    expect(visibleReleaseNotes(notes, "0.0.3", "current", "0.0.3")).toHaveLength(1);
  });

  it("shows sourced bullet highlights or a prose excerpt", () => {
    expect(releaseHighlights(notes[1], 1)).toEqual(["Question review: source evidence stays visible."]);
    expect(releaseHighlights(notes[2])).toEqual(["One focused change."]);
  });
});
