import { describe, expect, it } from "vitest";
import type { ParsedQuestionDraft } from "../questionParse";
import { compareAssessmentVersions } from "./sourceVersionComparison";
const original = (n:number, stem="An adult presents with chest pain and a new ECG tracing. Which diagnosis is likely?"):ParsedQuestionDraft => ({
  questionNumber:n, stem, options:[{key:"A",text:"Pericarditis"},{key:"B",text:"STEMI"},{key:"C",text:"Pulmonary embolism"}],
  confidence:"medium", warnings:[],
});
describe("full-numbered-stem and choice correspondence between academic assessment versions",()=>{
  it("requires matching whole-question content and never promotes a PDF answer key automatically",()=>{
    const left=[original(1),original(2)];
    const right=[{...original(1),correctKey:"B"},{...original(2),correctKey:"A"}];
    const r=compareAssessmentVersions(left,right);
    expect(r.exact).toBe(2);
    expect(r.observedAnswerCandidates).toBe(2);
    expect(r.readyToAssignAnswers).toBe(0);
  });
  it("blocks ambiguous repeated numbers rather than pairing by source position",()=>{
    const left=[original(1),original(1)];
    const right=[{...original(1),correctKey:"B"}];
    const r=compareAssessmentVersions(left,right);
    expect(r.exact).toBe(0);
    expect(r.ambiguousNumber).toBeGreaterThanOrEqual(2);
    expect(r.readyToAssignAnswers).toBe(0);
  });
  it("reports changed option ordering as choice drift despite identical stems",()=>{
    const left=[original(1)];
    const right=[{...original(1),options:[{key:"A",text:"STEMI"},{key:"B",text:"Pericarditis"},{key:"C",text:"Pulmonary embolism"}]}];
    const r=compareAssessmentVersions(left,right);
    expect(r.choiceDrift).toBe(1);
    expect(r.exact).toBe(0);
  });
  it("keeps missing and substantially rewritten question numbers visible",()=>{
    const left=[original(1),original(2)];
    const right=[original(1,"Which cell produces immunoglobulin?"),original(3)];
    const r=compareAssessmentVersions(left,right);
    expect(r.stemDrift).toBe(1);
    expect(r.missingMatch).toBe(2);
  });
});
