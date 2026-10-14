import { describe, expect, it } from "vitest";
import type { ImportPackage, PackageQuestion } from "./package";
import { comparePackageVariants } from "./packageConcordance";
const checksum="sha256:"+"a".repeat(64);
function q(set:number,number:number,answer="B"):PackageQuestion {
return{
 id:`q-${set}-${number}`,source:{filename:"original.pdf",set,questionNumber:number,page:number},
 stem:[{type:"text",text:"In a 55-year-old with dyspnea, which disease best explains this clinical finding?"}],
 choices:[{id:"a",label:"A",blocks:[{type:"text",text:"Primary pulmonary hypertension"}]},
   {id:"b",label:"B",blocks:[{type:"text",text:"Pulmonary embolism"}]}],
 correctAnswer:{labels:[answer],evidence:"printed-key"},provenance:{method:"pdf-import",sourceChecksum:checksum},assets:[],
};
}
function pack(questions:PackageQuestion[]):ImportPackage{
return{
manifest:{schemaVersion:1,course:{name:"GOER",term:5,week:2},
  bank:{id:"demo",title:"Synthetic",discipline:"Medicine"},source:{filename:"original.pdf",sourceWeekDeclared:false},
  questionsFile:"questions.json",assetsDirectory:"assets/"},questions
};
}
describe("conservative package-version correspondence",()=>{
it("accepts identical stem/choices/answers with stable source identity and checksum",()=>{
const original=pack([q(1,1),q(2,1)]);
const candidate=pack(structuredClone(original.questions));
const result=comparePackageVariants(original,candidate);
expect(result.replacementSafe).toBe(true);
expect(result.concordant).toBe(2);
expect(result.unambiguousSourceIdentity).toBe(true);
});
it("rejects distinct original source bytes even if the text appears identical",()=>{
const orig=pack([q(1,1)]),incoming=pack([{...q(1,1),provenance:{method:"pdf-import",sourceChecksum:"sha256:"+"b".repeat(64)}}]);
expect(comparePackageVariants(orig,incoming).replacementSafe).toBe(false);
});
it("requires equal choice order and answer evidence labels; never guesses mappings",()=>{
const orig=pack([q(1,1)]);
const swapped=pack([{...q(1,1),choices:[q(1,1).choices[1],q(1,1).choices[0]]}]);
expect(comparePackageVariants(orig,swapped).replacementSafe).toBe(false);
const conflicting=pack([q(1,1,"A")]);
expect(comparePackageVariants(orig,conflicting)).toMatchObject({answerConflicts:1,replacementSafe:false});
});
it("cannot map two sets by question number alone when source set is changed",()=>{
const orig=pack([q(1,1),q(2,1)]);
const conflicting=pack([q(1,1),q(1,1)]);
expect(comparePackageVariants(orig,conflicting).replacementSafe).toBe(false);
});
it("cannot silently replace an incomplete or page-misidentified extraction",()=>{
const orig=pack([q(1,1),q(1,2)]);
expect(comparePackageVariants(orig,pack([q(1,1)])).replacementSafe).toBe(false);
const misplaced=pack([{...q(1,1),source:{...q(1,1).source,page:77}},q(1,2)]);
expect(comparePackageVariants(orig,misplaced).sourcePageConflicts).toBe(1);
});
it("preserves source-media asymmetry when the canonical question text still matches",()=>{
const orig=pack([q(1,1)]),candidate=pack([{
 ...q(1,1),stem:[...q(1,1).stem,{type:"image",assetId:"histo"}],assets:[
 {id:"histo",filename:"histo.png",mimeType:"image/png",questionId:"q-1-1",role:"stem"}]}]);
expect(comparePackageVariants(orig,candidate).replacementSafe).toBe(true);
});
});
