// @vitest-environment node
// Real private original PDF; opt-in, writes only Git-ignored result packages.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import { describe, expect, it } from "vitest";
import { sha256, describeAssets, readImageInfo } from "../assets";
import { assessBank } from "../assessBank";
import type { ImportPackage } from "../package";
import { serializeManifest, serializeQuestionsFile, parsePackage } from "../packageJson";
import { applyReviewedSourceExceptions } from "./sourceReviewExceptions";
import { loadTaggedPdf } from "./loadTaggedPdf";
import { readTaggedPage } from "./taggedPdf";
import { taggedPdfToQuestions } from "./taggedPdfToQuestions";
import { renderTaggedPdfMediaLocally } from "./renderTaggedPdfMedia.local";

const root=join(process.cwd(),"../artifacts/qbank-6way-20261014");
describe.skipIf(process.env.ROLE2_RICH_PDF_REAL !== "1")("real tagged source visual media preservation",()=>{
  it("preserves every anchored figure and source page with checksum and no premature answer release",async()=>{
    const baseline=JSON.parse(readFileSync(join(root,"role-2-b3-prepared-index.json"),"utf8"));
    const probe=JSON.parse(readFileSync(join(root,"role-2-tagged-probe-0.json"),"utf8"));
    const selected=probe.rows.find((row:{tagged?:boolean;renderRequests?:number})=>row.tagged&&row.renderRequests===8)
       ?? probe.rows.find((row:{tagged?:boolean;renderRequests?:number})=>row.tagged&&(row.renderRequests??0)>0);
    expect(selected).toBeDefined();
    const source=baseline.sources.find((row:{sourceSha256:string})=>row.sourceSha256===selected.sha);
    expect(source).toBeDefined();
    const raw=new Uint8Array(readFileSync(source.sourcePath));
    const checksum=await sha256(raw);
    expect(checksum).toBe("sha256:"+source.sourceSha256);
    const pdfjs=await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loaded=await loadTaggedPdf(pdfjs as unknown as typeof import("pdfjs-dist"),raw);
    expect(loaded.tagged).toBe(true);
    const bankId="rich-"+source.sourceSha256.slice(0,20);
    const converted=taggedPdfToQuestions({pages:loaded.pages.map(readTaggedPage)},{
      bankId,sourceFilename:basename(source.sourcePath)
    });
    const review=applyReviewedSourceExceptions(converted.questions,checksum);
    expect(review.issues).toEqual([]);
    const sizes=new Map(loaded.pages.map(page=>[page.page,{width:page.width,height:page.height}]));
    const rendered=renderTaggedPdfMediaLocally(source.sourcePath,converted.renders,sizes);
    expect(rendered.assets.size).toBe(converted.renders.size);
    const files=await describeAssets(review.questions,asset=>rendered.assets.get(asset.id));
    expect(files.size).toBe(converted.renders.size);
    const nativeSizes=[...files].map(([filename,bytes])=>({filename,bytes,info:readImageInfo(bytes)}));
    expect(nativeSizes.every(asset=>asset.info?.mimeType==="image/png")).toBe(true);
    for(const question of review.questions){
      question.provenance.sourceChecksum=checksum;
      // Headless import may not independently verify which marked slide
      // constitutes a source key. Preserve the candidate, never auto-score it.
      if(question.correctAnswer) question.flags=[...(question.flags??[]),{
        type:"answer_needs_review",
        message:"Bulk PDF original and answer-marking require source review before scored practice."
      }];
    }
    const pkg:ImportPackage={
      manifest:{schemaVersion:1,course:{name:"UNMAPPED",term:0,week:0},
        bank:{id:bankId,title:basename(source.sourcePath).replace(/\.pdf$/i,""),discipline:"Imported academic PDF"},
        source:{filename:basename(source.sourcePath),sourceWeekDeclared:false},
        questionsFile:"questions.json",assetsDirectory:"assets/"},
      questions:review.questions,
    };
    const issues=[...converted.issues,...review.issues];
    const assessed=assessBank(pkg,issues,[...files.keys()].map(name=>({name})));
    expect(assessed.counts.ready).toBe(0);
    const out=join(root,"role-2-rich-b3",source.sourceSha256);
    mkdirSync(join(out,"assets"),{recursive:true});
    for(const [name,bytes] of files) writeFileSync(join(out,"assets",name),bytes);
    const manifest=serializeManifest(pkg.manifest);
    const questions=serializeQuestionsFile(pkg);
    expect(parsePackage(manifest,questions).package?.questions).toHaveLength(converted.questions.length);
    writeFileSync(join(out,"manifest.json"),manifest);
    writeFileSync(join(out,"questions.json"),questions);
    writeFileSync(join(out,"prepared-bank.json"),JSON.stringify({pkg,issues:assessed.issues,
      sourceText:converted.sourceText,sourceBytes:source.sourceBytes,
      notes:[...converted.notes,...review.notes,"Bulk images preserved as source page/figure assets; answer verification required."]
    },null,2)+"\n");
    const stats={sourceSha256:source.sourceSha256,questions:pkg.questions.length,renderRequests:converted.renders.size,
      imageAssets:nativeSizes.length,renderedPages:rendered.renderedPages,
      taggedCoverage:converted.report.taggedShare,tables:converted.report.tablesPlaced,
      needsReview:assessed.counts["needs-review"],unresolved:assessed.counts.unresolved,
      ready:assessed.counts.ready,sourcePages:converted.report.pages,
      sourceVerified:true,cloudReadbackVerified:false};
    writeFileSync(join(out,"source-ledger.json"),JSON.stringify(stats,null,2)+"\n");
    console.log("RICH_PDF_REAL_PROOF",JSON.stringify(stats));
    expect(stats.imageAssets).toBeGreaterThan(0);
  },120_000);
});
