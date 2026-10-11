// @vitest-environment node
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterEach,beforeEach,describe,expect,it } from "vitest";
import { installStorageTestSchema } from "./storage.testing";
const migrations=["20261010233000_shared_academic_catalog.sql","20261011014000_harden_academic_publication.sql"].map(name=>readFileSync(new URL(`../../../../supabase/migrations/${name}`,import.meta.url),"utf8"));
const A="11111111-1111-4111-8111-111111111111",B="22222222-2222-4222-8222-222222222222",R="33333333-3333-4333-8333-333333333333";
let db:PGlite;
beforeEach(async()=>{db=new PGlite();await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
  grant usage on schema public to anon,authenticated,service_role;
  alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
  alter default privileges in schema public grant all on functions to anon,authenticated,service_role;
  create schema auth;create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  grant usage on schema auth to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;
  insert into auth.users values('${A}'),('${B}');`);await installStorageTestSchema(db);for(const sql of migrations)await db.exec(sql);},30_000);
afterEach(async()=>{await db?.close();});
async function as(role:string,sub:string|null,sql:string,params:unknown[]=[]){await db.exec(`reset role;select set_config('request.jwt.claim.sub','${sub??""}',false);set role ${role};`);try{return await db.query<Record<string,unknown>>(sql,params);}finally{await db.exec("reset role;");}}
async function stage(audience="authenticated",object=true){
 await db.query("insert into public.academic_catalog_releases(id,catalog_key,version,title,audience,rights_reference,manifest_sha256,expected_entries,expected_files) values($1,'test','1','Synthetic test library',$2,'Synthetic authored fixture',$3,1,1)",[R,audience,"a".repeat(64)]);
 await db.query("insert into public.academic_catalog_files(release_id,path,storage_path,sha256,byte_size,mime_type) values($1,'templates/test.txt',$2,$3,4,'text/plain')",[R,`${R}/templates/test.txt`,"b".repeat(64)]);
 await db.query("insert into public.academic_catalog_entries(release_id,id,kind,title,module,term,activity_count,payload_path,source_label) values($1,'template','template','Test','FTM 1','Term 1',1,'templates/test.txt','test.txt')",[R]);
 if(object)await db.query("insert into storage.objects(bucket_id,name,metadata) values('academic-catalog',$1,'{\"size\":4}')",[`${R}/templates/test.txt`]);
}
const publish=()=>as("service_role",null,"select public.publish_academic_release($1)",[R]);
const rows=(role:string,sub:string|null)=>as(role,sub,"select id from public.academic_catalog_entries");
describe("hardened publication on Postgres",()=>{
 it("keeps staging invisible and exposes authenticated content independently to both accounts",async()=>{await stage();expect((await rows("authenticated",A)).rows).toHaveLength(0);await publish();expect((await rows("authenticated",A)).rows).toHaveLength(1);expect((await rows("authenticated",B)).rows).toHaveLength(1);expect((await rows("anon",null)).rows).toHaveLength(0);});
 it("enforces restricted readership on metadata and storage",async()=>{await stage("restricted");await expect(publish()).rejects.toThrow(/authorized readers/);await db.query("insert into public.academic_catalog_grants values($1,$2)",[R,A]);await publish();expect((await rows("authenticated",A)).rows).toHaveLength(1);expect((await rows("authenticated",B)).rows).toHaveLength(0);expect((await as("authenticated",B,"select name from storage.objects")).rows).toHaveLength(0);});
 it("validates storage even on a direct status UPDATE",async()=>{await stage("authenticated",false);await expect(db.exec("update public.academic_catalog_releases set status='published'")).rejects.toThrow(/storage object/);await db.query("insert into storage.objects(bucket_id,name,metadata) values('academic-catalog',$1,'{\"size\":3}')",[`${R}/templates/test.txt`]);await expect(publish()).rejects.toThrow(/storage object/);await db.exec("update storage.objects set metadata='{\"size\":4}'");await publish();});
 it("refuses incomplete manifests and public buckets",async()=>{await stage();await db.exec("update storage.buckets set public=true");await expect(publish()).rejects.toThrow(/must be private/);await db.exec("update storage.buckets set public=false;update public.academic_catalog_releases set expected_entries=2");await expect(publish()).rejects.toThrow(/Incomplete/);});
 it("retains immutable history and stops future reads on withdrawal",async()=>{await stage("public");await publish();await publish();await expect(db.exec("update public.academic_catalog_entries set title='Changed'")).rejects.toThrow(/immutable/);await expect(db.exec("update public.academic_catalog_releases set status='staging'")).rejects.toThrow(/immutable/);await expect(db.exec("update public.academic_catalog_releases set expected_files=2")).rejects.toThrow(/immutable/);await db.exec("update public.academic_catalog_releases set status='withdrawn'");expect((await rows("anon",null)).rows).toHaveLength(0);await expect(publish()).rejects.toThrow(/Withdrawn/);});
 it("does not give browser roles either publish overload",async()=>{for(const role of["anon","authenticated"])for(const sig of["public.publish_academic_release(uuid)","public.publish_academic_release(uuid,integer,integer)","public.guard_academic_release_mutation()"]){expect((await db.query<{ok:boolean}>("select has_function_privilege($1,$2,'execute') as ok",[role,sig])).rows[0].ok).toBe(false);}});
});
