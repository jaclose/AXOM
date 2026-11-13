import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { supabasePlatform } from "../sync/supabasePlatform.testing";

// The SQL fixtures previously lived only as manual psql instructions. Run
// them against an isolated, fully migrated PostgreSQL engine in regular CI.
// This is synthetic DB coverage, not authenticated Supabase staging acceptance.
const migrationsDir = fileURLToPath(new URL("../../../../supabase/migrations/", import.meta.url));
const testsDir = fileURLToPath(new URL("../../../../supabase/tests/", import.meta.url));
const migrationFiles = readdirSync(migrationsDir).filter(name => name.endsWith(".sql")).sort();
const sqlSuites = [
  "question_set_library_private_citation_gate.sql",
  "question_set_library_inline_document_uri_gate.sql",
  "question_set_library_approval_citation_gate.sql",
  "question_set_library_approval_snapshot_type_gate.sql",
  "question_set_library_approval_content_bounds_gate.sql",
] as const;

let db: PGlite;
beforeAll(async () => {
  db = await supabasePlatform();
  for (const file of migrationFiles) {
    await db.exec(readFileSync(migrationsDir + file, "utf8"));
  }
}, 120_000);

afterAll(async () => { await db?.close(); });

describe("Community Question Set publication SQL admission (isolated PostgreSQL)", () => {
  it.each(sqlSuites)("executes and rolls back %s", async file => {
    const sql = readFileSync(testsDir + file, "utf8");
    // Each checked-in fixture asserts its own forbidden/allowed transitions,
    // privileges and historical compatibility, then explicitly rolls back.
    // If an assertion fails mid-transaction, clear the failed transaction so
    // the next fixture cannot accidentally inherit its state.
    try {
      await expect(db.exec(sql)).resolves.toBeDefined();
    } finally {
      await db.exec("rollback;");
    }
  }, 60_000);
});
