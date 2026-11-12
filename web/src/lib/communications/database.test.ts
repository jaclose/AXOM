import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { describe, expect, it } from "vitest";
const A = "11111111-1111-4111-8111-111111111111"; const B = "22222222-2222-4222-8222-222222222222";
const migrationDirectory = fileURLToPath(new URL("../../../../supabase/migrations/", import.meta.url));
const SESSION_CONSENT_MIGRATION = "20261112080000_communications_deletion_session_consent.sql";
const TERMINAL_SCRUB_MIGRATION = "20261112213000_communications_deletion_receipt_session_scrub.sql";
const ATOMIC_QUEUE_MIGRATION = "20261112231500_communications_deletion_queue_atomic.sql";
async function applyMigration(db: PGlite, filename: string) {
  await db.exec(readFileSync(migrationDirectory + filename, "utf8"));
}
async function database(throughMigration?: string) {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`create schema extensions; create extension pgcrypto with schema extensions; create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon,authenticated,service_role; alter default privileges in schema public grant all on tables to anon,authenticated,service_role; alter default privileges in schema public grant all on functions to anon,authenticated,service_role; create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}'); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema auth to anon,authenticated; set search_path=public,extensions;`);
  await db.exec(`create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text); alter table storage.objects enable row level security; grant usage on schema storage to anon,authenticated; grant select on storage.objects to anon,authenticated; create policy fixture_other_bucket_access on storage.objects for select to anon,authenticated using(true);`);
  for (const name of readdirSync(migrationDirectory).filter(f => f.endsWith(".sql") && (!throughMigration || f <= throughMigration)).sort()) await applyMigration(db, name);
  await db.exec(`insert into auth.users(id,email) values('${A}','alex@example.invalid'),('${B}','riley@example.invalid');`);
  return db;
}
describe("communications on real Postgres", () => {
  it("reconciles a single existing future deletion job without resurrecting closed consent", async () => {
    const db = await database(TERMINAL_SCRUB_MIGRATION);
    const first = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const second = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    try {
      await db.exec(`insert into privacy_requests(user_id,kind,status,actor_session_id,scheduled_for)
        values('${A}','deletion','scheduled','${first}','2030-11-20T12:00:00Z'),
              ('${B}','deletion','scheduled','${second}','2030-11-20T12:00:00Z');`);
      const pendingId = (await db.query<{ id: string }>(
        `select id from privacy_requests where user_id='${A}'`
      )).rows[0].id;
      const closedId = (await db.query<{ id: string }>(
        `select id from privacy_requests where user_id='${B}'`
      )).rows[0].id;
      await db.exec(`insert into email_jobs(user_id,type,category,idempotency_key,variables)
        values('${A}','deletion_requested','account_deletion','${pendingId}:requested','{}');
        update privacy_requests set status='cancelled' where id='${closedId}';`);
      await applyMigration(db, ATOMIC_QUEUE_MIGRATION);
      const jobs = (await db.query<{ idempotency_key: string }>(
        `select idempotency_key from email_jobs where category='account_deletion' order by idempotency_key`
      )).rows.map(job => job.idempotency_key);
      expect(jobs).toEqual([`${pendingId}:requested`, `${pendingId}:scheduled`]);
      await applyMigration(db, ATOMIC_QUEUE_MIGRATION);
      expect((await db.query("select id from email_jobs where category='account_deletion'")).rows).toHaveLength(2);
      // The scheduled consent remains active and its same-session replay is barred.
      await expect(db.exec(`insert into privacy_requests(user_id,kind,status,actor_session_id,scheduled_for)
        values('${A}','deletion','scheduled','${first}','2030-11-20T12:00:00Z')`))
        .rejects.toThrow();
    } finally { await db.close(); }
  }, 30000);


  it("does not enqueue for cancelled, actorless or export-only privacy records", async () => {
    const db = await database();
    try {
      await db.exec(`insert into privacy_requests(user_id,kind,status,scheduled_for)
        values('${A}','deletion','scheduled','2030-11-20T12:00:00Z'),
              ('${B}','deletion','cancelled','2030-11-20T12:00:00Z'),
              ('${B}','export','requested',null);`);
      expect((await db.query("select id from email_jobs where category='account_deletion'")).rows)
        .toHaveLength(0);
      expect((await db.query("select id from privacy_requests where kind='deletion'")).rows)
        .toHaveLength(2);
    } finally { await db.close(); }
  }, 30000);

  it("persists both deletion notices atomically with a new scheduled consent", async () => {
    const db = await database();
    const session = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    try {
      await db.exec(`insert into privacy_requests(user_id,kind,status,actor_session_id,scheduled_for,notification_email)
        values('${A}','deletion','scheduled','${session}','2030-11-20T12:00:00Z','alex@example.invalid');`);
      const receipt = (await db.query<{ id: string }>(
        `select id from privacy_requests where user_id='${A}' and kind='deletion'`
      )).rows[0];
      const notices = (await db.query<{
        type: string; category: string; idempotency_key: string; status: string;
        variables: { requestId?: string; date?: string };
      }>(`select type,category,idempotency_key,status,variables
          from email_jobs where user_id='${A}' and category='account_deletion' order by type`)).rows;
      expect(notices.map(n => [n.type, n.category, n.idempotency_key, n.status])).toEqual([
        ["deletion_requested", "account_deletion", `${receipt.id}:requested`, "queued"],
        ["deletion_scheduled", "account_deletion", `${receipt.id}:scheduled`, "queued"],
      ]);
      expect(notices[0].variables.requestId).toBe(receipt.id);
      expect(Date.parse(notices[1].variables.date ?? "")).toBe(Date.parse("2030-11-20T12:00:00Z"));
      // The existing handler's post-insert enqueue attempts must remain idempotent.
      await db.exec(`insert into email_jobs(user_id,type,category,idempotency_key,variables)
        values('${A}','deletion_requested','account_deletion','${receipt.id}:requested','{}')
        on conflict (idempotency_key) do nothing;`);
      expect((await db.query<{ count: string }>(
        `select count(*)::text as count from email_jobs where user_id='${A}' and category='account_deletion'`
      )).rows[0].count).toBe("2");
    } finally { await db.close(); }
  }, 30000);

  it("rolls back consent if either required deletion job cannot be written", async () => {
    const db = await database();
    const session = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const consent = `insert into privacy_requests(user_id,kind,status,actor_session_id,scheduled_for)
      values('${A}','deletion','scheduled','${session}','2030-11-20T12:00:00Z')`;
    try {
      await db.exec("alter table email_jobs add constraint reject_scheduled_notice check (type <> 'deletion_scheduled')");
      await expect(db.exec(consent)).rejects.toThrow();
      expect((await db.query("select id from privacy_requests where user_id=$1", [A])).rows).toHaveLength(0);
      expect((await db.query("select id from email_jobs where user_id=$1 and category='account_deletion'", [A])).rows).toHaveLength(0);
      await db.exec("alter table email_jobs drop constraint reject_scheduled_notice");
      await db.exec(consent);
      expect((await db.query("select id from privacy_requests where user_id=$1", [A])).rows).toHaveLength(1);
      expect((await db.query("select id from email_jobs where user_id=$1 and category='account_deletion'", [A])).rows).toHaveLength(2);
    } finally { await db.close(); }
  }, 30000);

  it("retains cancelled deletion consent as a session-bound replay barrier", async () => {
    const db = await database();
    const first = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const newSession = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    try {
      await db.exec(`insert into privacy_requests(user_id,kind,status,actor_session_id)
        values('${A}','deletion','scheduled','${first}');
        update privacy_requests set status='cancelled' where user_id='${A}' and actor_session_id='${first}';`);
      await expect(db.exec(`insert into privacy_requests(user_id,kind,status,actor_session_id)
        values('${A}','deletion','scheduled','${first}')`)).rejects.toThrow();
      await db.exec(`insert into privacy_requests(user_id,kind,status,actor_session_id)
        values('${A}','deletion','scheduled','${newSession}')`);
      await expect(db.exec(`insert into privacy_requests(user_id,kind,status,actor_session_id)
        values('${A}','export','requested','${newSession}')`)).rejects.toThrow();
      expect((await db.query<{ status: string }>(`select status from privacy_requests where user_id='${A}' order by created_at`)).rows).toHaveLength(2);
    } finally { await db.close(); }
  }, 30000);
  it("scrubs terminal and orphaned deletion-session IDs without freeing live cancellation tombstones", async () => {
    const db = await database();
    const first = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const second = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    try {
      await db.exec(`insert into privacy_requests(user_id,kind,status,actor_session_id)
        values('${A}','deletion','scheduled','${first}'),('${B}','deletion','scheduled','${second}');
        update privacy_requests set status='cancelled' where user_id='${A}' and kind='deletion';`);
      // While the user exists, cancellation must continue to block session replay.
      expect((await db.query<{ actor_session_id: string }>(`select actor_session_id from privacy_requests where user_id='${A}' and kind='deletion'`)).rows[0].actor_session_id).toBe(first);
      await expect(db.exec(`insert into privacy_requests(user_id,kind,status,actor_session_id) values('${A}','deletion','scheduled','${first}')`)).rejects.toThrow();

      // A failed preflight must retain its consent identity for reconciliation.
      await db.exec(`update privacy_requests set status='failed' where user_id='${B}' and kind='deletion';`);
      expect((await db.query<{ actor_session_id: string | null }>(`select actor_session_id from privacy_requests where user_id='${B}' and kind='deletion'`)).rows[0].actor_session_id).toBe(second);

      // Terminal completion scrubs identity even if a deployed Edge handler only updates status.
      await db.exec(`update privacy_requests set status='completed' where user_id='${B}' and kind='deletion';`);
      expect((await db.query<{ user_id: string; actor_session_id: string | null }>(`select user_id,actor_session_id from privacy_requests where user_id='${B}' and kind='deletion'`)).rows[0])
        .toEqual({ user_id: B, actor_session_id: null });

      // Auth FK ON DELETE SET NULL must also scrub sessions on orphaned receipts,
      // including a cancelled tombstone whose account no longer exists.
      await db.exec(`delete from auth.users where id='${A}';`);
      expect((await db.query<{ user_id: string | null; actor_session_id: string | null; status: string }>(
        "select user_id,actor_session_id,status from privacy_requests where status='cancelled'"
      )).rows).toEqual([{ user_id: null, actor_session_id: null, status: "cancelled" }]);

      // A later update may not reintroduce the completed receipt's session identifier.
      await db.exec(`update privacy_requests set actor_session_id='${second}' where user_id='${B}' and kind='deletion';`);
      expect((await db.query<{ actor_session_id: string | null }>(`select actor_session_id from privacy_requests where user_id='${B}' and kind='deletion'`)).rows[0].actor_session_id).toBeNull();

      await db.exec(`insert into privacy_requests(user_id,kind,status) values('${B}','export','requested');`);
      expect((await db.query<{ actor_session_id: string | null }>(`select actor_session_id from privacy_requests where user_id='${B}' and kind='export'`)).rows[0].actor_session_id).toBeNull();
    } finally { await db.close(); }
  }, 30000);

  it("upgrades an already-R63 database, scrubs historical receipts and retains cancellation replay protection", async () => {
    // Reconstruct the pre-forward state: consent migration applied; scrub absent.
    const db = await database(SESSION_CONSENT_MIGRATION);
    const C = "33333333-3333-4333-8333-333333333333";
    const completedSession = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const cancelledSession = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const orphanSession = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    try {
      await db.exec(`insert into auth.users(id,email) values('${C}','orphan@example.invalid');
        insert into privacy_requests(user_id,kind,status,actor_session_id)
        values('${A}','deletion','completed','${completedSession}'),
              ('${B}','deletion','cancelled','${cancelledSession}'),
              ('${C}','deletion','cancelled','${orphanSession}');
        delete from auth.users where id='${C}';`);
      expect((await db.query<{ actor_session_id: string | null }>(`select actor_session_id from privacy_requests where user_id='${A}' and kind='deletion'`)).rows[0].actor_session_id).toBe(completedSession);
      expect((await db.query<{ actor_session_id: string | null }>("select actor_session_id from privacy_requests where user_id is null and kind='deletion'")).rows[0].actor_session_id).toBe(orphanSession);

      // A fresh reset would miss these old rows. Apply the later, distinct version.
      await applyMigration(db, TERMINAL_SCRUB_MIGRATION);
      expect((await db.query<{ actor_session_id: string | null }>(`select actor_session_id from privacy_requests where user_id='${A}' and kind='deletion'`)).rows[0].actor_session_id).toBeNull();
      expect((await db.query<{ actor_session_id: string | null }>("select actor_session_id from privacy_requests where user_id is null and kind='deletion'")).rows[0].actor_session_id).toBeNull();
      expect((await db.query<{ actor_session_id: string | null }>(`select actor_session_id from privacy_requests where user_id='${B}' and kind='deletion'`)).rows[0].actor_session_id).toBe(cancelledSession);
      await expect(db.exec(`insert into privacy_requests(user_id,kind,status,actor_session_id)
        values('${B}','deletion','scheduled','${cancelledSession}')`)).rejects.toThrow();

      // A previous R64 preview may already have created the same trigger.
      // Reapplying this SQL must not fail or reintroduce sensitive identifiers.
      await applyMigration(db, TERMINAL_SCRUB_MIGRATION);
      await db.exec(`update privacy_requests set status='completed' where user_id='${B}' and kind='deletion';`);
      expect((await db.query<{ actor_session_id: string | null }>(`select actor_session_id from privacy_requests where user_id='${B}' and kind='deletion'`)).rows[0].actor_session_id).toBeNull();
      await db.exec(`insert into privacy_requests(user_id,kind,status,actor_session_id)
        values(null,'deletion','cancelled','${orphanSession}');`);
      expect((await db.query<{ actor_session_id: string | null }>("select actor_session_id from privacy_requests where user_id is null and status='cancelled' and actor_session_id is not null")).rows).toHaveLength(0);
    } finally { await db.close(); }
  }, 30000);
  it("prevents cross-account reads, browser writes and privileged worker calls", async () => {
    const db = await database();
    try {
      await db.exec(`insert into communication_preferences(user_id,category,enabled) values('${A}','weekly_report',true),('${B}','weekly_report',true); set role authenticated; select set_config('request.jwt.claim.sub','${A}',false);`);
      const rows = await db.query<{ user_id: string }>("select user_id from communication_preferences"); expect(rows.rows.map(r => r.user_id)).toEqual([A]);
      await expect(db.exec("update communication_preferences set enabled=false")).rejects.toThrow();
      await expect(db.exec("select * from claim_axom_email_jobs(10)")).rejects.toThrow();
      await expect(db.exec("select * from email_suppressions")).rejects.toThrow();
      await db.exec("reset role; set role anon;"); await expect(db.exec("select * from pulse_snapshots")).rejects.toThrow();
    } finally { await db.close(); }
  }, 30000);
  it("exposes only published essays to anonymous readers", async () => {
    const db = await database();
    try {
      await db.exec(`insert into axom_articles(title,excerpt,body,published_at) values('Draft','Excerpt','Private draft',null),('Published','Excerpt','Public essay',now()-interval '1 hour'),('Future','Excerpt','Scheduled essay',now()+interval '1 day'); set role anon;`);
      expect((await db.query<{ title: string }>("select title from axom_articles")).rows.map(r => r.title)).toEqual(["Published"]);
    } finally { await db.close(); }
  }, 30000);
  it("keeps export objects private even when another Storage policy is broadly permissive", async () => {
    const db = await database();
    try {
      expect((await db.query<{ public: boolean }>("select public from storage.buckets where id='communications-exports'")).rows[0].public).toBe(false);
      await db.exec(`insert into storage.objects(bucket_id,name) values('communications-exports','private.json'),('public-assets','orb.png'); set role anon;`);
      expect((await db.query<{ name: string }>("select name from storage.objects")).rows.map(r => r.name)).toEqual(["orb.png"]);
    } finally { await db.close(); }
  }, 30000);
  it("queues welcome once, claims jobs once, and keeps essential mail after optional opt-out", async () => {
    const db = await database();
    try {
      const jobs = await db.query("select * from email_jobs"); expect(jobs.rows).toHaveLength(2);
      await db.exec(`insert into communication_preferences(user_id,category,enabled) values('${A}','weekly_report',true); update communication_preferences set enabled=false where user_id='${A}'; set role service_role;`);
      const claim = await db.query("select * from claim_axom_email_jobs(20)"); expect(claim.rows).toHaveLength(2);
      expect((await db.query("select * from claim_axom_email_jobs(20)")).rows).toHaveLength(0);
      await expect(db.exec(`insert into email_jobs(user_id,type,category,idempotency_key) values('${A}','welcome','account','${A}:welcome')`)).rejects.toThrow();
      expect((await db.query<{ category: string }>("select category from email_jobs")).rows.every(r => r.category === "account")).toBe(true);
    } finally { await db.close(); }
  }, 30000);
  it("makes an interrupted final attempt visible for reconciliation", async () => {
    const db = await database();
    try {
      await db.exec(`update email_jobs set status='processing',attempts=5,locked_at=now()-interval '15 minutes' where user_id='${A}'; set role service_role; select * from claim_axom_email_jobs(20);`);
      const row = (await db.query<{ status: string; failure_code: string }>(`select status,failure_code from email_jobs where user_id='${A}'`)).rows[0];
      expect(row).toEqual({ status: "failed", failure_code: "delivery-reconciliation-required" });
    } finally { await db.close(); }
  }, 30000);
  it("publishes and schedules a draft atomically, without rescheduling it", async () => {
    const db = await database();
    try {
      await db.exec(`insert into email_campaigns(id,type,content,audience,created_by) values('${B}','essay','{}','{}','${A}'); insert into axom_articles(campaign_id,title,excerpt,body) values('${B}','A note','Excerpt','Full essay'); set role service_role;`);
      expect((await db.query<{ scheduled: boolean }>(`select schedule_axom_campaign('${B}',now()+interval '1 day') as scheduled`)).rows[0].scheduled).toBe(true);
      expect((await db.query<{ scheduled: boolean }>(`select schedule_axom_campaign('${B}',now()+interval '2 days') as scheduled`)).rows[0].scheduled).toBe(false);
      expect((await db.query(`select id from axom_articles where published_at is not null`)).rows).toHaveLength(1);
    } finally { await db.close(); }
  }, 30000);
  it("leases the worker exclusively and cascades account data while preserving the deletion receipt", async () => {
    const db = await database();
    try {
      expect((await db.query<{ acquire_communication_worker: string }>("select acquire_communication_worker()")).rows[0].acquire_communication_worker).toMatch(/^[\da-f-]{36}$/);
      expect((await db.query<{ acquire_communication_worker: string | null }>("select acquire_communication_worker()")).rows[0].acquire_communication_worker).toBeNull();
      await db.exec(`insert into privacy_requests(user_id,kind,status,notification_email) values('${A}','deletion','scheduled','alex@example.invalid'); insert into pulse_snapshots(user_id,period_key,scope,payload) values('${A}','2025','year','{}'); delete from auth.users where id='${A}';`);
      expect((await db.query("select * from pulse_snapshots")).rows).toHaveLength(0);
      const receipts = await db.query<{ user_id: string | null }>("select user_id from privacy_requests"); expect(receipts.rows[0].user_id).toBeNull();
    } finally { await db.close(); }
  }, 30000);
});
