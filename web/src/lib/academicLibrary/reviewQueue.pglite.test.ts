import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const OWNER_B = "22222222-2222-4222-8222-222222222222";
const REVIEWER = "33333333-3333-4333-8333-333333333333";
const LEARNER = "44444444-4444-4444-8444-444444444444";
const H = "a".repeat(64);
const migrations = [
  "20261011190000_academic_library.sql",
  "20261013210000_academic_course_lookup.sql",
  "20261013220000_content_storage_boundaries.sql",
  "20261014122000_academic_current_review_gate.sql",
  "20261015230042_enforce_academic_source_identity.sql",
  "20261017233759_enforce_academic_collection_classification.sql",
  "20261027120000_academic_curriculum_catalog.sql",
  "20261028160000_academic_review_queue.sql",
];
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema public grant all on functions to anon,authenticated,service_role;
    create schema auth; create table auth.users(id uuid primary key);
    insert into auth.users values('${OWNER_A}'),('${OWNER_B}'),('${REVIEWER}'),('${LEARNER}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to anon,authenticated,service_role;
    grant execute on function auth.uid() to anon,authenticated,service_role;
    create table public.account_profiles(user_id uuid primary key references auth.users, display_name text not null);
    insert into public.account_profiles values('${OWNER_A}','First contributor'),('${OWNER_B}','Second contributor');
    alter table public.account_profiles enable row level security;
    create policy profiles_self on public.account_profiles for select to authenticated using(user_id = auth.uid());
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,unique(bucket_id,name));
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon,authenticated,service_role;
    grant all on storage.objects to anon,authenticated,service_role;
  `);
  for (const name of migrations) await db.exec(readFileSync(new URL(`../../../../supabase/migrations/${name}`, import.meta.url), "utf8"));
  await db.query("insert into public.academic_reviewers values($1)", [REVIEWER]);
}, 30_000);
afterAll(async () => db?.close());

async function as<T>(user: string, sql: string, params: unknown[] = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub','${user}',false); set role authenticated;`);
  try { return (await db.query<T>(sql, params)).rows; } finally { await db.exec("reset role;"); }
}
interface QueueRow {
  id: string; title: string; module: string; term: string; current_revision_id: string;
  owner_display_name: string; ready_questions: number; review_questions: number; submitted_at: string;
}
async function queue(user = REVIEWER, after?: Pick<QueueRow, "id" | "submitted_at">): Promise<QueueRow[]> {
  return (await as<{ value: QueueRow[] }>(user, "select public.academic_review_queue($1,$2) value", [after?.submitted_at ?? null, after?.id ?? null]))[0].value;
}
async function seed({ owner = OWNER_A, visibility = "shared", review = "pending", withdrawn = false, status = "ready", title = "Synthetic submission", submittedAt = "2026-10-28T12:00:00Z" } = {}) {
  const id = randomUUID(), revision = randomUUID();
  const groupId = visibility === "group" ? randomUUID() : null;
  if (groupId) await db.query("insert into public.academic_groups(id,name) values($1,'Review fixture group')", [groupId]);
  await db.query(`insert into public.academic_collections(id,owner_id,title,module,term,visibility,review_status,withdrawn,updated_at,group_id)
    values($1,$2,$3,'GOER','Term 5',$4,$5,$6,$7,$8)`, [id, owner, title, visibility, review, withdrawn, submittedAt, groupId]);
  await db.query(`insert into public.academic_revisions(id,collection_id,content_hash,template_text,provenance,ready_questions,review_questions,status)
    values($1,$2,$3,'T5 - GOER - Course plan: Week 1 Synthetic activity',$4,7,3,$5)`,
  [revision, id, H, JSON.stringify({ private_payload: "Must never leave the revision row" }), status]);
  await db.query("update public.academic_collections set current_revision_id=$1 where id=$2", [revision, id]);
  await db.query(`insert into public.academic_files(revision_id,path,object_path,sha256,byte_size,mime_type)
    values($1,'questions.json',$2,$3,2,'application/json')`, [revision, `${id}/${H}`, H]);
  await db.query("insert into storage.objects(bucket_id,name,metadata) values('academic-content',$1,$2)", [`${id}/${H}`, JSON.stringify({ size: 2 })]);
  return { id, revision };
}

describe("academic reviewer metadata queue", () => {
  it("returns all owners' pending shared submissions but no question, media or private-owner identifiers", async () => {
    const first = await seed(), second = await seed({ owner: OWNER_B }), missingProfile = await seed({ owner: LEARNER });
    const hidden = await Promise.all([
      seed({ visibility: "private" }), seed({ visibility: "group" }), seed({ review: "approved" }), seed({ review: "rejected" }),
      seed({ withdrawn: true }), seed({ status: "uploading" }),
    ]);
    const rows = await queue();
    expect(rows.map(row => row.id).sort()).toEqual([first.id, second.id, missingProfile.id].sort());
    expect(rows.find(row => row.id === first.id)).toMatchObject({ title: "Synthetic submission", term: "Term 5", module: "GOER", owner_display_name: "First contributor", ready_questions: 7, review_questions: 3 });
    expect(rows.find(row => row.id === second.id)?.owner_display_name).toBe("Second contributor");
    expect(rows.find(row => row.id === missingProfile.id)?.owner_display_name).toBe("Account owner");
    expect(rows.every(row => Date.parse(row.submitted_at) === Date.parse("2026-10-28T12:00:00Z"))).toBe(true);
    expect(rows.every(row => hidden.every(item => item.id !== row.id))).toBe(true);
    expect(Object.keys(rows[0]).sort()).toEqual(["id", "title", "module", "term", "current_revision_id", "owner_display_name", "ready_questions", "review_questions", "submitted_at"].sort());
    expect(await as(REVIEWER, "select * from public.account_profiles")).toEqual([]);
  });

  it("returns nothing to nonreviewers, owners without reviewer membership or signed-out authenticated callers", async () => {
    expect(await queue(LEARNER)).toEqual([]);
    expect(await queue(OWNER_A)).toEqual([]);
    expect(await queue("")).toEqual([]);
    await expect(as(LEARNER, "insert into public.academic_reviewers values($1)", [LEARNER])).rejects.toThrow(/permission denied/);
    await as(LEARNER, "select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ role: "reviewer", user_id: REVIEWER, app_metadata: { academic_reviewer: true } })]);
    expect(await queue(LEARNER)).toEqual([]);
    const grants = (await db.query<{ queue: boolean; preview: boolean; review: boolean }>(`select
      has_function_privilege('anon','public.academic_review_queue(timestamptz,uuid)','execute') queue,
      has_function_privilege('anon','public.academic_review_preview(uuid,uuid)','execute') preview,
      has_function_privilege('anon','public.academic_review(uuid,boolean,uuid)','execute') review`)).rows[0];
    expect(grants).toEqual({ queue: false, preview: false, review: false });
  });

  it("paginates beyond 24 using a stable submitted-time and identity cursor, even when its previous row is reviewed", async () => {
    for (let index = 0; index < 26; index++) await seed({ title: `Paged ${index}`, submittedAt: "2026-10-29T12:00:00Z" });
    const first = await queue();
    expect(first).toHaveLength(24);
    const cursor = first.at(-1)!;
    await as(REVIEWER, "select public.academic_review($1,true,$2)", [cursor.id, cursor.current_revision_id]);
    const second = await queue(REVIEWER, cursor);
    expect(second).toHaveLength(5);
    expect(new Set([...first, ...second].map(row => row.id)).size).toBe(29);
    expect(await queue(REVIEWER, second.at(-1))).toEqual([]);
    expect((await as<{ value: QueueRow[] }>(REVIEWER, "select public.academic_review_queue(null,$1) value", [randomUUID()]))[0].value).toEqual([]);
  });
});

describe("narrow reviewer preview and exact-revision decisions", () => {
  it("previews only the current pending shared template without widening table, file or Storage reads", async () => {
    const course = await seed();
    const query = "select public.academic_review_preview($1,$2) value";
    const [preview] = await as<{ value: Record<string, unknown> }>(REVIEWER, query, [course.id, course.revision]);
    expect(preview.value).toMatchObject({ id: course.revision, collection_id: course.id, ready_questions: 7, review_questions: 3, template_text: expect.stringContaining("Synthetic activity") });
    expect(Object.keys(preview.value).sort()).toEqual(["id", "collection_id", "source_revision", "template_text", "ready_questions", "review_questions"].sort());
    for (const user of [OWNER_B, LEARNER, ""]) expect((await as(user, query, [course.id, course.revision]))[0]).toEqual({ value: null });
    expect((await as(REVIEWER, query, [course.id, randomUUID()]))[0]).toEqual({ value: null });
    expect(await as(REVIEWER, "select id from public.academic_revisions where id=$1", [course.revision])).toEqual([]);
    expect(await as(REVIEWER, "select path from public.academic_files where revision_id=$1", [course.revision])).toEqual([]);
    expect(await as(REVIEWER, "select name from storage.objects where name=$1", [`${course.id}/${H}`])).toEqual([]);
    const privateCourse = await seed({ visibility: "private" }), withdrawn = await seed({ withdrawn: true });
    for (const item of [privateCourse, withdrawn]) expect((await as(REVIEWER, query, [item.id, item.revision]))[0]).toEqual({ value: null });
  });

  it("rejects a stale preview after a replacement arrives and permits approve/reject only for the current pending submission", async () => {
    const course = await seed();
    const replacement = randomUUID();
    await db.query(`insert into public.academic_revisions(id,collection_id,content_hash,template_text,status) values($1,$2,$3,'Replacement plan','ready')`, [replacement, course.id, "b".repeat(64)]);
    await db.query("update public.academic_collections set current_revision_id=$1 where id=$2", [replacement, course.id]);
    await expect(as(REVIEWER, "select public.academic_review($1,true,$2)", [course.id, course.revision])).rejects.toThrow(/submission changed/);
    expect((await db.query("select review_status from public.academic_collections where id=$1", [course.id])).rows).toEqual([{ review_status: "pending" }]);
    await expect(as(LEARNER, "select public.academic_review($1,true,$2)", [course.id, replacement])).rejects.toThrow(/Reviewer access/);
    await as(REVIEWER, "select public.academic_review($1,true,$2)", [course.id, replacement]);
    expect((await db.query("select review_status from public.academic_collections where id=$1", [course.id])).rows).toEqual([{ review_status: "approved" }]);
    const rejected = await seed();
    await as(REVIEWER, "select public.academic_review($1,false,$2)", [rejected.id, rejected.revision]);
    expect((await db.query("select review_status from public.academic_collections where id=$1", [rejected.id])).rows).toEqual([{ review_status: "rejected" }]);
    expect((await as(REVIEWER, "select public.academic_review_preview($1,$2) value", [rejected.id, rejected.revision]))[0]).toEqual({ value: null });
    await expect(as(REVIEWER, "select public.academic_review($1,true,$2)", [rejected.id, rejected.revision])).rejects.toThrow(/submission changed/);
  });

  it("retains the existing two-argument academic_review caller", async () => {
    const course = await seed();
    await as(REVIEWER, "select public.academic_review($1,true)", [course.id]);
    expect((await db.query("select review_status from public.academic_collections where id=$1", [course.id])).rows).toEqual([{ review_status: "approved" }]);
  });
});
