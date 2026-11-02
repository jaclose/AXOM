import { describe, expect, it } from "vitest";
import { validateJournalExperienceFeedback } from "./journalFeedback";

const input = { rating: 4, liked: "  Quiet desk  ", wantMore: "", missing: "", painPoints: "", comment: "" };

describe("journal experience feedback boundary", () => {
  it("trims explicit fields without adding journal content", () => {
    expect(validateJournalExperienceFeedback(input)).toEqual({ ...input, liked: "Quiet desk" });
    expect(Object.keys(validateJournalExperienceFeedback(input)).sort()).toEqual(Object.keys(input).sort());
  });

  it("rejects invalid ratings and oversized fields", () => {
    expect(() => validateJournalExperienceFeedback({ ...input, rating: 0 })).toThrow(/rating/i);
    expect(() => validateJournalExperienceFeedback({ ...input, painPoints: "x".repeat(1001) })).toThrow(/pain points/i);
  });
});
