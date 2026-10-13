import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const H = "a".repeat(64);
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema public grant all on functions to anon,authenticated,service_role;
    create schema auth; create table auth.users(id uuid primary key);
    insert into auth.users values('${A}'),('${B}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to anon,authenticated,service_role;
    grant execute on function auth.uid() to anon,authenticated,service_role;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,unique(bucket_id,name));
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon,authenticated,service_role;
    grant all on storage.objects to authenticated,service_role;
  `);
  await db.exec(readFileSync(new URL("../../../../supabase/migrations/20261011190000_academic_library.sql", import.meta.url), "utf8"));
}, 30_000);
afterAll(async () => db?.close());
async function as<T>(user: string, sql: string, params: unknown[] = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub','${user}',false); set role authenticated;`);
  try { return (await db.query<T>(sql, params)).rows; } finally { await db.exec("reset role;"); }
}
async function create() {
  const collection = randomUUID();
  const args = [JSON.stringify({ title: "Synthetic course", module: "SAMPLE", term: "Term 1" }), "SAMPLE - Course plan:\nWeek 1:\nLecture 1 Example [Lecture]", "{}", JSON.stringify([{ path: "catalog.json", sha256: H, byte_size: 2, mime_type: "application/json" }]), H, collection];
  const [row] = await as<{ value: { collection_id: string; revision_id: string } }>(A, "select public.academic_create_revision($1,$2,$3,$4,$5,$6) as value", args);
  return { ...row.value, args };
}
async function upload(collection: string, bytes = 2) {
  return as(A, "insert into storage.objects(bucket_id,name,metadata) values('academic-content',$1,$2)", [`${collection}/${H}`, JSON.stringify({ size: bytes })]);
}

describe("academic catalog authorization and publication", () => {
  it("requires explicit grants as well as row policies, including object access", async () => {
    const c = await create();
    expect(await as(B, "select id from public.academic_collections")).toEqual([]);
    expect(await as(B, "select * from public.academic_revisions")).toEqual([]);
    expect(await as(B, "select * from public.academic_files")).toEqual([]);
    await expect(as(B, "insert into storage.objects(bucket_id,name) values('academic-content',$1)", [`${c.collection_id}/${H}`])).rejects.toThrow(/row-level security/);
    await upload(c.collection_id);
    expect(await as(B, "select * from storage.objects")).toEqual([]);
    await expect(as(A, "select owner_id from public.academic_collections")).rejects.toThrow(/permission denied/);
    await expect(as(A, "update public.academic_collections set review_status='approved'")).rejects.toThrow(/permission denied/);
    await expect(as(A, "select public.academic_review($1,true)", [c.collection_id])).rejects.toThrow(/Reviewer access/);
    const acl = await db.query<{ allowed: boolean }>("select has_function_privilege('anon','public.academic_catalog(text,text,uuid)','execute') allowed");
    expect(acl.rows[0].allowed).toBe(false);
  });
  it("resumes an upload without duplicate revisions and refuses incomplete acknowledgement", async () => {
    const c = await create();
    const [again] = await as<{ value: { revision_id: string } }>(A, "select public.academic_create_revision($1,$2,$3,$4,$5,$6) value", c.args);
    expect(again.value.revision_id).toBe(c.revision_id);
    await expect(as(A, "select public.academic_finish_revision($1)", [c.revision_id])).rejects.toThrow(/Upload incomplete/);
    await upload(c.collection_id, 3);
    await expect(as(A, "select public.academic_finish_revision($1)", [c.revision_id])).rejects.toThrow(/Upload incomplete/);
    await expect(as(B, "select public.academic_create_revision($1,$2,$3,$4,$5,$6)", c.args)).rejects.toThrow(/Collection unavailable/);
  });
  it("shares only an approved immutable revision and withdraws metadata and media together", async () => {
    const c = await create(); await upload(c.collection_id);
    await as(A, "select public.academic_finish_revision($1)", [c.revision_id]);
    await as(A, "select public.academic_set_visibility($1,'shared')", [c.collection_id]);
    expect(await as(B, "select id from public.academic_collections where id=$1", [c.collection_id])).toEqual([]);
    await db.query("insert into public.academic_reviewers values($1) on conflict do nothing", [A]);
    await as(A, "select public.academic_review($1,true)", [c.collection_id]);
    const [page] = await as<{ value: Array<Record<string, unknown>> }>(B, "select public.academic_catalog() value");
    expect(page.value.find(row => row.id === c.collection_id)).toMatchObject({ module: "SAMPLE", owned: false });
    expect(JSON.stringify(page)).not.toContain("owner_id");
    expect(await as(B, "select name from storage.objects where name=$1", [`${c.collection_id}/${H}`])).toHaveLength(1);
    await as(A, "select public.academic_enroll($1,$2,array[2,1,1])", [c.collection_id,c.revision_id]);
    await as(B, "select public.academic_enroll($1,$2,array[1])", [c.collection_id,c.revision_id]);
    expect(await as(A, "select weeks from public.academic_enrollments")).toEqual([{ weeks: [1,2] }]);
    expect(await as(B, "select weeks from public.academic_enrollments")).toEqual([{ weeks: [1] }]);
    await as(B, "select public.academic_enroll($1,$2,array[2])", [c.collection_id,c.revision_id]);
    expect(await as(B, "select weeks from public.academic_enrollments")).toEqual([{ weeks: [1,2] }]);
    await expect(as(B, "select public.academic_enroll($1,$2,array[null]::integer[])", [c.collection_id,c.revision_id])).rejects.toThrow(/Invalid week/);
    expect(await as(B, "update storage.objects set metadata='{}' returning name")).toEqual([]);
    expect(await as(B, "select metadata from storage.objects where name=$1", [`${c.collection_id}/${H}`])).toEqual([{ metadata: { size: 2 } }]);
    await as(A, "select public.academic_withdraw($1,true)", [c.collection_id]);
    expect(await as(B, "select name from storage.objects where name=$1", [`${c.collection_id}/${H}`])).toEqual([]);
    expect(await as(B, "select id from public.academic_revisions where id=$1", [c.revision_id])).toEqual([]);
  });
  it("retains approved historical content during revision review and never rewinds on an old acknowledgement", async () => {
    const c = await create(); await upload(c.collection_id);
    await as(A, "select public.academic_finish_revision($1)", [c.revision_id]);
    await as(A, "select public.academic_set_visibility($1,'shared')", [c.collection_id]);
    await db.query("insert into public.academic_reviewers values($1) on conflict do nothing", [A]);
    await as(A, "select public.academic_review($1,true)", [c.collection_id]);
    const args = [...c.args]; args[4] = "b".repeat(64);
    const [next] = await as<{ value: { revision_id: string } }>(A, "select public.academic_create_revision($1,$2,$3,$4,$5,$6) value", args);
    await as(A, "select public.academic_finish_revision($1)", [next.value.revision_id]);
    expect(await as(B, "select id from public.academic_revisions where id=$1", [c.revision_id])).toHaveLength(1);
    expect(await as(B, "select id from public.academic_revisions where id=$1", [next.value.revision_id])).toEqual([]);
    await expect(as(B, "select public.academic_enroll($1,$2,array[1])", [c.collection_id,next.value.revision_id])).rejects.toThrow(/Course unavailable/);
    await as(A, "select public.academic_finish_revision($1)", [c.revision_id]);
    expect(await as(A, "select current_revision_id from public.academic_collections where id=$1", [c.collection_id])).toEqual([{ current_revision_id: next.value.revision_id }]);
  });
});
