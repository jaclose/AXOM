// @vitest-environment node
import { describe, expect, it } from "vitest";
import { digest, preparePublication, validatePlan } from "./prepare";
import type { PreparedBank, PrivateLibraryCatalog } from "../../src/lib/privateLibrary/types";
const encode=(value:unknown)=>new TextEncoder().encode(typeof value==="string"?value:JSON.stringify(value));
const options={catalogKey:"demo",version:"1",title:"Synthetic courses",audience:"authenticated" as const,rightsReference:"Authored synthetic test content"};
function fixture(){
  const template=encode("T5 - DEMO - Lectures:\nWeek 1:\nLecture 01 Sample [Lecture]\n"),sourceHash="a".repeat(64);
  const question={id:"sample-1",source:{filename:"sample.txt",questionNumber:1},stem:[{type:"text" as const,text:"Which sample is first?"}],choices:[{id:"a",label:"A",blocks:[{type:"text" as const,text:"One"}]},{id:"b",label:"B",blocks:[{type:"text" as const,text:"Two"}]}],correctAnswer:{labels:["A"],evidence:"printed-key" as const},assets:[],provenance:{method:"authored" as const,sourceChecksum:`sha256:${sourceHash}`}};
  const bank:PreparedBank={pkg:{manifest:{schemaVersion:1,course:{name:"DEMO",term:5,week:1},bank:{id:"sample",title:"Sample bank",discipline:"Example"},source:{filename:"sample.txt",sourceWeekDeclared:true},questionsFile:"questions.json",assetsDirectory:"assets"},questions:[question]},issues:[],sourceText:{rawText:"PRIVATE_PATH /Users/example/do-not-copy\nUnreviewed unrelated content."},sourceBytes:80,notes:[]};
  const held=structuredClone(question);held.id="sample-2";held.source.questionNumber=2;held.correctAnswer={labels:["B"],evidence:"explanation" as "printed-key"};bank.pkg.questions.push(held);
  const catalog:PrivateLibraryCatalog={format:"axom-private-library",schemaVersion:1,id:"test",version:"old",templates:[{file:"templates/test.txt",name:"test.txt",checksum:digest(template)}],sources:[{id:"source",name:"sample.txt",sourcePath:"/Users/private/source.txt",checksum:sourceHash,status:"review-required",reason:"One held",ready:1,review:1,bankFile:"banks/test/bank.json"}]};
  const input=new Map([["catalog.json",encode(catalog)],["templates/test.txt",template],["banks/test/bank.json",encode(bank)]]),output=new Map<string,Uint8Array>();
  return{input,output,bank,io:{read:async(path:string)=>{const bytes=input.get(path);if(!bytes)throw new Error("Missing file");return bytes;},write:async(path:string,bytes:Uint8Array)=>{output.set(path,bytes);}}};
}
describe("prepared collection to publishable content",()=>{
  it("publishes only ready siblings, not held questions or arbitrary raw source text",async()=>{
    const f=fixture(),{plan,coverage}=await preparePublication(f.io,options);
    expect(plan.body.entries).toHaveLength(2);expect(plan.body.entries.find(e=>e.kind==="bank")?.question_count).toBe(1);
    const bank=plan.body.entries.find(e=>e.kind==="bank")!;const payload=new TextDecoder().decode(f.output.get(bank.payload_path)!);
    expect(payload).not.toContain("PRIVATE_PATH");expect(payload).not.toContain("/Users/");expect(payload).not.toContain('"id":"sample-2"');
    expect(coverage.find(c=>c.source==="sample.txt")?.reason).toContain("1 other candidates");
    expect(validatePlan(plan).release_id).toBe(plan.release_id);
  });
  it("resumes deterministically and detects modifications to a reviewed plan",async()=>{
    const f=fixture(),a=await preparePublication(f.io,options),b=await preparePublication(f.io,options);
    expect(a.plan).toEqual(b.plan);
    const changed=structuredClone(a.plan);changed.body.entries[0].title="Changed after review";
    expect(()=>validatePlan(changed)).toThrow(/changed/);
  });
  it("holds corrupted templates while retaining unrelated ready material",async()=>{
    const f=fixture();f.input.set("templates/test.txt",encode("corrupted"));
    const result=await preparePublication(f.io,options);
    expect(result.plan.body.entries).toHaveLength(1);
    expect(result.coverage.some(c=>c.status==="held"&&c.reason?.includes("checksum"))).toBe(true);
  });
  it("requires an explicitly chosen audience and rights, never defaults to public",async()=>{
    const f=fixture();await expect(preparePublication(f.io,{...options,rightsReference:""})).rejects.toThrow(/rights/);
    await expect(preparePublication(f.io,{...options,audience:"restricted",grantUserIds:[]})).rejects.toThrow(/rights/);
  });
  it("holds a question whose required image cannot be read",async()=>{
    const f=fixture();const q=f.bank.pkg.questions[0];q.assets=[{id:"image",filename:"missing.png",mimeType:"image/png",role:"question",questionId:q.id,checksum:`sha256:${"b".repeat(64)}`}];
    q.stem.push({type:"image",assetId:"image",role:"question",alt:"Required sample"});
    f.input.set("banks/test/bank.json",encode(f.bank));
    const result=await preparePublication(f.io,options);
    expect(result.plan.body.entries.every(e=>e.kind==="template")).toBe(true);
    expect(result.coverage.find(c=>c.source==="sample.txt")?.status).toBe("held");
  });
});
