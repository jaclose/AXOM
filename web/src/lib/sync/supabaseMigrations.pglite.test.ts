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

async function as(db: PGlite, role: "anon" | "authenticated", sub: string | null, sql: string, params: unknown[] = []) {
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
];

describe("Supabase migrations on real Postgres", () => {
  it.each([false, true])("apply cleanly and lock function ACLs (rls_auto_enable present: %s)", async (rlsAutoEnable) => {
    const db = await supabaseLikeDatabase({ rlsAutoEnable });
    for (const signature of PRIVILEGED) {
      expect(await canExecute(db, "anon", signature), `anon on ${signature}`).toBe(false);
      expect(await canExecute(db, "authenticated", signature), `authenticated on ${signature}`).toBe(true);
    }
    // The share token is the capability, so anonymous resolution stays open.
    expect(await canExecute(db, "anon", "public.resolve_question_set_share(text)")).toBe(true);
    for (const role of ["anon", "authenticated"]) {
      expect(await canExecute(db, role, "public.handle_new_account()")).toBe(false);
      if (rlsAutoEnable) expect(await canExecute(db, role, "public.rls_auto_enable()")).toBe(false);
    }
    await db.close();
  }, 30_000);

  it("keeps revisions, devices and shares private and deletion scoped to the caller", async () => {
    const db = await supabaseLikeDatabase({ rlsAutoEnable: false });
    await db.query("insert into auth.users(id, email, raw_user_meta_data) values ($1,'a@x.com','{\"display_name\":\"Ada\"}'), ($2,'b@x.com','{}')", [A, B]);
    const { rows: profiles } = await db.query<{ display_name: string }>("select display_name from public.account_profiles order by display_name");
    expect(profiles.map((row) => row.display_name)).toEqual(["Ada", "b"]);

    const push = async (sub: string, base: number, key: string) => (await as(db, "authenticated", sub,
      "select public.push_workspace_revision($1,33,$2,'{\"ok\":true}'::jsonb,'33333333-3333-4333-8333-333333333333'::uuid,$3::uuid,'automatic') as r",
      [base, HASH, key])).rows[0].r as { status: string; revision?: number; server_revision?: number; idempotent?: boolean };
    expect(await push(A, 0, "44444444-4444-4444-8444-444444444444")).toMatchObject({ status: "accepted", revision: 1 });
    expect(await push(A, 0, "44444444-4444-4444-8444-444444444444")).toMatchObject({ status: "accepted", revision: 1, idempotent: true });
    expect(await push(A, 0, "55555555-5555-4555-8555-555555555555")).toMatchObject({ status: "conflict", server_revision: 1 });
    await expect(as(db, "anon", null, "select public.push_workspace_revision(0,33,$1,'{}'::jsonb,gen_random_uuid(),gen_random_uuid(),'automatic')", [HASH]))
      .rejects.toThrow(/permission denied/);

    const count = async (sub: string, table: string) => Number((await as(db, "authenticated", sub, `select count(*)::int as n from public.${table}`)).rows[0].n);
    expect(await count(A, "workspace_revisions")).toBe(2);
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

    await as(db, "authenticated", A, "select public.delete_my_cloud_data()");
    const { rows: left } = await db.query<{ n: number }>(`select
      (select count(*) from public.workspace_revisions where user_id=$1)::int + (select count(*) from public.workspaces where user_id=$1)::int +
      (select count(*) from public.account_devices where user_id=$1)::int + (select count(*) from public.question_set_shares where owner_user_id=$1)::int as n`, [A]);
    expect(left[0].n).toBe(0);
    expect((await db.query<{ n: number }>("select count(*)::int as n from public.account_profiles where user_id=$1", [A])).rows[0].n).toBe(1);
    await db.close();
  }, 30_000);
});
