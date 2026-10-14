// @vitest-environment node
// Local diagnostic only; no original question text leaves ignored artifacts.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadTaggedPdf } from "./loadTaggedPdf";
import { readTaggedPage } from "./taggedPdf";
import { taggedPdfToQuestions } from "./taggedPdfToQuestions";
import { assessBank } from "../assessBank";
import { applyReviewedSourceExceptions } from "./sourceReviewExceptions";
import { sha256 } from "../assets";
import { readPreparedBank } from "../../privateLibrary/install";
const repo=join(process.cwd(),"..");
const source=join(process.env.HOME!,"Downloads/AXOM_GOER_Prepared_Library/banks/goer-biostats-epidemiology");
const report=join(repo,"artifacts/qbank-6way-20261014/role-2-goer-biostats-answer-diff.json");
describe.skipIf(process.env.ROLE2_PRIVATE_GOER_SOURCE !== "1")("real GOER PDF/native answer integrity reconciliation",()=>{
 it("compares native/source conversion answer evidence by question number",async()=>{
  const legacy=await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdf=new Uint8Array(readFileSync(join(source,"source/Biostats and Epidemiology PQ.pdf")));
  const checksum=await sha256(pdf);
  const loaded=await loadTaggedPdf(legacy as unknown as typeof import("pdfjs-dist"),pdf);
  expect(loaded.tagged).toBe(true);
  const bank=readPreparedBank(JSON.parse(readFileSync(join(source,"prepared-bank.json"),"utf8")));
  const converted=taggedPdfToQuestions({pages:loaded.pages.map(readTaggedPage)},{
    bankId:bank.pkg.manifest.bank.id,sourceFilename:bank.pkg.manifest.source.filename,
  });
  const reviewed=applyReviewedSourceExceptions(converted.questions,checksum);
  expect(reviewed.annotated).toBe(3);
  expect(reviewed.issues).toEqual([]);
  const reconstructed={manifest:bank.pkg.manifest,questions:reviewed.questions};
  const nativeFiles=bank.pkg.questions.flatMap(q=>q.assets.map(a=>({name:a.filename})));
  const directFiles=converted.questions.flatMap(q=>q.assets.map(a=>({name:a.filename})));
  const native=assessBank(bank.pkg,bank.issues,nativeFiles);
  const direct=assessBank(reconstructed,[...converted.issues,...reviewed.issues],directFiles);
  // Identical question numbers recur in two sets. Matching by number alone
  // is unsafe and would manufacture spurious source-key conflicts.
  const identity=(q:{source:{set?:number;questionNumber?:number}})=>String(q.source.set??0)+":"+String(q.source.questionNumber??0);
  const byIdentity=new Map(bank.pkg.questions.map(q=>[identity(q),q]));
  const mismatches=converted.questions.map(q=>{
    const n=byIdentity.get(identity(q));
    if(!n) return {number:q.source.questionNumber,set:q.source.set,missingNative:true};
    const nv=native.verdicts.get(n.id),dv=direct.verdicts.get(q.id);
    return {number:q.source.questionNumber,set:q.source.set,nativeId:n.id,directId:q.id,
      nativeReady:nv?.readiness,directReady:dv?.readiness,
      nativeAnswer:n.correctAnswer?.labels??[],directAnswer:q.correctAnswer?.labels??[],
      nativeEvidence:n.correctAnswer?.evidence??null,directEvidence:q.correctAnswer?.evidence??null,
      nativeFlags:n.flags?.map(flag=>flag.type)??[],directFlags:q.flags?.map(flag=>flag.type)??[],
      nativeReasons:nv?.reasons??[],directReasons:dv?.reasons??[],
    };
  });
  const compact={native:native.counts,direct:direct.counts,
    nativeQuestions:bank.pkg.questions.length,directQuestions:converted.questions.length,
    differences:mismatches.filter(row=>row.missingNative||row.nativeReady!==row.directReady||JSON.stringify(row.nativeAnswer)!==JSON.stringify(row.directAnswer)),
    all:mismatches};
  writeFileSync(report,JSON.stringify(compact,null,2)+"\n");
  expect(direct.counts).toEqual(native.counts);
  expect(compact.differences).toHaveLength(0);
  console.log("GOER_ANSWER_COMPARISON",JSON.stringify({native:compact.native,direct:compact.direct,
    disagreements:compact.differences.length,
    directExceedsNative:compact.differences.filter(row=>row.directReady==="ready"&&row.nativeReady!=="ready").map(row=>row.number)}));
  expect(bank.pkg.questions).toHaveLength(15);
  expect(converted.questions.length).toBeGreaterThan(10);
 });
});
