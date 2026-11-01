import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const H = "a".repeat(64);
const migrationNames = [
  "20261011190000_academic_library.sql",
  "20261013210000_academic_course_lookup.sql",
  "20261013220000_content_storage_boundaries.sql",
  "20261014122000_academic_current_review_gate.sql",
  "20261015230042_enforce_academic_source_identity.sql",
  "20261017233759_enforce_academic_collection_classification.sql",
  "20261027120000_academic_curriculum_catalog.sql",
  "20261101120000_academic_community_submissions.sql",
];
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    create schema auth; create table auth.users(id uuid primary key);
    insert into auth.users values('${A}'),('${B}'),('${C}');
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,unique(bucket_id,name));
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon, authenticated, service_role;
    grant all on storage.objects to anon, authenticated, service_role;
    create policy fixture_broad_access on storage.objects for all to anon,authenticated using(true) with check(true);
  `);
  for (const name of migrationNames) {
    await db.exec(readFileSync(new URL(`../../../../supabase/migrations/${name}`, import.meta.url), "utf8"));
  }
}, 30_000);
afterAll(async () => db?.close());

async function as<T = Record<string, unknown>>(user: string, sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub','${user}',false); set role authenticated;`);
  try { return (await db.query<T>(sql, params)).rows; }
  catch (error) { throw new Error(`${sql}: ${error instanceof Error ? error.message : String(error)}`, { cause: error }); }
  finally { await db.exec("reset role;"); }
}
async function anon<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec("reset role; select set_config('request.jwt.claim.sub','',false); set role anon;");
  try { return (await db.query<T>(sql, params)).rows; } finally { await db.exec("reset role;"); }
}
function args(collection: string, contentHash = H, source = randomUUID().replaceAll("-", "").repeat(2)) {
  return [
    JSON.stringify({ title: "Synthetic community course", module: "SAMPLE", term: "Term 1", ready_questions: 1 }),
    "SAMPLE - Course plan:\nWeek 1:\nLecture 1 Example [Lecture]",
    JSON.stringify({ sourceChecksums: [source] }),
    JSON.stringify([{ path: "catalog.json", sha256: contentHash, byte_size: 2, mime_type: "application/json" }]),
    contentHash, collection,
  ];
}
async function create(collection = randomUUID(), contentHash = H) {
  const [row] = await as<{ value: { collection_id: string; revision_id: string } }>(
    A, "select public.academic_create_revision($1,$2,$3,$4,$5,$6) value", args(collection, contentHash),
  );
  await as(A, "insert into storage.objects(bucket_id,name,metadata) values('academic-content',$1,$2)",
    [`${collection}/${contentHash}`, JSON.stringify({ size: 2 })]);
  await as(A, "select public.academic_finish_revision($1)", [row.value.revision_id]);
  return row.value;
}
async function catalog(user: string, rpc: "academic_catalog" | "academic_community_catalog") {
  const [row] = await as<{ value: Array<Record<string, unknown>> }>(user, `select public.${rpc}() value`);
  return row.value;
}
async function communityPage(user: string, search: string, submittedAt: string | null, afterId: string | null) {
  const [row] = await as<{ value: Array<Record<string, unknown>> }>(user,
    "select public.academic_community_catalog($1,'',$2,$3) value", [search, submittedAt, afterId]);
  return row.value;
}
async function submit(collection: string, revision: string) {
  await as(A, "select public.academic_submit_community($1,$2,true)", [collection, revision]);
}

describe("academic community submissions", () => {
  it("requires an owned current ready revision and rights attestation", async () => {
    const c = await create();
    expect((await catalog(B, "academic_community_catalog")).some(row => row.id === c.collection_id)).toBe(false);
    expect(await as(B, "select id from public.academic_revisions where id=$1", [c.revision_id])).toEqual([]);
    await expect(as(B, "select public.academic_submit_community($1,$2,true)", [c.collection_id,c.revision_id])).rejects.toThrow(/Current ready/);
    await expect(as(A, "select public.academic_submit_community($1,$2,false)", [c.collection_id,c.revision_id])).rejects.toThrow(/Sharing rights/);
    await expect(as(A, "select public.academic_submit_community($1,$2,true)", [c.collection_id,randomUUID()])).rejects.toThrow(/Current ready/);
    await expect(anon("select public.academic_community_catalog()")).rejects.toThrow(/permission denied/);
    await expect(anon("select name from storage.objects where name=$1", [`${c.collection_id}/${H}`])).resolves.toEqual([]);
  });

  it("lets signed-in readers inspect one unreviewed revision while keeping the official catalog and enrollment gated", async () => {
    const c = await create();
    await submit(c.collection_id, c.revision_id);
    await submit(c.collection_id, c.revision_id); // retry is idempotent
    const community = await catalog(B, "academic_community_catalog");
    expect(community.find(row => row.id === c.collection_id)).toMatchObject({
      id: c.collection_id, current_revision_id: c.revision_id, owned: false, status: "unreviewed",
      ready_questions: 1,
    });
    expect((await catalog(B, "academic_catalog")).some(row => row.id === c.collection_id)).toBe(false);
    expect(await as(B, "select public.academic_course($1) value", [c.collection_id])).toEqual([{ value: null }]);
    expect(await as(B, "select id from public.academic_revisions where id=$1", [c.revision_id])).toEqual([]);
    const [preview] = await as<{ value: Record<string, unknown> }>(B,
      "select public.academic_community_preview($1,$2) value", [c.collection_id,c.revision_id]);
    expect(preview.value).toMatchObject({ id: c.revision_id, collection_id: c.collection_id, ready_questions: 1 });
    expect(JSON.stringify(preview.value)).not.toMatch(/provenance|content_hash|owner_id/);
    expect(await as(B, "select path from public.academic_files where revision_id=$1", [c.revision_id])).toEqual([{ path: "catalog.json" }]);
    expect(await as(B, "select name from storage.objects where name=$1", [`${c.collection_id}/${H}`])).toEqual([{ name: `${c.collection_id}/${H}` }]);
    await expect(as(B, "select public.academic_enroll($1,$2,array[1])", [c.collection_id,c.revision_id])).rejects.toThrow(/Course unavailable/);
    await expect(as(B, "select public.academic_community_review($1,$2,true)", [c.collection_id,c.revision_id])).rejects.toThrow(/Reviewer access/);
    await expect(as(B, "update public.academic_community_submissions set status='approved'")).rejects.toThrow(/permission denied/);
    await expect(anon("select id from public.academic_revisions where id=$1", [c.revision_id])).rejects.toThrow(/permission denied/);
    expect(await anon("select name from storage.objects where name=$1", [`${c.collection_id}/${H}`])).toEqual([]);
  });

  it("binds reviewer promotion to the exact submitted current revision", async () => {
    const c = await create(); await submit(c.collection_id,c.revision_id);
    await db.query("insert into public.academic_reviewers(user_id) values($1)", [C]);
    await expect(as(C, "select public.academic_review($1,true)", [c.collection_id])).rejects.toThrow(/exact community/);
    await expect(as(C, "select public.academic_community_review($1,$2,true)", [c.collection_id,randomUUID()])).rejects.toThrow(/submission changed/);
    await as(C, "select public.academic_community_review($1,$2,true)", [c.collection_id,c.revision_id]);
    expect((await catalog(B, "academic_community_catalog")).some(row => row.id === c.collection_id)).toBe(false);
    expect((await catalog(B, "academic_catalog")).some(row => row.id === c.collection_id)).toBe(true);
    await as(B, "select public.academic_enroll($1,$2,array[1])", [c.collection_id,c.revision_id]);
    expect(await as(B, "select weeks from public.academic_enrollments where collection_id=$1", [c.collection_id])).toEqual([{ weeks: [1] }]);
    await as(C, "select public.academic_community_review($1,$2,false)", [c.collection_id,c.revision_id]);
    expect((await catalog(B, "academic_catalog")).some(row => row.id === c.collection_id)).toBe(false);
    expect(await as(B, "select name from storage.objects where name=$1", [`${c.collection_id}/${H}`])).toEqual([]);
  });

  it("removes a withdrawn upload and refuses review after a replacement revision", async () => {
    const c = await create(); await submit(c.collection_id,c.revision_id);
    await as(A, "select public.academic_community_withdraw($1,$2)", [c.collection_id,c.revision_id]);
    expect((await catalog(B, "academic_community_catalog")).some(row => row.id === c.collection_id)).toBe(false);
    expect(await as(B, "select path from public.academic_files where revision_id=$1", [c.revision_id])).toEqual([]);
    await expect(as(C, "select public.academic_community_review($1,$2,true)", [c.collection_id,c.revision_id])).rejects.toThrow(/submission changed/);

    const d = await create(); await submit(d.collection_id,d.revision_id);
    const nextHash = "b".repeat(64);
    const [replacement] = await as<{ value: { revision_id: string } }>(
      A, "select public.academic_create_revision($1,$2,$3,$4,$5,$6) value", args(d.collection_id, nextHash),
    );
    await as(A, "insert into storage.objects(bucket_id,name,metadata) values('academic-content',$1,$2)",
      [`${d.collection_id}/${nextHash}`, JSON.stringify({ size: 2 })]);
    await as(A, "select public.academic_finish_revision($1)", [replacement.value.revision_id]);
    expect((await catalog(B, "academic_community_catalog")).some(row => row.id === d.collection_id)).toBe(false);
    expect(await as(B, "select id from public.academic_revisions where id=$1", [d.revision_id])).toEqual([]);
    await expect(as(C, "select public.academic_community_review($1,$2,true)", [d.collection_id,d.revision_id])).rejects.toThrow(/submission changed/);
    await submit(d.collection_id,replacement.value.revision_id);
    expect((await catalog(B, "academic_community_catalog")).some(row => row.id === d.collection_id)).toBe(true);
  });

  it("pages community metadata without repeating an upload or leaking owner identity", async () => {
    for (let index = 0; index < 25; index++) {
      const collection = randomUUID();
      const revision = randomUUID();
      await db.query("insert into public.academic_collections(id,owner_id,title,module,term,review_status,current_revision_id) values($1,$2,$3,'SAMPLE','Term 1','pending',null)",
        [collection, A, `Page fixture ${index}`]);
      await db.query("insert into public.academic_revisions(id,collection_id,content_hash,template_text,ready_questions,status) values($1,$2,$3,'Week 1',1,'ready')",
        [revision, collection, randomUUID().replaceAll("-", "").repeat(2)]);
      await db.query("update public.academic_collections set current_revision_id=$1 where id=$2", [revision,collection]);
      await db.query("insert into public.academic_community_submissions(collection_id,revision_id,rights_attested_at) values($1,$2,now())", [collection,revision]);
    }
    const first = await communityPage(B, "Page fixture", null, null);
    expect(first).toHaveLength(24);
    const last = first.at(-1)!;
    const second = await communityPage(B, "Page fixture", last.submitted_at as string, last.id as string);
    expect(second).toHaveLength(1);
    expect(new Set([...first,...second].map(row => row.id)).size).toBe(25);
    expect(JSON.stringify([...first,...second])).not.toMatch(/owner_id|rights_attested_at|provenance/);
  });
});
