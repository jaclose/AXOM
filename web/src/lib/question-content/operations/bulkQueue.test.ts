import { describe, expect, it } from "vitest";
import { corpusExtension, corpusKey, dispositionCounts, inputSignatureProblem, inventorySha, queueJobs, queueWindow, receiptConsistent, recoveredSourcePath, type CorpusJob, type CorpusReceipt } from "./bulkQueue";

const src=(name:string,checksum="a".repeat(64)):CorpusJob=>({
  source_path:"/offline/"+name,
  equivalent_paths:["/recovered/"+name],
  canonical_input_key:"byte:"+checksum,
});
const sourceReceipt=(overrides:Partial<CorpusReceipt>={}):CorpusReceipt=>({
  schemaVersion:1,adapterVersion:"v2",batch:"B4",queueIndex:0,sourceKey:"byte-"+"a".repeat(64),
  inputExtension:".pdf",status:"review-prepared",detected:3,canonicalReadable:3,
  ready:0,reviewRequired:2,unresolved:1,rejected:0,imageAssets:0,
  inventoryChecksumVerified:false,answerIndependentlyVerified:false,
  accountCloudReadbackVerified:false,reasons:[],createdAt:"2026-10-14T00:00:00Z",...overrides
});
describe("canonical corpus queue checkpoint contracts",()=>{
  it("supports B4 index windows without ever treating job count as the number of questions",()=>{
    const all=[src("a.pdf"),src("b.docx"),src("c.pdf")];
    const jobs=queueJobs({processing_order:[{id:"B4",job_indices:[2,0,1]}]},all,"B4");
    expect(jobs.map(x=>x.source_path)).toEqual(["/offline/c.pdf","/offline/a.pdf","/offline/b.docx"]);
    expect(queueWindow(jobs,1,1)[0].source_path).toContain("a.pdf");
    expect(()=>queueWindow(jobs,0,300)).toThrow(/1–200/);
    expect(()=>queueJobs({processing_order:[{id:"B4",job_indices:[3]}]},all,"B4")).toThrow(/Invalid/);
  });
  it("recovers an equivalent existing original and never guesses a source identity from filename",()=>{
    const job=src("qbank.pdf");
    expect(recoveredSourcePath(job,path=>path==="/recovered/qbank.pdf")).toBe("/recovered/qbank.pdf");
    expect(recoveredSourcePath(job,()=>false)).toBeUndefined();
    expect(inventorySha(job)).toBe("a".repeat(64));
    expect(corpusKey(job)).toBe("byte-"+"a".repeat(64));
    expect(inventorySha({source_path:"/offline/file.pdf",canonical_input_key:"path:/offline/file.pdf"})).toBeUndefined();
    expect(corpusKey({source_path:"/offline/file.pdf",canonical_input_key:"path:/offline/file.pdf"})).toBe("");
    expect(()=>inventorySha(src("bad.pdf","g".repeat(64)))).toThrow(/invalid SHA/);
  });
  it("detects corrupt file signatures and Office owner lock placeholders before invoking parsers",()=>{
    const text=(value:string)=>new TextEncoder().encode(value);
    expect(inputSignatureProblem(text("a 133 byte placeholder"),".pdf","fake.pdf")).toMatch(/no PDF header/);
    expect(inputSignatureProblem(text("%PDF-1.7\n"),".pdf","valid.pdf")).toBeUndefined();
    expect(inputSignatureProblem(new Uint8Array([0x50,0x4b,0x03,0x04]),".pptx","valid.pptx")).toBeUndefined();
    expect(inputSignatureProblem(text("not a zip"),".pptx","broken.pptx")).toMatch(/not a readable ZIP/);
    expect(inputSignatureProblem(text("anything"),".pptx","~$Week Review.pptx")).toMatch(/Office lock/);
    expect(inputSignatureProblem(new Uint8Array([0x41,0,0x42]),".txt","binary.txt")).toMatch(/NUL/);
  });
  it("tracks independently extracted and installable counts and rejects misleading receipts",()=>{
    expect(receiptConsistent(sourceReceipt())).toBe(true);
    expect(receiptConsistent(sourceReceipt({detected:4}))).toBe(false);
    expect(receiptConsistent(sourceReceipt({ready:3}))).toBe(false);
    expect(receiptConsistent(sourceReceipt({accountCloudReadbackVerified:true}))).toBe(false);
    expect(receiptConsistent(sourceReceipt({detected:3,canonicalReadable:2,rejected:1,unresolved:0}))).toBe(true);
    expect(dispositionCounts([sourceReceipt(),sourceReceipt({status:"unavailable",detected:0,canonicalReadable:0,reviewRequired:0,unresolved:0})]))
      .toMatchObject({files:2,detected:3,ready:0,reviewRequired:2,cloudVerified:0,
        statuses:{"review-prepared":1,unavailable:1}});
    expect(corpusExtension("Lecture.PDF")).toBe(".pdf");
  });
});
