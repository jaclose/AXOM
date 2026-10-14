import {describe,expect,it} from "vitest";
import {prepareRawPdfForReview} from "./batchPreparePdf";
import {packageToReviewedImport} from "./toReviewedImport";
const page1="Question 1: Which class is the loop diuretic?\nA. Furosemide\nB. Chlorthalidone\nC. Acetazolamide\nAnswer: A";
const page2="Question 2: In a patient with edema, which hormone is elevated?\nA. Insulin\nB. Aldosterone\nC. Calcitonin\nAnswer: B";
const bytes=new TextEncoder().encode("synthetic PDF bytes for parser-only test");
describe("unverified raw-PDF canonical preparation",()=>{
it("holds all question content until original visual and answer verification",async()=>{
const r=await prepareRawPdfForReview({filename:"mock.pdf",originalBytes:bytes,pageTexts:[page1,page2],fullText:page1+"\n\n"+page2});
expect(r.detected).toBe(2);
expect(r.verifiedReady).toBe(0);
expect(r.needsReview).toBe(2);
expect(r.pkg.questions.every(q=>q.flags?.some(f=>f.type==="media_association_uncertain"))).toBe(true);
expect(r.pkg.questions.every(q=>q.provenance.sourceChecksum==="sha256:"+r.sha256)).toBe(true);
expect(new Set(r.pkg.questions.map(q=>q.id)).size).toBe(2);
const handoff=packageToReviewedImport(r.pkg,r.issues);
expect(handoff.imports).toHaveLength(0);
expect(handoff.held).toHaveLength(2);
});
it("rejects a mismatched original checksum before preparing any records",async()=>{
await expect(prepareRawPdfForReview({filename:"changed.pdf",originalBytes:bytes,pageTexts:[page1],fullText:page1,expectedSha256:"0".repeat(64)})).rejects.toThrow(/changed since inventory/);
});
it("reports that a scan yielded zero text instead of inventing OCR questions",async()=>{
const r=await prepareRawPdfForReview({filename:"scanned.pdf",originalBytes:bytes,pageTexts:["",""],fullText:""});
expect(r.detected).toBe(0);
expect(r.notes.join(" ")).toMatch(/no extractable text/);
});
});
