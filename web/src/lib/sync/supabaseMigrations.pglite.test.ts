import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { supabasePlatform } from "./supabasePlatform.testing";

/**
 * Replays every migration against Postgres with the platform-owned Auth and
 * Storage tables supplied by Supabase. These are test fixtures, not application
 * migrations. Default public function privileges deliberately match Supabase.
 */
const migrationsDir = fileURLToPath(new URL("../../../../supabase/migrations/", import.meta.url));
const files = readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort();
const privacyBarrierMigration = "20261016011812_harden_privacy_request_barrier.sql";
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const HASH = "a".repeat(64);

async function supabaseLikeDatabase({ rlsAutoEnable, stopBefore }: { rlsAutoEnable: boolean; stopBefore?: string }) {
  const db = await supabasePlatform();
  if (rlsAutoEnable) await db.exec("create function public.rls_auto_enable() returns void language sql as $$ select $$;");
  for (const file of files) {
    if (stopBefore && file >= stopBefore) break;
    await db.exec(`begin;${readFileSync(migrationsDir + file, "utf8")}commit;`);
  }
  return db;
}
async function as(db: PGlite, role: "anon" | "authenticated" | "service_role", sub: string | null, sql: string, params: unknown[] = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${sub ?? ""}', false); set role ${role};`);
  try { return await db.query<Record<string, unknown>>(sql, params); }
  finally { await db.exec("reset role;"); }
}
async function canExecute(db: PGlite, role: string, signature: string) {
  const { rows } = await db.query<{ ok: boolean }>("select has_function_privilege($1, $2, 'execute') as ok", [role, signature]);
  return rows[0].ok;
}
const PRIVILEGED = [
  "public.push_workspace_delta_v2(bigint,text,integer,text,jsonb,uuid,uuid,text)",
  "public.push_workspace_revision_v2(bigint,integer,text,jsonb,uuid,uuid,text)",
  "public.push_workspace_revision(bigint,integer,text,jsonb,uuid,uuid,text)",
  "public.create_question_set_share(text,jsonb)",
  "public.touch_account_device(uuid,text,text,bigint)",
  "public.axom_account_accepts_cloud_writes()",
  "public.delete_my_cloud_data()", "public.consume_ai_quota()", "public.revoke_question_set_share(uuid)",
];
const SERVICE_ONLY_PRIVACY = [
  "public.guard_privacy_export_admission()",
  "public.quarantine_stale_privacy_requests(timestamp with time zone)",
  "public.claim_privacy_request(uuid,timestamp with time zone)",
  "public.finalize_privacy_export(uuid,text,timestamp with time zone)",
  "public.begin_account_deletion_cleanup(uuid)",
  "public.record_account_deletion_failure(uuid,boolean)",
];
const PRIVATE_TABLES = [
  "account_profiles", "workspaces", "workspace_revisions", "sync_conflicts", "question_set_shares", "account_devices", "ai_usage",
  "academic_catalog_releases", "academic_catalog_entries", "academic_catalog_files", "academic_catalog_grants",
  "academic_source_identities",
];
describe("Supabase migrations on real Postgres", () => {
  it("revokes group/shared access when the currently selected academic revision is pending or rejected", async () => {
    const db = await supabaseLikeDatabase({ rlsAutoEnable: false });
    const collection = "77777777-7777-4777-8777-777777777777";
    const oldRevision = "88888888-8888-4888-8888-888888888888";
    const newRevision = "99999999-9999-4999-8999-999999999999";
    const oldHash = HASH;
    const newHash = "b".repeat(64);
    try {
      await db.query("insert into auth.users(id,email) values ($1,'a@x.test'),($2,'b@x.test')", [A, B]);
      await db.query("insert into public.academic_collections(id,owner_id,title,module,term,visibility,review_status) values($1,$2,'Sample approved bank','T1','Term 1','shared','pending')",
        [collection, A]);
      await db.query(`insert into public.academic_revisions
        (id,collection_id,content_hash,template_text,status,created_at,approved_at)
        values($1,$3,$4,'Week 1','ready','2026-10-12T00:00:00Z',now()),
              ($2,$3,$5,'Week 2','ready','2026-10-13T00:00:00Z',null)`,
      [oldRevision, newRevision, collection, oldHash, newHash]);
      await db.query("insert into public.academic_files(revision_id,path,object_path,sha256,byte_size,mime_type) values($1,'bank.json',$2,$3,7,'application/json')",
        [oldRevision, `${collection}/${oldHash}`, oldHash]);
      await db.query("insert into storage.objects(bucket_id,name,metadata) values('academic-content',$1,'{\"size\":7}')",
        [`${collection}/${oldHash}`]);
      const visibility = (user: string) => as(db, "authenticated", user,
        "select public.academic_can_read($1) as allowed", [collection]);
      const filesFor = (user: string) => as(db, "authenticated", user,
        "select object_path from public.academic_files where revision_id=$1", [oldRevision]);
      const visibleObject = (user: string) => as(db, "authenticated", user,
        "select name from storage.objects where bucket_id='academic-content'");

      // An explicitly approved active version is accessible to authorized viewers.
      await db.query("update public.academic_collections set current_revision_id=$2,review_status='approved' where id=$1",
        [collection, oldRevision]);
      expect((await visibility(B)).rows).toEqual([{ allowed: true }]);
      expect((await filesFor(B)).rows).toHaveLength(1);
      expect((await visibleObject(B)).rows).toHaveLength(1);

      // Its older historical approval must not expose files after replacement
      // by a new, unreviewed revision.
      await db.query("update public.academic_collections set current_revision_id=$2,review_status='pending' where id=$1",
        [collection, newRevision]);
      expect((await visibility(B)).rows).toEqual([{ allowed: false }]);
      expect((await filesFor(B)).rows).toHaveLength(0);
      expect((await visibleObject(B)).rows).toHaveLength(0);
      expect((await visibility(A)).rows).toEqual([{ allowed: true }]);
      expect((await filesFor(A)).rows).toHaveLength(1);
      await db.query("update public.academic_collections set review_status='rejected' where id=$1",
        [collection]);
      expect((await visibility(B)).rows).toEqual([{ allowed: false }]);

      // Reviewer approval for the *current* revision restores access, but
      // withdrawing the collection closes it again without deleting history.
      await db.query("update public.academic_revisions set approved_at=now() where id=$1", [newRevision]);
      await db.query("update public.academic_collections set review_status='approved' where id=$1", [collection]);
      expect((await visibility(B)).rows).toEqual([{ allowed: true }]);
      await db.query("update public.academic_collections set withdrawn=true where id=$1", [collection]);
      expect((await visibility(B)).rows).toEqual([{ allowed: false }]);
      expect((await visibility(A)).rows).toEqual([{ allowed: true }]);
    } finally { await db.close(); }
  }, 60_000);

  it("references one academic object for two learners while enforcing review, withdrawal and acknowledged personal history", async () => {
    const db = await supabaseLikeDatabase({ rlsAutoEnable: false });
    const collection = "33333333-3333-4333-8333-333333333333";
    const revision = "44444444-4444-4444-8444-444444444444";
    try {
      await db.query("insert into auth.users(id,email) values ($1,'a@x.com'),($2,'b@x.com')", [A, B]);
      await db.query("insert into public.academic_collections(id,owner_id,title,module,term) values($1,$2,'Test course','TEST','Term 1')", [collection, A]);
      await db.query("insert into public.academic_revisions(id,collection_id,content_hash,template_text,status) values($1,$2,$3,'Week 1','ready')", [revision, collection, HASH]);
      await db.query("insert into public.academic_files(revision_id,path,object_path,sha256,byte_size,mime_type) values($1,'bank.json',$2,$3,7,'application/json')", [revision, `${collection}/${HASH}`, HASH]);
      await db.query("insert into storage.objects(bucket_id,name,metadata) values('academic-content',$1,'{\"size\":7}')", [`${collection}/${HASH}`]);
      const source = { collection: "questions", id: "q1", hash: HASH, byteSize: 10, expandedBytes: 20,
        academic: { revisionId: revision, path: "bank.json", sha256: HASH, adapterVersion: 1, kind: "question", questionId: "original-q1", reviewedAt: "2026-10-13T00:00:00Z" } };
      const payload = { _axomCloudFormat: 2, _axomHashFormat: 2, content: "{}", expandedBytes: 2, media: [], sources: [source] };
      const save = (user: string, base: number, value = payload, key = randomUUID()) => as(db, "authenticated", user,
        "select public.push_workspace_revision_v2($1,34,$2,$3,gen_random_uuid(),$4) as r", [base, HASH, value, key]);
      expect((await save(A, 0)).rows[0].r).toMatchObject({ status: "accepted" });
      await expect(save(B, 0)).rejects.toMatchObject({ code: "PT409" });
      await db.query("update public.academic_collections set visibility='shared',review_status='approved',current_revision_id=$2 where id=$1", [collection, revision]);
      await db.query("update public.academic_revisions set approved_at=now() where id=$1", [revision]);
      const retryKey = randomUUID();
      expect((await save(B, 0, payload, retryKey)).rows[0].r).toMatchObject({ status: "accepted" });
      expect((await db.query("select * from storage.objects where bucket_id='workspace-content'")).rows).toEqual([]);
      await db.query("update public.academic_collections set withdrawn=true where id=$1", [collection]);
      expect((await save(B, 0, payload, retryKey)).rows[0].r).toMatchObject({ status: "accepted", revision: 1, idempotent: true });
      expect((await save(B, 1)).rows[0].r).toMatchObject({ status: "accepted" });
      await expect(save(B, 2, { ...payload, sources: [{ ...source, id: "unacknowledged" }] })).rejects.toMatchObject({ code: "PT409" });
      expect((await as(db, "authenticated", B, "select * from storage.objects where bucket_id='academic-content'")).rows).toEqual([]);
    } finally { await db.close(); }
  }, 60_000);

  it("cascades an academic owner's relational graph without deleting another owner's content", async () => {
    const db = await supabaseLikeDatabase({ rlsAutoEnable: false });
    const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const ownerCollection = "33333333-3333-4333-8333-333333333333";
    const ownerRevision = "44444444-4444-4444-8444-444444444444";
    const foreignCollection = "55555555-5555-4555-8555-555555555555";
    const foreignRevision = "66666666-6666-4666-8666-666666666666";
    const challenge = "77777777-7777-4777-8777-777777777777";
    const foreignHash = "b".repeat(64);
    const scalar = async (sql: string, params: unknown[] = []) =>
      Number((await db.query<{ n: number }>(sql, params)).rows[0].n);
    try {
      await db.query("insert into auth.users(id,email) values ($1,'owner@x.test'),($2,'other@x.test'),($3,'empty@x.test')", [A, B, C]);
      await db.query(`insert into public.academic_collections(id,owner_id,title,module,term)
        values($1,$2,'Owner bank','OWNER','Term 1'),($3,$4,'Other bank','OTHER','Term 1')`,
      [ownerCollection, A, foreignCollection, B]);
      await db.query(`insert into public.academic_revisions(id,collection_id,content_hash,template_text,status)
        values($1,$2,$3,'Owner week','ready'),($4,$5,$6,'Other week','ready')`,
      [ownerRevision, ownerCollection, HASH, foreignRevision, foreignCollection, foreignHash]);
      await db.query(`insert into public.academic_files(revision_id,path,object_path,sha256,byte_size,mime_type)
        values($1,'owner.json',$2,$3,7,'application/json'),($4,'other.json',$5,$6,7,'application/json')`,
      [ownerRevision, `${ownerCollection}/${HASH}`, HASH, foreignRevision, `${foreignCollection}/${foreignHash}`, foreignHash]);
      await db.query("update public.academic_collections set current_revision_id=$2 where id=$1", [ownerCollection, ownerRevision]);
      await db.query("update public.academic_collections set current_revision_id=$2 where id=$1", [foreignCollection, foreignRevision]);
      await db.query(`insert into public.academic_enrollments(user_id,collection_id,revision_id,weeks)
        values($1,$2,$3,'{1}'),($4,$5,$6,'{1}')`,
      [B, ownerCollection, ownerRevision, A, foreignCollection, foreignRevision]);
      await db.query("insert into public.academic_source_identities(owner_id,source_sha256,collection_id) values($1,$2,$3)",
        [A, HASH, ownerCollection]);
      await db.query(`insert into public.academic_challenges(id,collection_id,revision_id,day,questions)
        values($1,$2,$3,'2026-10-15','[{"id":"q1"}]')`,
      [challenge, ownerCollection, ownerRevision]);
      await db.query("insert into public.academic_challenge_participants(challenge_id,user_id,alias) values($1,$2,'Other learner')", [challenge, B]);
      await db.query(`insert into public.academic_challenge_attempts(user_id,question_key,challenge_id,event_id,answer_key,assisted,points)
        values($1,'q1',$2,'88888888-8888-4888-8888-888888888888','A',false,1)`, [B, challenge]);
      await db.query("insert into storage.objects(bucket_id,name,metadata) values('academic-content',$1,'{}'),('academic-content',$2,'{}')",
        [`${ownerCollection}/${HASH}`, `${foreignCollection}/${foreignHash}`]);

      // The service deletes and verifies only the owner's immutable prefix
      // before Auth deletion. The database migration owns relational cleanup.
      await db.query("delete from storage.objects where bucket_id='academic-content' and name=$1", [`${ownerCollection}/${HASH}`]);
      await db.query("delete from auth.users where id=$1", [A]);
      await db.query("delete from auth.users where id=$1", [C]);

      expect(await scalar("select count(*)::int as n from public.academic_collections where id=$1", [ownerCollection])).toBe(0);
      expect(await scalar("select count(*)::int as n from public.academic_revisions where id=$1", [ownerRevision])).toBe(0);
      expect(await scalar("select count(*)::int as n from public.academic_files where revision_id=$1", [ownerRevision])).toBe(0);
      expect(await scalar("select count(*)::int as n from public.academic_enrollments")).toBe(0);
      expect(await scalar("select count(*)::int as n from public.academic_challenges where id=$1", [challenge])).toBe(0);
      expect(await scalar("select count(*)::int as n from public.academic_challenge_participants where challenge_id=$1", [challenge])).toBe(0);
      expect(await scalar("select count(*)::int as n from public.academic_challenge_attempts where challenge_id=$1", [challenge])).toBe(0);
      expect(await scalar("select count(*)::int as n from public.academic_source_identities where owner_id=$1", [A])).toBe(0);
      expect(await scalar("select count(*)::int as n from auth.users where id=$1", [C])).toBe(0);

      expect(await scalar("select count(*)::int as n from public.academic_collections where id=$1", [foreignCollection])).toBe(1);
      expect(await scalar("select count(*)::int as n from public.academic_revisions where id=$1", [foreignRevision])).toBe(1);
      expect(await scalar("select count(*)::int as n from public.academic_files where revision_id=$1", [foreignRevision])).toBe(1);
      expect((await db.query("select name from storage.objects where bucket_id='academic-content'")).rows)
        .toEqual([{ name: `${foreignCollection}/${foreignHash}` }]);
    } finally { await db.close(); }
  }, 60_000);

  it("blocks owner uploads and manifests throughout deletion cleanup and reconciliation", async () => {
    const db = await supabaseLikeDatabase({ rlsAutoEnable: false });
    const collection = "33333333-3333-4333-8333-333333333333";
    const revision = "44444444-4444-4444-8444-444444444444";
    const request = "55555555-5555-4555-8555-555555555555";
    const secondHash = "b".repeat(64);
    const shareSnapshot = JSON.stringify({
      shareFormatVersion: 1,
      title: "Deletion barrier",
      questions: [{ stem: "Q" }],
      createdAt: "2026-10-16T00:00:00Z",
    });
    const save = (user: string, base: number, hash: string) => as(db, "authenticated", user,
      "select public.push_workspace_revision($1,34,$2,$3::jsonb,gen_random_uuid(),gen_random_uuid(),'automatic') as result",
      [base, hash, JSON.stringify({ value: hash })]);
    const upload = (user: string, bucket: string, hash: string) => as(db, "authenticated", user,
      "insert into storage.objects(bucket_id,name,metadata) values($1,$2,'{\"size\":7}')",
      [bucket, `${user}/${hash}`]);
    try {
      const { rows: barrierPolicies } = await db.query<{ policyname: string; cmd: string; qual: string | null; with_check: string | null }>(`
        select policyname,cmd,qual,with_check from pg_policies
        where schemaname='storage' and tablename='objects'
          and policyname in ('account_deletion_storage_write_barrier','account_deletion_storage_update_barrier')
        order by policyname`);
      expect(barrierPolicies.map(policy => [policy.policyname, policy.cmd])).toEqual([
        ["account_deletion_storage_update_barrier", "UPDATE"],
        ["account_deletion_storage_write_barrier", "INSERT"],
      ]);
      expect(barrierPolicies.every(policy =>
        `${policy.qual ?? ""} ${policy.with_check ?? ""}`.includes("axom_account_accepts_cloud_writes"))).toBe(true);

      await db.query("insert into auth.users(id,email) values ($1,'a@x.test'),($2,'b@x.test')", [A, B]);
      await db.query(`insert into public.academic_collections(id,owner_id,title,module,term)
        values($1,$2,'Owner bank','OWNER','Term 1')`, [collection, A]);
      await db.query(`insert into public.academic_revisions(id,collection_id,content_hash,template_text,status)
        values($1,$2,$3,'Owner week','uploading')`, [revision, collection, HASH]);
      await db.query(`insert into public.academic_files(revision_id,path,object_path,sha256,byte_size,mime_type)
        values($1,'bank.json',$2,$3,7,'application/json')`, [revision, `${collection}/${HASH}`, HASH]);
      expect((await save(A, 0, HASH)).rows[0].result).toMatchObject({ status: "accepted" });
      expect((await save(B, 0, HASH)).rows[0].result).toMatchObject({ status: "accepted" });
      const existingShare = (await as(db, "authenticated", A,
        "select public.create_question_set_share('existing', $1::jsonb) as result", [shareSnapshot])).rows[0].result;

      await db.query(`insert into public.privacy_requests(id,user_id,kind,status,failure_code)
        values($1,$2,'deletion','processing','deletion-preflight')`, [request, A]);
      for (const bucket of ["workspace-media", "workspace-content", "workspace-originals"]) {
        await expect(upload(A, bucket, HASH)).rejects.toMatchObject({ code: "42501" });
      }
      await expect(as(db, "authenticated", A,
        "insert into storage.objects(bucket_id,name,metadata) values('academic-content',$1,'{\"size\":7}')",
        [`${collection}/${HASH}`])).rejects.toMatchObject({ code: "42501" });
      await expect(save(A, 1, secondHash)).rejects.toMatchObject({ code: "PT409" });
      await expect(as(db, "authenticated", A,
        "select public.create_question_set_share('existing', $1::jsonb)", [shareSnapshot]))
        .rejects.toMatchObject({ code: "PT409" });
      await expect(as(db, "authenticated", A,
        "select public.create_question_set_share('new', $1::jsonb)", [shareSnapshot]))
        .rejects.toMatchObject({ code: "PT409" });
      await expect(upload(B, "workspace-media", HASH)).resolves.toBeDefined();
      await expect(as(db, "authenticated", B,
        "select public.create_question_set_share('other-owner', $1::jsonb)", [shareSnapshot]))
        .resolves.toBeDefined();

      await db.query("update public.privacy_requests set status='failed',failure_code='deletion-preflight-failed' where id=$1", [request]);
      await expect(upload(A, "workspace-media", HASH)).resolves.toBeDefined();
      expect((await save(A, 1, secondHash)).rows[0].result).toMatchObject({ status: "accepted" });
      expect((await as(db, "authenticated", A,
        "select public.create_question_set_share('existing', $1::jsonb) as result", [shareSnapshot])).rows[0].result)
        .toMatchObject({ id: (existingShare as { id: string }).id, idempotent: true });

      await db.query("update public.privacy_requests set failure_code='deletion-reconciliation-required' where id=$1", [request]);
      await expect(upload(A, "workspace-content", secondHash)).rejects.toMatchObject({ code: "42501" });
      await expect(save(A, 2, "c".repeat(64))).rejects.toMatchObject({ code: "PT409" });
      await expect(as(db, "authenticated", A,
        "select public.create_question_set_share('existing', $1::jsonb)", [shareSnapshot]))
        .rejects.toMatchObject({ code: "PT409" });
    } finally { await db.close(); }
  }, 60_000);

  it("serializes export and deletion and revokes bearer shares at the irreversible boundary", async () => {
    const db = await supabaseLikeDatabase({ rlsAutoEnable: false });
    const exportRequest = "33333333-3333-4333-8333-333333333333";
    const deletionRequest = "44444444-4444-4444-8444-444444444444";
    const otherShareOwner = "22222222-2222-4222-8222-222222222222";
    const collection = "55555555-5555-4555-8555-555555555555";
    const revision = "66666666-6666-4666-8666-666666666666";
    const shareSnapshot = JSON.stringify({
      shareFormatVersion: 1,
      title: "Deletion boundary",
      questions: [{ stem: "Q" }],
      createdAt: "2026-10-16T00:00:00Z",
    });
    try {
      await db.query("insert into auth.users(id,email) values ($1,'a@x.test'),($2,'b@x.test')", [A, otherShareOwner]);
      await db.query(`insert into public.academic_collections
        (id,owner_id,title,module,term,visibility,review_status)
        values($1,$2,'Owner shared bank','OWNER','Term 1','shared','approved')`, [collection, A]);
      await db.query(`insert into public.academic_revisions
        (id,collection_id,content_hash,template_text,status,approved_at)
        values($1,$2,$3,'Week 1','ready',now())`, [revision, collection, HASH]);
      await db.query("update public.academic_collections set current_revision_id=$2 where id=$1", [collection, revision]);
      const ownerShare = (await as(db, "authenticated", A,
        "select public.create_question_set_share('owner-set', $1::jsonb) as result", [shareSnapshot])).rows[0].result as { share_token: string };
      const otherShare = (await as(db, "authenticated", otherShareOwner,
        "select public.create_question_set_share('other-set', $1::jsonb) as result", [shareSnapshot])).rows[0].result as { share_token: string };
      await db.query(`insert into public.privacy_requests(id,user_id,kind,status,scheduled_for)
        values($1,$3,'export','requested',null),($2,$3,'deletion','scheduled','2000-01-01')`,
      [exportRequest, deletionRequest, A]);

      // If export admission won the owner lock, due deletion must not overtake
      // that accepted export before a worker has had a chance to claim it.
      expect((await as(db, "service_role", null,
        "select public.claim_privacy_request($1,'2026-10-16T01:00:00Z') as claimed", [deletionRequest])).rows)
        .toEqual([{ claimed: false }]);
      expect((await as(db, "service_role", null,
        "select public.claim_privacy_request($1,'2026-10-16T01:00:00Z') as claimed", [exportRequest])).rows)
        .toEqual([{ claimed: true }]);
      expect((await as(db, "service_role", null,
        "select public.claim_privacy_request($1,'2026-10-16T01:00:00Z') as claimed", [deletionRequest])).rows)
        .toEqual([{ claimed: false }]);
      expect((await as(db, "service_role", null,
        "select public.finalize_privacy_export($1,$2,now() + interval '7 days') as finalized",
        [exportRequest, `${A}/${exportRequest}.json`])).rows).toEqual([{ finalized: true }]);
      expect((await as(db, "service_role", null,
        "select public.claim_privacy_request($1,'2026-10-16T01:00:00Z') as claimed", [deletionRequest])).rows)
        .toEqual([{ claimed: true }]);

      // Preflight is still reversible, so an existing share remains usable.
      expect((await as(db, "anon", null,
        "select title from public.resolve_question_set_share($1)", [ownerShare.share_token])).rows)
        .toEqual([{ title: "Deletion boundary" }]);
      expect((await as(db, "authenticated", otherShareOwner,
        "select title from public.academic_collections where id=$1", [collection])).rows)
        .toEqual([{ title: "Owner shared bank" }]);
      expect((await as(db, "service_role", null,
        "select public.begin_account_deletion_cleanup($1) as started", [deletionRequest])).rows)
        .toEqual([{ started: true }]);
      // The state marker, share revocation and academic withdrawal are one
      // database transaction. Visibility metadata is retained as evidence.
      expect((await db.query("select failure_code from public.privacy_requests where id=$1", [deletionRequest])).rows)
        .toEqual([{ failure_code: "deletion-cleanup-started" }]);
      expect((await db.query("select withdrawn,visibility from public.academic_collections where id=$1", [collection])).rows)
        .toEqual([{ withdrawn: true, visibility: "shared" }]);
      expect((await as(db, "anon", null,
        "select title from public.resolve_question_set_share($1)", [ownerShare.share_token])).rows).toEqual([]);
      expect((await as(db, "authenticated", otherShareOwner,
        "select title from public.academic_collections where id=$1", [collection])).rows).toEqual([]);
      expect((await as(db, "anon", null,
        "select title from public.resolve_question_set_share($1)", [otherShare.share_token])).rows)
        .toEqual([{ title: "Deletion boundary" }]);

      await db.query("update public.privacy_requests set status='failed',failure_code='deletion-reconciliation-required' where id=$1", [deletionRequest]);
      await expect(db.query(`insert into public.privacy_requests(user_id,kind,status,scheduled_for)
        values($1,'deletion','scheduled',now()+interval '7 days')`, [A])).rejects.toMatchObject({ code: "23505" });
      await expect(as(db, "service_role", null,
        "insert into public.privacy_requests(user_id,kind,status) values($1,'export','requested')", [A]))
        .rejects.toMatchObject({ code: "PT409" });
      expect((await db.query("select id from public.privacy_requests where user_id=$1 and kind='export' and status='requested'", [A])).rows)
        .toEqual([]);

      const functions = await db.query<{ name: string; volatility: string; definition: string }>(`
        select p.proname as name, p.provolatile as volatility,
               pg_get_functiondef(p.oid) as definition
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public'
          and p.proname in ('axom_account_accepts_cloud_writes','create_question_set_share','begin_account_deletion_cleanup')`);
      const gate = functions.rows.find(row => row.name === "axom_account_accepts_cloud_writes")!;
      const publisher = functions.rows.find(row => row.name === "create_question_set_share")!;
      const cleanup = functions.rows.find(row => row.name === "begin_account_deletion_cleanup")!;
      expect(gate.volatility).toBe("v");
      expect(publisher.definition.indexOf("pg_advisory_xact_lock"))
        .toBeLessThan(publisher.definition.indexOf("axom_account_accepts_cloud_writes"));
      expect(cleanup.definition).toContain("pg_advisory_xact_lock");
    } finally { await db.close(); }
  }, 60_000);

  it("admits exports only before deletion processing or after a proven reversible failure", async () => {
    const db = await supabaseLikeDatabase({ rlsAutoEnable: false });
    const deletionRequest = "44444444-4444-4444-8444-444444444444";
    try {
      await db.query("insert into auth.users(id,email) values ($1,'a@x.test'),($2,'b@x.test')", [A, B]);
      await db.query(`insert into public.privacy_requests(id,user_id,kind,status,scheduled_for)
        values($1,$2,'deletion','scheduled',now()+interval '7 days')`, [deletionRequest, A]);
      for (const [status, failureCode] of [
        ["processing", "deletion-preflight"],
        ["processing", "deletion-cleanup-started"],
        ["failed", "deletion-reconciliation-required"],
        ["failed", "unknown-legacy-failure"],
        ["failed", null],
      ]) {
        await db.query("update public.privacy_requests set status=$2,failure_code=$3 where id=$1", [deletionRequest, status, failureCode]);
        await expect(as(db, "service_role", null,
          "insert into public.privacy_requests(user_id,kind,status) values($1,'export','requested')", [A]))
          .rejects.toMatchObject({ code: "PT409" });
      }
      expect((await db.query("select id from public.privacy_requests where user_id=$1 and kind='export'", [A])).rows).toEqual([]);
      // Another account is not blocked by this owner's reconciliation state.
      await as(db, "service_role", null,
        "insert into public.privacy_requests(user_id,kind,status) values($1,'export','requested')", [B]);

      for (const [status, failureCode] of [
        ["scheduled", null],
        ["failed", "deletion-preflight-failed"],
        ["cancelled", null],
        ["completed", null],
      ]) {
        await db.query("update public.privacy_requests set status=$2,failure_code=$3 where id=$1", [deletionRequest, status, failureCode]);
        await as(db, "service_role", null,
          "insert into public.privacy_requests(user_id,kind,status) values($1,'export','requested')", [A]);
        await db.query("update public.privacy_requests set status='completed' where user_id=$1 and kind='export'", [A]);
      }
      const definition = (await db.query<{ definition: string }>(
        "select pg_get_functiondef('public.guard_privacy_export_admission()'::regprocedure) as definition")).rows[0].definition;
      expect(definition.indexOf("pg_advisory_xact_lock")).toBeLessThan(definition.indexOf("from public.privacy_requests"));
      expect((await db.query("select count(*)::integer as count from public.privacy_requests where user_id=$1 and kind='export'", [A])).rows)
        .toEqual([{ count: 4 }]);
    } finally { await db.close(); }
  }, 60_000);

  it("classifies a lost cleanup response from committed database state", async () => {
    const db = await supabaseLikeDatabase({ rlsAutoEnable: false });
    const destructive = "33333333-3333-4333-8333-333333333333";
    const reversible = "44444444-4444-4444-8444-444444444444";
    try {
      await db.query("insert into auth.users(id,email) values ($1,'a@x.test'),($2,'b@x.test')", [A, B]);
      await db.query(`insert into public.privacy_requests(id,user_id,kind,status,failure_code)
        values($1,$3,'deletion','processing','deletion-preflight'),
              ($2,$4,'deletion','processing','deletion-preflight')`, [destructive, reversible, A, B]);
      expect((await as(db, "service_role", null,
        "select public.begin_account_deletion_cleanup($1) as started", [destructive])).rows)
        .toEqual([{ started: true }]);

      expect((await as(db, "service_role", null,
        "select public.record_account_deletion_failure($1,false) as code", [destructive])).rows)
        .toEqual([{ code: "deletion-reconciliation-required" }]);
      expect((await as(db, "service_role", null,
        "select public.record_account_deletion_failure($1,false) as code", [reversible])).rows)
        .toEqual([{ code: "deletion-preflight-failed" }]);
      expect((await db.query("select id,status,failure_code from public.privacy_requests order by id")).rows)
        .toEqual([
          { id: destructive, status: "failed", failure_code: "deletion-reconciliation-required" },
          { id: reversible, status: "failed", failure_code: "deletion-preflight-failed" },
        ]);
    } finally { await db.close(); }
  }, 60_000);

  it("quarantines stale external work instead of making it eligible for automatic replay", async () => {
    const db = await supabaseLikeDatabase({ rlsAutoEnable: false });
    const request = "33333333-3333-4333-8333-333333333333";
    try {
      await db.query("insert into auth.users(id,email) values ($1,'a@x.test')", [A]);
      await db.query(`insert into public.privacy_requests(id,user_id,kind,status,processing_at)
        values($1,$2,'export','processing','2000-01-01')`, [request, A]);
      expect((await as(db, "service_role", null,
        "select public.quarantine_stale_privacy_requests('2026-10-16') as quarantined")).rows)
        .toEqual([{ quarantined: 1 }]);
      expect((await db.query("select status,failure_code from public.privacy_requests where id=$1", [request])).rows)
        .toEqual([{ status: "failed", failure_code: "export-reconciliation-required" }]);
      await expect(db.query("insert into public.privacy_requests(user_id,kind,status) values($1,'export','requested')", [A]))
        .rejects.toMatchObject({ code: "23505" });
    } finally { await db.close(); }
  }, 60_000);

  it("upgrades legacy duplicate privacy candidates without dropping their evidence", async () => {
    const db = await supabaseLikeDatabase({ rlsAutoEnable: false, stopBefore: privacyBarrierMigration });
    const scheduledDeletion = "33333333-3333-4333-8333-333333333333";
    const failedDeletion = "44444444-4444-4444-8444-444444444444";
    const requestedExport = "55555555-5555-4555-8555-555555555555";
    const failedExport = "66666666-6666-4666-8666-666666666666";
    try {
      await db.query("insert into auth.users(id,email) values ($1,'a@x.test'),($2,'b@x.test')", [A, B]);
      await db.query(`insert into public.privacy_requests
        (id,user_id,kind,status,failure_code,scheduled_for,completion_payload,created_at)
        values
          ($1,$5,'deletion','scheduled',null,'2026-10-20','{"scheduled":true}','2026-10-15'),
          ($2,$5,'deletion','failed','deletion-reconciliation-required',null,'{"failed":true}','2026-10-14'),
          ($3,$6,'export','requested',null,null,'{"requested":true}','2026-10-15'),
          ($4,$6,'export','failed','export-reconciliation-required',null,'{"failed":true}','2026-10-14')`,
      [scheduledDeletion, failedDeletion, requestedExport, failedExport, A, B]);

      await db.exec(`begin;${readFileSync(migrationsDir + privacyBarrierMigration, "utf8")}commit;`);

      const rows = await db.query<{
        id: string;
        status: string;
        failure_code: string | null;
        completion_payload: Record<string, unknown> | null;
      }>("select id,status,failure_code,completion_payload from public.privacy_requests order by id");
      expect(rows.rows.find(row => row.id === failedDeletion)).toMatchObject({
        status: "failed",
        failure_code: "deletion-reconciliation-required",
        completion_payload: { failed: true },
      });
      expect(rows.rows.find(row => row.id === failedExport)).toMatchObject({
        status: "failed",
        failure_code: "export-reconciliation-required",
        completion_payload: { failed: true },
      });
      expect(rows.rows.find(row => row.id === scheduledDeletion)).toMatchObject({
        status: "cancelled",
        failure_code: "legacy-single-flight-duplicate",
        completion_payload: {
          _axom_privacy_migration: {
            migration: "20261016011812",
            reason: "legacy-single-flight-duplicate",
            canonical_request_id: failedDeletion,
            original_status: "scheduled",
            original_failure_code: null,
          },
          prior_completion_payload: { scheduled: true },
        },
      });
      expect(rows.rows.find(row => row.id === requestedExport)).toMatchObject({
        status: "cancelled",
        failure_code: "legacy-single-flight-duplicate",
        completion_payload: {
          _axom_privacy_migration: {
            canonical_request_id: failedExport,
            original_status: "requested",
          },
          prior_completion_payload: { requested: true },
        },
      });
      await expect(db.query(`insert into public.privacy_requests(user_id,kind,status)
        values($1,'export','requested')`, [B])).rejects.toMatchObject({ code: "23505" });
      await expect(db.query(`insert into public.privacy_requests(user_id,kind,status,scheduled_for)
        values($1,'deletion','scheduled',now()+interval '7 days')`, [A])).rejects.toMatchObject({ code: "23505" });
    } finally { await db.close(); }
  }, 60_000);

  it("aborts legacy normalization when duplicate candidates include active external work", async () => {
    const db = await supabaseLikeDatabase({ rlsAutoEnable: false, stopBefore: privacyBarrierMigration });
    const processing = "33333333-3333-4333-8333-333333333333";
    const failed = "44444444-4444-4444-8444-444444444444";
    try {
      await db.query("insert into auth.users(id,email) values ($1,'a@x.test')", [A]);
      await db.query(`insert into public.privacy_requests(id,user_id,kind,status,failure_code,processing_at)
        values($1,$3,'deletion','processing','deletion-preflight',now()),
              ($2,$3,'deletion','failed','deletion-reconciliation-required',null)`, [processing, failed, A]);

      await expect(db.exec(`begin;${readFileSync(migrationsDir + privacyBarrierMigration, "utf8")}commit;`))
        .rejects.toThrow(/manual reconciliation of duplicate processing requests/i);
      await db.exec("rollback");

      expect((await db.query("select id,status,failure_code from public.privacy_requests order by id")).rows)
        .toEqual([
          { id: processing, status: "processing", failure_code: "deletion-preflight" },
          { id: failed, status: "failed", failure_code: "deletion-reconciliation-required" },
        ]);
    } finally { await db.close(); }
  }, 60_000);

  it("aborts privacy migration when export and deletion are both processing", async () => {
    const db = await supabaseLikeDatabase({ rlsAutoEnable: false, stopBefore: privacyBarrierMigration });
    const activeExport = "33333333-3333-4333-8333-333333333333";
    const activeDeletion = "44444444-4444-4444-8444-444444444444";
    try {
      await db.query("insert into auth.users(id,email) values ($1,'a@x.test')", [A]);
      await db.query(`insert into public.privacy_requests(id,user_id,kind,status,failure_code,processing_at)
        values($1,$3,'export','processing','export-pending',now()),
              ($2,$3,'deletion','processing','deletion-preflight',now())`, [activeExport, activeDeletion, A]);

      await expect(db.exec(`begin;${readFileSync(migrationsDir + privacyBarrierMigration, "utf8")}commit;`))
        .rejects.toThrow(/conflicting processing request kinds/i);
      await db.exec("rollback");

      expect((await db.query("select id,kind,status from public.privacy_requests order by id")).rows)
        .toEqual([
          { id: activeExport, kind: "export", status: "processing" },
          { id: activeDeletion, kind: "deletion", status: "processing" },
        ]);
    } finally { await db.close(); }
  }, 60_000);

  it("rejects stale authenticated claims after the Auth user is deleted", async () => {
    const db = await supabaseLikeDatabase({ rlsAutoEnable: false });
    const collection = "33333333-3333-4333-8333-333333333333";
    const revision = "44444444-4444-4444-8444-444444444444";
    const staleHash = "b".repeat(64);
    const paths = [
      ["workspace-media", `${A}/${HASH}`],
      ["workspace-content", `${A}/${HASH}`],
      ["workspace-originals", `${A}/${HASH}`],
      ["academic-content", `${collection}/${HASH}`],
    ] as const;
    const shareSnapshot = JSON.stringify({
      shareFormatVersion: 1,
      title: "Stale token",
      questions: [{ stem: "Q" }],
    });
    try {
      await db.query("insert into auth.users(id,email) values ($1,'a@x.test'),($2,'b@x.test')", [A, B]);
      await db.query(`insert into public.academic_collections(id,owner_id,title,module,term)
        values($1,$2,'Owner bank','OWNER','Term 1')`, [collection, A]);
      await db.query(`insert into public.academic_revisions(id,collection_id,content_hash,template_text,status)
        values($1,$2,$3,'Owner week','uploading')`, [revision, collection, HASH]);
      await db.query(`insert into public.academic_files(revision_id,path,object_path,sha256,byte_size,mime_type)
        values($1,'bank.json',$2,$3,7,'application/json')`, [revision, `${collection}/${HASH}`, HASH]);
      for (const [bucket, path] of paths) {
        await as(db, "authenticated", A,
          "insert into storage.objects(bucket_id,name,metadata) values($1,$2,'{\"size\":7}')", [bucket, path]);
      }
      await as(db, "authenticated", A,
        "select public.create_question_set_share('before-delete', $1::jsonb)", [shareSnapshot]);

      await db.query("delete from auth.users where id=$1", [A]);

      expect((await as(db, "authenticated", A,
        "select public.axom_account_accepts_cloud_writes() as allowed")).rows)
        .toEqual([{ allowed: false }]);
      for (const [bucket, path] of paths) {
        const stalePath = bucket === "academic-content" ? `${collection}/${staleHash}` : `${A}/${staleHash}`;
        await expect(as(db, "authenticated", A,
          "insert into storage.objects(bucket_id,name,metadata) values($1,$2,'{\"size\":7}')", [bucket, stalePath]))
          .rejects.toMatchObject({ code: "42501" });
        await expect(as(db, "authenticated", A, `insert into storage.objects(bucket_id,name,metadata)
          values($1,$2,'{"size":9}')
          on conflict(bucket_id,name) do update set metadata=excluded.metadata`, [bucket, path]))
          .rejects.toMatchObject({ code: "42501" });
      }
      await expect(as(db, "authenticated", A,
        "select public.create_question_set_share('after-delete', $1::jsonb)", [shareSnapshot]))
        .rejects.toMatchObject({ code: "PT409" });

      expect((await as(db, "authenticated", B,
        "select public.axom_account_accepts_cloud_writes() as allowed")).rows)
        .toEqual([{ allowed: true }]);
      await expect(as(db, "authenticated", B,
        "insert into storage.objects(bucket_id,name,metadata) values('workspace-media',$1,'{\"size\":7}')",
        [`${B}/${HASH}`])).resolves.toBeDefined();
      await expect(as(db, "authenticated", B,
        "select public.create_question_set_share('other-owner', $1::jsonb)", [shareSnapshot]))
        .resolves.toBeDefined();
    } finally { await db.close(); }
  }, 60_000);

  it.each([false, true])("apply cleanly and lock function ACLs (rls_auto_enable present: %s)", async (rlsAutoEnable) => {
    const db = await supabaseLikeDatabase({ rlsAutoEnable });
    for (const signature of PRIVILEGED) {
      expect(await canExecute(db, "anon", signature), `anon on ${signature}`).toBe(false);
      expect(await canExecute(db, "authenticated", signature), `authenticated on ${signature}`).toBe(true);
      expect(await canExecute(db, "service_role", signature), `service_role on ${signature}`).toBe(true);
    }
    for (const role of ["anon", "authenticated", "service_role"]) {
      expect(await canExecute(db, role,
        "axom_private.create_question_set_share_without_account_gate(text,jsonb)"),
      `${role} on internal share publisher`).toBe(false);
    }
    for (const signature of SERVICE_ONLY_PRIVACY) {
      expect(await canExecute(db, "anon", signature), `anon on ${signature}`).toBe(false);
      expect(await canExecute(db, "authenticated", signature), `authenticated on ${signature}`).toBe(false);
      expect(await canExecute(db, "service_role", signature), `service_role on ${signature}`).toBe(true);
    }
    expect(await canExecute(db, "anon", "public.revoke_question_set_share(uuid)")).toBe(false);
    expect(await canExecute(db, "authenticated", "public.revoke_question_set_share(uuid)")).toBe(true);
    expect(await canExecute(db, "anon", "public.resolve_question_set_share(text)")).toBe(true);
    expect((await db.query<{ ok: boolean }>(
      "select has_column_privilege('anon','public.question_set_shares','id','select') as ok",
    )).rows[0].ok).toBe(false);
    expect((await db.query<{ ok: boolean }>(
      "select has_column_privilege('authenticated','public.question_set_shares','id','select') as ok",
    )).rows[0].ok).toBe(true);
    // Read authorization is callable; publication is restricted to the operator role.
    for (const role of ["anon", "authenticated"]) {
      expect(await canExecute(db, role, "public.can_read_academic_release(uuid)")).toBe(true);
      expect(await canExecute(db, role, "public.publish_academic_release(uuid,integer,integer)")).toBe(false);
      expect(await canExecute(db, role, "public.guard_academic_catalog_mutation()")).toBe(false);
      expect(await canExecute(db, role, "public.guard_academic_release_mutation()")).toBe(false);
      expect(await canExecute(db, role, "public.handle_new_account()")).toBe(false);
      if (rlsAutoEnable) expect(await canExecute(db, role, "public.rls_auto_enable()")).toBe(false);
    }
    expect(await canExecute(db, "service_role", "public.publish_academic_release(uuid,integer,integer)")).toBe(true);
    await db.close();
  }, 30_000);

  it("keeps private tables under RLS and fixes search_path on SECURITY DEFINER functions", async () => {
    const db = await supabaseLikeDatabase({ rlsAutoEnable: false });
    const { rows: tables } = await db.query<{ relname: string; relrowsecurity: boolean }>(
      "select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relname = any($1::text[])", [PRIVATE_TABLES]);
    expect(Object.fromEntries(tables.map(({ relname, relrowsecurity }) => [relname, relrowsecurity]))).toEqual(Object.fromEntries(PRIVATE_TABLES.map((name) => [name, true])));
    const { rows: functions } = await db.query<{ signature: string; proconfig: string[] | null }>(
      "select p.oid::regprocedure::text as signature, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef");
    expect(functions.length).toBeGreaterThan(0);
    for (const { signature, proconfig } of functions) {
      // New functions qualify every relation and use an empty path; existing
      // functions explicitly put pg_temp last so caller tables cannot shadow.
      expect(["search_path=pg_catalog, public, pg_temp", 'search_path=""'], `${signature} search_path`)
        .toContain(proconfig?.find(value => value.startsWith("search_path=")));
      if (signature.startsWith("push_workspace_revision(")) {
        expect(proconfig).toContain("statement_timeout=60s");
      } else {
        expect(proconfig?.some((setting) => setting.startsWith("statement_timeout="))).toBe(false);
      }
    }
    await db.close();
  }, 30_000);

  it("does not let caller temporary tables shadow SECURITY DEFINER data", async () => {
    const db = await supabaseLikeDatabase({ rlsAutoEnable: false });
    await db.query("insert into auth.users(id, email) values ($1, 'a@x.com')", [A]);
    await db.query("insert into public.question_set_shares (owner_user_id, source_question_set_id, share_token, title, question_count, snapshot_payload) values ($1, 'set-1', 'real-token', 'real share', 0, '{\"questions\":[]}'::jsonb)", [A]);
    await as(db, "anon", null, `create temporary table question_set_shares (
      id uuid, owner_user_id uuid, source_question_set_id text, share_token text,
      share_format_version integer, title text, question_count integer, snapshot_payload jsonb,
      created_at timestamptz, revoked_at timestamptz, expires_at timestamptz
    )`);
    await as(db, "anon", null, "insert into pg_temp.question_set_shares (share_token, title, question_count, share_format_version, snapshot_payload) values ('fake-token', 'shadow row', 0, 1, '{\"questions\":[]}'::jsonb)");
    const real = await as(db, "anon", null, "select title from public.resolve_question_set_share('real-token')");
    const fake = await as(db, "anon", null, "select title from public.resolve_question_set_share('fake-token')");
    expect(real.rows).toEqual([{ title: "real share" }]); expect(fake.rows).toEqual([]);
    await as(db, "anon", null, "create temporary table academic_catalog_releases(id uuid,status text,audience text)");
    await as(db, "anon", null, "insert into pg_temp.academic_catalog_releases values ($1,'published','public')", [A]);
    expect((await as(db, "anon", null, "select public.can_read_academic_release($1) as allowed", [A])).rows).toEqual([{ allowed: false }]);
    await db.close();
  }, 30_000);

  it("keeps revisions, devices and shares private and deletion scoped to the caller", async () => {
    const db = await supabaseLikeDatabase({ rlsAutoEnable: false });
    await db.query("insert into auth.users(id, email, raw_user_meta_data) values ($1,'a@x.com','{\"display_name\":\"Ada\"}'), ($2,'b@x.com','{}')", [A, B]);
    const { rows: profiles } = await db.query<{ display_name: string }>("select display_name from public.account_profiles order by display_name");
    expect(profiles.map((row) => row.display_name)).toEqual(["Ada", "b"]);
    expect(Number((await as(db, "service_role", null, "select count(*)::int as n from public.account_profiles")).rows[0].n)).toBe(2);
    const push = async (sub: string, base: number, key: string) => (await as(db, "authenticated", sub,
      "select public.push_workspace_revision($1,33,$2,'{\"ok\":true}'::jsonb,'33333333-3333-4333-8333-333333333333'::uuid,$3::uuid,'automatic') as r", [base, HASH, key])).rows[0].r as { status: string; revision?: number; server_revision?: number; idempotent?: boolean };
    expect(await push(A, 0, "44444444-4444-4444-8444-444444444444")).toMatchObject({ status: "accepted", revision: 1 });
    expect(await push(A, 0, "44444444-4444-4444-8444-444444444444")).toMatchObject({ status: "accepted", revision: 1, idempotent: true });
    expect(await push(A, 0, "55555555-5555-4555-8555-555555555555")).toMatchObject({ status: "conflict", server_revision: 1 });
    await expect(as(db, "authenticated", A, "update public.workspaces set current_revision = 999 where user_id = $1", [A])).rejects.toThrow(/permission denied/);
    await expect(as(db, "authenticated", B, "insert into public.account_profiles(user_id, display_name) values ($1, 'Forged') on conflict(user_id) do update set display_name = excluded.display_name", [A])).rejects.toThrow(/row-level security|violates/);
    await expect(as(db, "authenticated", A, "update public.account_profiles set user_id = $1 where user_id = $2", [B, A])).rejects.toThrow(/row-level security|violates/);
    await expect(as(db, "anon", null, "select public.push_workspace_revision(0,33,$1,'{}'::jsonb,gen_random_uuid(),gen_random_uuid(),'automatic')", [HASH])).rejects.toThrow(/permission denied/);
    const count = async (sub: string, table: string) => Number((await as(db, "authenticated", sub, `select count(*)::int as n from public.${table}`)).rows[0].n);
    expect(await count(A, "workspace_revisions")).toBe(2); expect(await count(B, "workspace_revisions")).toBe(0);
    expect(await count(B, "workspaces")).toBe(0); expect(await count(B, "account_profiles")).toBe(1);
    await as(db, "authenticated", B, "delete from public.account_profiles where user_id = $1", [A]);
    expect(await count(A, "account_profiles")).toBe(1); expect(await count(B, "workspace_revisions")).toBe(0);
    await expect(as(db, "authenticated", B, "insert into public.workspace_revisions(workspace_id,user_id,revision,base_revision,schema_version,content_hash,snapshot_payload,device_id,idempotency_key) values (gen_random_uuid(),$1,1,0,33,$2,'{}',gen_random_uuid(),gen_random_uuid())", [B, HASH])).rejects.toThrow(/row-level security|violates/);
    await as(db, "authenticated", A, "select public.touch_account_device('77777777-7777-4777-8777-777777777777'::uuid,'Chrome on Mac','web',2)");
    await as(db, "authenticated", A, "select public.touch_account_device('77777777-7777-4777-8777-777777777777'::uuid,'Chrome on Mac','web',3)");
    expect(await count(A, "account_devices")).toBe(1); expect(await count(B, "account_devices")).toBe(0);
    const shareSnapshot = { shareFormatVersion: 1, title: "Cardio", questions: [{ stem: "Q" }], createdAt: "2026-10-15T12:00:00Z" };
    const share = (await as(db, "authenticated", A, "select public.create_question_set_share('set-1', $1::jsonb) as r", [JSON.stringify(shareSnapshot)])).rows[0].r as {
      id: string; share_token: string; expires_at: string; idempotent: boolean;
    };
    expect(share.share_token).toMatch(/^[0-9a-f]{48}$/);
    expect(share.idempotent).toBe(false);
    expect(Date.parse(share.expires_at)).toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1_000);
    expect(Date.parse(share.expires_at)).toBeLessThanOrEqual(Date.now() + 7 * 24 * 60 * 60 * 1_000 + 5_000);
    const retry = (await as(db, "authenticated", A,
      "select public.create_question_set_share('set-1', $1::jsonb) as r",
      [JSON.stringify({ ...shareSnapshot, createdAt: "2026-10-15T12:01:00Z" })])).rows[0].r as {
      id: string; share_token: string; idempotent: boolean;
    };
    expect(retry).toMatchObject({ id: share.id, share_token: share.share_token, idempotent: true });
    const resolved = await as(db, "anon", null, "select title from public.resolve_question_set_share($1)", [share.share_token]); expect(resolved.rows).toEqual([{ title: "Cardio" }]);
    await expect(as(db, "anon", null, "select count(*)::int as n from public.question_set_shares"))
      .rejects.toThrow(/permission denied/);
    await as(db, "authenticated", B, "select public.create_question_set_share('set-b', $1::jsonb)", [JSON.stringify({ ...shareSnapshot, title: "B only" })]);
    expect((await as(db, "authenticated", A,
      "select source_question_set_id from public.question_set_shares order by source_question_set_id")).rows)
      .toEqual([{ source_question_set_id: "set-1" }]);
    expect((await as(db, "authenticated", B,
      "select source_question_set_id from public.question_set_shares order by source_question_set_id")).rows)
      .toEqual([{ source_question_set_id: "set-b" }]);
    await expect(as(db, "authenticated", A, "update public.question_set_shares set snapshot_payload='{}'::jsonb")).rejects.toThrow(/permission denied/);
    await as(db, "authenticated", A, "select public.delete_my_cloud_data()");
    const { rows: left } = await db.query<{ n: number }>(`select
      (select count(*) from public.workspace_revisions where user_id=$1)::int + (select count(*) from public.workspaces where user_id=$1)::int +
      (select count(*) from public.account_devices where user_id=$1)::int + (select count(*) from public.question_set_shares where owner_user_id=$1)::int as n`, [A]);
    expect(left[0].n).toBe(0);
    expect((await db.query<{ n: number }>("select count(*)::int as n from public.account_profiles where user_id=$1", [A])).rows[0].n).toBe(1);
    await db.close();
  }, 30_000);

  it("meters Cloud AI per user and per day, and stops at the limit", async () => {
    const db = await supabaseLikeDatabase({ rlsAutoEnable: false });
    await db.exec(`insert into auth.users (id, email) values ('${A}', 'a@x.test'), ('${B}', 'b@x.test');`);
    const call = async (sub: string) => (await as(db, "authenticated", sub, "select public.consume_ai_quota() as left")).rows[0].left;
    expect(await call(A)).toBe(59);
    for (let request = 1; request < 60; request += 1) await call(A);
    expect(await call(A)).toBe(-1); expect(await call(B)).toBe(59);
    const own = await as(db, "authenticated", A, "select user_id, requests from public.ai_usage"); expect(own.rows).toEqual([{ user_id: A, requests: 60 }]);
    await expect(as(db, "authenticated", A, "update public.ai_usage set requests = 0")).rejects.toThrow();
    await expect(as(db, "authenticated", A, "select public.consume_ai_quota(500)")).rejects.toThrow();
    await expect(as(db, "anon", null, "select public.consume_ai_quota()")).rejects.toThrow();
    await db.close();
  }, 30_000);

  it("bounds per-account conflict and share snapshot storage", async () => {
    const db = await supabaseLikeDatabase({ rlsAutoEnable: false });
    await db.query("insert into auth.users(id, email) values ($1, 'a@x.com')", [A]);
    const push = async (base: number, key: string, reason = "automatic") => as(db, "authenticated", A,
      "select public.push_workspace_revision($1,33,$2,'{\"ok\":true}'::jsonb,gen_random_uuid(),$3::uuid,$4) as r", [base, HASH, key, reason]);
    await push(0, "44444444-4444-4444-8444-444444444444");
    for (let index = 0; index < 20; index += 1) await push(0, `55555555-5555-4555-8555-${String(index).padStart(12, "0")}`);
    expect((await push(0, "66666666-6666-4666-8666-666666666666")).rows[0].r).toEqual({ status: "conflict", server_revision: 1, preserved_revision_id: null, preserved: false });
    expect(Number((await db.query<{ n: number }>("select count(*)::int as n from public.workspace_revisions where user_id=$1 and reason='conflict'", [A])).rows[0].n)).toBe(20);
    expect(Number((await db.query<{ n: number }>("select count(*)::int as n from public.sync_conflicts where user_id=$1 and resolved_at is null", [A])).rows[0].n)).toBe(20);
    const resolution = await push(1, "77777777-7777-4777-8777-777777777777", "manual"); expect(resolution.rows[0].r).toMatchObject({ status: "accepted", revision: 2 });
    expect(Number((await db.query<{ n: number }>("select count(*)::int as n from public.sync_conflicts where user_id=$1 and resolved_at is null", [A])).rows[0].n)).toBe(0);
    expect(Number((await db.query<{ n: number }>("select count(*)::int as n from public.workspace_revisions where user_id=$1 and reason='conflict'", [A])).rows[0].n)).toBe(0);
    await expect(push(0, "88888888-8888-4888-8888-888888888888")).resolves.toBeDefined();
    const snapshot = JSON.stringify({ shareFormatVersion: 1, title: "Bounded", questions: [{ stem: "Q" }] });
    await expect(as(db, "authenticated", A, "select public.create_question_set_share('missing-version', '{\"questions\":[]}'::jsonb)")).rejects.toThrow(/invalid share format/);
    await expect(as(db, "authenticated", A, "select public.create_question_set_share('null-version', '{\"shareFormatVersion\":null,\"questions\":[]}'::jsonb)")).rejects.toThrow(/invalid share format/);
    expect(Number((await db.query<{ n: number }>("select count(*)::int as n from public.question_set_shares where owner_user_id=$1", [A])).rows[0].n)).toBe(0);
    let firstShareId = "";
    for (let index = 0; index < 20; index += 1) {
      const result = await as(db, "authenticated", A, "select public.create_question_set_share($1, $2::jsonb) as share", [`set-${index}`, snapshot]);
      if (index === 0) firstShareId = String((result.rows[0].share as { id: string }).id);
    }
    await expect(as(db, "authenticated", A, "select public.create_question_set_share('overflow', $1::jsonb)", [snapshot])).rejects.toThrow(/storage limit/);
    await as(db, "authenticated", A, "select public.revoke_question_set_share($1::uuid)", [firstShareId]);
    expect(Number((await db.query<{ n: number }>("select count(*)::int as n from public.question_set_shares where owner_user_id=$1 and revoked_at is null", [A])).rows[0].n)).toBe(19);
    expect((await db.query<{ snapshot_payload: unknown }>("select snapshot_payload from public.question_set_shares where id=$1", [firstShareId])).rows[0].snapshot_payload).toEqual({ shareFormatVersion: 1, title: "Revoked", questions: [] });
    await as(db, "authenticated", A, "select public.create_question_set_share('replacement', $1::jsonb)", [snapshot]);
    expect(Number((await db.query<{ n: number }>("select count(*)::int as n from public.question_set_shares where owner_user_id=$1 and revoked_at is null", [A])).rows[0].n)).toBe(20);
    await db.close();
  }, 30_000);

  it("prunes canonical history to the storage budget instead of refusing new revisions", async () => {
    const db = await supabaseLikeDatabase({ rlsAutoEnable: false });
    await db.query("insert into auth.users(id, email) values ($1, 'a@x.com')", [A]);
    const snapshot = JSON.stringify({ blob: randomBytes(6_750_000).toString("base64") });
    const kept = async () => (await db.query<{ revision: number }>("select revision::int as revision from public.workspace_revisions where user_id=$1 and reason<>'conflict' order by revision", [A])).rows.map((row) => row.revision);
    const stored = async () => Number((await db.query<{ bytes: string }>("select coalesce(sum(pg_column_size(snapshot_payload)),0)::bigint as bytes from public.workspace_revisions where user_id=$1 and reason<>'conflict'", [A])).rows[0].bytes);
    const push = async (base: number) => (await as(db, "authenticated", A,
      "select public.push_workspace_revision($1,34,$2,$3::jsonb,gen_random_uuid(),gen_random_uuid(),'automatic') as r", [base, HASH, snapshot])).rows[0].r as { status: string; revision: number };
    await db.query("insert into public.workspaces(user_id, current_revision, current_hash) values ($1, 8, $2)", [A, HASH]);
    await db.query(`insert into public.workspace_revisions(workspace_id,user_id,revision,base_revision,schema_version,content_hash,snapshot_payload,device_id,idempotency_key,reason)
      select w.id, w.user_id, n, n - 1, 34, $2, $3::jsonb, gen_random_uuid(), gen_random_uuid(), 'automatic'
      from public.workspaces w, generate_series(1, 8) n where w.user_id = $1`, [A, HASH, snapshot]);
    expect(await stored()).toBeGreaterThan(50_000_000);
    expect(await push(8)).toMatchObject({ status: "accepted", revision: 9 }); expect(await kept()).toEqual([5, 6, 7, 8, 9]); expect(await stored()).toBeLessThanOrEqual(50_000_000);
    for (const base of [9, 10]) expect(await push(base)).toMatchObject({ status: "accepted", revision: base + 1 });
    expect(await kept()).toEqual([7, 8, 9, 10, 11]); expect(await stored()).toBeLessThanOrEqual(50_000_000);
    await db.close();
  }, 120_000);

  it("keeps small histories at sixty revisions", async () => {
    const db = await supabaseLikeDatabase({ rlsAutoEnable: false });
    await db.query("insert into auth.users(id, email) values ($1, 'a@x.com')", [A]);
    for (let base = 0; base < 63; base += 1) await as(db, "authenticated", A, "select public.push_workspace_revision($1,34,$2,'{\"ok\":true}'::jsonb,gen_random_uuid(),gen_random_uuid(),'automatic')", [base, HASH]);
    const { rows } = await db.query<{ n: number; oldest: number; newest: number }>("select count(*)::int as n, min(revision)::int as oldest, max(revision)::int as newest from public.workspace_revisions where user_id=$1", [A]);
    expect(rows[0]).toEqual({ n: 60, oldest: 4, newest: 63 }); await db.close();
  }, 60_000);

  it("refuses with client errors, never a server error, and replays retries faithfully", async () => {
    const db = await supabaseLikeDatabase({ rlsAutoEnable: false }); await db.query("insert into auth.users(id, email) values ($1, 'a@x.com')", [A]);
    const call = (base: number | null, key: string, payload: string, hash = HASH) => as(db, "authenticated", A,
      "select public.push_workspace_revision($1,34,$2,$3::jsonb,'33333333-3333-4333-8333-333333333333'::uuid,$4::uuid,'automatic') as r", [base, hash, payload, key]);
    await expect(call(0, "44444444-4444-4444-8444-444444444444", JSON.stringify({ payload: "x".repeat(15_000_001) }))).rejects.toMatchObject({ code: "PT413", message: expect.stringMatching(/too large/) });
    await expect(call(null, "44444444-4444-4444-8444-444444444444", "{}")).rejects.toMatchObject({ code: "P0001", message: expect.stringMatching(/invalid snapshot metadata/) });
    const { rows: [definition] } = await db.query<{ sql: string }>("select pg_get_functiondef('public.push_workspace_revision(bigint,integer,text,jsonb,uuid,uuid,text)'::regprocedure) as sql");
    expect(definition.sql).not.toMatch(/errcode\s*=\s*'5/); expect(definition.sql).not.toMatch(/(?<!p_)snapshot_payload\s*::\s*text/);
    const other = "b".repeat(64);
    expect((await call(0, "55555555-5555-4555-8555-555555555555", "{\"v\":1}")).rows[0].r).toMatchObject({ status: "accepted", revision: 1, idempotent: false });
    expect((await call(0, "55555555-5555-4555-8555-555555555555", "{\"v\":2}", other)).rows[0].r).toMatchObject({ status: "accepted", revision: 1, idempotent: true, content_hash: HASH });
    const conflict = (await call(0, "66666666-6666-4666-8666-666666666666", "{\"v\":3}")).rows[0].r as { preserved_revision_id: string };
    expect(conflict).toMatchObject({ status: "conflict", server_revision: 1, preserved: true });
    expect((await call(0, "66666666-6666-4666-8666-666666666666", "{\"v\":3}")).rows[0].r).toEqual({ status: "conflict", server_revision: 1, preserved_revision_id: conflict.preserved_revision_id, preserved: true });
    expect(Number((await db.query<{ n: number }>("select count(*)::int as n from public.workspace_revisions where user_id=$1", [A])).rows[0].n)).toBe(2);
    await db.close();
  }, 60_000);
  it("applies bounded changes only to the exact owner base, retaining retries and conflicts", async () => {
    const db = await supabaseLikeDatabase({ rlsAutoEnable: false });
    try {
      await db.query("insert into auth.users(id,email) values ($1,'a@x.com'),($2,'b@x.com')", [A, B]);
      const content = JSON.stringify({ questions: [{ id: "q1", attempts: [], notes: "" }, { id: "q2", attempts: [] }], profile: { name: "A" } });
      const snapshot = { _axomCloudFormat: 2, _axomDeltaFormat: 1, content, expandedBytes: new TextEncoder().encode(content).length, media: [], sources: [] };
      await as(db, "authenticated", A, "select public.push_workspace_revision_v2(0,34,$1,$2,'33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444')", [HASH, snapshot]);
      const call = (user: string, key: string, changes: unknown[], baseHash = HASH) => as(db, "authenticated", user,
        "select public.push_workspace_delta_v2(1,$1,34,$2,$3,'33333333-3333-4333-8333-333333333333',$4,'automatic') as r", [baseHash, "b".repeat(64), changes, key]);
      const key = "55555555-5555-4555-8555-555555555555";
      const changes = [{ op: "append", path: ["workspace", "questions", "0", "attempts"], value: [{ id: "attempt-1", key: "A" }] },
        { op: "set", path: ["workspace", "questions", "0", "notes"], value: "Private note" },
        { op: "remove", path: ["workspace", "questions", "1"] }];
      await expect(call(B, key, changes)).rejects.toMatchObject({ code: "PT428" });
      await expect(call(A, key, changes, "c".repeat(64))).rejects.toMatchObject({ code: "PT428" });
      for (const change of [
        { op: "set", path: [], value: {} }, { op: "set", path: ["unknown"], value: {} },
        { op: "set", path: ["workspace", "questions", "99"], value: {} },
        { op: "set", path: ["workspace", "missing", "nested"], value: {} },
        { op: "append", path: ["workspace", "profile"], value: [] },
        { op: "remove", path: ["workspace"] },
      ]) await expect(call(A, key, [change])).rejects.toMatchObject({ code: "PT400" });
      await expect(call(A, key, Array.from({ length: 1001 }, () => changes[1]))).rejects.toMatchObject({ code: "PT413" });
      expect((await call(A, key, changes)).rows[0].r).toMatchObject({ status: "accepted", revision: 2 });
      expect((await call(A, key, changes)).rows[0].r).toMatchObject({ status: "accepted", revision: 2, idempotent: true, content_hash: "b".repeat(64) });
      const saved = (await as(db, "authenticated", A, "select snapshot_payload from public.workspace_revisions where revision=2")).rows[0].snapshot_payload as { content: string; expandedBytes: number };
      expect(JSON.parse(saved.content)).toEqual({ questions: [{ id: "q1", attempts: [{ id: "attempt-1", key: "A" }], notes: "Private note" }], profile: { name: "A" } });
      expect(saved.expandedBytes).toBe(new TextEncoder().encode(saved.content).length);
      expect((await call(A, "66666666-6666-4666-8666-666666666666", changes)).rows[0].r).toMatchObject({ status: "conflict", server_revision: 2 });
      expect((await call(A, "66666666-6666-4666-8666-666666666666", changes)).rows[0].r).toMatchObject({ status: "conflict", server_revision: 2 });
    } finally { await db.close(); }
  }, 60_000);

  it("protects v2 files by owner, refuses incomplete revisions, and preserves atomic retries", async () => {
    const db = await supabaseLikeDatabase({ rlsAutoEnable: false });
    try {
      await db.query("insert into auth.users(id,email) values ($1,'a@x.com'),($2,'b@x.com')", [A, B]);
      const path = `${A}/${HASH}`;
      const put = (user: string, name: string) => as(db, "authenticated", user,
        "insert into storage.objects(bucket_id,name,metadata) values ('workspace-media',$1,'{\"size\":7}')", [name]);
      await put(A, path);
      await expect(put(B, `${A}/${"b".repeat(64)}`)).rejects.toMatchObject({ code: "42501" });
      expect((await as(db, "authenticated", B, "select * from storage.objects")).rows).toHaveLength(0);
      expect((await as(db, "authenticated", B, "delete from storage.objects returning name")).rows).toHaveLength(0);
      expect((await as(db, "authenticated", A, "update storage.objects set metadata='{}' returning name")).rows).toHaveLength(0);
      const snapshot = { _axomCloudFormat: 2, content: "{}", expandedBytes: 2, sources: [], media: [
        { blobKey: "figure", hash: HASH, byteSize: 7, updatedAt: "2026-10-11T00:00:00Z" },
      ] };
      const call = (user: string, base: number, key: string, payload = snapshot) => as(db, "authenticated", user,
        "select public.push_workspace_revision_v2($1,34,$2,$3::jsonb,'33333333-3333-4333-8333-333333333333'::uuid,$4::uuid,'automatic') as r",
        [base, HASH, JSON.stringify(payload), key]);
      await expect(call(B, 0, "44444444-4444-4444-8444-444444444444")).rejects.toMatchObject({ code: "PT409" });
      await expect(call(A, 0, "44444444-4444-4444-8444-444444444444", { ...snapshot, media: [...snapshot.media, ...snapshot.media] })).rejects.toMatchObject({ code: "PT400" });
      await expect(call(A, 0, "44444444-4444-4444-8444-444444444444", { ...snapshot, media: [{ ...snapshot.media[0], byteSize: 8 }] })).rejects.toMatchObject({ code: "PT409" });
      expect((await call(A, 0, "44444444-4444-4444-8444-444444444444")).rows[0].r).toMatchObject({ status: "accepted", revision: 1 });
      expect((await call(A, 0, "44444444-4444-4444-8444-444444444444")).rows[0].r).toMatchObject({ status: "accepted", revision: 1, idempotent: true });
      expect((await call(A, 0, "55555555-5555-4555-8555-555555555555")).rows[0].r).toMatchObject({ status: "conflict", preserved: true });
      await expect(as(db, "authenticated", A, "select public.push_workspace_revision(1,34,$1,'{}','33333333-3333-4333-8333-333333333333','66666666-6666-4666-8666-666666666666')", [HASH]))
        .rejects.toMatchObject({ code: "PT409", message: expect.stringMatching(/Update AXOM/) });
      expect((await db.query<{ public: boolean }>("select public from storage.buckets")).rows.every((bucket) => !bucket.public)).toBe(true);
    } finally { await db.close(); }
  }, 60_000);

  it.each([
    "20261010000100", // AXOM Production at start of Round 2, twelve migrations
    "20261014120000", // AXOM Production at 13:46 AST, twenty-three migrations
  ])("upgrades an occupied production-shaped database from %s without modifying account history", async (startVersion) => {
    const db = await supabaseLikeDatabase({ rlsAutoEnable: false, stopBefore: startVersion });
    const C = "33333333-3333-4333-8333-333333333333";
    const D = "44444444-4444-4444-8444-444444444444";
    try {
      await db.query("insert into auth.users(id,email) values ($1,'a@x.test'),($2,'b@x.test'),($3,'c@x.test'),($4,'d@x.test')", [A, B, C, D]);
      await db.query("insert into public.workspaces(user_id,current_revision,current_hash) values($1,40,$3),($2,25,$3)", [A, B, HASH]);
      await db.query(`insert into public.workspace_revisions
        (workspace_id,user_id,revision,base_revision,schema_version,content_hash,snapshot_payload,device_id,idempotency_key,reason)
        select w.id,w.user_id,n,n-1,34,$3,jsonb_build_object('legacy',true,'sequence',n),
          gen_random_uuid(),gen_random_uuid(),'automatic'
        from public.workspaces w cross join lateral generate_series(1,case when w.user_id=$1 then 40 else 25 end) n
        where w.user_id in ($1,$2)`, [A, B, HASH]);
      const baseline = await db.query<{ count: number }>("select count(*)::int as count from public.workspace_revisions");
      expect(baseline.rows[0].count).toBe(65);
      for (const file of files.filter(file => file >= startVersion)) {
        await db.exec(`begin;${readFileSync(migrationsDir + file, "utf8")}commit;`);
      }
      const [{ rows: people }, { rows: workspaces }, { rows: revisions }, { rows: objects }, { rows: buckets }] = await Promise.all([
        db.query<{ count: number }>("select count(*)::int as count from auth.users"),
        db.query<{ user_id: string; current_revision: number }>("select user_id,current_revision::int as current_revision from public.workspaces order by user_id"),
        db.query<{ user_id: string; count: number; oldest: number; newest: number }>(
          "select user_id,count(*)::int as count,min(revision)::int as oldest,max(revision)::int as newest from public.workspace_revisions group by user_id order by user_id"),
        db.query<{ count: number }>("select count(*)::int as count from storage.objects"),
        db.query<{ id: string; public: boolean }>("select id, public from storage.buckets"),
      ]);
      expect(people[0].count).toBe(4);
      expect(workspaces).toEqual([{ user_id: A, current_revision: 40 }, { user_id: B, current_revision: 25 }]);
      expect(revisions).toEqual([
        { user_id: A, count: 40, oldest: 1, newest: 40 },
        { user_id: B, count: 25, oldest: 1, newest: 25 },
      ]);
      expect(objects[0].count).toBe(0);
      expect(buckets.length).toBeGreaterThanOrEqual(5);
      expect(buckets.every(bucket => !bucket.public)).toBe(true);
      expect(buckets.some(bucket => bucket.id === "workspace-originals")).toBe(true);
      expect((await as(db, "authenticated", A, "select count(*)::int as n from public.workspace_revisions")).rows)
        .toEqual([{ n: 40 }]);
      expect((await as(db, "authenticated", B, "select count(*)::int as n from public.workspace_revisions")).rows)
        .toEqual([{ n: 25 }]);
      const result = (await as(db, "authenticated", A, "select public.push_workspace_revision_v2(40,34,$1,$2,gen_random_uuid(),gen_random_uuid(),'automatic') as receipt",
        [HASH, { _axomCloudFormat: 2, _axomDeltaFormat: 1, content: "{}", expandedBytes: 2, media: [], sources: [] }])).rows[0].receipt;
      expect(result).toMatchObject({ status: "accepted", revision: 41 });
      expect((await as(db, "authenticated", B, "select count(*)::int as n from public.workspace_revisions")).rows)
        .toEqual([{ n: 25 }]);
    } finally { await db.close(); }
  }, 120_000);

  it("protects source-original objects and never acknowledges a missing or wrong-size original", async () => {
    const db = await supabaseLikeDatabase({ rlsAutoEnable: false });
    try {
      await db.query("insert into auth.users(id,email) values ($1,'a@x.com'),($2,'b@x.com')", [A, B]);
      const bucket = (await db.query<{ public: boolean; file_size_limit: string }>(
        "select public,file_size_limit from storage.buckets where id='workspace-originals'")).rows[0];
      expect(bucket.public).toBe(false);
      expect(Number(bucket.file_size_limit)).toBe(134_217_728);
      const original = {
        id: "source-1", checksum: `sha256:${HASH}`, sizeBytes: 7,
        originalFile: { version: 1, sha256: HASH, byteSize: 7, mimeType: "application/pdf" },
      };
      const body = JSON.stringify({ documents: [original], questions: [] });
      const snapshot = { _axomCloudFormat: 2, _axomDeltaFormat: 1, content: body,
        expandedBytes: new TextEncoder().encode(body).length, media: [], sources: [] };
      const call = (user: string, base: number, key: string, value: unknown = snapshot) => as(db, "authenticated", user,
        "select public.push_workspace_revision_v2($1,34,$2,$3::jsonb,gen_random_uuid(),$4::uuid) as r",
        [base, HASH, JSON.stringify(value), key]);
      const retryKey = "77777777-7777-4777-8777-777777777777";
      await expect(call(A, 0, retryKey)).rejects.toMatchObject({ code: "PT409" });
      await expect(as(db, "authenticated", B,
        "insert into storage.objects(bucket_id,name,metadata) values('workspace-originals',$1,'{\"size\":7}')",
        [`${A}/${HASH}`])).rejects.toMatchObject({ code: "42501" });
      await expect(as(db, "anon", null,
        "insert into storage.objects(bucket_id,name,metadata) values('workspace-originals',$1,'{\"size\":7}')",
        [`${A}/${HASH}`])).rejects.toMatchObject({ code: "42501" });
      await as(db, "authenticated", A,
        "insert into storage.objects(bucket_id,name,metadata) values('workspace-originals',$1,'{\"size\":6}')",
        [`${A}/${HASH}`]);
      await expect(call(A, 0, retryKey)).rejects.toMatchObject({ code: "PT409" });
      expect((await as(db, "authenticated", B,
        "select name from storage.objects where bucket_id='workspace-originals'")).rows).toEqual([]);
      expect((await as(db, "authenticated", A,
        "update storage.objects set metadata='{\"size\":7}' where bucket_id='workspace-originals' returning name")).rows).toEqual([]);
      await as(db, "authenticated", A,
        "delete from storage.objects where bucket_id='workspace-originals' and name=$1", [`${A}/${HASH}`]);
      await as(db, "authenticated", A,
        "insert into storage.objects(bucket_id,name,metadata) values('workspace-originals',$1,'{\"size\":7}')",
        [`${A}/${HASH}`]);
      await expect(call(A, 0, retryKey, { ...snapshot, content: JSON.stringify({
        documents: [{ ...original, checksum: "sha256:" + "b".repeat(64) }], questions: [],
      }) })).rejects.toMatchObject({ code: "PT400" });
      expect((await call(A, 0, retryKey)).rows[0].r).toMatchObject({ status: "accepted", revision: 1 });
      expect((await call(A, 0, retryKey)).rows[0].r).toMatchObject({ status: "accepted", revision: 1, idempotent: true });
      await expect(call(B, 0, "88888888-8888-4888-8888-888888888888")).rejects.toMatchObject({ code: "PT409" });
      expect(Number((await db.query<{ n: number }>("select count(*)::int as n from public.workspace_revisions where user_id=$1", [A])).rows[0].n)).toBe(1);
      expect(Number((await db.query<{ n: number }>("select count(*)::int as n from public.workspace_revisions where user_id=$1", [B])).rows[0].n)).toBe(0);
    } finally { await db.close(); }
  }, 60_000);

  it("does not reactivate an older academic revision that finishes after a newer one", async () => {
    const db = await supabaseLikeDatabase({ rlsAutoEnable: false });
    const collection = "33333333-3333-4333-8333-333333333333";
    const older = "44444444-4444-4444-8444-444444444444";
    const newer = "55555555-5555-4555-8555-555555555555";
    try {
      await db.query("insert into auth.users(id,email) values ($1,'a@x.com')", [A]);
      await db.query("insert into public.academic_collections(id,owner_id,title,module,term) values ($1,$2,'Term 1','Sample','Term 1')", [collection, A]);
      for (const [id, hash, created] of [[older, HASH, "2026-10-12T00:00:00Z"], [newer, "b".repeat(64), "2026-10-13T00:00:00Z"]]) {
        await db.query("insert into public.academic_revisions(id,collection_id,content_hash,template_text,created_at) values($1,$2,$3,'Course',$4)", [id, collection, hash, created]);
        await db.query("insert into public.academic_files(revision_id,path,object_path,sha256,byte_size,mime_type) values($1,'catalog.json',$2,$3,7,'application/json')", [id, `${collection}/${hash}`, hash]);
        await db.query("insert into storage.objects(bucket_id,name,metadata) values('academic-content',$1,'{\"size\":7}')", [`${collection}/${hash}`]);
      }
      await as(db, "authenticated", A, "select public.academic_finish_revision($1)", [newer]);
      await db.query("update public.academic_collections set review_status='approved' where id=$1", [collection]);
      await as(db, "authenticated", A, "select public.academic_finish_revision($1)", [older]);
      const result = (await db.query<{ current_revision_id: string; review_status: string }>(
        "select current_revision_id, review_status from public.academic_collections where id=$1", [collection])).rows[0];
      expect(result).toEqual({ current_revision_id: newer, review_status: "approved" });
      expect((await db.query<{ id: string; status: string }>("select id,status from public.academic_revisions where collection_id=$1 order by created_at", [collection])).rows)
        .toEqual([{ id: older, status: "ready" }, { id: newer, status: "ready" }]);
    } finally { await db.close(); }
  }, 60_000);

});

/** Schema-first media rollout: prove an existing private academic revision
 * survives the additive GIF migration while the original RLS still denies
 * other accounts access. No production SQL is executed by this test. */
describe("academic GIF Storage migration", () => {
  it("preserves existing revisions, admits GIF figures and keeps bucket/RLS private", async () => {
    const db = await supabaseLikeDatabase({ rlsAutoEnable: false,
      stopBefore: "20261015133000_academic_gif_media_support.sql" });
    const collection = "55555555-5555-4555-8555-555555555555";
    const revision = "66666666-6666-4666-8666-666666666666";
    const pngHash = "b".repeat(64);
    const gifHash = "c".repeat(64);
    try {
      await db.query("insert into auth.users(id,email) values($1,'owner@test.invalid'),($2,'other@test.invalid')", [A, B]);
      await db.query("insert into public.academic_collections(id,owner_id,title,module,term) values($1,$2,'Synthetic illustrations','GOER','Term 5')", [collection, A]);
      await db.query("insert into public.academic_revisions(id,collection_id,content_hash,template_text,status) values($1,$2,$3,'','uploading')", [revision, collection, HASH]);
      await db.query("insert into public.academic_files(revision_id,path,object_path,sha256,byte_size,mime_type) values($1,'assets/existing.png',$2,$3,64,'image/png')",
        [revision, `${collection}/${pngHash}`, pngHash]);
      const previous = (await db.query<{ allowed_mime_types: string[] }>(
        "select allowed_mime_types from storage.buckets where id='academic-content'")).rows[0];
      expect(previous.allowed_mime_types).toContain("image/png");
      expect(previous.allowed_mime_types).not.toContain("image/gif");
      await expect(db.query("insert into public.academic_files(revision_id,path,object_path,sha256,byte_size,mime_type) values($1,'assets/figure.gif',$2,$3,43,'image/gif')",
        [revision, `${collection}/${gifHash}`, gifHash])).rejects.toThrow(/check constraint/);

      await db.exec(readFileSync(migrationsDir + "20261015133000_academic_gif_media_support.sql", "utf8"));
      const bucket = (await db.query<{ public: boolean; file_size_limit: string; allowed_mime_types: string[] }>(
        "select public,file_size_limit,allowed_mime_types from storage.buckets where id='academic-content'")).rows[0];
      expect(bucket.public).toBe(false);
      expect(Number(bucket.file_size_limit)).toBe(52_428_800);
      expect(bucket.allowed_mime_types).toContain("image/gif");
      expect(bucket.allowed_mime_types).toContain("image/png");

      expect((await db.query("select path,mime_type from public.academic_files where revision_id=$1", [revision])).rows)
        .toEqual([{ path: "assets/existing.png", mime_type: "image/png" }]);
      await db.query("insert into public.academic_files(revision_id,path,object_path,sha256,byte_size,mime_type) values($1,'assets/figure.gif',$2,$3,43,'image/gif')",
        [revision, `${collection}/${gifHash}`, gifHash]);
      const ownerWrite = await as(db, "authenticated", A,
        "insert into storage.objects(bucket_id,name,metadata) values('academic-content',$1,'{\"size\":43}') returning name",
        [`${collection}/${gifHash}`]);
      expect(ownerWrite.rows).toEqual([{ name: `${collection}/${gifHash}` }]);
      expect((await as(db, "authenticated", B,
        "select name from storage.objects where bucket_id='academic-content'")).rows).toEqual([]);

      // Script is idempotent if reviewed twice, but Agent0 should only apply it
      // once via migration tracking rather than re-running raw SQL.
      await db.exec(readFileSync(migrationsDir + "20261015133000_academic_gif_media_support.sql", "utf8"));
      const again = (await db.query<{ allowed_mime_types: string[] }>(
        "select allowed_mime_types from storage.buckets where id='academic-content'")).rows[0];
      expect(again.allowed_mime_types.filter(type => type === "image/gif")).toHaveLength(1);
      expect((await db.query("select count(*)::integer as n from public.academic_files")).rows)
        .toEqual([{ n: 2 }]);
    } finally { await db.close(); }
  }, 60_000);
});
