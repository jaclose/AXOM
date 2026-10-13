import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { preparePublication, validatePlan, type Audience } from "./prepare";
import { publishPlan } from "./publish";
import { privateReader, publicationIO } from "./io";
function args(values: string[]): Map<string,string> {
  const result = new Map<string,string>();
  for (let i=0; i<values.length; i+=2) {
    const key=values[i];
    if (!key.startsWith("--") || !values[i+1] || values[i+1].startsWith("--") || result.has(key)) throw new Error("Use unique --option value pairs.");
    result.set(key, values[i+1]);
  }
  return result;
}
function needed(options: Map<string,string>, key: string): string {
  const value=options.get(key); if (!value) throw new Error(`Missing ${key}.`); return value;
}
export async function main(argv: string[]): Promise<void> {
  const command=argv[0], options=args(argv.slice(1));
  if (command === "prepare") {
    const io=await publicationIO(needed(options,"--source"), needed(options,"--out"));
    const {plan,coverage}=await preparePublication(io, {
      catalogKey:needed(options,"--catalog"),version:needed(options,"--version"),title:needed(options,"--title"),
      audience:needed(options,"--audience") as Audience,rightsReference:needed(options,"--rights-reference"),
      grantUserIds:(options.get("--grant-users")??"").split(",").filter(Boolean),
    });
    console.log(JSON.stringify({releaseId:plan.release_id,entries:plan.body.entries.length,files:plan.body.files.length,
      questions:plan.body.entries.reduce((n,e)=>n+e.question_count,0),heldSources:coverage.filter(c=>c.status==="held").length,published:false},null,2));
    return;
  }
  if (command!=="publish") throw new Error("Use prepare or publish. See docs/features/shared-academic-catalog.md.");
  const planPath=resolve(needed(options,"--plan")), plan=validatePlan(JSON.parse(await readFile(planPath,"utf8")));
  const approved=options.get("--approve-release");
  if (!approved) {
    console.log(JSON.stringify({dryRun:true,releaseId:plan.release_id,audience:plan.body.audience,entries:plan.body.entries.length,files:plan.body.files.length},null,2)); return;
  }
  if (approved!==plan.release_id) throw new Error("Approval does not match this reviewed release.");
  const url=new URL(process.env.AXOM_CATALOG_PROJECT_URL??"https://invalid.invalid"), project=needed(options,"--project-ref");
  if (!/^[a-z0-9]{20}$/.test(project)||url.protocol!=="https:"||url.hostname!==`${project}.supabase.co`||url.pathname!=="/"||url.username||url.password||url.search||url.hash) throw new Error("Set the intended Supabase project URL and matching --project-ref before publishing.");
  const key=process.env.AXOM_CATALOG_SERVICE_KEY;
  if (!key || key.startsWith("sb_publishable_")) throw new Error("A server-side publisher credential is required. Never place it in a VITE_ variable or command argument.");
  const client=createClient(url.origin,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  const result=await publishPlan(client,plan,{approveRelease:approved,read:await privateReader(dirname(planPath)),progress:message=>console.log(message)});
  await writeFile(resolve(dirname(planPath),"publication-result.json"),JSON.stringify({...result,verifiedAt:new Date().toISOString()},null,2),{mode:0o600});
  console.log(JSON.stringify(result));
}
