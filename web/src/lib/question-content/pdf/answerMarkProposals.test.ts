import { describe, expect, it } from "vitest";
import type { ImportPackage, PackageQuestion } from "../package";
import { assertPackageSourceIdentity, buildAnswerMarkProposals, vectorCheckBoxes, vectorOutlineBoxes, type AnswerMarkPage } from "./answerMarkProposals";

const mark = { left: 15, top: 277, width: 26, height: 26 };
const labels = [{ key: "A", x: 43, y: 255, height: 20 }, { key: "B", x: 43, y: 206, height: 20 }];
const page = (number: number, figures = [] as typeof mark[]): AnswerMarkPage =>
  ({ page: number, height: 500, figures, labels, vectorChecks: [], outlines: [] });
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

  it("suppresses conflicting choices across two answer-reveal pages", () => {
    const linked = question();
    linked.assets.push({ ...linked.assets[0], id: `${linked.id}-reveal-3`, sourcePage: 3 });
    const proposals = buildAnswerMarkProposals([linked], [page(1), page(2, [mark]),
      page(3, [{ ...mark, top: 228 }])]);
    expect(proposals).toHaveLength(2);
    expect(proposals.map(proposal => proposal.answerPage)).toEqual([2, 3]);
    expect(proposals.every(proposal => proposal.suggestedChoice === undefined
      && proposal.reviewReason === "conflicting-reveal-pages" && proposal.conflict)).toBe(true);
    expect(linked.correctAnswer).toBeUndefined();
  });
});

it("rejects a stale bank or wrong source identity before reusing its receipt", () => {
  const source = { sha256: "a".repeat(64), fileName: "synthetic.pdf" };
  const linked = question();
  linked.provenance.sourceChecksum = `sha256:${source.sha256}`;
  const pkg: ImportPackage = { manifest: { schemaVersion: 2, course: { name: "Synthetic", term: 1, week: 1 },
    bank: { id: "synthetic", title: "Synthetic", discipline: "Synthetic" }, source: { filename: source.fileName, sourceWeekDeclared: false },
    questionsFile: "questions.json", assetsDirectory: "assets" }, questions: [linked] };
  expect(() => assertPackageSourceIdentity(pkg, source)).not.toThrow();
  expect(() => assertPackageSourceIdentity(pkg, { ...source, sha256: "b".repeat(64) })).toThrow(/question source identity/);
  expect(() => assertPackageSourceIdentity(pkg, { ...source, fileName: "other.pdf" })).toThrow(/bank source filename/);
  expect(() => assertPackageSourceIdentity({ ...pkg, questions: [{ ...linked, source: { filename: "other.pdf", page: 1 } }] }, source))
    .toThrow(/question source identity/);
  expect(() => assertPackageSourceIdentity({ ...pkg, questions: [{ ...linked, assets: [{ ...linked.assets[0], sourceFile: "other.pdf" }] }] }, source))
    .toThrow(/answer-reveal asset source identity/);
});

const ops = { save: 10, restore: 11, transform: 12, stroke: 20, fill: 22, eoFill: 23,
  setStrokeRGBColor: 58, setFillRGBColor: 59, constructPath: 91 };
const tick = [0, 15, 61, 1, 0, 30.5, 1, 40, 0, 1, 100, 82.6, 1, 100, 100, 1, 35, 30.5, 4];
const outlinedChoice = [0, 80, 200, 1, 280, 200, 1, 280, 230, 1, 80, 230, 4];
const roundedChoice = [0, 0, 0, 2, 0, 4, 4, 8, 8, 8, 1, 192, 8,
  2, 196, 8, 200, 4, 200, 0, 1, 200, -24, 2, 200, -28, 196, -32, 192, -32,
  1, 8, -32, 2, 4, -32, 0, -28, 0, -24, 4];

it("proposes only the strict green vector tick, preserving its bounds", () => {
  const accepted = vectorCheckBoxes({ fnArray: [59, 91], argsArray: [["#00c800"], [22, [tick]]] }, ops);
  expect(accepted).toEqual([{ left: 0, bottom: 0, right: 100, top: 100 }]);
  expect(vectorCheckBoxes({ fnArray: [59, 91], argsArray: [["#00c800"], [22, [[0,0,0,1,1,0,1,1,1,4]]]] }, ops)).toEqual([]);
  expect(vectorCheckBoxes({ fnArray: [59, 91], argsArray: [["#c80000"], [22, [tick]]] }, ops)).toEqual([]);
});

it("finds colored rectangular and transformed rounded choice outlines as review evidence", () => {
  expect(vectorOutlineBoxes({ fnArray: [58, 91], argsArray: [["#0070c0"], [20, [outlinedChoice]]] }, ops))
    .toEqual([{ left: 80, bottom: 200, right: 280, top: 230 }]);
  expect(vectorOutlineBoxes({ fnArray: [10, 12, 58, 91, 11], argsArray: [[], [1, 0, 0, 1, 84, 164],
    ["#800080"], [20, [roundedChoice]], []] }, ops))
    .toEqual([{ left: 84, bottom: 132, right: 284, top: 172 }]);
  expect(vectorOutlineBoxes({ fnArray: [58, 91], argsArray: [["#042433"], [20, [outlinedChoice]]] }, ops))
    .toHaveLength(1);
  expect(vectorOutlineBoxes({ fnArray: [58, 91], argsArray: [["#0070c0"], [22, [outlinedChoice]]] }, ops)).toEqual([]);
});

it("suggests only an answer-page outline with one same-row choice, never scoring it", () => {
  const original = question();
  const outline = { left: 80, bottom: 200, right: 280, top: 230 };
  const proposal = buildAnswerMarkProposals([original], [page(1), { ...page(2), outlines: [outline] }])[0];
  expect(proposal).toMatchObject({ suggestedChoice: "B", reviewRequired: true, reviewReason: "visual-mark",
    evidence: [{ kind: "native-choice-outline", adjacentChoice: "B" }] });
  expect(original.correctAnswer).toBeUndefined();
  expect(buildAnswerMarkProposals([original], [{ ...page(1), outlines: [outline] },
    { ...page(2), outlines: [outline] }])).toEqual([]);
});

it("suppresses decorative, elliptical and ambiguous outlines", () => {
  const outline = { left: 80, bottom: 200, right: 280, top: 230 };
  const decorative = { left: 80, bottom: 300, right: 280, top: 330 };
  expect(buildAnswerMarkProposals([question()], [page(1), { ...page(2), outlines: [decorative] }])).toEqual([]);
  const ambiguous = buildAnswerMarkProposals([question()], [page(1), { ...page(2), outlines: [outline,
    { left: 80, bottom: 250, right: 280, top: 280 }] }])[0];
  expect(ambiguous).toMatchObject({ reviewReason: "multiple-marks", reviewRequired: true });
  expect(ambiguous.suggestedChoice).toBeUndefined();
  const ellipse = [0, 80, 200, 2, 80, 230, 280, 230, 280, 215,
    2, 280, 200, 80, 200, 80, 215, 4];
  expect(vectorOutlineBoxes({ fnArray: [58, 91], argsArray: [["#0070c0"], [20, [ellipse]]] }, ops)).toEqual([]);
  expect(vectorOutlineBoxes({ fnArray: [91], argsArray: [[20, [outlinedChoice]]] }, ops)).toEqual([]);
});
