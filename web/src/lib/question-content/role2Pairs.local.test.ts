// @vitest-environment node
// PRIVATE one-off full-source correspondence audit: never ship raw PDF contents.
import {readFileSync,writeFileSync} from "node:fs";
import {join,basename} from "node:path";
import {describe,it,expect} from "vitest";
import {sha256} from "./assets";
import {extractCompletePdfSource} from "./pdf/extractCompletePdfSource";
import {parsePdfQuestions} from "../pdfQuestionImport";
import {compareAssessmentVersions} from "./sourceVersionComparison";
const base=join(process.cwd(),"../artifacts/qbank-6way-20261014");
const legacyWorker=new URL("../../../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs",import.meta.url).toString();
describe.skipIf(process.env.ROLE2_PRIVATE_B2 !== "1")("B2 actual academic answered/unanswered PDF pair comparison",()=>{
it("compares whole numbered stems and choices while withholding all key attribution",async()=>{
const legacy=await import("pdfjs-dist/legacy/build/pdf.mjs");
const candidates=JSON.parse(readFileSync(join(base,"agent-2-answer-pair-review-tasks.json"),"utf8")) as Array<{
  original_file:string;answered_file:string;status?:string;first_question_text_similarity?:number
}>;
expect(candidates).toHaveLength(11);
const read=async(file:string)=>{
 const content=new Uint8Array(readFileSync(file));
 const checksum=await sha256(content);
 const source=await extractCompletePdfSource(content.buffer.slice(0),undefined,
   legacy as unknown as typeof import("pdfjs-dist"),legacyWorker);
 const parsed=parsePdfQuestions(source.text,source.pages);
 return {source,parsed,checksum:checksum.slice(7)};
};
const reports=[];
for(const [index,job] of candidates.entries()){
 try {
  const original=await read(job.original_file);
  const answered=await read(job.answered_file);
  const comparison=compareAssessmentVersions(original.parsed.drafts,answered.parsed.drafts);
  reports.push({
    candidateIndex:index+1,
    originalFileName:basename(job.original_file),answeredFileName:basename(job.answered_file),
    originalPath:job.original_file,answeredPath:job.answered_file,
    originalSha256:original.checksum,answeredSha256:answered.checksum,
    originalPages:original.source.totalPages,answeredPages:answered.source.totalPages,
    sourceWordingMatchFromDiscovery:job.first_question_text_similarity??null,
    ...comparison,
    humanApprovalRequired:true,sourceVerified:false,cloudReadbackVerified:false,
  });
  console.log("B2_PAIR",JSON.stringify({ix:index+1,a:basename(job.original_file),originalCount:comparison.originalQuestions,
  answeredCount:comparison.answeredQuestions,exact:comparison.exact,near:comparison.similarNeedsReview,
  choiceDrift:comparison.choiceDrift,stemDrift:comparison.stemDrift,missing:comparison.missingMatch,
  ambiguous:comparison.ambiguousNumber,keyCandidates:comparison.observedAnswerCandidates}));
 } catch(err) {
  reports.push({candidateIndex:index+1,originalFileName:basename(job.original_file),error:err instanceof Error?err.message:String(err),
  originalPath:job.original_file,answeredPath:job.answered_file,humanApprovalRequired:true,cloudReadbackVerified:false});
 }
}
const complete=reports.filter(r=>"originalQuestions" in r);
const summary={attempted:candidates.length,analyzed:complete.length,failed:reports.length-complete.length,
  extractedUnansweredQuestions:complete.reduce((s,r)=>s+r.originalQuestions,0),
  extractedAnsweredQuestions:complete.reduce((s,r)=>s+r.answeredQuestions,0),
  fullStemChoiceExactMatches:complete.reduce((s,r)=>s+r.exact,0),
  nearMatches:complete.reduce((s,r)=>s+r.similarNeedsReview,0),
  keyCandidatesSeen:complete.reduce((s,r)=>s+r.observedAnswerCandidates,0),
  keysApprovedForPractice:0,cloudReadbacks:0};
writeFileSync(join(base,"role-2-b2-pair-audit.json"),JSON.stringify({schemaVersion:1,generatedAt:new Date().toISOString(),
 summary,reports},null,2)+"\n");
console.log("B2_TOTAL",JSON.stringify(summary));
expect(complete.length).toBeGreaterThan(5);
expect(summary.keysApprovedForPractice).toBe(0);
});
});
