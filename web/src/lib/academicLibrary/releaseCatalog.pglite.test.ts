import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const OWNER = "11111111-1111-4111-8111-111111111111";
const LEARNER = "22222222-2222-4222-8222-222222222222";
const REVIEWER = "33333333-3333-4333-8333-333333333333";
const EVIDENCE = "e".repeat(64);
let db: PGlite;

async function as<T>(user: string, sql: string, params: unknown[] = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub','${user}',false); set role authenticated;`);
  try { return (await db.query<T>(sql, params)).rows; } finally { await db.exec("reset role;"); }
}

const nextHash = () => randomUUID().replaceAll("-", "").repeat(2);

interface RevisionFixture {
  collection: string;
  revision: string;
  files: Array<{ path: string; sha256: string; byte_size: number; mime_type: string }>;
}

interface ReleaseFile {
  path: string;
  sha256: string;
  byte_size: number;
  mime_type: string;
}

async function createRevision(options: { review?: number; paths?: string[] } = {}): Promise<RevisionFixture> {
  const collection = randomUUID();
  const paths = options.paths ?? ["catalog.json", "banks/set/bank.json"];
  const files = paths.map(path => ({
    path,
    sha256: nextHash(),
    byte_size: 2,
    mime_type: path.endsWith(".pdf") ? "application/pdf"
      : path.endsWith(".txt") ? "text/plain"
        : path.endsWith(".png") ? "image/png" : "application/json",
  }));
  const metadata = {
    title: "Synthetic collection", module: "SAMPLE", term: "Term 1",
    ready_questions: 4, review_questions: options.review ?? 0,
  };
  const [created] = await as<{ value: { collection_id: string; revision_id: string } }>(OWNER,
    "select public.academic_create_revision($1,$2,$3,$4,$5,$6) value",
    [JSON.stringify(metadata), "SAMPLE - Course plan:\nWeek 1:\nLecture 1 Example [Lecture]",
      JSON.stringify({ sourceChecksums: [nextHash()] }), JSON.stringify(files), nextHash(), collection]);
  for (const file of files) {
    await as(OWNER, "insert into storage.objects(bucket_id,name,metadata) values('academic-content',$1,$2)",
      [`${collection}/${file.sha256}`, JSON.stringify({ size: file.byte_size })]);
  }
  await as(OWNER, "select public.academic_finish_revision($1)", [created.value.revision_id]);
  return { collection, revision: created.value.revision_id, files };
}

async function attest(fixture: RevisionFixture, options: {
  profile?: string; rights?: "pending" | "verified" | "rejected";
  evidence?: string | null; optedIn?: boolean; held?: number;
  paths?: string[]; finish?: boolean;
} = {}): Promise<ReleaseFile[]> {
  const paths = options.paths ?? ["catalog.json", "banks/set/bank.json"];
  const files = paths.map((path): ReleaseFile => ({
    path,
    sha256: nextHash(),
    byte_size: path.endsWith(".png") ? 68 : 2,
    mime_type: path.endsWith(".txt") ? "text/plain"
      : path.endsWith(".png") ? "image/png" : "application/json",
  }));
  await as(OWNER, "select public.academic_attest_release($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [
    fixture.revision, options.profile ?? "universal", "question-bank",
    JSON.stringify({ track: "core" }), options.rights ?? "verified",
    options.evidence === undefined ? EVIDENCE : options.evidence,
    options.optedIn ?? true, options.held ?? 0,
    nextHash(), JSON.stringify(files),
  ]);
  for (const file of files) {
    await as(OWNER, "insert into storage.objects(bucket_id,name,metadata) values('academic-content',$1,$2) on conflict do nothing", [
      `${fixture.collection}/release/${file.sha256}`, JSON.stringify({ size: file.byte_size }),
    ]);
  }
  if (options.finish !== false) {
    await as(OWNER, "select public.academic_finish_release_candidate($1)", [fixture.revision]);
  }
  return files;
}

async function approve(fixture: RevisionFixture) {
  await as(REVIEWER, "select public.academic_review($1,true)", [fixture.collection]);
}

async function publish(fixture: RevisionFixture) {
  const [row] = await as<{ release: string }>(REVIEWER,
    "select public.academic_publish_release($1) release", [fixture.revision]);
  return row.release;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema public grant all on functions to anon,authenticated,service_role;
    create schema axom_private;
    create schema auth; create table auth.users(id uuid primary key);
    insert into auth.users values('${OWNER}'),('${LEARNER}'),('${REVIEWER}');
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;
    grant usage on schema auth to anon,authenticated,service_role;
    grant execute on function auth.uid() to anon,authenticated,service_role;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,unique(bucket_id,name));
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon,authenticated,service_role;
    grant all on storage.objects to anon,authenticated,service_role;
    create policy fixture_broad_access on storage.objects for all to anon,authenticated using(true) with check(true);
  `);
  for (const migration of [
    "20261011190000_academic_library",
    "20261013210000_academic_course_lookup",
    "20261013220000_content_storage_boundaries",
    "20261014121000_academic_revision_order",
    "20261014122000_academic_current_review_gate",
    "20261015230042_enforce_academic_source_identity",
    "20261017233759_enforce_academic_collection_classification",
    "20261023213000_academic_release_catalog",
  ]) {
    await db.exec(readFileSync(new URL(`../../../../supabase/migrations/${migration}.sql`, import.meta.url), "utf8"));
  }
  await db.query("insert into public.academic_reviewers(user_id) values($1)", [REVIEWER]);
}, 30_000);

afterAll(async () => db?.close());

describe("immutable academic releases", () => {
  it("requires every publication gate, including zero held and review questions", async () => {
    const incomplete = await createRevision();
    await attest(incomplete, { rights: "pending", evidence: null, optedIn: false, held: 1 });
    await approve(incomplete);
    await expect(as(OWNER, "select public.academic_set_visibility($1,'shared')", [incomplete.collection]))
      .rejects.toThrow(/reviewed academic release workflow/);
    expect(await as(LEARNER, "select id from public.academic_revisions where id=$1", [incomplete.revision]))
      .toEqual([]);
    await expect(publish(incomplete)).rejects.toThrow(/verified rights.*zero held\/review/i);

    const held = await createRevision({ review: 1 });
    await attest(held);
    await approve(held);
    await expect(publish(held)).rejects.toThrow(/verified rights.*zero held\/review/i);

    const ready = await createRevision();
    const readyManifest = await attest(ready);
    await approve(ready);
    const missing = readyManifest[0];
    await db.query("delete from storage.objects where bucket_id='academic-content' and name=$1", [
      `${ready.collection}/release/${missing.sha256}`,
    ]);
    await expect(publish(ready)).rejects.toThrow(/projection objects are missing/i);
    await db.query("insert into storage.objects(bucket_id,name,metadata) values('academic-content',$1,$2)", [
      `${ready.collection}/release/${missing.sha256}`, JSON.stringify({ size: missing.byte_size }),
    ]);
    const release = await publish(ready);
    expect(release).toMatch(/^[0-9a-f-]{36}$/i);
    await expect(publish(ready)).resolves.toBe(release);
  });

  it("projects only learner-safe files while retaining the complete private source revision", async () => {
    const fixture = await createRevision({ paths: [
      "catalog.json",
      "templates/course.txt",
      "banks/set/bank.json",
      "banks/set/assets/figure.png",
      "audit/review.json",
      "sources/original.pdf",
      "banks/set/private/original/key.json",
    ] });
    await expect(attest(fixture, { paths: ["catalog.json", "banks/set/private/key.json"] }))
      .rejects.toThrow(/academic_release_candidate_files_path_check|violates check constraint/i);
    const releaseManifest = await attest(fixture, { paths: [
      "catalog.json", "templates/course.txt", "banks/set/bank.json", "banks/set/assets/figure.png",
    ] });
    const stagedBank = releaseManifest.find(file => file.path === "banks/set/bank.json")!;
    expect(await as(LEARNER, "select name from storage.objects where name=$1",
      [`${fixture.collection}/release/${stagedBank.sha256}`])).toEqual([]);
    await approve(fixture);
    const release = await publish(fixture);

    const source = (await db.query<{ path: string }>(
      "select path from public.academic_files where revision_id=$1 order by path", [fixture.revision])).rows;
    expect(source).toHaveLength(7);
    const projected = (await db.query<{ path: string }>(
      "select path from public.academic_release_files where release_id=$1 order by path", [release])).rows;
    expect(projected.map(row => row.path)).toEqual([
      "banks/set/assets/figure.png", "banks/set/bank.json", "catalog.json", "templates/course.txt",
    ]);
    const [releaseIdentity] = (await db.query<{ projection_hash: string; attested_hash: string }>(`
      select r.projection_hash, a.projection_hash attested_hash
      from public.academic_releases r
      join public.academic_release_attestations a on a.revision_id=r.source_revision_id
      where r.id=$1
    `, [release])).rows;
    expect(releaseIdentity.projection_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(releaseIdentity.projection_hash).toBe(releaseIdentity.attested_hash);
    expect(await as(LEARNER, "select path from public.academic_files where revision_id=$1", [fixture.revision]))
      .toEqual([]);
    const [legacyCatalog] = await as<{ value: Array<{ id: string }> }>(LEARNER,
      "select public.academic_catalog() value");
    expect(legacyCatalog.value.map(row => row.id)).not.toContain(fixture.collection);
    const [legacyCourse] = await as<{ value: unknown }>(LEARNER,
      "select public.academic_course($1) value", [fixture.collection]);
    expect(legacyCourse.value).toBeNull();
    await expect(as(LEARNER, "select public.academic_enroll($1,$2,array[1])",
      [fixture.collection, fixture.revision])).rejects.toThrow(/Course unavailable/);
    const [releaseFiles] = await as<{ value: Array<{ path: string }> }>(LEARNER,
      "select public.academic_release_files_for_revision($1) value", [fixture.revision]);
    expect(releaseFiles.value.map(file => file.path)).toEqual(projected.map(file => file.path));
    const [preview] = await as<{ value: { id: string; source_revision: null; review_questions: number } }>(LEARNER,
      "select public.academic_release_preview($1) value", [fixture.revision]);
    expect(preview.value).toMatchObject({
      id: fixture.revision,
      source_revision: null,
      review_questions: 0,
    });

    const safeObject = releaseManifest.find(file => file.path === "banks/set/bank.json")!;
    const privateObject = fixture.files.find(file => file.path === "audit/review.json")!;
    expect(await as(LEARNER, "select name from storage.objects where name=$1", [`${fixture.collection}/release/${safeObject.sha256}`]))
      .toHaveLength(1);
    expect(await as(LEARNER, "select name from storage.objects where name=$1", [`${fixture.collection}/${privateObject.sha256}`]))
      .toEqual([]);
    await expect(db.query("update public.academic_releases set title='Changed' where id=$1", [release]))
      .rejects.toThrow(/immutable/i);
    await expect(db.query("delete from public.academic_release_files where release_id=$1", [release]))
      .rejects.toThrow(/immutable/i);
    expect((await db.query("select path from public.academic_files where revision_id=$1", [fixture.revision])).rows)
      .toHaveLength(7);
  });

  it("gives every authenticated account universal releases plus its requested opaque profile", async () => {
    const universal = await createRevision();
    await attest(universal, { profile: "universal" }); await approve(universal); await publish(universal);
    const focused = await createRevision();
    await attest(focused, { profile: "profile.core-1" }); await approve(focused); await publish(focused);

    const [core] = await as<{ value: Array<{ id: string; profile_key: string }> }>(LEARNER,
      "select public.academic_release_catalog('','',null,'profile.core-1') value");
    expect(core.value.map(row => row.id)).toEqual(expect.arrayContaining([universal.collection, focused.collection]));
    expect(core.value.find(row => row.id === universal.collection)?.profile_key).toBe("universal");
    expect(core.value.find(row => row.id === focused.collection)?.profile_key).toBe("profile.core-1");

    const [other] = await as<{ value: Array<{ id: string }> }>(LEARNER,
      "select public.academic_release_catalog('','',null,'profile.other') value");
    expect(other.value.map(row => row.id)).toContain(universal.collection);
    expect(other.value.map(row => row.id)).not.toContain(focused.collection);
    const [deepLink] = await as<{ value: { id: string; release_id: string } | null }>(LEARNER,
      "select public.academic_release_course($1,'profile.core-1') value", [focused.collection]);
    expect(deepLink.value).toMatchObject({ id: focused.collection });
    const [wrongProfile] = await as<{ value: unknown }>(LEARNER,
      "select public.academic_release_course($1,'profile.other') value", [focused.collection]);
    expect(wrongProfile.value).toBeNull();
    await expect(as(LEARNER, "select public.academic_enroll_release($1,$2,array[2,1],'profile.core-1')",
      [focused.collection, focused.revision])).resolves.toHaveLength(1);
    expect(await as(LEARNER, "select weeks from public.academic_enrollments where collection_id=$1", [focused.collection]))
      .toEqual([{ weeks: [1, 2] }]);
    await expect(as(LEARNER, "select public.academic_enroll_release($1,$2,array[1],'profile.other')",
      [focused.collection, focused.revision])).rejects.toThrow(/Course unavailable/);

    await db.exec("select set_config('request.jwt.claim.sub','',false); set role anon;");
    try {
      await expect(db.query("select public.academic_release_catalog()"))
        .rejects.toThrow(/permission denied/i);
    } finally { await db.exec("reset role"); }
  });
});

it("retains mixed unfiled content in a private moderation collection that cannot share or enroll", async () => {
  const collection = randomUUID();
  const fileHash = nextHash();
  const sourceHash = nextHash();
  const [created] = await as<{ value: { revision_id: string } }>(OWNER,
    "select public.academic_create_moderation_revision($1,$2,$3,$4,$5) value", [
      JSON.stringify({ title: "Private moderation queue", module: "Unfiled", term: "Term 0",
        collection_mode: "moderation", content_kind: "mixed", ready_questions: 0, review_questions: 12 }),
      JSON.stringify({ sourceChecksums: [sourceHash], weekAssignment: "unassigned" }),
      JSON.stringify([{ path: "catalog.json", sha256: fileHash, byte_size: 2, mime_type: "application/json" }]),
      nextHash(), collection,
    ]);
  await as(OWNER, "insert into storage.objects(bucket_id,name,metadata) values('academic-content',$1,$2)",
    [`${collection}/${fileHash}`, JSON.stringify({ size: 2 })]);
  await as(OWNER, "select public.academic_finish_revision($1)", [created.value.revision_id]);

  expect((await db.query<{ collection_mode: string; term: string; module: string }>(
    "select collection_mode,term,module from public.academic_collections where id=$1", [collection])).rows)
    .toEqual([{ collection_mode: "moderation", term: "Term 0", module: "Unfiled" }]);
  await expect(as(OWNER, "select public.academic_set_visibility($1,'shared')", [collection]))
    .rejects.toThrow(/reviewed academic release workflow/);
  await expect(db.query("update public.academic_collections set visibility='shared' where id=$1", [collection]))
    .rejects.toThrow(/academic_moderation_stays_unfiled_private|violates check constraint/i);
  await expect(as(OWNER, "select public.academic_enroll($1,$2,array[1])", [collection, created.value.revision_id]))
    .rejects.toThrow(/Course unavailable/);
  await expect(attest({ collection, revision: created.value.revision_id, files: [{
    path: "catalog.json", sha256: fileHash, byte_size: 2, mime_type: "application/json",
  }] })).rejects.toThrow(/Current private revision unavailable/);
  const [catalog] = await as<{ value: Array<{ id: string }> }>(OWNER,
    "select public.academic_release_catalog() value");
  expect(catalog.value.map(row => row.id)).not.toContain(collection);
  expect((await db.query("select id from public.academic_revisions where id=$1", [created.value.revision_id])).rows)
    .toHaveLength(1);
});
