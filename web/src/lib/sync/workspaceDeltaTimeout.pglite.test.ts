import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { supabasePlatform } from "./supabasePlatform.testing";

const migrationsDir = fileURLToPath(new URL("../../../../supabase/migrations/", import.meta.url));
const migration = "20261110230700_delta_rpc_statement_timeout.sql";
const sql = readFileSync(migrationsDir + migration, "utf8");
const signature = "public.push_workspace_delta_v2(bigint,text,integer,text,jsonb,uuid,uuid,text)";

interface FunctionMetadata {
  signature: string;
  prosrc: string;
  prosecdef: boolean;
  proowner: number;
  proacl: string[] | null;
  proconfig: string[] | null;
}

async function database() {
  const db = await supabasePlatform();
  for (const file of readdirSync(migrationsDir).filter(name => name.endsWith(".sql") && name < migration).sort()) {
    await db.exec(readFileSync(migrationsDir + file, "utf8"));
  }
  return db;
}

const metadata = (db: PGlite) => db.query<FunctionMetadata>(`
  select p.oid::regprocedure::text as signature,p.prosrc,p.prosecdef,p.proowner,p.proacl,p.proconfig
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','axom_private')
    and p.proname in ('push_workspace_delta_v2','push_workspace_revision_v2','push_workspace_revision')
  order by p.oid`);

const privileges = (db: PGlite) => db.query(`
  select has_function_privilege('anon',$1,'execute') as anon,
    has_function_privilege('authenticated',$1,'execute') as authenticated,
    has_function_privilege('service_role',$1,'execute') as service_role`, [signature]);

describe("exposed delta revision statement timeout", () => {
  it("changes only delta's bounded timeout, preserving the full writer, invoker privileges and data", async () => {
    const db = await database();
    try {
      await db.exec("alter role authenticated set statement_timeout='8s'");
      const before = (await metadata(db)).rows;
      const deltaBefore = before.find(row => row.signature.includes("push_workspace_delta_v2("));
      expect(deltaBefore).toBeDefined();
      expect(deltaBefore!.prosecdef).toBe(false);
      expect(deltaBefore!.proconfig?.some(setting => setting.startsWith("statement_timeout="))).toBe(false);
      const otherWriter = before.find(row => row.signature.includes("push_workspace_revision_v2("));
      expect(otherWriter?.proconfig).toContain("statement_timeout=60s");
      const aclBefore = (await privileges(db)).rows;
      expect(aclBefore).toEqual([{ anon: false, authenticated: true, service_role: true }]);
      const rolesBefore = (await db.query("select rolname,rolconfig from pg_roles order by rolname")).rows;
      const dataBefore = (await db.query("select count(*)::int as n from public.workspace_revisions")).rows;

      await db.exec(sql);
      const after = (await metadata(db)).rows;
      const changed = after.filter((row, index) => JSON.stringify(row) !== JSON.stringify(before[index]));
      expect(changed).toHaveLength(1);
      expect(changed[0].signature).toMatch(/push_workspace_delta_v2\(bigint,text,integer,text,jsonb,uuid,uuid,text\)$/);
      expect(changed[0].proconfig).toEqual(['search_path=""', "statement_timeout=60s"]);
      expect({ ...changed[0], proconfig: undefined }).toEqual({ ...deltaBefore, proconfig: undefined });
      expect((await privileges(db)).rows).toEqual(aclBefore);
      expect((await db.query("select rolname,rolconfig from pg_roles order by rolname")).rows).toEqual(rolesBefore);
      expect((await db.query("select count(*)::int as n from public.workspace_revisions")).rows).toEqual(dataBefore);
      expect(sql).toMatch(/notify pgrst, 'reload schema'/i);
      // Reapplying a configuration migration must not alter the protected writer.
      await db.exec(sql);
      expect((await metadata(db)).rows).toEqual(after);
    } finally { await db.close(); }
  }, 30_000);
});
