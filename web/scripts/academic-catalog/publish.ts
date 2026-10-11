import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { parseEntry, parseCatalogFile, CATALOG_BUCKET } from "../../src/lib/cloudLibrary/model";
import { hashBytes, readWithin, type PublishPlan } from "./prepare";

/** Credentials come from the administrator's environment, never a VITE variable,
 * command argument, committed file, browser, or publication plan. */
export function publisherClient(url: string, key: string, confirmedProject: string): SupabaseClient {
  const target = new URL(url), local = ["127.0.0.1","localhost"].includes(target.hostname);
  if ((!local && target.protocol !== "https:") || target.username || target.password || target.pathname !== "/" || target.search || target.hash
    || (local ? target.host : target.hostname.split(".")[0]) !== confirmedProject || !key) throw new Error("An explicit matching project confirmation and server-side key are required.");
  return createClient(target.origin,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.any([...(init?.signal?[init.signal]:[]),AbortSignal.timeout(30_000)])})}});
}
const checked = (error: unknown, stage: string) => { if(error) throw new Error(`${stage} failed. Publication is not complete; retry the same immutable plan. No credentials or response payloads were logged.`); };
function same(actual: Record<string,unknown>, expected: Record<string,unknown>) { return Object.entries(expected).every(([key,value])=>actual[key]===value); }
export async function publishPackage(root: string, client: SupabaseClient, publish: boolean) {
  const plan = JSON.parse(new TextDecoder().decode(await readWithin(root,"publish-plan.json"))) as PublishPlan;
  if(plan.format!=="axom-academic-publish-plan"||plan.schemaVersion!==1||!Array.isArray(plan.entries)||!Array.isArray(plan.files)||!Array.isArray(plan.readerIds)) throw new Error("Unsupported publication package.");
  const entries=plan.entries.map(parseEntry),files=plan.files.map(parseCatalogFile),r=plan.release;
  if(!r || r.expected_entries!==entries.length || r.expected_files!==files.length || entries.some(e=>e.release_id!==r.id)||files.some(f=>f.release_id!==r.id)
    || !/^[a-f0-9]{64}$/.test(r.manifest_sha256) || plan.readerIds.some(id=>!/^([a-f0-9]{8}-)([a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id))) throw new Error("Publication identity/counts are invalid.");
  const existing=await client.from("academic_catalog_releases").select("*").eq("id",r.id).maybeSingle(); checked(existing.error,"Release inspection");
  if(existing.data) {
    if(!same(existing.data,r as unknown as Record<string,unknown>)) throw new Error("This catalog version already exists with different content/approval. Create a new version.");
    if(existing.data.status==="withdrawn") throw new Error("A withdrawn version cannot be republished.");
    if(existing.data.status==="published") return {releaseId:r.id,status:"already-published",entries:entries.length,files:files.length};
  } else { const result=await client.from("academic_catalog_releases").insert(r); checked(result.error,"Create staging release"); }
  for(const file of files) {
    const bytes=await readWithin(root,file.path);
    if(bytes.length!==file.byte_size||hashBytes(bytes)!==file.sha256) throw new Error("A package file changed. No release was published.");
    const prior=await client.from("academic_catalog_files").select("*").eq("release_id",r.id).eq("path",file.path).maybeSingle(); checked(prior.error,"File checkpoint inspection");
    if(prior.data&&!same(prior.data,file as unknown as Record<string,unknown>)) throw new Error("An existing file checkpoint has different content.");
    // Never overwrite an object. An interrupted upload is resumed per file.
    const upload=await client.storage.from(CATALOG_BUCKET).upload(file.storage_path,bytes,{contentType:file.mime_type,upsert:false,cacheControl:"0"});
    const verify=await client.storage.from(CATALOG_BUCKET).download(file.storage_path); checked(verify.error,"Uploaded file verification");
    if(!verify.data||verify.data.size!==file.byte_size||hashBytes(new Uint8Array(await verify.data.arrayBuffer()))!==file.sha256) throw new Error("The uploaded file differs from its checksum. No release was published.");
    if(upload.error&&!prior.data) {
      // A prior upload may have succeeded before its DB checkpoint was written.
      // Matching server bytes above are the only accepted retry condition.
    }
    if(!prior.data) { const result=await client.from("academic_catalog_files").insert(file); checked(result.error,"File checkpoint"); }
  }
  for(const entry of entries) {
    const prior=await client.from("academic_catalog_entries").select("*").eq("release_id",r.id).eq("id",entry.id).maybeSingle(); checked(prior.error,"Entry checkpoint inspection");
    if(prior.data&&!same(prior.data,entry as unknown as Record<string,unknown>)) throw new Error("An existing entry differs from this publication plan.");
    if(!prior.data){const result=await client.from("academic_catalog_entries").insert(entry);checked(result.error,"Entry checkpoint");}
  }
  if(plan.readerIds.length){const result=await client.from("academic_catalog_grants").upsert(plan.readerIds.map(user_id=>({release_id:r.id,user_id})),{onConflict:"release_id,user_id"});checked(result.error,"Audience grants");}
  if(publish){const result=await client.rpc("publish_academic_release",{wanted:r.id});checked(result.error,"Atomic publication");}
  return {releaseId:r.id,status:publish?"published":"staged-not-visible",entries:entries.length,files:files.length};
}
