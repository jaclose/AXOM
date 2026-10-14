// @vitest-environment node
// Private local comparison of text-only vs rich versions; never publishes stems.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { comparePackageVariants } from "./packageConcordance";
const root=join(process.cwd(),"../artifacts/qbank-6way-20261014");
describe.skipIf(process.env.ROLE2_PRIVATE_CONCORDANCE !== "1")("real B3 dual-parser concordance",()=>{
it("reports exact identity/answer/page/choice differences before accepting rich replacements",()=>{
const sourceList=JSON.parse(readFileSync(join(root,"role-2-b3-prepared-index.json"),"utf8"));
const rows=[];
for(const file of sourceList.sources){
 const existing=join(root,"role-2-prepared/portable-B3",file.bankFile??"");
 const replacement=join(root,"role-2-rich-b3",file.sourceSha256,"prepared-bank.json");
 if(!file.bankFile||!existsSync(existing)||!existsSync(replacement))continue;
 const text=JSON.parse(readFileSync(existing,"utf8"));
 const rich=JSON.parse(readFileSync(replacement,"utf8"));
 const checked=comparePackageVariants(text.pkg,rich.pkg);
 rows.push({
  sha256:file.sourceSha256,sourceFileName:file.fileName,
  sourceBytes:file.sourceBytes,richImages:rich.pkg.questions.flatMap((q:{assets:unknown[]})=>q.assets).length,
  originalCandidates:checked.originalCount,richCandidates:checked.candidateCount,
  replacementSafe:checked.replacementSafe,unambiguous:checked.unambiguousSourceIdentity,
  textMatches:checked.concordant,answerConflicts:checked.answerConflicts,
  pageConflicts:checked.sourcePageConflicts,unmatched:checked.unmatched,
  reasons:checked.reasons,
 });
 console.log("RICH_CONCORDANCE",JSON.stringify({sha:file.sourceSha256.slice(0,12),orig:checked.originalCount,
  rich:checked.candidateCount,matched:checked.concordant,eligible:checked.replacementSafe,
  keyConflicts:checked.answerConflicts,sourcePages:checked.sourcePageConflicts}));
}
const summary={compared:rows.length,fullyConcordant:rows.filter(row=>row.replacementSafe).length,
  reviewRequired:rows.filter(row=>!row.replacementSafe).length,
  imageAssets:rows.reduce((n,r)=>n+r.richImages,0),
  verifiedCloudUploads:0};
writeFileSync(join(root,"role-2-b3-media-concordance.json"),JSON.stringify({summary,rows},null,2)+"\n");
console.log("RICH_CONCORDANCE_TOTAL",JSON.stringify(summary));
expect(rows.length).toBe(11);
});
});
