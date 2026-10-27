import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const H = "a".repeat(64);
const migrations = [
  "20261011190000_academic_library.sql",
  "20261013210000_academic_course_lookup.sql",
  "20261013220000_content_storage_boundaries.sql",
  "20261014122000_academic_current_review_gate.sql",
  "20261015230042_enforce_academic_source_identity.sql",
  "20261017233759_enforce_academic_collection_classification.sql",
  "20261027120000_academic_curriculum_catalog.sql",
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
    insert into auth.users values('${A}'),('${B}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to anon,authenticated,service_role;
    grant execute on function auth.uid() to anon,authenticated,service_role;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,unique(bucket_id,name));
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon,authenticated,service_role;
    grant all on storage.objects to anon,authenticated,service_role;
  `);
  for (const name of migrations) {
    await db.exec(readFileSync(new URL(`../../../../supabase/migrations/${name}`, import.meta.url), "utf8"));
  }
}, 30_000);
afterAll(async () => db?.close());

async function as<T>(user: string, sql: string, params: unknown[] = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub','${user}',false); set role authenticated;`);
  try { return (await db.query<T>(sql, params)).rows; } finally { await db.exec("reset role;"); }
}
const sourceHash = () => randomUUID().replaceAll("-", "").repeat(2);
type Row = { id: string; term: string; module: string; title: string; owned: boolean };

/** One finished revision; shared and approved unless the owner keeps it private. */
async function course(term: string, module: string, title = module, share = true): Promise<string> {
  const collection = randomUUID();
  await as(A, "select public.academic_create_revision($1,$2,$3,$4,$5,$6)", [
    JSON.stringify({ title, module, term }),
    `${module} - Course plan:\nWeek 1:\nLecture 1 Example [Lecture]`,
    JSON.stringify({ sourceChecksums: [sourceHash()] }),
    JSON.stringify([{ path: "catalog.json", sha256: H, byte_size: 2, mime_type: "application/json" }]),
    H, collection,
  ]);
  await as(A, "insert into storage.objects(bucket_id,name,metadata) values('academic-content',$1,$2)",
    [`${collection}/${H}`, JSON.stringify({ size: 2 })]);
  const [revision] = await as<{ id: string }>(A, "select id from public.academic_revisions where collection_id=$1", [collection]);
  await as(A, "select public.academic_finish_revision($1)", [revision.id]);
  if (share) {
    await as(A, "select public.academic_set_visibility($1,'shared')", [collection]);
    await as(A, "select public.academic_review($1,true)", [collection]);
  }
  return collection;
}
async function catalog(user: string, search = "", term = "", after: string | null = null): Promise<Row[]> {
  const [page] = await as<{ value: Row[] }>(user, "select public.academic_catalog($1,$2,$3) value", [search, term, after]);
  return page.value;
}
const label = (row: Row) => `${row.term}/${row.module}/${row.title}`;

describe("curriculum-ordered academic catalog", () => {
  beforeAll(async () => {
    await db.query("insert into public.academic_reviewers values($1)", [A]);
  });

  it("pages every permitted course by term, then module, then title, with a stable keyset cursor", async () => {
    // Created deliberately out of order; collection UUIDs are random.
    await course("Term 5", "GOER");
    await course("Term 10", "Elective");
    await course("Term 1", "FTM 1", "FTM 1");
    await course("Boards", "STEP 1");
    await course("Term 2", "ER");
    await course("Term 1", "CPR 1");
    await course("Term 1", "FTM 1", "FTM 1 questions");
    const hidden = await course("Term 1", "BSCE 1", "BSCE 1", false);
    for (let index = 0; index < 22; index++) await course("Term 3", `Module ${String(index).padStart(2, "0")}`);

    const first = await catalog(B);
    expect(first).toHaveLength(24);
    const second = await catalog(B, "", "", first.at(-1)!.id);
    const all = [...first, ...second];
    expect(second).toHaveLength(5);
    expect(new Set(all.map(row => row.id)).size).toBe(29);
    expect(all.some(row => row.id === hidden)).toBe(false);
    expect(all.map(label).slice(0, 4)).toEqual([
      "Term 1/CPR 1/CPR 1", "Term 1/FTM 1/FTM 1", "Term 1/FTM 1/FTM 1 questions", "Term 2/ER/ER",
    ]);
    expect(all.map(label).slice(4, 26)).toEqual(Array.from({ length: 22 }, (_, index) =>
      `Term 3/Module ${String(index).padStart(2, "0")}/Module ${String(index).padStart(2, "0")}`));
    // Numeric, not lexical: Term 10 follows Term 5; a non-term label sorts last.
    expect(all.map(label).slice(26)).toEqual(["Term 5/GOER/GOER", "Term 10/Elective/Elective", "Boards/STEP 1/STEP 1"]);
    expect(all.every(row => row.owned === false)).toBe(true);
    expect(await catalog(B, "", "", second.at(-1)!.id)).toEqual([]);
  });

  it("keeps term filters, search and the owner's private courses within the same order", async () => {
    const owner = await catalog(A, "", "Term 1");
    expect(owner.map(label)).toEqual([
      "Term 1/BSCE 1/BSCE 1", "Term 1/CPR 1/CPR 1", "Term 1/FTM 1/FTM 1", "Term 1/FTM 1/FTM 1 questions",
    ]);
    expect(owner.every(row => row.owned)).toBe(true);
    expect((await catalog(B, "ftm")).map(label)).toEqual(["Term 1/FTM 1/FTM 1", "Term 1/FTM 1/FTM 1 questions"]);
  });

  it("returns an empty page for a cursor that no longer exists instead of restarting", async () => {
    expect(await catalog(B, "", "", randomUUID())).toEqual([]);
  });

  it("stays unavailable to anonymous callers", async () => {
    const acl = await db.query<{ allowed: boolean }>("select has_function_privilege('anon','public.academic_catalog(text,text,uuid)','execute') allowed");
    expect(acl.rows[0].allowed).toBe(false);
  });
});

describe("academic reviewer self-check", () => {
  it("reports only the caller's own reviewer membership", async () => {
    expect(await as(A, "select public.academic_is_reviewer() value")).toEqual([{ value: true }]);
    expect(await as(B, "select public.academic_is_reviewer() value")).toEqual([{ value: false }]);
    await db.exec("select set_config('request.jwt.claim.sub','',false); set role authenticated;");
    try { expect((await db.query("select public.academic_is_reviewer() value")).rows).toEqual([{ value: false }]); }
    finally { await db.exec("reset role;"); }
    const acl = await db.query<{ anon: boolean; authenticated: boolean }>(`select
      has_function_privilege('anon','public.academic_is_reviewer()','execute') anon,
      has_function_privilege('authenticated','public.academic_is_reviewer()','execute') authenticated`);
    expect(acl.rows[0]).toEqual({ anon: false, authenticated: true });
    // Membership itself is not writable by learners.
    await expect(as(B, "insert into public.academic_reviewers values($1)", [B])).rejects.toThrow(/permission denied/);
  });
});
