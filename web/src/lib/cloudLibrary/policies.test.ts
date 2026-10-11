// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
let db: PGlite;
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
const PUB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", AUTH = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", PRIVATE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc", DRAFT = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const hash = "a".repeat(64);
async function asRole<T>(role: "anon" | "authenticated", user: string | null, query: string): Promise<T[]> {
  await db.exec("begin");
  try {
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [user ?? ""]);
    await db.exec(`set local role ${role}`);
    return (await db.query<T>(query)).rows;
  } finally { await db.exec("rollback"); }
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key);
    insert into auth.users values ('${A}'), ('${B}');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public, auth, storage to anon, authenticated, service_role;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid primary key, bucket_id text, name text, metadata jsonb);
    alter table storage.objects enable row level security;
    grant select on storage.objects to anon, authenticated;
    grant all on storage.objects, storage.buckets to service_role;`);
  const sql = await readFile(new URL("../../../../supabase/migrations/20261010233000_shared_academic_catalog.sql", import.meta.url), "utf8");
  await db.exec(sql);
  for (const [id, audience] of [[PUB, "public"], [AUTH, "authenticated"], [PRIVATE, "restricted"], [DRAFT, "authenticated"]]) {
    await db.query("insert into public.academic_catalog_releases(id,catalog_key,version,manifest_sha256,title,audience,rights_reference) values ($1,$2,'1',$3,'Synthetic test catalog',$4,'Synthetic fixture only')", [id,id,hash,audience]);
    await db.query("insert into public.academic_catalog_files values ($1,'bank.json',$2,$3,10,'application/json')", [id,`${id}/bank.json`,hash]);
    await db.query("insert into public.academic_catalog_entries(release_id,id,kind,title,module,term,question_count,payload_path,source_label) values ($1,'bank','bank','Synthetic practice','TEST','Term 1',1,'bank.json','fixture.txt')", [id]);
    if (id !== DRAFT) await db.query("insert into storage.objects values ($1,'academic-catalog',$2,'{\"size\":10}')", [id,`${id}/bank.json`]);
    if (id === PRIVATE) await db.query("insert into public.academic_catalog_grants values ($1,$2)", [id,A]);
    if (id !== DRAFT) await db.query("select public.publish_academic_release($1,1,1)", [id]);
  }
}, 30000);
afterAll(async () => { await db?.close(); });
describe("catalog RLS and publication (local PostgreSQL, not live Storage)", () => {
  it("separates anonymous, signed-in and individually granted audiences", async () => {
    expect(await asRole<{id:string}>("anon",null,"select id from public.academic_catalog_releases order by id")).toEqual([{ id:PUB }]);
    expect((await asRole<{id:string}>("authenticated",B,"select id from public.academic_catalog_releases order by id")).map(r=>r.id)).toEqual([PUB,AUTH]);
    expect((await asRole<{id:string}>("authenticated",A,"select id from public.academic_catalog_releases order by id")).map(r=>r.id)).toEqual([PUB,AUTH,PRIVATE]);
  });
  it("applies the same authorization to exact storage objects", async () => {
    const rows = await asRole<{name:string}>("authenticated",B,"select name from storage.objects order by name");
    expect(rows.map(r=>r.name)).toEqual([`${PUB}/bank.json`,`${AUTH}/bank.json`]);
  });
  it("does not let a learner publish, write shared records or grant access", async () => {
    await expect(asRole("authenticated",B,`select public.publish_academic_release('${DRAFT}',1,1)`)).rejects.toThrow(/permission denied/i);
    await expect(asRole("authenticated",B,`insert into public.academic_catalog_grants values ('${PRIVATE}','${B}')`)).rejects.toThrow(/permission denied/i);
    await expect(asRole("anon",null,`delete from public.academic_catalog_entries`)).rejects.toThrow(/permission denied/i);
  });
  it("will not publish an incomplete upload", async () => {
    await expect(db.query("select public.publish_academic_release($1,1,1)",[DRAFT])).rejects.toThrow(/Storage upload/);
    const result = await db.query<{status:string}>("select status from public.academic_catalog_releases where id=$1",[DRAFT]);
    expect(result.rows[0].status).toBe("staging");
  });
  it("preserves published content and cannot reopen a withdrawn release", async () => {
    await expect(db.query("update public.academic_catalog_entries set title='mutated' where release_id=$1",[PRIVATE])).rejects.toThrow(/immutable/);
    await expect(db.query("update public.academic_catalog_releases set audience='public' where id=$1",[PRIVATE])).rejects.toThrow(/immutable/);
    await db.query("update public.academic_catalog_releases set status='withdrawn' where id=$1",[PRIVATE]);
    expect(await asRole("authenticated",A,`select id from public.academic_catalog_releases where id='${PRIVATE}'`)).toEqual([]);
    expect(await asRole("authenticated",A,`select name from storage.objects where name='${PRIVATE}/bank.json'`)).toEqual([]);
    await expect(db.query("update public.academic_catalog_releases set status='staging' where id=$1",[PRIVATE])).rejects.toThrow(/reopened/);
  });
});
