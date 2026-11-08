import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { supabasePlatform } from "../sync/supabasePlatform.testing";

const OWNER = "11111111-1111-4111-8111-111111111111";
const LEARNER = "22222222-2222-4222-8222-222222222222";
const REVIEWER = "33333333-3333-4333-8333-333333333333";
const migrationsDir = fileURLToPath(new URL("../../../../supabase/migrations/", import.meta.url));
const migrationFiles = readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort();

type Snapshot = {
  shareFormatVersion: number;
  title: string;
  tags: unknown[];
  orderedQuestionIds: string[];
  questions: Array<Record<string, unknown>>;
  createdAt: string;
  copyrightNotice: string;
  [field: string]: unknown;
};

function snapshot(): Snapshot {
  return {
    shareFormatVersion: 1,
    title: "Synthetic reviewed set",
    tags: ["sample"],
    orderedQuestionIds: ["shared-question-1"],
    questions: [{
      id: "shared-question-1",
      stem: "Which synthetic option is the marked answer?",
      options: [{ key: "A", text: "First option" }, { key: "B", text: "Second option" }],
      correctKey: "B",
      correctAnswerText: "Second option",
      tags: ["sample"],
    }],
    createdAt: "2026-11-01T12:00:00.000Z",
    copyrightNotice: "Synthetic material created for this test.",
  };
}

let db: PGlite;
beforeAll(async () => {
  db = await supabasePlatform();
  for (const file of migrationFiles) {
    await db.exec(`begin;${readFileSync(migrationsDir + file, "utf8")}commit;`);
  }
  await db.query("insert into auth.users(id,email) values ($1,'owner@example.test'),($2,'learner@example.test'),($3,'reviewer@example.test')",
    [OWNER, LEARNER, REVIEWER]);
}, 120_000);
afterAll(async () => { await db?.close(); });

async function as<T = Record<string, unknown>>(who: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec("reset role;");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [who ?? ""]);
  await db.exec(`set role ${who ? "authenticated" : "anon"};`);
  try { return (await db.query<T>(sql, params)).rows; }
  finally { await db.exec("reset role;"); }
}

async function submit(who: string, sourceId: string, value: Snapshot = snapshot()): Promise<string> {
  const rows = await as<{ id: string }>(who,
    "select public.submit_question_set_library($1,$2::jsonb,$3,$4,$5) id",
    [sourceId, JSON.stringify(value), "Synthetic author", true, true]);
  return rows[0].id;
}

async function search(who: string, query = "") {
  return as<{ id: string; title: string; likes: number; liked: boolean }>(who,
    "select id,title,likes,liked from public.list_question_set_library($1,0)", [query]);
}

async function approve(who: string, id: string, inspected: Snapshot = snapshot(), revision = 1) {
  return as(who, "select public.review_question_set_library($1,true,'Checked synthetic source and sharing rights',$2::jsonb,$3::bigint)",
    [id, JSON.stringify(inspected), revision]);
}

describe("reviewed Question Set Library SQL and RLS", () => {
  it("hides pending content from learners and anonymous clients", async () => {
    const id = await submit(OWNER, "private-pending");
    expect(await as<{ status: string; id: string }>(OWNER, "select id,status from public.my_question_set_library()"))
      .toEqual(expect.arrayContaining([{ id, status: "pending" }]));
    await expect(as(LEARNER, "select * from public.pending_question_set_library()"))
      .rejects.toThrow(/reviewer access required/i);
    expect(await search(LEARNER, "Synthetic reviewed")).toEqual([]);
    await expect(as(LEARNER, "select public.get_question_set_library($1)", [id])).rejects.toThrow(/unavailable/i);
    await expect(as(null, "select * from public.question_set_library_entries")).rejects.toThrow(/permission denied/i);
    await expect(as(null, "select * from public.list_question_set_library('')")).rejects.toThrow(/permission denied/i);
    await expect(as(LEARNER, "insert into public.question_set_library_entries(owner_id,source_id,title,question_count,snapshot_payload) values($1,'forged','Forged',1,'{}')", [LEARNER]))
      .rejects.toThrow(/permission denied/i);
  });

  it("requires an academic reviewer, then exposes only approved search and preview", async () => {
    const id = await submit(OWNER, "for-review");
    await db.query("insert into public.axom_operator_roles(user_id,role) values($1,'moderator')", [LEARNER]);
    await expect(approve(LEARNER, id)).rejects.toThrow(/reviewer access required/i);
    await db.query("insert into public.academic_reviewers(user_id) values($1)", [REVIEWER]);
    expect(await as<{ id: string }>(REVIEWER, "select id from public.pending_question_set_library()"))
      .toEqual(expect.arrayContaining([{ id }]));
    await approve(REVIEWER, id);
    const rows = await search(LEARNER, "sample");
    expect(rows.map(row => row.id)).toContain(id);
    const [preview] = await as<{ value: { snapshot_payload: Snapshot; status: string } }>(LEARNER,
      "select public.get_question_set_library($1) value", [id]);
    expect(preview.value.status).toBe("approved");
    expect(preview.value.snapshot_payload).toMatchObject(snapshot());
    for (const account of [OWNER, LEARNER, REVIEWER]) {
      await expect(as(account, "select owner_id,source_id,review_note,reviewed_by,snapshot_payload from public.question_set_library_entries where id=$1", [id]))
        .rejects.toThrow(/permission denied/i);
    }
    await expect(as(LEARNER, "select public.review_question_set_library($1,false,'A reason for rejection',$2::jsonb,$3::bigint)", [id, JSON.stringify(snapshot()), 1]))
      .rejects.toThrow(/reviewer access required/i);
  });

  it("rejects a replaced answer under the SQL row lock and keeps the submission pending", async () => {
    const inspected = snapshot();
    const id = await submit(OWNER, "atomic-answer-revision", inspected);
    const revised = snapshot();
    revised.questions[0].correctKey = "A";
    revised.questions[0].correctAnswerText = "First option";
    // Simulate an internal modification between the reviewer's inspection and
    // decision. Learners cannot directly update this protected table.
    await db.query("update public.question_set_library_entries set snapshot_payload=$1::jsonb where id=$2",
      [JSON.stringify(revised), id]);
    await expect(approve(REVIEWER, id, inspected)).rejects.toThrow(/changed since inspection/i);
    const state = await as<{ id: string; status: string }>(OWNER,
      "select id,status from public.my_question_set_library()");
    expect(state.find(row => row.id === id)?.status).toBe("pending");
    await approve(REVIEWER, id, revised, 2);
    const approved = await search(LEARNER, "Synthetic reviewed");
    expect(approved.some(row => row.id === id)).toBe(true);
  });

  it("rejects ABA resubmissions of identical question content using a row revision", async () => {
    const id = await submit(OWNER, "review-aba", snapshot());
    // Internal updates simulate a reviewed/rejected/resubmitted set with the
    // same snapshot. Status and public credit still alter its review evidence.
    await db.query("update public.question_set_library_entries set status='rejected' where id=$1", [id]);
    await db.query("update public.question_set_library_entries set status='pending', credit='Revised credit' where id=$1", [id]);
    await expect(approve(REVIEWER, id, snapshot(), 1)).rejects.toThrow(/changed since inspection/i);
    const pending = await as<{ id: string }>(REVIEWER, "select id from public.pending_question_set_library()");
    expect(pending.some(row => row.id === id)).toBe(true);
    await approve(REVIEWER, id, snapshot(), 3);
    expect((await search(LEARNER, "Synthetic reviewed")).some(row => row.id === id)).toBe(true);
  });

  it("fails closed for the legacy review signature and invalid inspected evidence", async () => {
    const id = await submit(OWNER, "reject-legacy-review");
    await expect(as(REVIEWER,
      "select public.review_question_set_library($1,true,'Checked the source evidence')", [id]))
      .rejects.toThrow(/Refresh AXOM/i);
    await expect(as(REVIEWER,
      "select public.review_question_set_library($1,true,'Checked the source evidence',$2::jsonb,$3::bigint)",
      [id, JSON.stringify({ title: "invalid" }), 1]))
      .rejects.toThrow(/Reopen the inspected/i);
    const pending = await as<{ id: string }>(REVIEWER, "select id from public.pending_question_set_library()");
    expect(pending.some(row => row.id === id)).toBe(true);
  });

  it("keeps likes unique, account-bound and tied to approved content", async () => {
    const pending = await submit(OWNER, "pending-like");
    await expect(as(LEARNER, "select public.set_question_set_library_like($1,true)", [pending]))
      .rejects.toThrow(/unavailable/i);
    const id = await submit(OWNER, "approved-like");
    await approve(REVIEWER, id);
    await expect(as(LEARNER, "insert into public.question_set_library_likes(entry_id,user_id) values($1,$2)", [id, OWNER]))
      .rejects.toThrow(/permission denied/i);
    await as(LEARNER, "select public.set_question_set_library_like($1,true)", [id]);
    await as(LEARNER, "select public.set_question_set_library_like($1,true)", [id]);
    for (const account of [OWNER, LEARNER, REVIEWER]) {
      await expect(as(account, "select user_id from public.question_set_library_likes where entry_id=$1", [id]))
        .rejects.toThrow(/permission denied/i);
    }
    const row = (await search(LEARNER, "approved-like"))[0];
    // Search matches title, credit and tags, not the private source identity.
    expect(row).toBeUndefined();
    const approved = (await search(LEARNER, "Synthetic reviewed")).find(item => item.id === id);
    expect(approved).toMatchObject({ likes: 1, liked: true });
    const ownerView = (await search(OWNER, "Synthetic reviewed")).find(item => item.id === id);
    expect(ownerView).toMatchObject({ likes: 1, liked: false });
    await as(LEARNER, "select public.set_question_set_library_like($1,false)", [id]);
    await as(LEARNER, "select public.set_question_set_library_like($1,false)", [id]);
    expect((await search(LEARNER, "Synthetic reviewed")).find(item => item.id === id))
      .toMatchObject({ likes: 0, liked: false });
  });

  it("allows only the owner to withdraw and removes the public preview and likes", async () => {
    const id = await submit(OWNER, "withdraw-test");
    await approve(REVIEWER, id);
    await as(LEARNER, "select public.set_question_set_library_like($1,true)", [id]);
    await as(LEARNER, "select public.withdraw_question_set_library($1)", [id]);
    expect((await search(LEARNER, "Synthetic reviewed")).some(row => row.id === id)).toBe(true);
    await as(OWNER, "select public.withdraw_question_set_library($1)", [id]);
    expect((await search(LEARNER, "Synthetic reviewed")).some(row => row.id === id)).toBe(false);
    await expect(as(LEARNER, "select public.get_question_set_library($1)", [id])).rejects.toThrow(/unavailable/i);
    expect((await db.query("select * from public.question_set_library_likes where entry_id=$1", [id])).rows).toEqual([]);
  });

  it("rejects malformed payloads even when a custom client bypasses TypeScript validation", async () => {
    const cases: Array<[string, (value: Snapshot) => void]> = [
      ["extra workspace field", value => { value.privateWorkspace = { notes: "private" }; }],
      ["extra question field", value => { value.questions[0].attempts = [{ answer: "A" }]; }],
      ["extra option field", value => { (value.questions[0].options as Array<Record<string, unknown>>)[0].sourceFile = "private.pdf"; }],
      ["missing answer", value => { delete value.questions[0].correctKey; }],
      ["wrong answer key", value => { value.questions[0].correctKey = "C"; }],
      ["membership order mismatch", value => { value.orderedQuestionIds = ["different-question"]; }],
      ["duplicate option key", value => { (value.questions[0].options as Array<Record<string, unknown>>)[1].key = "A"; }],
      ["wrong correct answer text", value => { value.questions[0].correctAnswerText = "First option"; }],
      ["string share version", value => { value.shareFormatVersion = "1" as never; }],
      ["numeric membership ID", value => { value.orderedQuestionIds = [1 as never]; value.questions[0].id = "1"; }],
      ["numeric answer key", value => {
        value.questions[0].correctKey = 1;
        (value.questions[0].options as Array<Record<string, unknown>>)[1].key = 1;
      }],
      ["boolean answer choice text", value => {
        value.questions[0].correctAnswerText = "true";
        (value.questions[0].options as Array<Record<string, unknown>>)[1].text = true;
      }],
      ["numeric stem", value => { value.questions[0].stem = 123456789; }],
      ["numeric explanation", value => { value.questions[0].explanation = 12345; }],
      ["numeric copyright notice", value => { value.copyrightNotice = 123456789 as never; }],
      ["numeric creation time", value => { value.createdAt = 2026110112000 as never; }],
      ["non-string question tags", value => { value.questions[0].tags = [{ secret: "private" }]; }],
    ];
    const accepted: string[] = [];
    for (const [name, corrupt] of cases) {
      const value = snapshot();
      corrupt(value);
      try { await submit(OWNER, `malformed-${name.replaceAll(" ", "-")}`, value); accepted.push(name); }
      catch { /* Rejected by the server as intended. */ }
    }
    expect(accepted).toEqual([]);
    expect((await as<{ source_id: string }>(OWNER, "select source_id from public.my_question_set_library()"))
      .filter(row => row.source_id.startsWith("malformed-"))).toEqual([]);
  });

  it("keeps pending answer keys and review revisions unchanged after a malformed privileged replacement", async () => {
    const id = await submit(OWNER, "typed-post-submission-key");
    const malformed = snapshot();
    malformed.questions[0].correctKey = 1;
    (malformed.questions[0].options as Array<Record<string, unknown>>)[1].key = 1;
    await expect(db.query(
      "update public.question_set_library_entries set snapshot_payload=$1::jsonb where id=$2",
      [JSON.stringify(malformed), id],
    )).rejects.toThrow(/invalid scalar types/i);
    const [readback] = await as<{ value: { snapshot_payload: Snapshot; review_revision: number } }>(
      OWNER, "select public.get_question_set_library($1) value", [id],
    );
    expect(readback.value.snapshot_payload.questions[0].correctKey).toBe("B");
    expect(readback.value.review_revision).toBe(1);
  });

  it("rejects untyped visual tags and distractor rationales even on privileged snapshot replacement", async () => {
    const id = await submit(OWNER, "typed-teaching-metadata");
    const variants: Array<[string, (value: Snapshot) => void]> = [
      ["non-text visual tag", value => { value.tags = ["visual:intent:histology", { embedded: "private" }]; }],
      ["non-text question tag", value => { value.questions[0].tags = [42]; }],
      ["rationale map as array", value => { value.questions[0].choiceRationales = ["invalid"]; }],
      ["numeric distractor rationale", value => { value.questions[0].choiceRationales = { A: 1 }; }],
      ["null distractor rationale", value => { value.questions[0].choiceRationales = { A: null }; }],
      ["unmatched distractor rationale", value => { value.questions[0].choiceRationales = { Z: "Unreviewed option" }; }],
      ["oversized visual tag", value => { value.tags = ["visual:keyword:" + "x".repeat(64)]; }],
      ["blank visual tag", value => { value.tags = [" "]; }],
      ["oversized question tag", value => { value.questions[0].tags = ["x".repeat(65)]; }],
      ["oversized distractor rationale", value => { value.questions[0].choiceRationales = { A: "x".repeat(10001) }; }],
      ["blank distractor rationale", value => { value.questions[0].choiceRationales = { A: " " }; }],
    ];
    for (const [label, mutate] of variants) {
      const value = snapshot();
      mutate(value);
      await expect(db.query(
        "update public.question_set_library_entries set snapshot_payload=$1::jsonb where id=$2",
        [JSON.stringify(value), id],
      ), label).rejects.toThrow(/invalid scalar types/i);
    }
    const [readback] = await as<{ value: { snapshot_payload: Snapshot; review_revision: number } }>(
      OWNER, "select public.get_question_set_library($1) value", [id],
    );
    expect(readback.value.snapshot_payload).toEqual(snapshot());
    expect(readback.value.review_revision).toBe(1);
  });

  it("rejects private fields at every snapshot nesting level on privileged replacement", async () => {
    const id = await submit(OWNER, "privileged-private-field-guard");
    const variants: Array<[string, (value: Snapshot) => void]> = [
      ["root workspace notes", value => { value.workspaceNotes = { content: "private synthetic note" }; }],
      ["question attempts", value => { value.questions[0].attempts = [{ answer: "A", userId: OWNER }]; }],
      ["option source media path", value => {
        (value.questions[0].options as Array<Record<string, unknown>>)[0].sourceFile = "private-source.pdf";
      }],
    ];
    for (const [label, mutate] of variants) {
      const altered = snapshot();
      mutate(altered);
      await expect(db.query(
        "update public.question_set_library_entries set snapshot_payload=$1::jsonb where id=$2",
        [JSON.stringify(altered), id],
      ), label).rejects.toThrow(/private or unsupported fields/i);
    }
    const [readback] = await as<{ value: { snapshot_payload: Snapshot; review_revision: number } }>(
      OWNER, "select public.get_question_set_library($1) value", [id],
    );
    expect(readback.value.snapshot_payload).toEqual(snapshot());
    expect(readback.value.review_revision).toBe(1);
  });

  it("rejects well-typed but inconsistent answers and membership on protected snapshot replacement", async () => {
    const id = await submit(OWNER, "privileged-answer-semantics-guard");
    const variants: Array<[string, (value: Snapshot) => void]> = [
      ["membership does not match question ID", value => { value.orderedQuestionIds = ["unrelated-question"]; }],
      ["duplicate membership IDs", value => {
        value.questions.push({ ...value.questions[0] });
        value.orderedQuestionIds.push("shared-question-1");
      }],
      ["empty reviewed set", value => { value.questions = []; value.orderedQuestionIds = []; }],
      ["key absent from choices", value => {
        value.questions[0].correctKey = "Z";
        delete value.questions[0].correctAnswerText;
      }],
      ["duplicate choice keys", value => {
        (value.questions[0].options as Array<Record<string, unknown>>)[0].key = "B";
      }],
      ["contradictory correct-answer text", value => { value.questions[0].correctAnswerText = "First option"; }],
      ["blank reviewed key", value => { value.questions[0].correctKey = ""; }],
      ["too few choices", value => { value.questions[0].options = [{ key: "B", text: "Second option" }]; }],
      ["too many choices", value => {
        value.questions[0].options = Array.from({ length: 27 }, (_, index) => ({
          key: index === 1 ? "B" : `C${index}`,
          text: index === 1 ? "Second option" : `Synthetic option ${index}`,
        }));
      }],
    ];
    for (const [label, mutate] of variants) {
      const altered = snapshot();
      mutate(altered);
      await expect(db.query(
        "update public.question_set_library_entries set snapshot_payload=$1::jsonb where id=$2",
        [JSON.stringify(altered), id],
      ), label).rejects.toThrow(/inconsistent membership or answer evidence/i);
    }
    const [readback] = await as<{ value: { snapshot_payload: Snapshot; review_revision: number } }>(
      OWNER, "select public.get_question_set_library($1) value", [id],
    );
    expect(readback.value.snapshot_payload).toEqual(snapshot());
    expect(readback.value.review_revision).toBe(1);
  });

  it("retains valid text-only visual intent and reviewed teaching rationales through moderation", async () => {
    const source = snapshot();
    source.tags = ["visual:intent:histology"];
    source.questions[0].tags = ["visual:keyword:synthetic"];
    source.questions[0].choiceRationales = {
      A: "Synthetic distractor is not the marked choice.",
      B: "Synthetic marked choice matches the reviewed key.",
    };
    source.questions[0].explanation = "Synthetic fixture rationale, not a clinical explanation.";
    const id = await submit(OWNER, "typed-teaching-reviewed", source);
    await approve(REVIEWER, id, source, 1);
    const [readback] = await as<{ value: { snapshot_payload: Snapshot; status: string } }>(
      LEARNER, "select public.get_question_set_library($1) value", [id],
    );
    expect(readback.value.status).toBe("approved");
    expect(readback.value.snapshot_payload).toEqual(source);
  });

  it("denies new submissions when account deletion is processing", async () => {
    await db.query("insert into public.privacy_requests(user_id,kind,status) values($1,'deletion','processing')", [LEARNER]);
    await expect(submit(LEARNER, "deletion-locked")).rejects.toThrow(/deletion cleanup|unavailable/i);
    await db.query("delete from public.privacy_requests where user_id=$1", [LEARNER]);
  });
});

describe("Journal experience feedback SQL and RLS", () => {
  it("accepts explicit signed-in feedback while hiding it from other learners", async () => {
    await expect(as(null, "select public.submit_journal_experience_feedback(5,'Helpful')"))
      .rejects.toThrow(/permission denied/i);
    await expect(as(LEARNER, "insert into public.journal_experience_feedback(user_id,rating) values($1,5)", [LEARNER]))
      .rejects.toThrow(/permission denied/i);
    const [result] = await as<{ id: string }>(LEARNER,
      "select public.submit_journal_experience_feedback(5,' Helpful ',' More space ','A map','Too many clicks','Good start') id");
    expect(result.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(await as<{ rating: number; liked: string }>(LEARNER,
      "select rating,liked from public.journal_experience_feedback where id=$1", [result.id]))
      .toEqual([{ rating: 5, liked: "Helpful" }]);
    expect(await as(REVIEWER, "select id from public.journal_experience_feedback where id=$1", [result.id]))
      .toEqual([]);
    await db.query("insert into public.axom_operator_roles(user_id,role) values($1,'owner')", [OWNER]);
    expect(await as<{ id: string }>(OWNER, "select id from public.journal_experience_feedback where id=$1", [result.id]))
      .toEqual([{ id: result.id }]);
    await expect(as(OWNER, "delete from public.journal_experience_feedback where id=$1", [result.id]))
      .rejects.toThrow(/permission denied/i);
  });

  it("enforces field bounds and a five-submissions-per-day limit", async () => {
    await expect(as(REVIEWER, "select public.submit_journal_experience_feedback(0)"))
      .rejects.toThrow(/feedback fields and rating/i);
    await expect(as(REVIEWER, "select public.submit_journal_experience_feedback(5,$1)", ["x".repeat(1001)]))
      .rejects.toThrow(/feedback fields and rating/i);
    for (let index = 0; index < 5; index++) {
      await as(REVIEWER, "select public.submit_journal_experience_feedback(4,'Synthetic feedback')");
    }
    await expect(as(REVIEWER, "select public.submit_journal_experience_feedback(4,'Sixth submission')"))
      .rejects.toThrow(/feedback limit reached/i);
    expect(await as<{ count: number }>(REVIEWER,
      "select count(*)::integer count from public.journal_experience_feedback where user_id=$1", [REVIEWER]))
      .toEqual([{ count: 5 }]);
  });
});
