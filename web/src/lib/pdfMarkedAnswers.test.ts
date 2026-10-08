import { describe, expect, it, vi } from "vitest";
import { answerBesideCheck, isVectorCheck, proposePdfMarkedAnswers } from "./pdfMarkedAnswers";

import { parseQuestionBlocks } from "./questionParse";

const pdf = vi.hoisted(() => ({ getDocument: vi.fn() }));
vi.mock("pdfjs-dist", () => ({ GlobalWorkerOptions: {}, getDocument: pdf.getDocument, OPS: { save: 10, restore: 11, transform: 12, fill: 22, eoFill: 23, setFillRGBColor: 59, constructPath: 91 } }));

const tick = [0, 15, 61, 1, 0, 30.5, 1, 40, 0, 1, 100, 82.6, 1, 100, 100, 1, 35, 30.5, 4];
describe("native drawn answer marks", () => {
  it("recognizes a check silhouette independent of its size and translation", () => {
    expect(isVectorCheck(tick)).toBe(true);
    expect(isVectorCheck(tick.map((value, i) => i === 18 || i % 3 === 0 ? value : value * .23 + 17))).toBe(true);
  });
  it("does not treat a square, curve, arrow or malformed path as a check", () => {
    expect(isVectorCheck([0,0,0,1,1,0,1,1,1,1,0,1,4])).toBe(false);
    expect(isVectorCheck(tick.map((value, i) => i === 3 ? 2 : value))).toBe(false);
    expect(isVectorCheck([0,0,50,1,50,100,1,100,50,1,60,50,1,60,0,1,40,0,4])).toBe(false);
    expect(isVectorCheck([])).toBe(false);
  });
  it("associates only one adjacent option and rejects distant or ambiguous marks", () => {
    const box = { left: 15, right: 41, bottom: 197, top: 223 };
    const labels = [{ key: "A", x: 43, y: 255, height: 20 }, { key: "B", x: 43, y: 206, height: 20 }];
    expect(answerBesideCheck(box, labels)).toBe("B");
    expect(answerBesideCheck(box, [...labels, { ...labels[1], key: "C" }])).toBeUndefined();
    expect(answerBesideCheck({ ...box, left: 300, right: 330 }, labels)).toBeUndefined();
    expect(answerBesideCheck({ ...box, top: 400 }, labels)).toBeUndefined();
  });
});


it.each([22, 23])("review-gates a native check proposal using paint operation %s and retains its page", async (paint) => {
  const draft = parseQuestionBlocks("Question 1: Choose the sample option.\nA. Alpha\nB. Beta\nC. Gamma")[0];
  draft.sourcePage = 1;
  const path = tick.map((value, i) => i === 18 || i % 3 === 0 ? value : value * .26 + (i % 3 === 1 ? 15 : 197));
  const destroy = vi.fn();
  pdf.getDocument.mockReturnValue({ destroy, promise: Promise.resolve({ getPage: async () => ({
    getTextContent: async () => ({ items: [{ str: "B.", transform: [1,0,0,1,43,206], height: 20 }] }),
    getOperatorList: async () => ({ fnArray: [59, 91], argsArray: [["#00c800"], [paint, [path]]] }),
  }) }) });
  await proposePdfMarkedAnswers(new ArrayBuffer(1), [draft], [{ page: 2, kind: "answer", questionPage: 1, evidence: "Repeated slide" }]);
  expect(draft).toMatchObject({ correctKey: "B", answerEvidencePage: 2, needsReview: true, confidence: "medium", parserRuleIds: expect.arrayContaining(["answer.pdf-vector-check"]) });
  expect(destroy).toHaveBeenCalledOnce();
  draft.correctKey = "A";
  await proposePdfMarkedAnswers(new ArrayBuffer(1), [draft], [{ page: 2, kind: "answer", questionPage: 1, evidence: "Repeated slide" }]);
  expect(draft.correctKey).toBeUndefined();
  expect(draft.parserRuleIds).toContain("conflict.pdf-vector-answer");
});
