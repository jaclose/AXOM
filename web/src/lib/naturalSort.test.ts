import { describe, expect, it } from "vitest";
import { sortByNaturalTitle } from "./naturalSort";

describe("sortByNaturalTitle", () => {
  it("puts lecture 2 before lecture 10 and ignores case", () => {
    const titles = ["BPM L10 Neoplasia", "bpm L2 Inflammation", "BPM L1 Cell injury"].map((title) => ({ title }));
    expect(sortByNaturalTitle(titles).map((item) => item.title)).toEqual(["BPM L1 Cell injury", "bpm L2 Inflammation", "BPM L10 Neoplasia"]);
  });
});
