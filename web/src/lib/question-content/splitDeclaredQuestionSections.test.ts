import { describe, expect, it } from "vitest";
import { splitDeclaredQuestionSections } from "./splitDeclaredQuestionSections";
import { prepareRawTextBank } from "./batchPrepareText";

const first = ["Lectures 03 and 05 - Vascular Pathology", "Source file: lecture03.pdf", "",
  "Question 1: Which vessel?", "A. Aorta", "B. Vein", "Answer: A", "",
  "Question 2: Which layer?", "A. Media", "B. Intima", "Answer: B"].join("\n");
const second = ["Lectures 06 - Diuretics", "Source file: lecture06.pdf", "",
  "Question 1: Which drug?", "A. Loop drug", "B. Beta blocker", "Answer: A"].join("\n");
describe("declared source boundaries in concatenated medical question text",()=>{
  it("retains each explicit set number and source title without changing the original numbering",async()=>{
    const input = ["Semester overview", "", "============", first, "============",second].join("\n");
    const chunks = splitDeclaredQuestionSections(input);
    expect(chunks).toHaveLength(2);
    expect(chunks.map(chunk=>chunk.sourceLabel)).toEqual(["lecture03.pdf","lecture06.pdf"]);
    expect(chunks.map(chunk=>chunk.set)).toEqual([1,2]);
    const prepared=await prepareRawTextBank({filename:"combined.txt",sourceBytes:new TextEncoder().encode(input)});
    expect(prepared.declaredSets).toBe(2);
    expect(prepared.detected).toBe(3);
    expect(prepared.pkg.questions.map(q=>[q.source.set,q.source.questionNumber])).toEqual([[1,1],[1,2],[2,1]]);
    expect(prepared.pkg.questions.every(q=>q.correctAnswer !== undefined && q.flags?.some(f=>f.type==="answer_needs_review"))).toBe(true);
    expect(prepared.verifiedReadyIds).toHaveLength(0);
    expect(prepared.reviewRequiredIds).toHaveLength(3);
  });
  it("does not discard preamble questions just because later text resembles a catalog",()=>{
    const suspicious=["Question 1: Earlier question", "A. One","B. Two","Answer: A",
      first,second].join("\n");
    expect(splitDeclaredQuestionSections(suspicious)).toEqual([{body:suspicious}]);
  });
  it("does not split on one unverified source heading or an unrelated filename mention",()=>{
    const body="A note names an external source file.\nSource file: lecture.pdf\nIntroduction continues.";
    expect(splitDeclaredQuestionSections(body)).toEqual([{body}]);
  });
});
