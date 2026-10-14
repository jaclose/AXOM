// @vitest-environment node
// Opt-in private academic source media processing. All output is Git-ignored.
// Reuses AXOM's tagged PDF parser and render plan; no duplicate question DB.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { describe, expect, it } from "vitest";
import { sha256, readImageInfo, describeAssets } from "../assets";
import { assessBank } from "../assessBank";
import type { ImportPackage } from "../package";
import { serializeManifest, serializeQuestionsFile, parsePackage } from "../packageJson";
import { applyReviewedSourceExceptions } from "./sourceReviewExceptions";
import { loadTaggedPdf } from "./loadTaggedPdf";
import { readTaggedPage } from "./taggedPdf";
import { taggedPdfToQuestions } from "./taggedPdfToQuestions";
import { renderTaggedPdfMediaLocally } from "./renderTaggedPdfMedia.local";

const root=join(process.cwd(),"../artifacts/qbank-6way-20261014");
const resultRoot=join(root,"role-2-rich-b3");
type Candidate={sourceSha256:string;sourcePath:string;detected:number;sourceBytes:number};
type Probe={sha:string;tagged?:boolean;renderRequests?:number;candidateQuestions?:number};
describe.skipIf(process.env.ROLE2_RICH_B3_BATCH!=="1")("batch conversion of actual tagged academic PDFs, including figures",()=>{
 it("prepares one checksum-bound private rich collection per supported original without promoting guessed answers",async()=>{
  const baseline=JSON.parse(readFileSync(join(root,"role-2-b3-prepared-index.json"),"utf8"));
  const probe=JSON.parse(readFileSync(join(root,"role-2-tagged-probe-0.json"),"utf8"));
  const relevant=(probe.rows as Probe[]).filter(entry=>entry.tagged);
  const offset=Number(process.env.ROLE2_RICH_B3_OFFSET??"0");
  const limit=Number(process.env.ROLE2_RICH_B3_LIMIT??"3");
  const subset=relevant.slice(offset,offset+limit);
  const libraryPdf=await import("pdfjs-dist/legacy/build/pdf.mjs");
  const results=[];
  mkdirSync(resultRoot,{recursive:true});
  for(const row of subset){
    const source=(baseline.sources as Candidate[]).find(input=>input.sourceSha256===row.sha);
    expect(source).toBeDefined();
    const destination=join(resultRoot,row.sha);
    const savedLedger=join(destination,"source-ledger.json");
    if(existsSync(savedLedger)){
      const earlier=JSON.parse(readFileSync(savedLedger,"utf8"));
      const bankPath=join(destination,"prepared-bank.json");
      if(earlier.sourceSha256===row.sha && earlier.imageAssets===row.renderRequests && existsSync(bankPath)){
        const candidate=JSON.parse(readFileSync(bankPath,"utf8"));
        const assets=(candidate.pkg?.questions??[]).flatMap((question:{assets:{filename:string;checksum?:string}[]})=>question.assets);
        const verified=new Set<string>();
        let intact=true;
        for(const asset of assets){
          if(verified.has(asset.filename)) continue;
          verified.add(asset.filename);
          const assetPath=join(destination,"assets",asset.filename);
          if(!existsSync(assetPath) || !asset.checksum ||
              (await sha256(new Uint8Array(readFileSync(assetPath))))!==asset.checksum){
            intact=false;break;
          }
        }
        if(intact && verified.size===row.renderRequests &&
           candidate.pkg.questions.length===(earlier.candidateQuestions??earlier.questions)){
          results.push({
            ...earlier,
            candidateQuestions:earlier.candidateQuestions??earlier.questions,
            originalFiguresRequested:earlier.originalFiguresRequested??earlier.renderRequests,
            status:earlier.status??"rich-media-review-ready",
            resumed:true,
          });
          continue;
        }
      }
    }
    try{
      const raw=new Uint8Array(readFileSync(source!.sourcePath));
      if(source!.sourceBytes>128*1024*1024) throw new Error("PDF exceeds 128 MB maximum source file.");
      const checksum=await sha256(raw);
      if(checksum!=="sha256:"+row.sha) throw new Error("Original source checksum mismatch; rerun inventory before preparing.");
      const tagged=await loadTaggedPdf(libraryPdf as unknown as typeof import("pdfjs-dist"),raw);
      if(!tagged.tagged) throw new Error("Previously tagged source no longer contains readable structure.");
      const converted=taggedPdfToQuestions({pages:tagged.pages.map(readTaggedPage)},{
        bankId:"rich-"+row.sha.slice(0,20),sourceFilename:basename(source!.sourcePath),
      });
      const reviewed=applyReviewedSourceExceptions(converted.questions,checksum);
      if(reviewed.issues.length) throw new Error(reviewed.issues[0].message);
      const pageSizes=new Map(tagged.pages.map(page=>[page.page,{width:page.width,height:page.height}]));
      const raster=renderTaggedPdfMediaLocally(source!.sourcePath,converted.renders,pageSizes,{maxRequests:250,maxPages:100});
      const files=await describeAssets(reviewed.questions,asset=>raster.assets.get(asset.id));
      if(files.size!==converted.renders.size) throw new Error("Rendered assets do not match declared tagged image identities.");
      for(const question of reviewed.questions){
        question.provenance.sourceChecksum=checksum;
        if(question.correctAnswer) question.flags=[...(question.flags??[]),{
          type:"answer_needs_review",
          message:"Bulk tagged-PDF answer text has not been independently verified against the original source; human verification required.",
        }];
      }
      const pkg:ImportPackage={
        manifest:{schemaVersion:1,course:{name:"UNMAPPED",term:0,week:0},
          bank:{id:"rich-"+row.sha.slice(0,20),title:basename(source!.sourcePath).replace(/\.pdf$/i,""),discipline:"Imported academic PDF"},
          source:{filename:basename(source!.sourcePath),sourceWeekDeclared:false},
          questionsFile:"questions.json",assetsDirectory:"assets/"},
        questions:reviewed.questions,
      };
      const assessed=assessBank(pkg,[...converted.issues,...reviewed.issues],[...files].map(([name])=>({name})));
      expect(assessed.counts.ready).toBe(0);
      const manifest=serializeManifest(pkg.manifest),questionFile=serializeQuestionsFile(pkg);
      const round= parsePackage(manifest,questionFile);
      const unreadable=converted.questions.length-(round.package?.questions.length??0);
      if(unreadable===converted.questions.length && converted.questions.length) throw new Error("No rich questions survive canonical reading; review original PDF.");
      mkdirSync(join(destination,"assets"),{recursive:true});
      for(const [name,bytes] of files){
        if(readImageInfo(bytes)?.mimeType!=="image/png") throw new Error("A rasterized source image has invalid PNG bytes.");
        writeFileSync(join(destination,"assets",name),bytes);
        if(await sha256(bytes)!==reviewed.questions.flatMap(q=>q.assets).find(asset=>asset.filename===name)?.checksum)
          throw new Error("Rendered asset checksum changed before writing.");
      }
      const sourcePages=converted.questions.filter(q=>q.source.page!==undefined).length;
      const stats={sourceSha256:row.sha,sourcePath:source!.sourcePath,sourceBytes:source!.sourceBytes,
        candidateQuestions:converted.questions.length,baselineTextOnlyCandidates:source!.detected,
        readableQuestions:converted.questions.length-unreadable,unreadable,
        sourcePageMapped:sourcePages,sourcePages:converted.report.pages,
        tables:converted.report.tablesPlaced,originalFiguresRequested:converted.renders.size,
        imageAssets:files.size,renderedPages:raster.renderedPages,
        answerRevealAssets:converted.questions.flatMap(q=>q.assets).filter(asset=>asset.role==="answer_reveal").length,
        unplacedMedia:converted.unplaced.length,heldReady:0,needsReview:assessed.counts["needs-review"],
        unresolved:assessed.counts.unresolved,sourceVerified:true,cloudReadbackVerified:false,
        status:unreadable||source!.detected!==converted.questions.length?"needs-parser-and-source-reconciliation":"rich-media-review-ready"};
      writeFileSync(join(destination,"manifest.json"),manifest);
      writeFileSync(join(destination,"questions.json"),questionFile);
      writeFileSync(join(destination,"prepared-bank.json"),JSON.stringify({pkg,issues:assessed.issues,
        sourceText:converted.sourceText,sourceBytes:source!.sourceBytes,unreadableQuestions:unreadable,
        notes:[...converted.notes,...reviewed.notes,"Real page/table figures rendered; original medical answers still require source review."],
      },null,2)+"\n");
      writeFileSync(savedLedger,JSON.stringify(stats,null,2)+"\n");
      results.push(stats);
    }catch(cause){
      results.push({sourceSha256:row.sha,status:"failed-rich-media",error:cause instanceof Error?cause.message:String(cause),sourceVerified:false,cloudReadbackVerified:false});
    }
    console.log("RICH_MEDIA_BATCH_SOURCE",JSON.stringify({
      sha:row.sha.slice(0,12),status:results.at(-1)?.status,
      images:results.at(-1)?.imageAssets??0,questions:results.at(-1)?.candidateQuestions??0,
      error:results.at(-1)?.error??undefined,
    }));
  }
  const summary={offset,count:results.length,successful:results.filter(r=>r.status!=="failed-rich-media").length,
    failed:results.filter(r=>r.status==="failed-rich-media").length,
    images:results.reduce((s,row)=>s+(row.imageAssets??0),0),
    questions:results.reduce((s,row)=>s+(row.candidateQuestions??0),0),
    cloudVerified:0};
  writeFileSync(join(root,"role-2-rich-b3-batch-"+offset+".json"),JSON.stringify({summary,results},null,2)+"\n");
  console.log("RICH_MEDIA_BATCH_SUMMARY",JSON.stringify(summary));
  expect(results).toHaveLength(subset.length);
 },240_000);
});
