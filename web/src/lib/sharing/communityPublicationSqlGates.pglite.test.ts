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
  it("rejects a historical private citation through the actual reviewer RPC", async () => {
    // Synthetic users and a legacy row are isolated to this PGlite instance.
    // A pre-gate snapshot is reproduced by briefly disabling *user* triggers,
    // never by changing real learner data or the deployed admission rules.
    const owner = "a1111111-1111-4111-8111-111111111111";
    const reviewer = "a3333333-3333-4333-8333-333333333333";
    const learner = "a2222222-2222-4222-8222-222222222222";
    await db.query(
      "insert into auth.users(id,email) values($1,'publisher@example.test'),($2,'reviewer@example.test'),($3,'learner@example.test')",
      [owner, reviewer, learner],
    );
    await db.query("insert into public.academic_reviewers(user_id) values($1)", [reviewer]);

    async function as<T = Record<string, unknown>>(
      account: string, sql: string, params: unknown[] = [],
    ): Promise<T[]> {
      await db.exec("reset role;");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [account]);
      await db.exec("set role authenticated;");
      try { return (await db.query<T>(sql, params)).rows; }
      finally { await db.exec("reset role;"); }
    }

    const safe = {
      shareFormatVersion: 1,
      title: "Synthetic reviewer admission",
      tags: [],
      orderedQuestionIds: ["shared-q1"],
      questions: [{
        id: "shared-q1",
        stem: "Which synthetic option is marked in the source?",
        options: [{ key: "A", text: "Marked" }, { key: "B", text: "Not marked" }],
        correctKey: "A",
        tags: [],
        citation: "PMID: 123456",
      }],
      createdAt: "2026-11-13T07:00:00Z",
      copyrightNotice: "Original synthetic test material",
    };
    const submit = async (sourceId: string, snapshot: typeof safe) => {
      const [row] = await as<{ id: string }>(owner,
        "select public.submit_question_set_library($1,$2::jsonb,$3,$4,$5) id",
        [sourceId, JSON.stringify(snapshot), "Synthetic author", true, true]);
      return row.id;
    };
    const review = (id: string, snapshot: typeof safe, revision: number, approved: boolean) =>
      as(reviewer,
        "select public.review_question_set_library($1,$2,$3,$4::jsonb,$5::bigint)",
        [id, approved, "Reviewed synthetic provenance and citation rights", JSON.stringify(snapshot), revision]);

    const id = await submit("synthetic-pre-citation-gate", safe);
    const legacy = {
      ...safe,
      questions: [{ ...safe.questions[0], citation: "file:///Users/synthetic/private-notes.pdf" }],
    };
    await db.exec("alter table public.question_set_library_entries disable trigger user;");
    try {
      await db.query(
        "update public.question_set_library_entries set snapshot_payload=$1::jsonb where id=$2",
        [JSON.stringify(legacy), id],
      );
    } finally {
      await db.exec("alter table public.question_set_library_entries enable trigger user;");
    }
    const [before] = (await db.query<{ status: string; review_revision: number }>(
      "select status,review_revision from public.question_set_library_entries where id=$1", [id],
    )).rows;
    expect(before.status).toBe("pending");
    await expect(review(id, legacy, before.review_revision, true))
      .rejects.toThrow(/citation requires privacy review/i);
    const [held] = (await db.query<{ status: string; snapshot_payload: typeof safe; review_revision: number }>(
      "select status,snapshot_payload,review_revision from public.question_set_library_entries where id=$1", [id],
    )).rows;
    expect(held).toMatchObject({
      status: "pending", snapshot_payload: legacy, review_revision: before.review_revision,
    });
    expect(await as<{ id: string }>(learner,
      "select id from public.list_question_set_library($1,0)", ["Synthetic reviewer admission"]))
      .toEqual([]);
    await expect(as(learner, "select public.get_question_set_library($1)", [id]))
      .rejects.toThrow(/unavailable/i);
    // Moderation can still reject the legacy row, preserving original evidence.
    await review(id, legacy, before.review_revision, false);
    const [rejected] = (await db.query<{ status: string; snapshot_payload: typeof safe }>(
      "select status,snapshot_payload from public.question_set_library_entries where id=$1", [id],
    )).rows;
    expect(rejected).toMatchObject({ status: "rejected", snapshot_payload: legacy });

    // Positive control: a separately submitted keyed, public-source set remains
    // approvable and discoverable. No generated explanation gains review status.
    const safeId = await submit("synthetic-reviewed-safe", safe);
    await review(safeId, safe, 1, true);
    expect((await as<{ id: string }>(learner,
      "select id from public.list_question_set_library($1,0)", ["Synthetic reviewer admission"]))
      .map(row => row.id)).toContain(safeId);
    const [preview] = await as<{ value: { status: string; snapshot_payload: typeof safe } }>(
      learner, "select public.get_question_set_library($1) value", [safeId],
    );
    expect(preview.value).toMatchObject({ status: "approved", snapshot_payload: safe });
  }, 60_000);

  it("isolates a matching source ID across two learner publishers and owner withdrawals", async () => {
    const publisherA = "a1111111-1111-4111-8111-111111111111";
    const publisherB = "a2222222-2222-4222-8222-222222222222";
    const reviewer = "a3333333-3333-4333-8333-333333333333";
    const sourceId = "synthetic-colliding-local-source-r101";
    const makeSnapshot = (title: string) => ({
      shareFormatVersion: 1,
      title,
      tags: [],
      orderedQuestionIds: ["r101-q1"],
      questions: [{
        id: "r101-q1", stem: "Which synthetic label is keyed?",
        options: [{ key: "A", text: "Keyed" }, { key: "B", text: "Not keyed" }],
        correctKey: "A", tags: [], citation: "PMID: 123456",
      }],
      createdAt: "2026-11-13T08:00:00Z",
      copyrightNotice: "Original synthetic test material",
    });
    const first = makeSnapshot("Publisher A public candidate");
    const second = makeSnapshot("Publisher B private candidate");

    async function as<T = Record<string, unknown>>(account: string, sql: string, args: unknown[] = []): Promise<T[]> {
      await db.exec("reset role;");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [account]);
      await db.exec("set role authenticated;");
      try { return (await db.query<T>(sql, args)).rows; }
      finally { await db.exec("reset role;"); }
    }
    const submit = async (account: string, value: typeof first) => {
      const [row] = await as<{ id: string }>(account,
        "select public.submit_question_set_library($1,$2::jsonb,'Synthetic author',true,true) id",
        [sourceId, JSON.stringify(value)]);
      return row.id;
    };

    const firstId = await submit(publisherA, first);
    const secondId = await submit(publisherB, second);
    expect(firstId).not.toBe(secondId);
    const ownA = await as<{ id: string }>(publisherA, "select id from public.my_question_set_library()");
    const ownB = await as<{ id: string }>(publisherB, "select id from public.my_question_set_library()");
    expect(ownA.map(row => row.id)).toContain(firstId);
    expect(ownA.map(row => row.id)).not.toContain(secondId);
    expect(ownB.map(row => row.id)).toContain(secondId);
    expect(ownB.map(row => row.id)).not.toContain(firstId);
    await expect(as(publisherA, "select public.get_question_set_library($1)", [secondId]))
      .rejects.toThrow(/unavailable/i);
    await expect(as(publisherB, "select public.get_question_set_library($1)", [firstId]))
      .rejects.toThrow(/unavailable/i);

    // Security-definer withdrawal must use the JWT owner, not a caller-supplied
    // local source identity. A cross-account request is a no-op.
    await as(publisherB, "select public.withdraw_question_set_library($1)", [firstId]);
    await as(publisherA, "select public.withdraw_question_set_library($1)", [secondId]);
    const pending = (await db.query<{ id: string; owner_id: string; status: string }>(
      "select id,owner_id,status from public.question_set_library_entries where id in ($1,$2)",
      [firstId, secondId])).rows;
    expect(pending).toEqual(expect.arrayContaining([
      { id: firstId, owner_id: publisherA, status: "pending" },
      { id: secondId, owner_id: publisherB, status: "pending" },
    ]));

    await as(reviewer,
      "select public.review_question_set_library($1,true,'Inspected original synthetic rights and keys',$2::jsonb,1::bigint)",
      [firstId, JSON.stringify(first)]);
    expect((await as<{ id: string }>(publisherB,
      "select id from public.list_question_set_library($1,0)", ["Publisher A public candidate"]))
      .map(row => row.id)).toContain(firstId);
    expect(await as<{ id: string }>(publisherA,
      "select id from public.list_question_set_library($1,0)", ["Publisher B private candidate"]))
      .toEqual([]);
    const [approvedPreview] = await as<{ value: { status: string } }>(publisherB,
      "select public.get_question_set_library($1) value", [firstId]);
    expect(approvedPreview.value.status).toBe("approved");

    await as(publisherB, "select public.withdraw_question_set_library($1)", [secondId]);
    const surviving = (await db.query<{ id: string; status: string }>(
      "select id,status from public.question_set_library_entries where id in ($1,$2)",
      [firstId, secondId])).rows;
    expect(surviving).toEqual([{ id: firstId, status: "approved" }]);
  }, 60_000);

});
