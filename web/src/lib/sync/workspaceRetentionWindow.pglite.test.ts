import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { supabasePlatform } from "./supabasePlatform.testing";

const migrationsDir = fileURLToPath(new URL("../../../../supabase/migrations/", import.meta.url));
const migration = "20261105010000_restore_v2_retention_cleanup_window.sql";
const sql = readFileSync(migrationsDir + migration, "utf8");
const signature = "public.push_workspace_revision_v2(bigint,integer,text,jsonb,uuid,uuid,text)";
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const HASH = "a".repeat(64);
const snapshot = { _axomCloudFormat: 2, content: "{}", expandedBytes: 2, media: [], sources: [] };

async function database() {
  const db = await supabasePlatform();
  for (const file of readdirSync(migrationsDir).filter(name => name.endsWith(".sql") && name < migration).sort()) {
    await db.exec(readFileSync(migrationsDir + file, "utf8"));
  }
  return db;
}

async function push(db: PGlite, user: string, base: number, key = randomUUID(), reason = "automatic") {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec("set role authenticated");
  try {
    return (await db.query<{ result: Record<string, unknown> }>(
      "select public.push_workspace_revision_v2($1,34,$2,$3,gen_random_uuid(),$4,$5) as result",
      [base, HASH, snapshot, key, reason],
    )).rows[0].result;
  } finally { await db.exec("reset role"); }
}

interface FunctionMetadataRow {
  signature: string;
  prosrc: string;
  prosecdef: boolean;
  proowner: number;
  proacl: string[] | null;
  proconfig: string[] | null;
}

const functionMetadata = (db: PGlite) => db.query<FunctionMetadataRow>(`
  select p.oid::regprocedure::text as signature,p.prosrc,p.prosecdef,p.proowner,p.proacl,p.proconfig
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','axom_private') order by p.oid`);

describe("v2 revision retention cleanup allowance", () => {
  it("changes only the exposed v2 timeout, preserving function bodies, access and role defaults", async () => {
    const db = await database();
    try {
      // Model the existing hosted role default; the migration must not alter it.
      await db.exec("alter role authenticated set statement_timeout='8s'");
      const before = await functionMetadata(db);
      const roles = await db.query("select rolname,rolconfig from pg_roles order by rolname");
      const permissions = await db.query(`select
        has_function_privilege('anon',$1,'execute') as anon,
        has_function_privilege('authenticated',$1,'execute') as authenticated,
        has_function_privilege('service_role',$1,'execute') as service_role`, [signature]);
      expect(permissions.rows).toEqual([{ anon: false, authenticated: true, service_role: true }]);
      await db.exec(sql);
      const after = await functionMetadata(db);
      const changed = after.rows.filter((row, index) => JSON.stringify(row) !== JSON.stringify(before.rows[index]));
      expect(changed).toHaveLength(1);
      expect(changed[0].signature).toBe(signature.replace("public.", ""));
      expect(changed[0].prosecdef).toBe(false);
      expect(changed[0].proconfig).toEqual(["search_path=pg_catalog, public, pg_temp", "statement_timeout=60s"]);
      expect({ ...changed[0], proconfig: undefined }).toEqual({
        ...before.rows.find(row => row.signature === changed[0].signature), proconfig: undefined,
      });
      expect((await db.query("select rolname,rolconfig from pg_roles order by rolname")).rows).toEqual(roles.rows);
      expect((await db.query("select count(*)::integer as n from public.workspace_revisions")).rows).toEqual([{ n: 0 }]);
      expect(sql).toMatch(/notify pgrst, 'reload schema'/i);
      // Reapplying the migration neither changes metadata again nor rewrites data.
      await db.exec(sql);
      expect((await functionMetadata(db)).rows).toEqual(after.rows);
    } finally { await db.close(); }
  }, 30_000);

  it("retains exactly sixty newest canonical versions, owner isolation, conflicts and retry receipts", async () => {
    const db = await database();
    try {
      await db.query("insert into auth.users(id,email) values($1,'a@test.invalid'),($2,'b@test.invalid')", [A, B]);
      await db.query("insert into public.workspaces(user_id,current_revision,current_hash) values($1,60,$3),($2,60,$3)", [A, B, HASH]);
      await db.query(`insert into public.workspace_revisions
        (workspace_id,user_id,revision,base_revision,schema_version,content_hash,snapshot_payload,device_id,idempotency_key,reason)
        select w.id,w.user_id,n,n-1,34,$1,'{}'::jsonb,gen_random_uuid(),gen_random_uuid(),'automatic'
        from public.workspaces w cross join generate_series(1,60) n`, [HASH]);
      const otherBefore = await db.query("select * from public.workspace_revisions where user_id=$1 order by revision", [B]);
      const conflict = await push(db, A, 0);
      expect(conflict).toMatchObject({ status: "conflict", server_revision: 60, preserved: true });
      const historyBeforeMigration = await db.query("select * from public.workspace_revisions order by id");
      await db.exec(sql);
      expect((await db.query("select * from public.workspace_revisions order by id")).rows).toEqual(historyBeforeMigration.rows);
      const retryKey = randomUUID();
      const receipt = await push(db, A, 60, retryKey);
      expect(receipt).toMatchObject({ status: "accepted", revision: 61, idempotent: false });
      const kept = await db.query<{ revision: number }>("select revision::integer as revision from public.workspace_revisions where user_id=$1 and reason<>'conflict' order by revision", [A]);
      expect(kept.rows.map(row => row.revision)).toEqual(Array.from({ length: 60 }, (_, i) => i + 2));
      expect((await db.query("select id from public.workspace_revisions where id=$1 and reason='conflict'", [conflict.preserved_revision_id])).rows).toHaveLength(1);
      expect(await push(db, A, 60, retryKey)).toMatchObject({ status: "accepted", revision: 61, revision_id: receipt.revision_id, idempotent: true, content_hash: HASH });
      expect((await db.query("select * from public.workspace_revisions where user_id=$1 order by revision", [B])).rows).toEqual(otherBefore.rows);
      expect(await push(db, A, 61, randomUUID(), "manual")).toMatchObject({ status: "accepted", revision: 62 });
      expect((await db.query("select id from public.workspace_revisions where id=$1", [conflict.preserved_revision_id])).rows).toEqual([]);
      expect((await db.query("select resolved_at is not null as resolved,preserved_revision_id from public.sync_conflicts where user_id=$1", [A])).rows)
        .toEqual([{ resolved: true, preserved_revision_id: null }]);
    } finally { await db.close(); }
  }, 30_000);

  it("rolls an interrupted retention save back atomically before retrying the same receipt", async () => {
    const db = await database();
    try {
      await db.exec(sql);
      await db.query("insert into auth.users(id,email) values($1,'rollback@test.invalid')", [A]);
      await db.query("insert into public.workspaces(user_id,current_revision,current_hash) values($1,60,$2)", [A, HASH]);
      await db.query(`insert into public.workspace_revisions
        (workspace_id,user_id,revision,base_revision,schema_version,content_hash,snapshot_payload,device_id,idempotency_key,reason)
        select w.id,w.user_id,n,n-1,34,$1,'{}'::jsonb,gen_random_uuid(),gen_random_uuid(),'automatic'
        from public.workspaces w cross join generate_series(1,60) n`, [HASH]);
      const before = await db.query("select * from public.workspace_revisions order by revision");
      const workspaceBefore = await db.query("select * from public.workspaces");
      const key = randomUUID();
      // Fixture-only interruption at the actual pruning boundary, not a runtime change.
      await db.exec(`create function public.test_interrupt_retention() returns trigger language plpgsql as $$
        begin raise exception 'simulated retention cancellation' using errcode='57014'; end $$;
        create trigger test_interrupt_retention before delete on public.workspace_revisions
        for each row execute function public.test_interrupt_retention();`);
      await expect(push(db, A, 60, key)).rejects.toMatchObject({ code: "57014" });
      expect((await db.query("select * from public.workspace_revisions order by revision")).rows).toEqual(before.rows);
      expect((await db.query("select * from public.workspaces")).rows).toEqual(workspaceBefore.rows);
      await db.exec("drop trigger test_interrupt_retention on public.workspace_revisions; drop function public.test_interrupt_retention()");
      expect(await push(db, A, 60, key)).toMatchObject({ status: "accepted", revision: 61, idempotent: false });
      expect(await push(db, A, 60, key)).toMatchObject({ status: "accepted", revision: 61, idempotent: true });
    } finally { await db.close(); }
  }, 30_000);
});
