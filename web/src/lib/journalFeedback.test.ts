import { describe, expect, it } from "vitest";
import { validateJournalExperienceFeedback } from "./journalFeedback";

const input = { rating: 4, liked: "  Quiet desk  ", wantMore: "", missing: "", painPoints: "", comment: "" };

describe("journal experience feedback boundary", () => {
  it("trims explicit fields without adding journal content", () => {
    expect(validateJournalExperienceFeedback(input)).toEqual({ ...input, liked: "Quiet desk" });
    expect(Object.keys(validateJournalExperienceFeedback(input)).sort()).toEqual(Object.keys(input).sort());
  });


  it("drops unexpected runtime fields instead of retaining private notebook data", () => {
    const accidentalPayload = {
      ...input,
      notebookContents: "Private journal entry that must not appear in feedback",
      entryId: "private-page-id",
    };
    const validated = validateJournalExperienceFeedback(accidentalPayload);
    expect(validated).toEqual({
      rating: 4,
      liked: "Quiet desk",
      wantMore: "",
      missing: "",
      painPoints: "",
      comment: "",
    });
    expect("notebookContents" in validated).toBe(false);
    expect("entryId" in validated).toBe(false);
  });

  it("rejects invalid ratings and oversized fields", () => {
    expect(() => validateJournalExperienceFeedback({ ...input, rating: 0 })).toThrow(/rating/i);
    expect(() => validateJournalExperienceFeedback({ ...input, painPoints: "x".repeat(1001) })).toThrow(/pain points/i);
  });
});
