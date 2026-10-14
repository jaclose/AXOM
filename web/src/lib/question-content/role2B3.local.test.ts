// @vitest-environment node
// Isolated private offline corpus staging. NEVER commit original question text.
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {join,basename,extname} from "node:path";
import {describe,expect,it} from "vitest";
import {sha256} from "./assets";
import {extractCompletePdfSource} from "./pdf/extractCompletePdfSource";
import {prepareRawPdfForReview} from "./batchPreparePdf";
import {serializeManifest,serializeQuestionsFile,parsePackage} from "./packageJson";
import {readPreparedBank} from "../privateLibrary/install";
import {packageToReviewedImport} from "./toReviewedImport";
const root=join(process.cwd(),"../artifacts/qbank-6way-20261014");
const portable=join(root,"role-2-prepared/portable-B3");
const worker=new URL("../../../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs",import.meta.url).toString();
type Job={source_path:string;canonical_input_key:string;module?:string;academic_term?:string;week?:number;expected_questions?:number};
describe.skipIf(process.env.ROLE2_PRIVATE_B3 !== "1")("B3 private PDF source intake batch",()=>{
 it("prepares bounded real PDF sources for review without a fake verified key or missing-file success",async()=>{
 const plan=JSON.parse(readFileSync(join(root,"agent-2-priority-batches.json"),"utf8"));
 const jobs=(plan.processing_order.find((batch:{id:string})=>batch.id==="B3").jobs??[]) as Job[];
 const offset=Number(process.env.ROLE2_BATCH_OFFSET??"0");
 const limit=Number(process.env.ROLE2_BATCH_LIMIT??"30");
 const subset=jobs.slice(offset,offset+limit);
 const legacy=await import("pdfjs-dist/legacy/build/pdf.mjs");
 mkdirSync(portable,{recursive:true});
 const results=[];
 for(const [index,job] of subset.entries()){
  const fileName=basename(job.source_path);
  const source=new Uint8Array(readFileSync(job.source_path));
  const sha=(await sha256(source)).slice(7);
  const target=join(portable,"sources",sha);
  mkdirSync(target,{recursive:true});
  const sourceSuffix=extname(fileName).toLowerCase();
  const storedOriginal="sources/"+sha+"/original"+sourceSuffix;
  writeFileSync(join(portable,storedOriginal),source);
  const base={sourceSha256:sha,fileName,sourcePath:job.source_path,
   originalFile:storedOriginal,sourceBytes:source.byteLength,
   suggestedScope:{module:job.module??null,term:job.academic_term??null,week:job.week??null,basis:"unverified source-filename/inventory inference"},
   originalKeyIndependentlyVerified:false,headlessFigureAssetsVerified:false,cloudReadbackVerified:false};
  if(![".pdf"].includes(sourceSuffix)){
   results.push({...base,status:"unsupported-format",detected:0,needsReview:0,unresolved:0,
      pageMapped:0,ready:0,pages:0,bankFile:null,
      reason:"PowerPoint slideshow is not a supported direct source file. Original retained; export a tagged PDF or structured DOCX and re-import."});
   continue;
  }
  try{
   const extracted=await extractCompletePdfSource(source.buffer.slice(0),undefined,legacy as unknown as typeof import("pdfjs-dist"),worker);
   const prepared=await prepareRawPdfForReview({filename:fileName,originalBytes:source,
     fullText:extracted.text,pageTexts:extracted.pages,expectedSha256:job.canonical_input_key.replace(/^byte:/,"")});
   const manifestPath="sources/"+sha+"/manifest.json";
   const questionsPath="sources/"+sha+"/questions.json";
   const bankFile=prepared.detected ? "sources/"+sha+"/prepared-bank.json":null;
   const manifest=serializeManifest(prepared.pkg.manifest);
   const questions=serializeQuestionsFile(prepared.pkg);
   const roundTrip=parsePackage(manifest,questions);
   const readable=roundTrip.package?.questions.length??0;
   const unreadable=prepared.detected-readable;
   if(prepared.detected && !readable) throw new Error("No candidate question survived canonical package parsing; original retained.");
   writeFileSync(join(portable,manifestPath),manifest);
   writeFileSync(join(portable,questionsPath),questions);
   if(bankFile){
    const review={pkg:prepared.pkg,issues:prepared.issues,
      sourceText:{rawText:extracted.previewText,pageTexts:extracted.previewPages},
      sourceBytes:source.byteLength,unreadableQuestions:0,
      notes:[...prepared.notes,...extracted.warnings,"No independent medical answer or figure confirmation at this stage."]};
    const checked=readPreparedBank(review);
    expect(checked.pkg.questions).toHaveLength(readable);
    expect(checked.unreadableQuestions??0).toBe(unreadable);
    writeFileSync(join(portable,bankFile),JSON.stringify(review,null,2)+"\n");
    expect(packageToReviewedImport(prepared.pkg,prepared.issues).imports).toHaveLength(0);
   }
   results.push({...base,status:prepared.detected?"prepared-review":"no-extractable-questions",
      detected:prepared.detected,readableCandidates:readable,unreadableCandidates:unreadable,
      needsReview:prepared.needsReview,unresolved:prepared.unresolved,
      ready:0,pages:prepared.sourcePages,pageMapped:prepared.pageMapped,
      bankFile,manifestFile:manifestPath,questionsFile:questionsPath,
      reason:prepared.detected?(unreadable ? String(unreadable)+" candidate rows could not be read structurally; the original is retained for correction; all other candidates remain review-only." : "No source answer/media verification; all extracted candidates withheld from scored practice"):
        "No candidate questions extracted; original PDF retained for manual review/OCR.",
      warnings:[...prepared.notes,...extracted.warnings]});
  } catch(error){
   results.push({...base,status:"error",detected:0,needsReview:0,unresolved:0,
     ready:0,pages:0,pageMapped:0,bankFile:null,reason:error instanceof Error?error.message:String(error)});
  }
  if(index%10===0||index===subset.length-1) console.log("B3_PROGRESS",JSON.stringify({offset,at:index+1,total:subset.length,prepared:results.filter(r=>r.status==="prepared-review").length}));
 }
 const summary={requested:subset.length,processed:results.length,
  preparedReview:results.filter(r=>r.status==="prepared-review").length,
  noQuestions:results.filter(r=>r.status==="no-extractable-questions").length,
  errors:results.filter(r=>r.status==="error").length,
  unsupported:results.filter(r=>r.status==="unsupported-format").length,
  detected:results.reduce((n,r)=>n+r.detected,0),
  needsReview:results.reduce((n,r)=>n+r.needsReview,0),
  unresolved:results.reduce((n,r)=>n+r.unresolved,0),ready:0,cloudReadbacks:0};
 writeFileSync(join(root,"role-2-b3-part-"+offset+".json"),JSON.stringify({
   schemaVersion:1,batch:"B3",offset,generatedAt:new Date().toISOString(),summary,sources:results,
 },null,2)+"\n");
 console.log("B3_BATCH_SUMMARY",JSON.stringify({offset,...summary}));
 expect(results.length).toBe(subset.length);
 });
});
