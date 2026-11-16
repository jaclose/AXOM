import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REVIEWER = "11111111-1111-4111-8111-111111111111";
const SECOND_REVIEWER = "22222222-2222-4222-8222-222222222222";
const CONTRIBUTOR = "33333333-3333-4333-8333-333333333333";
const LEARNER = "44444444-4444-4444-8444-444444444444";
const H = "a".repeat(64);
const PLAN = "T5 - GOER - Course plan:\nWeek 1:\nLecture 1 Synthetic activity [Lecture]";
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
  "20261102170000_academic_review_queue.sql",
  "20261102171000_reviewer_attestation_identity.sql",
  "20261113220000_academic_public_catalog.sql",
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
    insert into auth.users values('${REVIEWER}'),('${SECOND_REVIEWER}'),('${CONTRIBUTOR}'),('${LEARNER}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to anon,authenticated,service_role;
    grant execute on function auth.uid() to anon,authenticated,service_role;
    create table public.account_profiles(user_id uuid primary key references auth.users, display_name text not null);
    alter table public.account_profiles enable row level security;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,unique(bucket_id,name));
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon,authenticated,service_role;
    grant all on storage.objects to anon,authenticated,service_role;
  `);
  for (const name of migrations) await db.exec(readFileSync(new URL(`../../../../supabase/migrations/${name}`, import.meta.url), "utf8"));
  await db.query("insert into public.academic_reviewers values($1),($2)", [REVIEWER, SECOND_REVIEWER]);
}, 30_000);
afterAll(async () => db?.close());

async function as<T>(user: string, sql: string, params: unknown[] = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub','${user}',false); set role authenticated;`);
  try { return (await db.query<T>(sql, params)).rows; } finally { await db.exec("reset role;"); }
}
/** A browser with no account: the anon role and no subject claim. */
async function visitor<T>(sql: string, params: unknown[] = []) {
  await db.exec("reset role; select set_config('request.jwt.claim.sub','',false); set role anon;");
  try { return (await db.query<T>(sql, params)).rows; } finally { await db.exec("reset role;"); }
}
interface Seeded { id: string; revision: string }
async function seed({ owner = REVIEWER, visibility = "shared", review = "approved", withdrawn = false, status = "ready",
  title = "Synthetic course", module = "GOER", term = "Term 5", plan = PLAN } = {}): Promise<Seeded> {
  const id = randomUUID(), revision = randomUUID();
  const groupId = visibility === "group" ? randomUUID() : null;
  if (groupId) await db.query("insert into public.academic_groups(id,name) values($1,'Offer fixture group')", [groupId]);
  await db.query(`insert into public.academic_collections(id,owner_id,title,module,term,visibility,review_status,withdrawn,group_id)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [id, owner, title, module, term, visibility, review, withdrawn, groupId]);
  await db.query(`insert into public.academic_revisions(id,collection_id,content_hash,source_revision,template_text,provenance,ready_questions,review_questions,status,approved_at)
    values($1,$2,$3,'2026-A',$4,$5,7,3,$6,$7)`,
  [revision, id, H, plan, JSON.stringify({ private_payload: "Must never leave the revision row" }), status, review === "approved" ? new Date().toISOString() : null]);
  await db.query("update public.academic_collections set current_revision_id=$1 where id=$2", [revision, id]);
  return { id, revision };
}
const offer = (user: string, course: Seeded, offered = true, revision: string | null = course.revision) =>
  as(user, "select public.academic_offer_publicly($1,$2,$3)", [course.id, offered, revision]);
interface PublicRow { id: string; title: string; module: string; term: string; current_revision_id: string; ready_questions: number; has_plan: boolean }
async function catalog(search = "", term = "", after: string | null = null): Promise<PublicRow[]> {
  return (await visitor<{ value: PublicRow[] }>("select public.academic_public_catalog($1,$2,$3) value", [search, term, after]))[0].value;
}
const listed = async (course: Seeded) => (await catalog()).some(row => row.id === course.id);
const isPublic = async (course: Seeded) => (await visitor<{ value: boolean }>("select public.academic_is_public($1) value", [course.id]))[0].value;
const preview = async (course: Seeded) => (await visitor<{ value: Record<string, unknown> | null }>("select public.academic_public_course($1) value", [course.id]))[0].value;
const offeredRevision = async (course: Seeded) => (await db.query<{ value: string | null }>("select public_revision_id value from public.academic_collections where id=$1", [course.id])).rows[0].value;
const refused = (code: string) => expect.objectContaining({ code });

describe("visitor catalog exposure", () => {
  it("shows nothing until a reviewer offers the exact approved revision of their own course", async () => {
    const course = await seed({ title: "Offered course" });
    expect(await listed(course)).toBe(false);
    expect(await isPublic(course)).toBe(false);
    expect(await preview(course)).toBeNull();

    await offer(REVIEWER, course);

    const row = (await catalog()).find(entry => entry.id === course.id);
    expect(row).toEqual({ id: course.id, title: "Offered course", module: "GOER", term: "Term 5", academic_term: null, cohort: null,
      current_revision_id: course.revision, ready_questions: 7, has_plan: true });
    expect(await isPublic(course)).toBe(true);
    const detail = await preview(course);
    expect(detail).toMatchObject({ id: course.id, template_text: PLAN, source_revision: "2026-A", ready_questions: 7 });
    // No owner, reviewer, sharing state, pending counts or revision provenance reaches a visitor.
    expect(Object.keys(detail!).sort()).toEqual(["academic_term", "cohort", "current_revision_id", "id", "module", "ready_questions", "source_revision", "template_text", "term", "title"]);
    expect(JSON.stringify([row, detail])).not.toMatch(/private_payload|owner|review_status|visibility|review_questions/);
  });

  it("refuses every caller and course state that must not reach visitors", async () => {
    const mine = await seed();
    const contributed = await seed({ owner: CONTRIBUTOR });
    // A contributor is not a reviewer; a reviewer cannot publish someone else's upload.
    await expect(offer(CONTRIBUTOR, contributed)).rejects.toEqual(refused("42501"));
    await expect(offer(REVIEWER, contributed)).rejects.toEqual(refused("42501"));
    await expect(offer(LEARNER, mine)).rejects.toEqual(refused("42501"));
    await expect(offer(REVIEWER, { id: randomUUID(), revision: randomUUID() })).rejects.toEqual(refused("42501"));
    // The decision is bound to the revision the reviewer inspected.
    await expect(offer(REVIEWER, mine, true, randomUUID())).rejects.toEqual(refused("40001"));
    await expect(offer(REVIEWER, mine, true, null)).rejects.toEqual(refused("40001"));
    await expect(as(REVIEWER, "select public.academic_offer_publicly($1,null,$2)", [mine.id, mine.revision])).rejects.toEqual(refused("22004"));
    for (const state of [{ review: "pending" }, { review: "rejected" }, { visibility: "private" }, { visibility: "group" }, { withdrawn: true }, { status: "uploading" }]) {
      const course = await seed(state);
      await expect(offer(REVIEWER, course), JSON.stringify(state)).rejects.toEqual(refused("42501"));
      expect(await isPublic(course)).toBe(false);
    }
    expect(await listed(mine)).toBe(false);
    expect(await listed(contributed)).toBe(false);
    // A visitor cannot make the decision at all.
    await expect(visitor("select public.academic_offer_publicly($1,true,$2)", [mine.id, mine.revision])).rejects.toEqual(refused("42501"));
  });

  it("ends an offer with the state it was granted for and never restores it silently", async () => {
    const rejected = await seed(), unshared = await seed(), withdrawn = await seed(), revised = await seed();
    for (const course of [rejected, unshared, withdrawn, revised]) await offer(REVIEWER, course);

    await as(REVIEWER, "select public.academic_review($1,false)", [rejected.id]);
    expect(await isPublic(rejected)).toBe(false);
    expect(await offeredRevision(rejected)).toBeNull();
    // The offer was removed, not masked: restoring approval by any route does not bring it back.
    await db.query("update public.academic_collections set review_status='approved' where id=$1", [rejected.id]);
    await db.query("update public.academic_revisions set approved_at=now() where id=$1", [rejected.revision]);
    expect(await isPublic(rejected)).toBe(false);

    await as(REVIEWER, "select public.academic_set_visibility($1,'private')", [unshared.id]);
    await as(REVIEWER, "select public.academic_set_visibility($1,'shared')", [unshared.id]);
    expect(await offeredRevision(unshared)).toBeNull();
    expect(await isPublic(unshared)).toBe(false);

    await as(REVIEWER, "select public.academic_withdraw($1,true)", [withdrawn.id]);
    await as(REVIEWER, "select public.academic_withdraw($1,false)", [withdrawn.id]);
    expect(await offeredRevision(withdrawn)).toBeNull();
    expect(await preview(withdrawn)).toBeNull();

    // A replacement revision becomes current exactly as academic_finish_revision records it.
    const next = randomUUID();
    await db.query(`insert into public.academic_revisions(id,collection_id,content_hash,template_text,ready_questions,review_questions,status)
      values($1,$2,$3,$4,9,0,'ready')`, [next, revised.id, "b".repeat(64), PLAN]);
    await db.query("update public.academic_collections set current_revision_id=$1, review_status='pending' where id=$2", [next, revised.id]);
    expect(await offeredRevision(revised)).toBeNull();
    expect(await listed(revised)).toBe(false);
    await expect(offer(REVIEWER, revised)).rejects.toEqual(refused("40001"));

    // Offering again is an explicit act on the restored state.
    await offer(REVIEWER, unshared);
    expect(await isPublic(unshared)).toBe(true);
  });

  it("lets the owner or any reviewer end an offer, and records each decision out of client reach", async () => {
    const course = await seed({ title: "Logged course" });
    await offer(REVIEWER, course);
    await expect(offer(LEARNER, course, false)).rejects.toEqual(refused("42501"));
    await expect(offer(CONTRIBUTOR, course, false)).rejects.toEqual(refused("42501"));
    expect(await isPublic(course)).toBe(true);
    await offer(SECOND_REVIEWER, course, false);
    expect(await isPublic(course)).toBe(false);
    await offer(REVIEWER, course);
    await offer(REVIEWER, course, false, null);

    const log = await db.query<{ actor_id: string; offered: boolean; revision_id: string | null }>(
      "select actor_id,offered,revision_id from public.academic_public_offer_log where collection_id=$1 order by id", [course.id]);
    expect(log.rows).toEqual([
      { actor_id: REVIEWER, offered: true, revision_id: course.revision },
      { actor_id: SECOND_REVIEWER, offered: false, revision_id: course.revision },
      { actor_id: REVIEWER, offered: true, revision_id: course.revision },
      { actor_id: REVIEWER, offered: false, revision_id: course.revision },
    ]);
    await expect(as(REVIEWER, "select * from public.academic_public_offer_log")).rejects.toEqual(refused("42501"));
    await expect(visitor("select * from public.academic_public_offer_log")).rejects.toEqual(refused("42501"));
  });

  it("pages offered courses in curriculum order with search, term filter and a stable cursor", async () => {
    await db.exec("update public.academic_collections set public_revision_id = null");
    const order: Array<[string, string, string]> = [["Term 5", "GOER", "GOER"], ["Term 10", "Elective", "Elective"],
      ["Term 1", "FTM 1", "FTM 1"], ["Boards", "STEP 1", "STEP 1"], ["Term 1", "CPR 1", "CPR 1"]];
    for (const [term, module, title] of order) await offer(REVIEWER, await seed({ term, module, title }));
    for (let index = 0; index < 22; index++) await offer(REVIEWER, await seed({ term: "Term 3", module: `Module ${String(index).padStart(2, "0")}`, title: "Paged" }));
    const hidden = await seed({ term: "Term 1", module: "BSCE 1", title: "Never offered" });

    const first = await catalog();
    expect(first).toHaveLength(24);
    const second = await catalog("", "", first.at(-1)!.id);
    const all = [...first, ...second];
    expect(all).toHaveLength(27);
    expect(all.some(row => row.id === hidden.id)).toBe(false);
    const label = (row: PublicRow) => `${row.term}/${row.module}`;
    expect(all.map(label).slice(0, 2)).toEqual(["Term 1/CPR 1", "Term 1/FTM 1"]);
    // Numeric, not lexical: Term 10 follows Term 5; a non-term label sorts last.
    expect(all.map(label).slice(-3)).toEqual(["Term 5/GOER", "Term 10/Elective", "Boards/STEP 1"]);
    expect((await catalog("ftm")).map(label)).toEqual(["Term 1/FTM 1"]);
    expect((await catalog("", "Term 1")).map(label)).toEqual(["Term 1/CPR 1", "Term 1/FTM 1"]);
    // A cursor that is not an offered course yields an empty page instead of restarting or leaking order.
    expect(await catalog("", "", randomUUID())).toEqual([]);
    expect(await catalog("", "", hidden.id)).toEqual([]);
  });

  it("opens only the three readers to visitors and leaves every existing boundary closed", async () => {
    const acl = await db.query<Record<string, boolean>>(`select
      has_function_privilege('anon','public.academic_public_catalog(text,text,uuid)','execute') catalog,
      has_function_privilege('anon','public.academic_public_course(uuid)','execute') course,
      has_function_privilege('anon','public.academic_is_public(uuid)','execute') state,
      has_function_privilege('anon','public.academic_offer_publicly(uuid,boolean,uuid)','execute') offer,
      has_function_privilege('authenticated','public.academic_offer_publicly(uuid,boolean,uuid)','execute') reviewer_offer,
      has_function_privilege('anon','public.academic_catalog(text,text,uuid)','execute') account_catalog,
      has_function_privilege('anon','public.academic_course(uuid)','execute') account_course,
      has_function_privilege('anon','public.academic_guard_public_offer()','execute') guard`);
    expect(acl.rows[0]).toEqual({ catalog: true, course: true, state: true, offer: false, reviewer_offer: true,
      account_catalog: false, account_course: false, guard: false });
    const course = await seed();
    await offer(REVIEWER, course);
    // Offered or not, a visitor reads no table row directly.
    for (const table of ["academic_collections", "academic_revisions", "academic_files"]) {
      const rows = await visitor(`select * from public.${table}`).then(result => result.length, error => (error as { code: string }).code);
      expect([0, "42501"], table).toContain(rows);
    }
  });
});
