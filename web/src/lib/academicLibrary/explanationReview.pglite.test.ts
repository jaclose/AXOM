import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const OWNER = "11111111-1111-4111-8111-111111111111";
const REVIEWER = "22222222-2222-4222-8222-222222222222";
const READER = "33333333-3333-4333-8333-333333333333";
const OTHER_REVIEWER = "44444444-4444-4444-8444-444444444444";
const H1 = "a".repeat(64);
const H2 = "b".repeat(64);
const migrations = [
  "20261011190000_academic_library.sql",
  "20261013210000_academic_course_lookup.sql",
  "20261013220000_content_storage_boundaries.sql",
  "20261014122000_academic_current_review_gate.sql",
  "20261015230042_enforce_academic_source_identity.sql",
  "20261017233759_enforce_academic_collection_classification.sql",
  "20261027120000_academic_curriculum_catalog.sql",
  "20261101120000_academic_community_submissions.sql",
  "20261101180000_academic_explanation_review.sql",
  "20261102171000_reviewer_attestation_identity.sql",
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
    insert into auth.users values('${OWNER}'),('${REVIEWER}'),('${READER}'),('${OTHER_REVIEWER}');
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
  `);
  for (const name of migrations) await db.exec(readFileSync(new URL(`../../../../supabase/migrations/${name}`, import.meta.url), "utf8"));
  await db.query("insert into public.academic_reviewers(user_id) values($1)", [REVIEWER]);
}, 30_000);
afterAll(async () => db?.close());

async function as<T = Record<string, unknown>>(user: string, sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub','${user}',false); set role authenticated;`);
  try { return (await db.query<T>(sql, params)).rows; }
  finally { await db.exec("reset role;"); }
}

async function revision(collection: string = randomUUID(), hash = H1, ready = 1) {
  const source = randomUUID().replaceAll("-", "").repeat(2);
  const [created] = await as<{ value: { collection_id: string; revision_id: string } }>(OWNER,
    "select public.academic_create_revision($1,$2,$3,$4,$5,$6) value", [
      JSON.stringify({ title: "Synthetic course", module: "SAMPLE", term: "Term 1", ready_questions: ready }),
      "Week 1", JSON.stringify({ sourceChecksums: [source] }),
      JSON.stringify([{ path: "catalog.json", sha256: hash, byte_size: 2, mime_type: "application/json" }]), hash, collection,
    ]);
  await as(OWNER, "insert into storage.objects(bucket_id,name,metadata) values('academic-content',$1,$2)",
    [`${collection}/${hash}`, JSON.stringify({ size: 2 })]);
  await as(OWNER, "select public.academic_finish_revision($1)", [created.value.revision_id]);
  return created.value;
}

async function attest(collection: string, rev: string, hash = H1, ready = 1, explained = ready, checked = true) {
  return as(REVIEWER, "select public.academic_attest_explanations($1,$2,$3,$4,$5,$6)",
    [collection, rev, hash, ready, explained, checked]);
}

describe("exact-revision explanation review gate", () => {
  it("requires the approving reviewer to make their own attestation for academic and community revisions", async () => {
    await db.query("insert into public.academic_reviewers(user_id) values($1)", [OTHER_REVIEWER]);
    const academic = await revision();
    await as(OWNER, "select public.academic_set_visibility($1,'shared')", [academic.collection_id]);
    await attest(academic.collection_id, academic.revision_id);
    await expect(as(OTHER_REVIEWER, "select public.academic_review($1,true)", [academic.collection_id]))
      .rejects.toThrow(/Explanation review attestation required/);
    await as(REVIEWER, "select public.academic_review($1,true)", [academic.collection_id]);

    const community = await revision();
    await as(OWNER, "select public.academic_submit_community($1,$2,true)", [community.collection_id, community.revision_id]);
    await attest(community.collection_id, community.revision_id);
    await expect(as(OTHER_REVIEWER, "select public.academic_community_review($1,$2,true)", [community.collection_id, community.revision_id]))
      .rejects.toThrow(/Explanation review attestation required/);
    await as(REVIEWER, "select public.academic_community_review($1,$2,true)", [community.collection_id, community.revision_id]);
  });

  it("denies old owner approval without attestation, then binds a reviewed current revision", async () => {
    const c = await revision();
    const [privateTarget] = await as<{ value: unknown }>(REVIEWER,
      "select public.academic_explanation_review_target($1,$2) value", [c.collection_id, c.revision_id]);
    expect(privateTarget.value).toBeNull();
    await expect(attest(c.collection_id, c.revision_id)).rejects.toThrow(/current revision changed/);
    expect(await as(REVIEWER, "select path from public.academic_files where revision_id=$1", [c.revision_id])).toEqual([]);
    await as(OWNER, "select public.academic_set_visibility($1,'shared')", [c.collection_id]);
    const [target] = await as<{ value: { content_hash: string; ready_questions: number } }>(REVIEWER,
      "select public.academic_explanation_review_target($1,$2) value", [c.collection_id, c.revision_id]);
    expect(target.value).toMatchObject({ content_hash: H1, ready_questions: 1 });
    const [hiddenTarget] = await as<{ value: unknown }>(READER,
      "select public.academic_explanation_review_target($1,$2) value", [c.collection_id, c.revision_id]);
    expect(hiddenTarget.value).toBeNull();
    expect(await as(REVIEWER, "select path from public.academic_files where revision_id=$1", [c.revision_id]))
      .toEqual([{ path: "catalog.json" }]);
    expect(await as(REVIEWER, "select id from public.academic_revisions where id=$1", [c.revision_id])).toEqual([]);
    expect(await as(READER, "select path from public.academic_files where revision_id=$1", [c.revision_id])).toEqual([]);
    expect(await as(REVIEWER, "select name from storage.objects where name=$1", [`${c.collection_id}/${H1}`]))
      .toEqual([{ name: `${c.collection_id}/${H1}` }]);
    expect(await as(READER, "select name from storage.objects where name=$1", [`${c.collection_id}/${H1}`])).toEqual([]);
    await expect(as(REVIEWER, "select public.academic_review($1,true)", [c.collection_id]))
      .rejects.toThrow(/Explanation review attestation required/);
    await expect(attest(c.collection_id, c.revision_id, H1, 1, 0)).rejects.toThrow(/Every ready question/);
    await expect(attest(c.collection_id, c.revision_id, H1, 1, 1, false)).rejects.toThrow(/Reviewer rationale/);
    await attest(c.collection_id, c.revision_id);
    await as(REVIEWER, "select public.academic_review($1,true)", [c.collection_id]);
    const [visible] = await as<{ value: boolean }>(READER, "select public.academic_can_read($1) value", [c.collection_id]);
    expect(visible.value).toBe(true);
    await as(REVIEWER, "select public.academic_review($1,false)", [c.collection_id]);
    expect((await db.query("select count(*)::integer n from public.academic_explanation_attestations where revision_id=$1", [c.revision_id])).rows[0]).toEqual({ n: 0 });
    await expect(as(REVIEWER, "select public.academic_review($1,true)", [c.collection_id]))
      .rejects.toThrow(/Explanation review attestation required/);
  });

  it("invalidates old approval and attestation after replacement; rejects a stale hash", async () => {
    const c = await revision();
    await as(OWNER, "select public.academic_set_visibility($1,'shared')", [c.collection_id]);
    await attest(c.collection_id, c.revision_id);
    await as(REVIEWER, "select public.academic_review($1,true)", [c.collection_id]);
    const newer = await revision(c.collection_id, H2);
    expect(newer.revision_id).not.toBe(c.revision_id);
    const [hidden] = await as<{ value: boolean }>(READER, "select public.academic_can_read($1) value", [c.collection_id]);
    expect(hidden.value).toBe(false);
    expect(await as(REVIEWER, "select path from public.academic_files where revision_id=$1", [c.revision_id])).toEqual([]);
    expect(await as(REVIEWER, "select name from storage.objects where name=$1", [`${c.collection_id}/${H1}`])).toEqual([]);
    expect(await as(REVIEWER, "select path from public.academic_files where revision_id=$1", [newer.revision_id]))
      .toEqual([{ path: "catalog.json" }]);
    await expect(attest(c.collection_id, c.revision_id)).rejects.toThrow(/current revision changed/);
    await expect(attest(c.collection_id, newer.revision_id, H1)).rejects.toThrow(/current revision changed/);
    await expect(as(REVIEWER, "select public.academic_review($1,true)", [c.collection_id]))
      .rejects.toThrow(/Explanation review attestation required/);
    await attest(c.collection_id, newer.revision_id, H2);
    await as(REVIEWER, "select public.academic_review($1,true)", [c.collection_id]);
    const [visible] = await as<{ value: boolean }>(READER, "select public.academic_can_read($1) value", [c.collection_id]);
    expect(visible.value).toBe(true);
  });

  it("keeps unreviewed community retrieval open but blocks promotion until this revision is attested", async () => {
    const c = await revision();
    await as(OWNER, "select public.academic_submit_community($1,$2,true)", [c.collection_id, c.revision_id]);
    const [target] = await as<{ value: { content_hash: string } }>(REVIEWER,
      "select public.academic_explanation_review_target($1,$2) value", [c.collection_id, c.revision_id]);
    expect(target.value.content_hash).toBe(H1);
    const [pending] = await as<{ value: Array<{ id: string }> }>(READER, "select public.academic_community_catalog() value");
    expect(pending.value.some(row => row.id === c.collection_id)).toBe(true);
    const files = await as(READER, "select path from public.academic_files where revision_id=$1", [c.revision_id]);
    expect(files).toEqual([{ path: "catalog.json" }]);
    expect(await as(READER, "select name from storage.objects where name=$1", [`${c.collection_id}/${H1}`]))
      .toEqual([{ name: `${c.collection_id}/${H1}` }]);
    await expect(as(REVIEWER, "select public.academic_community_review($1,$2,true)", [c.collection_id, c.revision_id]))
      .rejects.toThrow(/Explanation review attestation required/);
    await attest(c.collection_id, c.revision_id);
    await as(REVIEWER, "select public.academic_community_review($1,$2,true)", [c.collection_id, c.revision_id]);
    const [visible] = await as<{ value: boolean }>(READER, "select public.academic_can_read($1) value", [c.collection_id]);
    expect(visible.value).toBe(true);
    await as(REVIEWER, "select public.academic_community_review($1,$2,false)", [c.collection_id, c.revision_id]);
  });

  it("refuses zero-ready approval and protects the attestation table from client writes", async () => {
    const c = await revision(randomUUID(), H1, 0);
    await as(OWNER, "select public.academic_set_visibility($1,'shared')", [c.collection_id]);
    await expect(attest(c.collection_id, c.revision_id, H1, 0, 0)).rejects.toThrow(/Every ready question/);
    const [acl] = (await db.query<{ write: boolean; rpc: boolean }>(`select
      has_table_privilege('authenticated','public.academic_explanation_attestations','UPDATE') write,
      has_function_privilege('authenticated','public.academic_review(uuid,boolean)','EXECUTE') rpc`)).rows;
    expect(acl).toEqual({ write: false, rpc: true });
  });

  it("leaves an existing approved revision accessible without rewriting its history", async () => {
    const c = await revision();
    await db.query("update public.academic_collections set visibility='shared',review_status='approved' where id=$1", [c.collection_id]);
    await db.query("update public.academic_revisions set approved_at=now() where id=$1", [c.revision_id]);
    const [visible] = await as<{ value: boolean }>(READER, "select public.academic_can_read($1) value", [c.collection_id]);
    expect(visible.value).toBe(true);
    const [count] = (await db.query<{ n: number }>(
      "select count(*)::integer n from public.academic_explanation_attestations where revision_id=$1", [c.revision_id])).rows;
    expect(count.n).toBe(0);
  });
});
