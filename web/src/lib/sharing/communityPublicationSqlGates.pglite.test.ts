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
        explanation: "Synthetic teaching rationale: A matches the source-defined fixture rule, whereas B does not.",
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
        correctKey: "A",
        explanation: "Synthetic teaching rationale: the source-defined rule marks A but not B.",
        tags: [], citation: "PMID: 123456",
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

    // A learner's approved preview authorizes only this exact publication
    // edition. The publisher can withdraw it after the learner opens it;
    // that prior receipt must never authorize a later import, including if
    // an identical source set is shared again under the same local ID.
    const authorize = (id: string, revision: number, value: typeof first) =>
      as<{ value: {
        id: string; status: string; review_revision: number;
        snapshot_payload: typeof first;
      } }>(publisherB,
        "select public.authorize_question_set_library_import($1,$2::bigint,$3::jsonb) value",
        [id, revision, JSON.stringify(value)]);
    const [originalReceipt] = await authorize(firstId, 2, first);
    expect(originalReceipt.value).toMatchObject({
      id: firstId, status: "approved", review_revision: 2, snapshot_payload: first,
    });

    await as(publisherA, "select public.withdraw_question_set_library($1)", [firstId]);
    await expect(authorize(firstId, 2, first))
      .rejects.toThrow(/changed or was withdrawn/i);
    await expect(as(publisherB, "select public.get_question_set_library($1)", [firstId]))
      .rejects.toThrow(/unavailable/i);
    expect(await as<{ id: string }>(publisherB,
      "select id from public.list_question_set_library($1,0)", ["Publisher A public candidate"]))
      .toEqual([]);

    // Identical source identity and source-verified answer key do not revive
    // a withdrawn entry UUID or bypass a fresh academic review decision.
    const newId = await submit(publisherA, first);
    expect(newId).not.toBe(firstId);
    await expect(authorize(firstId, 2, first))
      .rejects.toThrow(/changed or was withdrawn/i);
    await expect(authorize(newId, 1, first))
      .rejects.toThrow(/changed or was withdrawn/i); // pending, not public
    await as(reviewer,
      "select public.review_question_set_library($1,true,'New edition source and rights reviewed',$2::jsonb,1::bigint)",
      [newId, JSON.stringify(first)]);
    const [freshReceipt] = await authorize(newId, 2, first);
    expect(freshReceipt.value).toMatchObject({
      id: newId, status: "approved", review_revision: 2, snapshot_payload: first,
    });
    await expect(authorize(firstId, 2, first))
      .rejects.toThrow(/changed or was withdrawn/i);
    const visible = await as<{ id: string }>(publisherB,
      "select id from public.list_question_set_library($1,0)", ["Publisher A public candidate"]);
    expect(visible.map(row => row.id)).toContain(newId);
    expect(visible.map(row => row.id)).not.toContain(firstId);
    expect(visible.map(row => row.id)).not.toContain(secondId);
  }, 60_000);

  it("requires a separate academic reviewer for publication, including direct status updates", async () => {
    // A publisher may also hold reviewer privileges. This must not turn their
    // own attestation into an independent academic approval. Synthetic only.
    const author = "c1111111-1111-4111-8111-111111111111";
    const reviewer = "c3333333-3333-4333-8333-333333333333";
    const learner = "c2222222-2222-4222-8222-222222222222";
    await db.query(
      "insert into auth.users(id,email) values($1,'self-review-author@example.test'),($2,'independent-reviewer@example.test'),($3,'review-learner@example.test')",
      [author, reviewer, learner],
    );
    await db.query("insert into public.academic_reviewers(user_id) values($1),($2)", [author, reviewer]);

    async function as<T = Record<string, unknown>>(account: string, sql: string, params: unknown[] = []): Promise<T[]> {
      await db.exec("reset role;");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [account]);
      await db.exec("set role authenticated;");
      try { return (await db.query<T>(sql, params)).rows; }
      finally { await db.exec("reset role;"); }
    }
    const snapshot = {
      shareFormatVersion: 1,
      title: "Independent academic review R103",
      tags: [],
      orderedQuestionIds: ["independent-q1"],
      questions: [{
        id: "independent-q1", stem: "Which source-marked synthetic option is keyed?",
        options: [{ key: "A", text: "Recorded answer" }, { key: "B", text: "Distractor" }],
        correctKey: "A",
        explanation: "Synthetic teaching rationale: the source-defined rule marks A but not B.",
        tags: [], citation: "PMID: 123456",
      }],
      createdAt: "2026-11-13T10:00:00Z",
      copyrightNotice: "Original synthetic testing material",
    };
    const [entry] = await as<{ id: string }>(author,
      "select public.submit_question_set_library($1,$2::jsonb,'Synthetic original author',true,true) id",
      ["r103-author-is-reviewer", JSON.stringify(snapshot)]);
    const decide = (who: string) => as(who,
      "select public.review_question_set_library($1,true,$2,$3::jsonb,1::bigint)",
      [entry.id, "Inspected the independent synthetic source and sharing rights", JSON.stringify(snapshot)]);
    await expect(decide(author)).rejects.toThrow(/independent academic reviewer/i);

    // A privileged direct status update bearing that same reviewer's JWT
    // must fail too. RLS is not the only protection for service-role paths.
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [author]);
    await expect(db.query(
      `update public.question_set_library_entries
         set status='approved', reviewed_by=$2, reviewed_at=now(),
             approved_at=now(), review_note='Claimed independent source review'
         where id=$1`, [entry.id, author],
    )).rejects.toThrow(/independent academic reviewer/i);

    const [held] = (await db.query<{
      status: string; review_revision: number; reviewed_by: string | null;
    }>("select status,review_revision,reviewed_by from public.question_set_library_entries where id=$1",
      [entry.id])).rows;
    expect(held).toEqual({ status: "pending", review_revision: 1, reviewed_by: null });
    expect(await as<{ id: string }>(learner,
      "select id from public.list_question_set_library($1,0)", ["Independent academic review R103"]))
      .toEqual([]);
    await expect(as(learner, "select public.get_question_set_library($1)", [entry.id]))
      .rejects.toThrow(/unavailable/i);

    // The distinct academically authorized reviewer can approve the exact
    // revision without changing keys, provenance, IDs or answer content.
    await decide(reviewer);
    const [approved] = (await db.query<{
      id: string; status: string; reviewed_by: string; review_revision: number;
      snapshot_payload: typeof snapshot;
    }>("select id,status,reviewed_by,review_revision,snapshot_payload from public.question_set_library_entries where id=$1",
      [entry.id])).rows;
    expect(approved).toMatchObject({
      id: entry.id, status: "approved", reviewed_by: reviewer, review_revision: 2,
      snapshot_payload: snapshot,
    });
    expect((await as<{ id: string }>(learner,
      "select id from public.list_question_set_library($1,0)", ["Independent academic review R103"]))
      .map(row => row.id)).toContain(entry.id);
    const [receipt] = await as<{ value: { id: string; review_revision: number } }>(learner,
      "select public.authorize_question_set_library_import($1,2::bigint,$2::jsonb) value",
      [entry.id, JSON.stringify(snapshot)]);
    expect(receipt.value).toMatchObject({ id: entry.id, review_revision: 2 });
  }, 60_000);


  it("enforces teaching rationale across direct RPC admission, historical review and resubmission", async () => {
    const author = "d1111111-1111-4111-8111-111111111111";
    const reviewer = "d3333333-3333-4333-8333-333333333333";
    const learner = "d2222222-2222-4222-8222-222222222222";
    await db.query(
      "insert into auth.users(id,email) values($1,'r128-author@example.test'),($2,'r128-reviewer@example.test'),($3,'r128-learner@example.test')",
      [author, reviewer, learner],
    );
    await db.query("insert into public.academic_reviewers(user_id) values($1)", [reviewer]);
    async function as<T = Record<string, unknown>>(who: string, sql: string, params: unknown[] = []): Promise<T[]> {
      await db.exec("reset role;");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [who]);
      await db.exec("set role authenticated;");
      try { return (await db.query<T>(sql, params)).rows; }
      finally { await db.exec("reset role;"); }
    }
    const safe = {
      shareFormatVersion: 1, title: "Synthetic explanation admission R128", tags: [],
      orderedQuestionIds: ["r128-q1"],
      questions: [{
        id: "r128-q1", stem: "Which synthetic option matches the source-defined rule?",
        options: [{ key: "A", text: "Source-marked option" }, { key: "B", text: "Unmarked option" }],
        correctKey: "A", tags: [], citation: "PMID: 123456",
        explanation: "Synthetic rule: option A matches the explicitly marked criterion; option B does not.",
      }],
      createdAt: "2026-11-14T11:00:00Z",
      copyrightNotice: "Original synthetic teaching fixture",
    };
    const submit = async (source: string, snapshot: unknown) => {
      const [row] = await as<{ id: string }>(author,
        "select public.submit_question_set_library($1,$2::jsonb,'Synthetic fixture author',true,true) id",
        [source, JSON.stringify(snapshot)]);
      return row.id;
    };
    const decide = (id: string, snapshot: unknown, revision: number, approved: boolean) =>
      as(reviewer, "select public.review_question_set_library($1,$2,$3,$4::jsonb,$5::bigint)",
        [id, approved, "Independently inspected original synthetic rights, answer and explanation", JSON.stringify(snapshot), revision]);

    const invalidCases: Array<[string, unknown]> = [
      ["omitted", undefined], ["empty", ""], ["whitespace", "  \n  "],
      ["key-only", "Correct option is A."], ["slide-only", "See lecture slide 12."],
      ["source-only", "Source: PMID 123456"], ["pending", "Rationale: pending"],
      ["numeric", 123], ["short", "Reason"],
    ];
    for (const [name, explanation] of invalidCases) {
      const question: Record<string, unknown> = { ...safe.questions[0], explanation };
      if (explanation === undefined) delete question.explanation;
      await expect(submit("r128-invalid-" + name, { ...safe, questions: [question] }))
        .rejects.toThrow(/teaching explanation/i);
    }
    const entry = await submit("r128-reviewed", safe);
    expect(await as<{ id: string }>(learner,
      "select id from public.list_question_set_library($1,0)", ["Synthetic explanation admission R128"]))
      .toEqual([]);
    await expect(as(learner, "select public.get_question_set_library($1)", [entry]))
      .rejects.toThrow(/unavailable/i);
    await decide(entry, safe, 1, true);
    const [receipt] = await as<{ value: { id: string; review_revision: number; snapshot_payload: typeof safe } }>(
      learner, "select public.authorize_question_set_library_import($1,2::bigint,$2::jsonb) value",
      [entry, JSON.stringify(safe)]);
    expect(receipt.value).toMatchObject({ id: entry, review_revision: 2, snapshot_payload: safe });

    // Insert a real pending row first. Modify only this disposable SQL fixture
    // with user triggers disabled to mimic a historical key-only submission.
    const legacyId = await submit("r128-legacy", safe);
    const legacy = { ...safe, questions: [{ ...safe.questions[0], explanation: "Answer: A" }] };
    await db.exec("alter table public.question_set_library_entries disable trigger user;");
    try {
      await db.query("update public.question_set_library_entries set snapshot_payload=$1::jsonb where id=$2",
        [JSON.stringify(legacy), legacyId]);
    } finally {
      await db.exec("alter table public.question_set_library_entries enable trigger user;");
    }
    const [before] = (await db.query<{ status: string; review_revision: number }>(
      "select status,review_revision from public.question_set_library_entries where id=$1", [legacyId])).rows;
    await expect(decide(legacyId, legacy, before.review_revision, true))
      .rejects.toThrow(/teaching explanation/i);
    const [stillHeld] = (await db.query<{ status: string; review_revision: number; snapshot_payload: typeof safe }>(
      "select status,review_revision,snapshot_payload from public.question_set_library_entries where id=$1",
      [legacyId])).rows;
    expect(stillHeld).toMatchObject({ ...before, snapshot_payload: legacy });
    // Rejection remains possible. Rejected evidence cannot be resubmitted
    // without substantive teaching text.
    await decide(legacyId, legacy, before.review_revision, false);
    await expect(submit("r128-legacy", { ...legacy, title: "Invalid revised edition" }))
      .rejects.toThrow(/teaching explanation/i);
    const resubmittedId = await submit("r128-legacy", safe);
    expect(resubmittedId).toBe(legacyId);
    const [resubmitted] = (await db.query<{ status: string; snapshot_payload: typeof safe }>(
      "select status,snapshot_payload from public.question_set_library_entries where id=$1", [legacyId])).rows;
    expect(resubmitted).toMatchObject({ status: "pending", snapshot_payload: safe });
    await expect(as(learner, "select public.get_question_set_library($1)", [legacyId]))
      .rejects.toThrow(/unavailable/i);
  }, 60_000);

});
