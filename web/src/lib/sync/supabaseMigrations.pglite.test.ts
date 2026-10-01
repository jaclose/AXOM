import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { describe, expect, it } from "vitest";

/**
 * Replays every supabase/migrations file against real Postgres (PGlite, WASM)
 * dressed like a hosted Supabase project: anon/authenticated roles, an auth
 * schema, and Supabase's default privileges, which grant EXECUTE on new public
 * functions to anon. Structural tests elsewhere only read the SQL text; this one
 * checks behavior and the resulting function ACLs.
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
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    set search_path = "$user", public, extensions;
  `);
  if (rlsAutoEnable) await db.exec("create function public.rls_auto_enable() returns void language sql as $$ select $$;");
  for (const file of files) await db.exec(`begin;${readFileSync(migrationsDir + file, "utf8")}commit;`);
  return db;
}

async function as(db: PGlite, role: "anon" | "authenticated" | "service_role", sub: string | null, sql: string, params: unknown[] = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${sub ?? ""}', false); set role ${role};`);
  try {
    return await db.query<Record<string, unknown>>(sql, params);
  } finally {
    await db.exec("reset role;");
  }
}

async function canExecute(db: PGlite, role: string, signature: string) {
  const { rows } = await db.query<{ ok: boolean }>("select has_function_privilege($1, $2, 'execute') as ok", [role, signature]);
  return rows[0].ok;
}

const PRIVILEGED = [
  "public.push_workspace_revision(bigint,integer,text,jsonb,uuid,uuid,text)",
  "public.create_question_set_share(text,jsonb)",
  "public.touch_account_device(uuid,text,text,bigint)",
  "public.delete_my_cloud_data()",
  "public.consume_ai_quota()",
  "public.revoke_question_set_share(uuid)",
];

const PRIVATE_TABLES = [
  "account_profiles",
  "workspaces",
  "workspace_revisions",
  "sync_conflicts",
  "question_set_shares",
  "account_devices",
  "ai_usage",
];

describe("Supabase migrations on real Postgres", () => {
  it.each([false, true])("apply cleanly and lock function ACLs (rls_auto_enable present: %s)", async (rlsAutoEnable) => {
    const db = await supabaseLikeDatabase({ rlsAutoEnable });
    for (const signature of PRIVILEGED) {
      expect(await canExecute(db, "anon", signature), `anon on ${signature}`).toBe(false);
      expect(await canExecute(db, "authenticated", signature), `authenticated on ${signature}`).toBe(true);
      expect(await canExecute(db, "service_role", signature), `service_role on ${signature}`).toBe(true);
    }
    expect(await canExecute(db, "anon", "public.revoke_question_set_share(uuid)")).toBe(false);
    expect(await canExecute(db, "authenticated", "public.revoke_question_set_share(uuid)")).toBe(true);
    // The share token is the capability, so anonymous resolution stays open.
    expect(await canExecute(db, "anon", "public.resolve_question_set_share(text)")).toBe(true);
    for (const role of ["anon", "authenticated"]) {
      expect(await canExecute(db, role, "public.handle_new_account()")).toBe(false);
      if (rlsAutoEnable) expect(await canExecute(db, role, "public.rls_auto_enable()")).toBe(false);
    }
    await db.close();
  }, 30_000);

  it("keeps private tables under RLS and fixes search_path on SECURITY DEFINER functions", async () => {
    const db = await supabaseLikeDatabase({ rlsAutoEnable: false });
    const { rows: tables } = await db.query<{ relname: string; relrowsecurity: boolean }>(
      "select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relname = any($1::text[])",
      [PRIVATE_TABLES],
    );
    expect(Object.fromEntries(tables.map(({ relname, relrowsecurity }) => [relname, relrowsecurity]))).toEqual(
      Object.fromEntries(PRIVATE_TABLES.map((name) => [name, true])),
    );

    const { rows: functions } = await db.query<{ signature: string; proconfig: string[] | null }>(
      "select p.oid::regprocedure::text as signature, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef",
    );
    expect(functions.length).toBeGreaterThan(0);
    for (const { signature, proconfig } of functions) {
      expect(proconfig, `${signature} search_path`).toContain("search_path=pg_catalog, public, pg_temp");
    }
    await db.close();
  }, 30_000);

  it("does not let caller temporary tables shadow SECURITY DEFINER data", async () => {
    const db = await supabaseLikeDatabase({ rlsAutoEnable: false });
    await db.query("insert into auth.users(id, email) values ($1, 'a@x.com')", [A]);
    await db.query(
      "insert into public.question_set_shares (owner_user_id, source_question_set_id, share_token, title, question_count, snapshot_payload) values ($1, 'set-1', 'real-token', 'real share', 0, '{\"questions\":[]}'::jsonb)",
      [A],
    );
    await as(db, "anon", null, `create temporary table question_set_shares (
      id uuid, owner_user_id uuid, source_question_set_id text, share_token text,
      share_format_version integer, title text, question_count integer, snapshot_payload jsonb,
      created_at timestamptz, revoked_at timestamptz, expires_at timestamptz
    )`);
    await as(db, "anon", null, "insert into pg_temp.question_set_shares (share_token, title, question_count, share_format_version, snapshot_payload) values ('fake-token', 'shadow row', 0, 1, '{\"questions\":[]}'::jsonb)");

    const real = await as(db, "anon", null, "select title from public.resolve_question_set_share('real-token')");
    const fake = await as(db, "anon", null, "select title from public.resolve_question_set_share('fake-token')");
    expect(real.rows).toEqual([{ title: "real share" }]);
    expect(fake.rows).toEqual([]);
    await db.close();
  }, 30_000);

  it("keeps revisions, devices and shares private and deletion scoped to the caller", async () => {
    const db = await supabaseLikeDatabase({ rlsAutoEnable: false });
    await db.query("insert into auth.users(id, email, raw_user_meta_data) values ($1,'a@x.com','{\"display_name\":\"Ada\"}'), ($2,'b@x.com','{}')", [A, B]);
    const { rows: profiles } = await db.query<{ display_name: string }>("select display_name from public.account_profiles order by display_name");
    expect(profiles.map((row) => row.display_name)).toEqual(["Ada", "b"]);
    expect(Number((await as(db, "service_role", null, "select count(*)::int as n from public.account_profiles")).rows[0].n)).toBe(2);

    const push = async (sub: string, base: number, key: string) => (await as(db, "authenticated", sub,
      "select public.push_workspace_revision($1,33,$2,'{\"ok\":true}'::jsonb,'33333333-3333-4333-8333-333333333333'::uuid,$3::uuid,'automatic') as r",
      [base, HASH, key])).rows[0].r as { status: string; revision?: number; server_revision?: number; idempotent?: boolean };
    expect(await push(A, 0, "44444444-4444-4444-8444-444444444444")).toMatchObject({ status: "accepted", revision: 1 });
    expect(await push(A, 0, "44444444-4444-4444-8444-444444444444")).toMatchObject({ status: "accepted", revision: 1, idempotent: true });
    expect(await push(A, 0, "55555555-5555-4555-8555-555555555555")).toMatchObject({ status: "conflict", server_revision: 1 });
    await expect(as(db, "authenticated", A, "update public.workspaces set current_revision = 999 where user_id = $1", [A])).rejects.toThrow(/permission denied/);
    await expect(as(db, "authenticated", B, "insert into public.account_profiles(user_id, display_name) values ($1, 'Forged') on conflict(user_id) do update set display_name = excluded.display_name", [A]))
      .rejects.toThrow(/row-level security|violates/);
    await expect(as(db, "authenticated", A, "update public.account_profiles set user_id = $1 where user_id = $2", [B, A]))
      .rejects.toThrow(/row-level security|violates/);
    await expect(as(db, "anon", null, "select public.push_workspace_revision(0,33,$1,'{}'::jsonb,gen_random_uuid(),gen_random_uuid(),'automatic')", [HASH]))
      .rejects.toThrow(/permission denied/);

    const count = async (sub: string, table: string) => Number((await as(db, "authenticated", sub, `select count(*)::int as n from public.${table}`)).rows[0].n);
    expect(await count(A, "workspace_revisions")).toBe(2);
    expect(await count(B, "workspace_revisions")).toBe(0);
    expect(await count(B, "workspaces")).toBe(0);
    expect(await count(B, "account_profiles")).toBe(1);
    await as(db, "authenticated", B, "delete from public.account_profiles where user_id = $1", [A]);
    expect(await count(A, "account_profiles")).toBe(1);
    expect(await count(B, "workspace_revisions")).toBe(0);
    await expect(as(db, "authenticated", B, "insert into public.workspace_revisions(workspace_id,user_id,revision,base_revision,schema_version,content_hash,snapshot_payload,device_id,idempotency_key) values (gen_random_uuid(),$1,1,0,33,$2,'{}',gen_random_uuid(),gen_random_uuid())", [B, HASH]))
      .rejects.toThrow(/row-level security|violates/);

    await as(db, "authenticated", A, "select public.touch_account_device('77777777-7777-4777-8777-777777777777'::uuid,'Chrome on Mac','web',2)");
    await as(db, "authenticated", A, "select public.touch_account_device('77777777-7777-4777-8777-777777777777'::uuid,'Chrome on Mac','web',3)");
    expect(await count(A, "account_devices")).toBe(1);
    expect(await count(B, "account_devices")).toBe(0);

    const share = (await as(db, "authenticated", A, "select public.create_question_set_share('set-1', $1::jsonb) as r",
      [JSON.stringify({ shareFormatVersion: 1, title: "Cardio", questions: [{ stem: "Q" }] })])).rows[0].r as { share_token: string };
    expect(share.share_token).toMatch(/^[0-9a-f]{48}$/);
    const resolved = await as(db, "anon", null, "select title from public.resolve_question_set_share($1)", [share.share_token]);
    expect(resolved.rows).toEqual([{ title: "Cardio" }]);
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
    expect(await call(A)).toBe(-1);
    expect(await call(B)).toBe(59);
    const own = await as(db, "authenticated", A, "select user_id, requests from public.ai_usage");
    expect(own.rows).toEqual([{ user_id: A, requests: 60 }]);
    await expect(as(db, "authenticated", A, "update public.ai_usage set requests = 0")).rejects.toThrow();
    await expect(as(db, "authenticated", A, "select public.consume_ai_quota(500)")).rejects.toThrow();
    await expect(as(db, "anon", null, "select public.consume_ai_quota()")).rejects.toThrow();
    await db.close();
  }, 30_000);

  it("bounds per-account conflict and share snapshot storage", async () => {
    const db = await supabaseLikeDatabase({ rlsAutoEnable: false });
    await db.query("insert into auth.users(id, email) values ($1, 'a@x.com')", [A]);
    const push = async (base: number, key: string, reason = "automatic") => as(db, "authenticated", A,
      "select public.push_workspace_revision($1,33,$2,'{\"ok\":true}'::jsonb,gen_random_uuid(),$3::uuid,$4) as r",
      [base, HASH, key, reason]);
    await push(0, "44444444-4444-4444-8444-444444444444");
    for (let index = 0; index < 20; index += 1) {
      await push(0, `55555555-5555-4555-8555-${String(index).padStart(12, "0")}`);
    }
    // At the limit the caller still learns it is in conflict; no further copy is stored.
    expect((await push(0, "66666666-6666-4666-8666-666666666666")).rows[0].r).toEqual({ status: "conflict", server_revision: 1, preserved_revision_id: null, preserved: false });
    expect(Number((await db.query<{ n: number }>("select count(*)::int as n from public.workspace_revisions where user_id=$1 and reason='conflict'", [A])).rows[0].n)).toBe(20);
    expect(Number((await db.query<{ n: number }>("select count(*)::int as n from public.sync_conflicts where user_id=$1 and resolved_at is null", [A])).rows[0].n)).toBe(20);
    const resolution = await push(1, "77777777-7777-4777-8777-777777777777", "manual");
    expect(resolution.rows[0].r).toMatchObject({ status: "accepted", revision: 2 });
    expect(Number((await db.query<{ n: number }>("select count(*)::int as n from public.sync_conflicts where user_id=$1 and resolved_at is null", [A])).rows[0].n)).toBe(0);
    expect(Number((await db.query<{ n: number }>("select count(*)::int as n from public.workspace_revisions where user_id=$1 and reason='conflict'", [A])).rows[0].n)).toBe(0);
    await expect(push(0, "88888888-8888-4888-8888-888888888888")).resolves.toBeDefined();

    const snapshot = JSON.stringify({ shareFormatVersion: 1, title: "Bounded", questions: [{ stem: "Q" }] });
    await expect(as(db, "authenticated", A, "select public.create_question_set_share('missing-version', '{\"questions\":[]}'::jsonb)"))
      .rejects.toThrow(/invalid share format/);
    await expect(as(db, "authenticated", A, "select public.create_question_set_share('null-version', '{\"shareFormatVersion\":null,\"questions\":[]}'::jsonb)"))
      .rejects.toThrow(/invalid share format/);
    expect(Number((await db.query<{ n: number }>("select count(*)::int as n from public.question_set_shares where owner_user_id=$1", [A])).rows[0].n)).toBe(0);
    let firstShareId = "";
    for (let index = 0; index < 20; index += 1) {
      const result = await as(db, "authenticated", A, "select public.create_question_set_share($1, $2::jsonb) as share", [`set-${index}`, snapshot]);
      if (index === 0) firstShareId = String((result.rows[0].share as { id: string }).id);
    }
    await expect(as(db, "authenticated", A, "select public.create_question_set_share('overflow', $1::jsonb)", [snapshot]))
      .rejects.toThrow(/storage limit/);
    await as(db, "authenticated", A, "select public.revoke_question_set_share($1::uuid)", [firstShareId]);
    expect(Number((await db.query<{ n: number }>("select count(*)::int as n from public.question_set_shares where owner_user_id=$1 and revoked_at is null", [A])).rows[0].n)).toBe(19);
    expect((await db.query<{ snapshot_payload: unknown }>("select snapshot_payload from public.question_set_shares where id=$1", [firstShareId])).rows[0].snapshot_payload)
      .toEqual({ shareFormatVersion: 1, title: "Revoked", questions: [] });
    await as(db, "authenticated", A, "select public.create_question_set_share('replacement', $1::jsonb)", [snapshot]);
    expect(Number((await db.query<{ n: number }>("select count(*)::int as n from public.question_set_shares where owner_user_id=$1 and revoked_at is null", [A])).rows[0].n)).toBe(20);
    await db.close();
  }, 30_000);

  it("prunes canonical history to the storage budget instead of refusing new revisions", async () => {
    const db = await supabaseLikeDatabase({ rlsAutoEnable: false });
    await db.query("insert into auth.users(id, email) values ($1, 'a@x.com')", [A]);
    // Random base64 does not compress, so each revision stores about 9 MB.
    const snapshot = JSON.stringify({ blob: randomBytes(6_750_000).toString("base64") });
    const kept = async () => (await db.query<{ revision: number }>("select revision::int as revision from public.workspace_revisions where user_id=$1 and reason<>'conflict' order by revision", [A])).rows.map((row) => row.revision);
    const stored = async () => Number((await db.query<{ bytes: string }>("select coalesce(sum(pg_column_size(snapshot_payload)),0)::bigint as bytes from public.workspace_revisions where user_id=$1 and reason<>'conflict'", [A])).rows[0].bytes);
    const push = async (base: number) => (await as(db, "authenticated", A,
      "select public.push_workspace_revision($1,34,$2,$3::jsonb,gen_random_uuid(),gen_random_uuid(),'automatic') as r",
      [base, HASH, snapshot])).rows[0].r as { status: string; revision: number };

    // An account that grew past the budget before it existed: eight revisions, about 72 MB.
    await db.query("insert into public.workspaces(user_id, current_revision, current_hash) values ($1, 8, $2)", [A, HASH]);
    await db.query(`insert into public.workspace_revisions(workspace_id,user_id,revision,base_revision,schema_version,content_hash,snapshot_payload,device_id,idempotency_key,reason)
      select w.id, w.user_id, n, n - 1, 34, $2, $3::jsonb, gen_random_uuid(), gen_random_uuid(), 'automatic'
      from public.workspaces w, generate_series(1, 8) n where w.user_id = $1`, [A, HASH, snapshot]);
    expect(await stored()).toBeGreaterThan(50_000_000);

    // The next upload is accepted (it used to be refused forever) and the oldest history goes.
    expect(await push(8)).toMatchObject({ status: "accepted", revision: 9 });
    expect(await kept()).toEqual([5, 6, 7, 8, 9]);
    expect(await stored()).toBeLessThanOrEqual(50_000_000);
    for (const base of [9, 10]) expect(await push(base)).toMatchObject({ status: "accepted", revision: base + 1 });
    expect(await kept()).toEqual([7, 8, 9, 10, 11]);
    expect(await stored()).toBeLessThanOrEqual(50_000_000);
    await db.close();
  }, 120_000);

  it("keeps small histories at sixty revisions", async () => {
    const db = await supabaseLikeDatabase({ rlsAutoEnable: false });
    await db.query("insert into auth.users(id, email) values ($1, 'a@x.com')", [A]);
    for (let base = 0; base < 63; base += 1) {
      await as(db, "authenticated", A, "select public.push_workspace_revision($1,34,$2,'{\"ok\":true}'::jsonb,gen_random_uuid(),gen_random_uuid(),'automatic')", [base, HASH]);
    }
    const { rows } = await db.query<{ n: number; oldest: number; newest: number }>("select count(*)::int as n, min(revision)::int as oldest, max(revision)::int as newest from public.workspace_revisions where user_id=$1", [A]);
    expect(rows[0]).toEqual({ n: 60, oldest: 4, newest: 63 });
    await db.close();
  }, 60_000);

  it("refuses with client errors, never a server error, and replays retries faithfully", async () => {
    const db = await supabaseLikeDatabase({ rlsAutoEnable: false });
    await db.query("insert into auth.users(id, email) values ($1, 'a@x.com')", [A]);
    const call = (base: number | null, key: string, payload: string, hash = HASH) => as(db, "authenticated", A,
      "select public.push_workspace_revision($1,34,$2,$3::jsonb,'33333333-3333-4333-8333-333333333333'::uuid,$4::uuid,'automatic') as r",
      [base, hash, payload, key]);

    // PostgREST turns SQLSTATE PT413 into HTTP 413; class 54 would be HTTP 500.
    await expect(call(0, "44444444-4444-4444-8444-444444444444", JSON.stringify({ payload: "x".repeat(15_000_001) })))
      .rejects.toMatchObject({ code: "PT413", message: expect.stringMatching(/too large/) });
    await expect(call(null, "44444444-4444-4444-8444-444444444444", "{}")).rejects.toMatchObject({ code: "P0001", message: expect.stringMatching(/invalid snapshot metadata/) });
    const { rows: [definition] } = await db.query<{ sql: string }>("select pg_get_functiondef('public.push_workspace_revision(bigint,integer,text,jsonb,uuid,uuid,text)'::regprocedure) as sql");
    expect(definition.sql).not.toMatch(/errcode\s*=\s*'5/);
    // Retained snapshots are measured where they are stored, never converted to text.
    expect(definition.sql).not.toMatch(/(?<!p_)snapshot_payload\s*::\s*text/);

    // A retry of an accepted upload returns the stored hash, so newer content is not mistaken for protected.
    const other = "b".repeat(64);
    expect((await call(0, "55555555-5555-4555-8555-555555555555", "{\"v\":1}")).rows[0].r).toMatchObject({ status: "accepted", revision: 1, idempotent: false });
    expect((await call(0, "55555555-5555-4555-8555-555555555555", "{\"v\":2}", other)).rows[0].r).toMatchObject({ status: "accepted", revision: 1, idempotent: true, content_hash: HASH });
    // A retry of an upload that was preserved as a conflict stays a conflict.
    const conflict = (await call(0, "66666666-6666-4666-8666-666666666666", "{\"v\":3}")).rows[0].r as { preserved_revision_id: string };
    expect(conflict).toMatchObject({ status: "conflict", server_revision: 1, preserved: true });
    expect((await call(0, "66666666-6666-4666-8666-666666666666", "{\"v\":3}")).rows[0].r).toEqual({ status: "conflict", server_revision: 1, preserved_revision_id: conflict.preserved_revision_id, preserved: true });
    expect(Number((await db.query<{ n: number }>("select count(*)::int as n from public.workspace_revisions where user_id=$1", [A])).rows[0].n)).toBe(2);
    await db.close();
  }, 60_000);
});
