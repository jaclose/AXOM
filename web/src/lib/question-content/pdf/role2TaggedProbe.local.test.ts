// @vitest-environment node
// Offline source-conversion probe; no copyrighted text leaves Git.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { loadTaggedPdf } from "./loadTaggedPdf";
import { readTaggedPage } from "./taggedPdf";
import { taggedPdfToQuestions } from "./taggedPdfToQuestions";
const root=join(process.cwd(),"..","artifacts/qbank-6way-20261014");
describe.skipIf(process.env.ROLE2_TAGGED_PROBE !== "1")("private B3 tagged PDF media feasibility",()=>{
it("measures extraction-ready source PDFs without writing question wording",async()=>{
 const input=JSON.parse(readFileSync(join(root,"role-2-b3-prepared-index.json"),"utf8"));
 const limit=Number(process.env.ROLE2_TAGGED_PROBE_LIMIT??20);
 const start=Number(process.env.ROLE2_TAGGED_PROBE_OFFSET??0);
 const jobs=input.sources.filter((r:{fileName:string})=>r.fileName.toLowerCase().endsWith(".pdf")).slice(start,start+limit);
 const pdfjs=await import("pdfjs-dist/legacy/build/pdf.mjs");
 const rows=[];
 for(const row of jobs){
  try {
   const raw=new Uint8Array(readFileSync(row.sourcePath));
   const tagged=await loadTaggedPdf(pdfjs as unknown as typeof import("pdfjs-dist"),raw);
   const parsed=tagged.tagged?taggedPdfToQuestions({pages:tagged.pages.map(readTaggedPage)},{
     bankId:"probe-"+row.sourceSha256.slice(0,20),sourceFilename:row.fileName
   }):undefined;
   rows.push({sha:row.sourceSha256,tagged:tagged.tagged,pages:tagged.pages.length,
     candidateQuestions:parsed?.questions.length??0,renderRequests:parsed?.renders.size??0,
     nativeTables:parsed?.report.tablesPlaced??0,flags:parsed?.issues.length??0});
  }catch(error){rows.push({sha:row.sourceSha256,error:error instanceof Error?error.message:String(error)})}
 }
 writeFileSync(join(root,"role-2-tagged-probe-"+start+".json"),JSON.stringify({start,rows},null,2)+"\n");
 console.log("TAGGED_PROBE",JSON.stringify({start,files:rows.length,tagged:rows.filter(r=>r.tagged).length,
   renderRequests:rows.reduce((n,r)=>n+(r.renderRequests??0),0),
   taggedQuestions:rows.reduce((n,r)=>n+(r.candidateQuestions??0),0),
   errors:rows.filter(r=>"error" in r).length}));
 expect(rows.length).toBe(jobs.length);
});
});
