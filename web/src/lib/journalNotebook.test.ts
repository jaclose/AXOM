// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { DayAtAGlance } from "./dayAtAGlance";
import {
  JOURNAL_ATTACHMENT_MAX_BYTES,
  JOURNAL_GLANCE_SECTION_KEYS,
  buildJournalGlanceSections,
  buildJournalMarkdown,
  createJournalAttachmentExport,
  nextJournalDay,
  normalizeJournalEntries,
  normalizeJournalNotebookPreferences,
  previousJournalDay,
  readJournalImage,
  renderJournalGlanceText,
  validateJournalImage,
  withoutJournalAttachment,
  type JournalImageAttachment,
  type NotebookJournalEntry,
} from "./journalNotebook";

const attachment: JournalImageAttachment = {
  id: "image-1",
  name: "desk.png",
  type: "image/png",
  size: 4,
  createdAt: "2026-07-13T12:00:00.000Z",
  dataUrl: "data:image/png;base64,YXhvbQ==",
};

describe("journal notebook local attachment boundary", () => {
  it("accepts only bounded image formats and never needs a network lookup", async () => {
    expect(validateJournalImage({ name: "note.txt", type: "text/plain", size: 20 })).toEqual({
      ok: false,
      message: "Use a JPG, PNG, WebP, or GIF image.",
    });
    expect(validateJournalImage({ name: "huge.png", type: "image/png", size: JOURNAL_ATTACHMENT_MAX_BYTES + 1 })).toEqual({
      ok: false,
      message: "Keep each image under 3 MB.",
    });

    let localReads = 0;
    const image = new File(["axom"], "safe.png", { type: "image/png" });
    const result = await readJournalImage(image, [], async () => {
      localReads += 1;
      return "data:image/png;base64,YXhvbQ==";
    });
    expect(localReads).toBe(1);
    expect(result).toMatchObject({ name: "safe.png", type: "image/png", size: 4 });
  });

  it("removes one image without touching the rest and exports the original local bytes", async () => {
    const other = { ...attachment, id: "image-2", name: "second.png" };
    expect(withoutJournalAttachment([attachment, other], attachment.id)).toEqual([other]);

    const exported = createJournalAttachmentExport(attachment);
    expect(exported.filename).toBe("desk.png");
    expect(exported.blob.type).toBe("image/png");
    expect(await exported.blob.text()).toBe("axom");
  });

  it("drops malformed imported images while preserving unknown future journal fields", () => {
    const [entry] = normalizeJournalEntries([{
      id: "future-entry",
      date: "2026-07-13T12:00:00.000Z",
      today: "Safe text",
      tomorrow: "",
      blockers: "",
      energy: "",
      rating: "",
      futureNotebookField: { retained: true },
      attachments: [attachment, {
        ...attachment,
        id: "unsafe",
        name: "unsafe.svg",
        type: "image/svg+xml",
        dataUrl: "data:image/svg+xml;base64,PHN2Zz4=",
      }],
    }]);
    expect(entry.attachments).toEqual([attachment]);
    expect((entry as unknown as { futureNotebookField: unknown }).futureNotebookField).toEqual({ retained: true });
  });
});

describe("journal notebook data projection", () => {
  it("keeps day navigation local-date safe across month boundaries", () => {
    expect(previousJournalDay("2026-03-01")).toBe("2026-02-28");
    expect(nextJournalDay("2026-12-31")).toBe("2027-01-01");
  });

  it("normalizes customizable cover metadata without technical or unsafe values", () => {
    expect(normalizeJournalNotebookPreferences({
      title: "  Residency journal  ",
      subtitle: "Daily review",
      coverTone: "forest",
      paperTone: "cream",
    })).toMatchObject({ title: "Residency journal", coverTone: "forest", paperTone: "cream" });
    expect(normalizeJournalNotebookPreferences({ coverTone: "script", paperTone: "remote" })).toMatchObject({
      coverTone: "onyx",
      paperTone: "warm",
    });
  });

  it("lets the user hide or correct local day-at-a-glance values before inclusion", () => {
    const sections = buildJournalGlanceSections(glanceFixture());
    const rendered = renderJournalGlanceText(sections, {
      hiddenSections: ["energy"],
      corrections: { focus: "75 min, including a lecture that was logged later" },
    });
    expect(rendered).toContain("Focused time: 75 min, including a lecture that was logged later");
    expect(rendered).not.toContain("Energy and readiness");
    expect(rendered).toContain("Questions and cards: 12 practice questions · 20 cards");
  });

  it("preserves every current day-at-a-glance preference through hydration", () => {
    const corrections = Object.fromEntries(
      JOURNAL_GLANCE_SECTION_KEYS.map((key) => [key, `Corrected ${key}`]),
    );
    const [entry] = normalizeJournalEntries([{
      id: "all-glance-preferences",
      date: "2026-07-13T12:00:00.000Z",
      today: "",
      tomorrow: "",
      blockers: "",
      energy: "",
      rating: "Daily review",
      dayAtAGlance: {
        hiddenSections: [...JOURNAL_GLANCE_SECTION_KEYS, "future-section"],
        corrections: { ...corrections, "future-section": "Not yet supported" },
        includedText: "Saved snapshot",
        includedAt: "2026-07-13T21:00:00.000Z",
      },
    }]);

    expect((entry as NotebookJournalEntry).dayAtAGlance).toEqual({
      hiddenSections: [...JOURNAL_GLANCE_SECTION_KEYS],
      corrections,
      includedText: "Saved snapshot",
      includedAt: "2026-07-13T21:00:00.000Z",
    });
  });

  it("exports a readable page without embedding attachment bytes or implying cloud storage", () => {
    const entry: NotebookJournalEntry = {
      id: "entry",
      date: "2026-07-13T12:00:00",
      today: "Protected a focus block.",
      tomorrow: "Review renal questions.",
      blockers: "A late start.",
      energy: "Medium",
      rating: "Useful",
      freeWriting: "I recovered without forcing the rest of the plan.",
      wins: ["Finished the lecture"],
      losses: ["Move flashcards"],
      attachments: [attachment],
      dayAtAGlance: { includedText: "Focused time: 60 min" },
    };
    const markdown = buildJournalMarkdown(entry, "Jul 13, 2026");
    expect(markdown).toContain("# Jul 13, 2026");
    expect(markdown).toContain("## Free writing");
    expect(markdown).toContain("desk.png");
    expect(markdown).not.toContain(attachment.dataUrl);
    expect(markdown.toLowerCase()).not.toContain("cloud");
  });
});

function glanceFixture(): DayAtAGlance {
  return {
    dayKey: "2026-07-13",
    hasEvidence: true,
    intention: { text: "Finish renal review", sourceId: "plan", provenance: [] },
    targetCompletion: {
      progress: 0.5,
      status: "in-progress",
      statusLabel: "In progress",
      eligibleCount: 2,
      metCount: 1,
      requirements: [],
      sourceIds: [],
      provenance: [],
    },
    focusedMinutes: { value: 60, sourceIds: [], pomodoroLogIds: [], sessions: [], provenance: [] },
    questions: { trustedAttempts: 12, correct: 10, incorrect: 2, other: 0, questionIds: [], sourceIds: [], provenance: [] },
    cards: { reviewed: 20, sourceIds: [], provenance: [] },
    habits: { items: [], expected: 1, done: 1, partial: 0, skipped: 0, missed: 0, unlogged: 0, sourceIds: [], provenance: [] },
    tasks: { completed: [{ id: "task", title: "Renal lecture" }], open: [], openBasis: "current-state-created-by-day", sourceIds: [], provenance: [] },
    energy: {
      hasEvidence: true,
      selfReported: { label: "Medium", score: 60, source: "journal" },
      estimatedReadiness: 68,
      readinessLabel: "Ready",
      contributions: [],
      possibleSignalIds: [],
      sourceIds: [],
      provenance: [],
    },
    wins: [{ text: "Finished the lecture", kind: "journal-summary", status: "reported", sourceIds: [], provenance: [] }],
    unfinishedItems: [],
    provenance: [],
  };
}
