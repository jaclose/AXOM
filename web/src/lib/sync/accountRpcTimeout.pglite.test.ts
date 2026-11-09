import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";

const migration = readFileSync(fileURLToPath(new URL(
  "../../../../supabase/migrations/20261109160000_bound_account_v2_rpc_timeout.sql",
  import.meta.url,
)), "utf8");

it("gives both current account save RPCs a bounded statement timeout", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create function public.push_workspace_revision_v2(bigint, integer, text, jsonb, uuid, uuid, text)
        returns jsonb language sql as $$ select '{}'::jsonb $$;
      create function public.push_workspace_delta_v2(bigint, text, integer, text, jsonb, uuid, uuid, text)
        returns jsonb language sql as $$ select '{}'::jsonb $$;
    `);
    await db.exec(migration);
    const { rows } = await db.query<{ proname: string; proconfig: string[] }>(`
      select proname, proconfig from pg_proc
      where oid in (
        'public.push_workspace_revision_v2(bigint,integer,text,jsonb,uuid,uuid,text)'::regprocedure,
        'public.push_workspace_delta_v2(bigint,text,integer,text,jsonb,uuid,uuid,text)'::regprocedure
      ) order by proname
    `);
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.proconfig).toContain("statement_timeout=60s");
  } finally {
    await db.close();
  }
});
