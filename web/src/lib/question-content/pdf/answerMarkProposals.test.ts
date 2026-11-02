import { describe, expect, it } from "vitest";
import type { PackageQuestion } from "../package";
import { buildAnswerMarkProposals, vectorCheckBoxes, type AnswerMarkPage } from "./answerMarkProposals";

const mark = { left: 15, top: 277, width: 26, height: 26 };
const labels = [{ key: "A", x: 43, y: 255, height: 20 }, { key: "B", x: 43, y: 206, height: 20 }];
const page = (number: number, figures = [] as typeof mark[]): AnswerMarkPage =>
  ({ page: number, height: 500, figures, labels, vectorChecks: [] });
const question = (id = "source-q1", answerPage = 2): PackageQuestion => ({
  id, source: { filename: "synthetic.pdf", page: 1 }, stem: [{ type: "text", text: "Which invented gate opens?" }],
  choices: ["A", "B"].map(label => ({ id: `${id}-${label}`, label, blocks: [{ type: "text", text: `Gate ${label}` }] })),
  assets: [{ id: `${id}-reveal`, filename: "answer.png", mimeType: "image/png", role: "answer_reveal",
    questionId: id, sourceFile: "synthetic.pdf", sourcePage: answerPage, derivation: "page-render" }],
  provenance: { method: "pdf-import" },
});

describe("private PDF answer-mark review proposals", () => {
  it("links one extra answer-page figure to its exact question, page and choice without scoring it", () => {
    const original = question();
    const before = JSON.stringify(original);
    const proposals = buildAnswerMarkProposals([original], [page(1), page(2, [mark])]);
    expect(proposals).toEqual([{ questionId: "source-q1", questionPage: 1, answerPage: 2,
      answerRevealAssetId: "source-q1-reveal",
      suggestedChoice: "B", reviewRequired: true, reviewReason: "visual-mark", storedAnswerLabels: [], conflict: false,
      evidence: [{ kind: "extra-tagged-figure", box: mark, adjacentChoice: "B" }] }]);
    expect(JSON.stringify(original)).toBe(before);
    expect(original.correctAnswer).toBeUndefined();
  });

  it("records a disagreement with a printed key but never changes that key", () => {
    const original = { ...question(), correctAnswer: { labels: ["A"], evidence: "printed-key" as const } };
    const proposals = buildAnswerMarkProposals([original], [page(1), page(2, [mark])]);
    expect(proposals[0]).toMatchObject({ suggestedChoice: "B", reviewReason: "conflicts-with-key", storedAnswerLabels: ["A"], conflict: true });
    expect(original.correctAnswer.labels).toEqual(["A"]);
  });

  it("leaves several marks and marks repeated on the question page ambiguous", () => {
    const other = { ...mark, top: 228 };
    const ambiguous = buildAnswerMarkProposals([question()], [page(1), page(2, [mark, other])])[0];
    expect(ambiguous.suggestedChoice).toBeUndefined();
    expect(ambiguous.reviewReason).toBe("multiple-marks");
    expect(ambiguous.evidence).toMatchObject([{ adjacentChoice: "B" }, { adjacentChoice: "A" }]);
    expect(buildAnswerMarkProposals([question()], [page(1, [mark]), page(2, [mark])])).toEqual([]);
  });

  it("refuses a slide shared by two questions and deduplicates one tagged/vector mark", () => {
    const answer = { ...page(2, [mark]), vectorChecks: [{ left: 15, bottom: 197, right: 41, top: 223 }] };
    expect(buildAnswerMarkProposals([question("one"), question("two")], [page(1), answer])).toEqual([]);
    expect(buildAnswerMarkProposals([question()], [page(1), answer])[0])
      .toMatchObject({ suggestedChoice: "B", evidence: [{ kind: "extra-tagged-figure" }, { kind: "native-vector-check" }] });
  });

  it("rejects a reveal asset with a different question or source identity", () => {
    const linked = question();
    linked.assets[0].questionId = "another-question";
    expect(buildAnswerMarkProposals([linked], [page(1), page(2, [mark])])).toEqual([]);
    linked.assets[0].questionId = linked.id;
    linked.assets[0].sourceFile = "another-source.pdf";
    expect(buildAnswerMarkProposals([linked], [page(1), page(2, [mark])])).toEqual([]);
  });

  it("keeps two nearby but separate marks ambiguous", () => {
    const close = { ...mark, left: mark.left + 20 };
    const proposal = buildAnswerMarkProposals([question()], [page(1), page(2, [mark, close])])[0];
    expect(proposal.suggestedChoice).toBeUndefined();
    expect(proposal.reviewReason).toBe("multiple-marks");
  });

  it("does not propose a vector check already drawn on the question page", () => {
    const check = { left: 15, bottom: 197, right: 41, top: 223 };
    expect(buildAnswerMarkProposals([question()], [{ ...page(1), vectorChecks: [check] },
      { ...page(2), vectorChecks: [check] }])).toEqual([]);
  });
});

const ops = { save: 10, restore: 11, transform: 12, fill: 22, eoFill: 23, setFillRGBColor: 59, constructPath: 91 };
const tick = [0, 15, 61, 1, 0, 30.5, 1, 40, 0, 1, 100, 82.6, 1, 100, 100, 1, 35, 30.5, 4];

it("proposes only the strict green vector tick, preserving its bounds", () => {
  const accepted = vectorCheckBoxes({ fnArray: [59, 91], argsArray: [["#00c800"], [22, [tick]]] }, ops);
  expect(accepted).toEqual([{ left: 0, bottom: 0, right: 100, top: 100 }]);
  expect(vectorCheckBoxes({ fnArray: [59, 91], argsArray: [["#00c800"], [22, [[0,0,0,1,1,0,1,1,1,4]]]] }, ops)).toEqual([]);
  expect(vectorCheckBoxes({ fnArray: [59, 91], argsArray: [["#c80000"], [22, [tick]]] }, ops)).toEqual([]);
});
