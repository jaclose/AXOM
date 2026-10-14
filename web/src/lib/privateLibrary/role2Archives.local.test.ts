// @vitest-environment node
// One-off native ZIP contract tests, private archives are untracked.
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {describe,expect,it} from "vitest";
import {zipLibraryReader} from "./fileInput";
import {readCatalog,readPreparedBank} from "./install";
import {sha256} from "../question-content/assets";
import {isAssetVisible} from "../question-content/visibility";
const base=join(process.cwd(),"../artifacts/qbank-6way-20261014/role-2-prepared");
async function open(name:string){
 const bytes=readFileSync(join(base,name));
 const file=new File([bytes],name,{type:"application/zip"});
 const read=await zipLibraryReader(file);
 const catalog=readCatalog(JSON.parse(new TextDecoder().decode(await read("catalog.json"))));
 return {read,catalog};
}
describe.skipIf(process.env.ROLE2_PRIVATE_ARCHIVES !== "1")("real review-only B1/B3 ZIP archives",()=>{
it("reads all eighteen B1 sources and their original SHA through strict ZIP preflight",async()=>{
 const {read,catalog}=await open("role-2-B1-review-only.zip");
 expect(catalog.sources).toHaveLength(18);
 for(const source of catalog.sources){
  const original=await read(source.originalFile!);
  expect(await sha256(original)).toBe("sha256:"+source.checksum);
  const bank=readPreparedBank(JSON.parse(new TextDecoder().decode(await read(source.bankFile!))));
  expect(bank.pkg.questions).toHaveLength(source.review);
  expect(bank.pkg.questions.every(question=>question.flags?.some(flag=>flag.type==="answer_needs_review"))).toBe(true);
 }
});
it("loads B3 native manifest with 120 original SHA identities and leaves unsupported slides out of parsing",async()=>{
 const {read,catalog}=await open("role-2-B3-review-only.zip");
 expect(catalog.sources).toHaveLength(120);
 expect(catalog.sources.filter(row=>row.status==="unsupported")).toHaveLength(5);
 const first=catalog.sources.find(row=>row.bankFile);
 expect(first).toBeDefined();
 const original=await read(first!.originalFile!);
 expect(await sha256(original)).toBe("sha256:"+first!.checksum);
 const bank=readPreparedBank(JSON.parse(new TextDecoder().decode(await read(first!.bankFile!))));
 expect(bank.pkg.questions.length).toBeGreaterThan(0);
 expect(bank.pkg.questions.every(question=>question.flags?.some(flag=>flag.type==="media_association_uncertain"))).toBe(true);
});
it("preserves the 20 source-rendered images in four concordant B3 banks, never exposing answer pages during a question",async()=>{
 const {read,catalog}=await open("role-2-B3-review-only.zip");
 const privateLedger=JSON.parse(readFileSync(join(base,"../role-2-b3-rich-promotion.json"),"utf8"));
 expect(privateLedger.sourcePromoted).toBe(4);
 let imageCount=0,questionCount=0;
 for(const verified of privateLedger.sources as Array<{sourceSha256:string;renderedAssets:number;concordantQuestions:number}>){
  const source=catalog.sources.find(item=>item.checksum===verified.sourceSha256);
  expect(source?.bankFile).toBeTruthy();
  const bank=readPreparedBank(JSON.parse(new TextDecoder().decode(await read(source!.bankFile!))));
  expect(bank.pkg.questions.length).toBe(verified.concordantQuestions);
  expect(bank.pkg.questions.every(item=>item.provenance.sourceChecksum==="sha256:"+verified.sourceSha256)).toBe(true);
  expect(bank.pkg.questions.every(item=>item.correctAnswer===undefined || item.flags?.some(flag=>flag.type==="answer_needs_review"))).toBe(true);
  const assets=bank.pkg.questions.flatMap(item=>item.assets);
  expect(assets.length).toBe(verified.renderedAssets);
  const prefix=source!.bankFile!.slice(0,source!.bankFile!.lastIndexOf("/"));
  for(const asset of assets){
   const bytes=await read(prefix+"/assets/"+asset.filename);
   expect(await sha256(bytes)).toBe(asset.checksum);
   expect(bytes.slice(0,8)).toEqual(new Uint8Array([137,80,78,71,13,10,26,10]));
   if(asset.role==="answer_reveal") expect(isAssetVisible(asset.role,"question")).toBe(false);
  }
  questionCount+=bank.pkg.questions.length;
  imageCount+=assets.length;
 }
 expect({questionCount,imageCount}).toEqual({questionCount:51,imageCount:20});
});
});
