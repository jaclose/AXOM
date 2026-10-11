import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { preparePublication } from "./prepare";
import { publisherClient, publishPackage } from "./publish";

const {values,positionals}=parseArgs({args:process.argv.slice(2),allowPositionals:true,options:{source:{type:"string"},out:{type:"string"},approval:{type:"string"},package:{type:"string"},url:{type:"string"},"confirm-project":{type:"string"},"confirm-publication":{type:"boolean",default:false}}});
try {
  if(positionals[0]==="prepare"&&values.source&&values.out&&values.approval){
    const plan=await preparePublication(values.source,values.out,JSON.parse(await readFile(values.approval,"utf8")));
    console.log(JSON.stringify({status:"prepared-locally-not-uploaded",releaseId:plan.release.id,entries:plan.entries.length,files:plan.files.length,readyQuestions:plan.entries.reduce((n,e)=>n+e.question_count,0),templates:plan.entries.filter(e=>e.kind==="template").length,heldSources:plan.coverage.filter(c=>c.state==="held").length}));
  } else if(positionals[0]==="upload"&&values.package&&values.url&&values["confirm-project"]){
    const secret=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY||"";
    const client=publisherClient(values.url,secret,values["confirm-project"]);
    console.log(JSON.stringify(await publishPackage(values.package,client,values["confirm-publication"]??false)));
  } else {
    throw new Error("Usage: prepare --source DIR --out PRIVATE_DIR --approval APPROVAL.json; or upload --package PRIVATE_DIR --url HTTPS_PROJECT --confirm-project REF [--confirm-publication]. Upload requires SUPABASE_SECRET_KEY in the administrator environment. Without --confirm-publication, uploaded content stays in staging.");
  }
} catch(cause){console.error(cause instanceof Error?cause.message:"Publication failed.");process.exitCode=1;}
