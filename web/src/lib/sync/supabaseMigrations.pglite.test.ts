import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { describe, expect, it } from "vitest";

/**
 * Replays every migration against Postgres with the platform-owned Auth and
 * Storage tables supplied by Supabase. These are test fixtures, not application
 * migrations. Default public function privileges deliberately match Supabase.
 */
const migrationsDir = fileURLToPath(new URL("../../../../supabase/migrations/", import.meta.url));
const files = readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort();
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const HASH = "a".repeat(64);

async function supabaseLikeDatabase({ rlsAutoEnable }: { rlsAutoEnable: boolean }) {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create schema if not exists extensions;
    create extension if not exists pgcrypto with schema extensions;
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    create schema storage;
    create table storage.buckets (
      id text primary key, name text not null, public boolean not null default false,
      file_size_limit bigint, allowed_mime_types text[]
    );
    create table storage.objects (
      id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
      name text not null, metadata jsonb, unique(bucket_id, name)
    );
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon, authenticated, service_role;
    grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
    grant all on storage.buckets to service_role;
    set search_path = "$user", public, extensions;
  `);
  if (rlsAutoEnable) await db.exec("create function public.rls_auto_enable() returns void language sql as $$ select $$;");
  for (const file of files) await db.exec(`begin;${readFileSync(migrationsDir + file, "utf8")}commit;`);
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
  "public.delete_my_cloud_data()", "public.consume_ai_quota()", "public.revoke_question_set_share(uuid)",
];
const PRIVATE_TABLES = [
  "account_profiles", "workspaces", "workspace_revisions", "sync_conflicts", "question_set_shares", "account_devices", "ai_usage",
  "academic_catalog_releases", "academic_catalog_entries", "academic_catalog_files", "academic_catalog_grants",
];
describe("Supabase migrations on real Postgres", () => {
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
      await db.query("update public.academic_collections set visibility='shared',review_status='approved' where id=$1", [collection]);
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

  it.each([false, true])("apply cleanly and lock function ACLs (rls_auto_enable present: %s)", async (rlsAutoEnable) => {
    const db = await supabaseLikeDatabase({ rlsAutoEnable });
    for (const signature of PRIVILEGED) {
      expect(await canExecute(db, "anon", signature), `anon on ${signature}`).toBe(false);
      expect(await canExecute(db, "authenticated", signature), `authenticated on ${signature}`).toBe(true);
      expect(await canExecute(db, "service_role", signature), `service_role on ${signature}`).toBe(true);
    }
    expect(await canExecute(db, "anon", "public.revoke_question_set_share(uuid)")).toBe(false);
    expect(await canExecute(db, "authenticated", "public.revoke_question_set_share(uuid)")).toBe(true);
    expect(await canExecute(db, "anon", "public.resolve_question_set_share(text)")).toBe(true);
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
    const share = (await as(db, "authenticated", A, "select public.create_question_set_share('set-1', $1::jsonb) as r", [JSON.stringify({ shareFormatVersion: 1, title: "Cardio", questions: [{ stem: "Q" }] })])).rows[0].r as { share_token: string };
    expect(share.share_token).toMatch(/^[0-9a-f]{48}$/);
    const resolved = await as(db, "anon", null, "select title from public.resolve_question_set_share($1)", [share.share_token]); expect(resolved.rows).toEqual([{ title: "Cardio" }]);
    expect(Number((await as(db, "anon", null, "select count(*)::int as n from public.question_set_shares")).rows[0].n)).toBe(0);
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

});
