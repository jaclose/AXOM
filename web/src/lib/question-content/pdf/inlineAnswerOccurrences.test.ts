import { describe, expect, it } from "vitest";
import { locateInlineAnswerOccurrences } from "./inlineAnswerOccurrences";

const stem = (verb: string): string => `Which invented gate ${verb} after the signal is activated?`;
const question = (number: number, verb: string): string =>
  `${number}. ${stem(verb)}\nA. Gate A\nB. Gate B\nC. Gate C`;

describe("private PDF inline-answer locations", () => {
  it("binds a marker on the next page before the following question", () => {
    const found = locateInlineAnswerOccurrences([
      question(1, "opens"), question(2, "closes"), question(1, "opens"),
      `Answer: B\n${question(2, "closes")}\nAnswer: C`,
    ]);
    expect(found).toHaveLength(4);
    expect(found.map(({ page, line }) => [page, line])).toEqual([[1, 1], [2, 1], [3, 1], [4, 2]]);
    expect(found.map(({ answerMarkers }) => answerMarkers)).toEqual([
      [], [], [{ page: 4, line: 1, label: "B" }], [{ page: 4, line: 6, label: "C" }],
    ]);
  });

  it("anchors the question line when an option repeats its opening", () => {
    const found = locateInlineAnswerOccurrences([
      `1. ${stem("opens")}\nA. Gate A repeats ${stem("opens")}\nB. Gate B\nC. Gate C`,
      question(2, "closes"),
    ]);
    expect(found).toHaveLength(2);
    expect(found.map(({ page, line, answerMarkers }) => [page, line, answerMarkers.length]))
      .toEqual([[1, 1, 0], [2, 1, 0]]);
  });

  it("does not infer positions for short openings", () => {
    expect(locateInlineAnswerOccurrences(["1. Gate?\nA. One\nB. Two"])).toEqual([]);
  });

  it("does not mistake an option repeating a split stem for the question start", () => {
    const split = `1. Which invented gate opens after\nthe signal is activated?\n`
      + `A. Gate A repeats ${stem("opens")}\nB. Gate B\nC. Gate C`;
    expect(locateInlineAnswerOccurrences([split, `${split}\nAnswer: B`])).toEqual([]);
  });

  it("withholds explicit multiple-letter answers in several printed forms", () => {
    for (const answer of ["B, C", "B/C", "B and C", "B (or C)", "B C"]) {
      const found = locateInlineAnswerOccurrences([question(1, "opens"), `${question(1, "opens")}\nAnswer: ${answer}`]);
      expect(found).toHaveLength(2);
      expect(found[1].answerMarkers).toEqual([]);
    }
  });
});
