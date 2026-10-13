import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { describe, expect, it } from "vitest";
const A = "11111111-1111-4111-8111-111111111111"; const B = "22222222-2222-4222-8222-222222222222";
async function database() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`create schema extensions; create extension pgcrypto with schema extensions; create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon,authenticated,service_role; alter default privileges in schema public grant all on tables to anon,authenticated,service_role; alter default privileges in schema public grant all on functions to anon,authenticated,service_role; create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}'); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema auth to anon,authenticated; set search_path=public,extensions;`);
  await db.exec(`create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text); alter table storage.objects enable row level security; grant usage on schema storage to anon,authenticated; grant select on storage.objects to anon,authenticated; create policy fixture_other_bucket_access on storage.objects for select to anon,authenticated using(true);`);
  const directory = fileURLToPath(new URL("../../../../supabase/migrations/", import.meta.url));
  for (const name of readdirSync(directory).filter(f => f.endsWith(".sql")).sort()) await db.exec(readFileSync(directory + name, "utf8"));
  await db.exec(`insert into auth.users(id,email) values('${A}','alex@example.invalid'),('${B}','riley@example.invalid');`);
  return db;
}
describe("communications on real Postgres", () => {
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
