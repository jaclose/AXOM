import type { SupabaseClient } from "@supabase/supabase-js";
import { CATALOG_BUCKET } from "../../src/lib/cloudLibrary/model";
import { digest, validatePlan, type PublicationPlan } from "./prepare";
export interface PublishOptions { approveRelease: string; read: (path: string)=>Promise<Uint8Array>; progress?: (message: string)=>void; }
function checked(error: {message:string}|null, step:string): void { if (error) throw new Error(`${step} failed. No release was marked complete; retry the reviewed plan after checking backend configuration.`); }
/** Server/operator-only. Never import this module into the web application. */
export async function publishPlan(client: SupabaseClient, input: PublicationPlan, options: PublishOptions): Promise<{releaseId:string;alreadyPublished:boolean}> {
  const plan=validatePlan(input), b=plan.body;
  if (options.approveRelease!==plan.release_id) throw new Error("Explicit approval of this exact release ID is required.");
  const desired={id:plan.release_id,catalog_key:b.catalog_key,version:b.version,manifest_sha256:plan.manifest_sha256,title:b.title,audience:b.audience,rights_reference:b.rights_reference};
  const existing=await client.from("academic_catalog_releases").select("id,manifest_sha256,status").eq("catalog_key",b.catalog_key).eq("version",b.version).maybeSingle();
  checked(existing.error,"Release lookup");
  if (existing.data && (existing.data.id!==plan.release_id || existing.data.manifest_sha256!==plan.manifest_sha256)) throw new Error("This catalog version already describes different content. Use a new reviewed version.");
  if (existing.data?.status==="withdrawn") throw new Error("A withdrawn release cannot be reopened.");
  if (existing.data?.status==="published") return {releaseId:plan.release_id,alreadyPublished:true};
  if (!existing.data) checked((await client.from("academic_catalog_releases").insert(desired)).error,"Staging creation");
  for (const [index,file] of b.files.entries()) {
    const bytes=await options.read(file.path);
    if (bytes.length!==file.byte_size || digest(bytes)!==file.sha256) throw new Error("Local publication content changed. Prepare and review the package again.");
    const objectPath=`${plan.release_id}/${file.path}`;
    // Immutable object names make interrupted retries safe. Never overwrite an existing object.
    const uploaded=await client.storage.from(CATALOG_BUCKET).upload(objectPath,bytes,{contentType:file.mime_type,upsert:false,cacheControl:"3600"});
    const stored=await client.storage.from(CATALOG_BUCKET).download(objectPath);
    if (stored.error || !stored.data || stored.data.size!==file.byte_size || digest(new Uint8Array(await stored.data.arrayBuffer()))!==file.sha256) {
      throw new Error(uploaded.error ? "Object upload or interrupted-upload verification failed. Retry this exact plan." : "Stored object verification failed. The release remains unpublished.");
    }
    checked((await client.from("academic_catalog_files").upsert({...file,release_id:plan.release_id,storage_path:objectPath},{onConflict:"release_id,path"})).error,"File registration");
    options.progress?.(`Verified ${index+1}/${b.files.length} files`);
  }
  for(let start=0;start<b.entries.length;start+=100) {
    checked((await client.from("academic_catalog_entries").upsert(b.entries.slice(start,start+100).map(e=>({...e,release_id:plan.release_id})),{onConflict:"release_id,id"})).error,"Entry registration");
  }
  if(b.grant_user_ids.length) checked((await client.from("academic_catalog_grants").upsert(b.grant_user_ids.map(user_id=>({release_id:plan.release_id,user_id})),{onConflict:"release_id,user_id"})).error,"Audience grants");
  checked((await client.rpc("publish_academic_release",{wanted:plan.release_id,expected_entries:b.entries.length,expected_files:b.files.length})).error,"Atomic publication");
  const final=await client.from("academic_catalog_releases").select("status,manifest_sha256").eq("id",plan.release_id).single();
  checked(final.error,"Publication verification");
  if(final.data?.status!=="published" || final.data.manifest_sha256!==plan.manifest_sha256) throw new Error("The published release could not be confirmed.");
  return {releaseId:plan.release_id,alreadyPublished:false};
}
