// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrations = resolve(__dirname, "../../../../supabase/migrations");

/**
 * Postgres accepts LOCK TABLE only inside a transaction block, and Supabase's
 * migration runner sends a file's statements without one: the privacy barrier
 * migration failed there with "LOCK TABLE can only be used in transaction
 * blocks". A migration that locks a table must open and close its own.
 */
describe("migration transaction blocks", () => {
  it("wraps every migration that locks a table in one explicit transaction", () => {
    const offenders = readdirSync(migrations).filter(name => name.endsWith(".sql")).filter(name => {
      const code = readFileSync(join(migrations, name), "utf8").replace(/--.*$/gm, "").trim();
      if (!/^\s*lock\s+table\b/im.test(code)) return false;
      return !/^begin\s*;/i.test(code) || !/\bcommit\s*;$/i.test(code);
    });
    expect(offenders).toEqual([]);
  });
});
