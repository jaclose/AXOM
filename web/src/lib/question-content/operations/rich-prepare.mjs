#!/usr/bin/env node
// Private tagged-PDF enrichment for Agent2 prepared text-only sources.
// Bounded CPU/RAM/page render, SHA and media receipt checked, no answer
// promotion, no automatic overwrite, no cloud calls, no copyrighted fixtures.
// Uses the existing AXOM tagged-PDF converter, block schema, validators,
// Poppler renderer and strict source-question concordance comparator.
import { createServer } from "vite";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const repo=fileURLToPath(new URL("../../../../../",import.meta.url));
const artifact=join(repo,"artifacts/qbank-6way-20261014");
const corpus=join(artifact,"role-2-corpus-v2");
const resultFolder=join(corpus,"rich-alternates");
const args=process.argv.slice(2);
const flag=(name,fallback)=>{const at=args.indexOf(name);return at<0?fallback:args[at+1]};
const count=Number(flag("--count","12"));
const offset=Number(flag("--offset","0"));
if(!Number.isSafeInteger(count)||count<1||count>40||!Number.isSafeInteger(offset)||offset<0)
  throw new Error("Rich PDF enrichment requires 1–40 sources and a nonnegative offset.");
const digest=bytes=>createHash("sha256").update(bytes).digest("hex");
let vite;
const now=()=>new Date().toISOString();
async function run(){
 const recommended=JSON.parse(await readFile(join(artifact,"agent0-pdf-triage-metadata.json"),"utf8")).balancedNextAfterB3;
 const rows=await Promise.all((await readdir(join(corpus,"results"))).filter(name=>name.startsWith("B4-")&&name.endsWith(".json"))
   .map(async name=>JSON.parse(await readFile(join(corpus,"results",name),"utf8"))));
 const bySha=new Map(rows.filter(row=>row.sourceSha256).map(row=>[row.sourceSha256,row]));
 const desired=recommended.slice(offset,offset+count);
 const legacy=await import("pdfjs-dist/legacy/build/pdf.mjs");
 vite=await createServer({root:join(repo,"web"),server:{middlewareMode:true,hmr:false},appType:"custom",optimizeDeps:{noDiscovery:true}});
 const [loader,taggedPages,converter,sourceReview,media,builder,assessment,packageWriter,concordance]=await Promise.all([
   vite.ssrLoadModule("/src/lib/question-content/pdf/loadTaggedPdf.ts"),
   vite.ssrLoadModule("/src/lib/question-content/pdf/taggedPdf.ts"),
   vite.ssrLoadModule("/src/lib/question-content/pdf/taggedPdfToQuestions.ts"),
   vite.ssrLoadModule("/src/lib/question-content/pdf/sourceReviewExceptions.ts"),
   vite.ssrLoadModule("/src/lib/question-content/pdf/renderTaggedPdfMedia.local.ts"),
   vite.ssrLoadModule("/src/lib/question-content/assets.ts"),
   vite.ssrLoadModule("/src/lib/question-content/assessBank.ts"),
   vite.ssrLoadModule("/src/lib/question-content/packageJson.ts"),
   vite.ssrLoadModule("/src/lib/question-content/packageConcordance.ts"),
 ]);
 const report=[], sourceImages={rendered:0,preserved:0};
 for(const [position,proposal] of desired.entries()){
   const sha=proposal.source_sha256;
   const existing=bySha.get(sha);
   const base={priorityRank:offset+position,sourceSha256:sha,generatedAt:now(),
     accountCloudReadbackVerified:false,readyForScoredPractice:0,sourceConcordanceRequired:true};
   const destination=join(resultFolder,sha);
   if(!existing||!["review-prepared","review-partial"].includes(existing.status)||!existing.originalPath||!existsSync(existing.originalPath)){
     report.push({...base,status:"original-unavailable-or-not-prepared"});continue;
   }
   if(existsSync(join(destination,"source-ledger.json")) && !args.includes("--force")){
     const previous=JSON.parse(await readFile(join(destination,"source-ledger.json"),"utf8"));
     report.push({...previous,resumed:true});continue;
   }
   try{
     const input=new Uint8Array(await readFile(existing.originalPath));
     if(input.byteLength>128*1024*1024)throw new Error("PDF exceeds the 128 MB source safety cap.");
     if(digest(input)!==sha)throw new Error("Input source SHA changed; rescan inventory.");
     const stored=JSON.parse(await readFile(join(existing.packagePath,"prepared-bank.json"),"utf8"));
     const loaded=await loader.loadTaggedPdf(legacy,input);
     if(!loaded.tagged){
       report.push({...base,status:"untagged-pdf",reason:"Existing text-only review package retained. PDF has no reliable structural tags."});
       continue;
     }
     const read=converter.taggedPdfToQuestions({pages:loaded.pages.map(taggedPages.readTaggedPage)},{
       bankId:stored.pkg.manifest.bank.id,sourceFilename:basename(existing.originalPath),
     });
     const sourceReviewed=sourceReview.applyReviewedSourceExceptions(read.questions,"sha256:"+sha);
     if(sourceReviewed.issues.length)throw new Error("Known source review metadata did not match this PDF.");
     const pageSizes=new Map(loaded.pages.map(p=>[p.page,{width:p.width,height:p.height}]));
     if(read.renders.size>80)throw new Error("More than 80 potential medical figures; split source for bounded rendering.");
     const pictures=media.renderTaggedPdfMediaLocally(existing.originalPath,read.renders,pageSizes,{
       maxPages:60,maxRequests:80,
     });
     const files=await builder.describeAssets(sourceReviewed.questions,asset=>pictures.assets.get(asset.id));
     if(files.size!==read.renders.size)throw new Error("Not all PDF source figure render requests produced verified pixels.");
     const imageReferences=sourceReviewed.questions.flatMap(q=>q.assets);
     const seen=new Set();
     for(const [name,pixels] of files){
       const asset=imageReferences.find(entry=>entry.filename===name);
       if(!asset||asset.checksum!=="sha256:"+digest(pixels))throw new Error("Asset checksum mismatch.");
       if(seen.has(name)||/[\\/]/.test(name)||name.includes(".."))throw new Error("Unsafe or repeated picture filename.");
       seen.add(name);
     }
     for(const question of sourceReviewed.questions){
       question.provenance.sourceChecksum="sha256:"+sha;
       if(question.correctAnswer)question.flags=[...(question.flags??[]),{
         type:"answer_needs_review",
         message:"A typed answer in an alternate PDF parser is not independent academic answer verification.",
       }];
     }
     const pkg={manifest:stored.pkg.manifest,questions:sourceReviewed.questions};
     const issues=[...read.issues,...sourceReviewed.issues];
     const evaluated=assessment.assessBank(pkg,issues,[...files.keys()].map(name=>({name})));
     if(evaluated.counts.ready)throw new Error("Rich extraction unexpectedly promoted an unverified correct answer.");
     const comparison=concordance.comparePackageVariants(stored.pkg,pkg);
     const manifestText=packageWriter.serializeManifest(pkg.manifest),questionsText=packageWriter.serializeQuestionsFile(pkg);
     const parsed=packageWriter.parsePackage(manifestText,questionsText);
     const readable=parsed.package?.questions.length??0;
     const complete=readable===pkg.questions.length && comparison.replacementSafe;
     await mkdir(join(destination,"assets"),{recursive:true});
     for(const [name,pixels] of files)await writeFile(join(destination,"assets",name),pixels);
     await writeFile(join(destination,"manifest.json"),manifestText);
     await writeFile(join(destination,"questions.json"),questionsText);
     await writeFile(join(destination,"prepared-bank.json"),JSON.stringify({
       pkg,issues:evaluated.issues,sourceText:read.sourceText,sourceBytes:input.byteLength,
       unreadableQuestions:pkg.questions.length-readable,
       notes:[...read.notes,...sourceReviewed.notes,"Strict comparison to the earlier parser required before QBank presentation; all answers held."],
     }));
     const outcome={...base,status:complete?"rich-concordant-review-only":"rich-alternative-needs-source-review",
       textCandidates:existing.detected,richCandidates:read.questions.length,readable,
       figuresRendered:files.size,assetPages:pictures.renderedPages,tablesPreserved:read.report.tablesPlaced,
       answerRevealFigures:imageReferences.filter(asset=>asset.role==="answer_reveal").length,
       sourcePageMapped:pkg.questions.filter(q=>q.source.page!==undefined).length,
       comparison:{concordant:comparison.concordant,sourcePageConflicts:comparison.sourcePageConflicts,
         answerConflicts:comparison.answerConflicts,reasons:comparison.reasons},
       packagePath:destination,questionFileSha256:digest(Buffer.from(questionsText,"utf8")),
       sourceStillRequiresReview:true};
     await writeFile(join(destination,"source-ledger.json"),JSON.stringify(outcome,null,2)+"\n");
     report.push(outcome);
     sourceImages.rendered+=files.size;
     if(complete)sourceImages.preserved+=files.size;
   }catch(error){
     report.push({...base,status:"rich-extraction-error",reason:error instanceof Error?error.message.slice(0,400):"Unknown"});
   }
   console.log("RICH_B4_PROGRESS",JSON.stringify({at:offset+position,source:sha?.slice(0,10),status:report.at(-1).status,
     figures:report.at(-1).figuresRendered??0}));
 }
 const summary={offset,selected:desired.length,results:report.length,
   statuses:report.reduce((acc,row)=>({...acc,[row.status]:(acc[row.status]??0)+1}),{}),
   totalRenderedImages:report.reduce((n,row)=>n+(row.figuresRendered??0),0),
   concordantImages:report.filter(row=>row.status==="rich-concordant-review-only").reduce((n,row)=>n+(row.figuresRendered??0),0),
   approvedQuestions:0,cloudReadbacks:0};
 await mkdir(join(corpus,"reports"),{recursive:true});
 await writeFile(join(corpus,"reports","rich-"+offset+"-"+count+".json"),JSON.stringify({summary,report},null,2)+"\n");
 console.log("RICH_B4_REPORT",JSON.stringify(summary));
}
try{await run()}catch(error){console.error("RICH_B4_FAILED",error.message);process.exitCode=1}
finally{await vite?.close().catch(()=>{})}
