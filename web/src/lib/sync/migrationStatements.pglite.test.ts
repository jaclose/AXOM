import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { supabasePlatform } from "./supabasePlatform.testing";

/**
 * supabaseMigrations.pglite.test.ts wraps each file in a transaction. Supabase's
 * migration runner does not: it sends a file's statements without a
 * transaction block, where Postgres refuses LOCK TABLE (the Supabase Preview
 * check failed on the privacy barrier that way). This suite applies every
 * migration one statement per round trip, each in its own transaction unless
 * the file opens one, so such a file fails here first.
 */
const migrationsDir = fileURLToPath(new URL("../../../../supabase/migrations/", import.meta.url));
const files = readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort();
const privacyBarrier = "20261016011812_harden_privacy_request_barrier.sql";
const read = (file: string) => readFileSync(migrationsDir + file, "utf8");

/** Top-level statements without their comments; quotes and dollar quotes keep their semicolons. */
function statements(sql: string): string[] {
  const found: string[] = [];
  const dollarTag = /\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/y;
  let current = "";
  let i = 0;
  const take = (end: number) => { current += sql.slice(i, end); i = end; };
  while (i < sql.length) {
    const c = sql[i];
    if (c === "-" && sql[i + 1] === "-") {
      const end = sql.indexOf("\n", i);
      i = end < 0 ? sql.length : end;
    } else if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < sql.length && !(sql[j] === c && sql[j + 1] !== c)) j += sql[j] === c ? 2 : 1;
      take(Math.min(j + 1, sql.length));
    } else if (c === "$" && (dollarTag.lastIndex = i, dollarTag.test(sql))) {
      const tag = sql.slice(i, dollarTag.lastIndex);
      const close = sql.indexOf(tag, dollarTag.lastIndex);
      take(close < 0 ? sql.length : close + tag.length);
    } else if (c === ";") {
      if (current.trim()) found.push(current.trim());
      current = "";
      i++;
    } else take(i + 1);
  }
  if (current.trim()) found.push(current.trim());
  return found;
}

async function apply(db: PGlite, list: readonly string[]) {
  for (const statement of list) await db.query(statement);
}

describe("migrations applied the way Supabase's runner sends them", () => {
  it("splits statements without breaking quoted or dollar-quoted text", () => {
    expect(statements("-- note; here\nselect 'a;b', \"x;\"\"y\";\ncreate function f() returns int language sql as $$ select 1; $$;\ndo $policy$ begin perform 1; end $policy$;"))
      .toEqual(["select 'a;b', \"x;\"\"y\"", "create function f() returns int language sql as $$ select 1; $$", "do $policy$ begin perform 1; end $policy$"]);
  });

  it("applies every migration one statement at a time", async () => {
    const db = await supabasePlatform();
    for (const file of files) await expect(apply(db, statements(read(file))), file).resolves.toBeUndefined();
    const reviewer = await db.query<{ exists: boolean }>("select to_regprocedure('public.academic_is_reviewer()') is not null as exists");
    expect(reviewer.rows[0].exists).toBe(true);
  }, 120_000);

  it("refuses the privacy barrier's table lock without the migration's own transaction", async () => {
    const db = await supabasePlatform();
    for (const file of files.filter((name) => name < privacyBarrier)) await apply(db, statements(read(file)));
    const withoutTransaction = statements(read(privacyBarrier)).filter((statement) => !/^(begin|commit)$/i.test(statement));
    await expect(apply(db, withoutTransaction)).rejects.toThrow(/LOCK TABLE can only be used in transaction blocks/);
  }, 120_000);
});
