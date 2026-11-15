import { expect, test } from "@playwright/test";
import { createPlatformDatabase, PLATFORM_USERS } from "./fixtures/platformDatabase";

// Real PGlite migration/trigger tests; account IDs and all content are synthetic.
// These do not establish deployed Supabase or medical/rights approval.
const [reviewer, publisher] = PLATFORM_USERS;
const reason = "Independent synthetic evidence review completed.";
const substantive = "Choice B matches the synthetic observation because only the second option binds the simulated receptor.";
const unsupported = [
  "Explanation: will be added",
  "Rationale: will be added",
  "Correct answer is A.",
  "The supplied notes do not provide a teaching rationale.",
];

function snapshot(explanation: string, count = 21) {
  const questions = Array.from({ length: count }, (_, index) => ({
    id: `synthetic-r146-q-${index + 1}`,
    stem: `Which synthetic receptor choice matches observation ${index + 1}?`,
    options: [
      { key: "A", text: "First synthetic observation" },
      { key: "B", text: "Second synthetic observation" },
    ],
    correctKey: "B",
    explanation: index === count - 1 ? explanation : substantive,
    choiceRationales: {
      A: "The first synthetic choice lacks the stipulated receptor interaction.",
      B: "The second synthetic choice has the stipulated receptor interaction.",
    },
    citation: `Synthetic fixture, observation ${index + 1}`,
    tags: ["synthetic"],
  }));
  return {
    shareFormatVersion: 1,
    title: "Synthetic 21-question rationale admission regression",
    tags: ["synthetic"],
    orderedQuestionIds: questions.map(question => question.id),
    questions,
    createdAt: "2026-11-15T04:00:00.000Z",
    copyrightNotice: "Synthetic fixture authored for testing; no external sources or media.",
  };
}

test("Community SQL admission rejects key-only placeholders across submit, resubmit and approval", async () => {
  test.setTimeout(180_000);
  const database = await createPlatformDatabase();
  try {
    await database.db.query("insert into public.academic_reviewers(user_id) values($1)", [reviewer.id]);

    for (const explanation of unsupported) {
      const { rows } = await database.db.query<{ accepted: boolean }>(
        "select private.question_set_library_has_teaching_rationale($1::jsonb) as accepted",
        [JSON.stringify(explanation)],
      );
      expect(rows[0].accepted, explanation).toBe(false);
    }
    const controls = [substantive, `Source: synthetic case study\n${substantive}`];
    for (const explanation of controls) {
      const { rows } = await database.db.query<{ accepted: boolean }>(
        "select private.question_set_library_has_teaching_rationale($1::jsonb) as accepted",
        [JSON.stringify(explanation)],
      );
      expect(rows[0].accepted).toBe(true);
    }
    const sourceOnly = "Source: synthetic page 1\nExplanation: will be added";
    const { rows: sourceRows } = await database.db.query<{ accepted: boolean }>(
      "select private.question_set_library_has_teaching_rationale($1::jsonb) as accepted",
      [JSON.stringify(sourceOnly)],
    );
    expect(sourceRows[0].accepted).toBe(false);

    const submit = (sourceId: string, explanation: string) => database.rpc(
      publisher.id, "submit_question_set_library", {
        p_source_id: sourceId,
        p_snapshot: snapshot(explanation),
        p_credit: "Synthetic fixture",
        p_rights_confirmed: true,
        p_answers_confirmed: true,
      },
    );
    const inspect = (id: string) => database.rpc(
      reviewer.id, "get_question_set_library", { p_id: id },
    ) as Promise<{ status: string; review_revision: number; snapshot_payload: ReturnType<typeof snapshot> }>;
    const decide = (id: string, approved: boolean, inspected: Awaited<ReturnType<typeof inspect>>) =>
      database.rpc(reviewer.id, "review_question_set_library", {
        p_id: id, p_approved: approved, p_reason: reason,
        p_expected_snapshot: inspected.snapshot_payload,
        p_expected_revision: inspected.review_revision,
      });

    // Every failure is on question 21, beyond the initial review-page batch.
    for (let index = 0; index < unsupported.length; index++) {
      await expect(submit(`r146-insert-${index}`, unsupported[index]))
        .rejects.toThrow(/teaching explanation/i);
      expect(await database.rpc(publisher.id, "my_question_set_library")).toEqual(
        expect.not.arrayContaining([expect.objectContaining({ source_id: `r146-insert-${index}` })]),
      );
    }

    const rejectedId = await submit("r146-revision", substantive) as string;
    await decide(rejectedId, false, await inspect(rejectedId));
    const beforeRevision = await inspect(rejectedId);
    expect(beforeRevision.status).toBe("rejected");
    await expect(submit("r146-revision", unsupported[0]))
      .rejects.toThrow(/teaching explanation/i);
    const afterRevision = await inspect(rejectedId);
    expect(afterRevision).toEqual(beforeRevision);

    // Emulate a legacy pending snapshot that predates the new admission gate.
    // The test-only DDL bypass is never issued against a live database.
    const pendingId = await submit("r146-legacy-pending", substantive) as string;
    await database.db.exec(
      "alter table public.question_set_library_entries disable trigger question_set_library_admission_teaching_rationale_gate",
    );
    try {
      await database.db.query(
        `update public.question_set_library_entries
            set snapshot_payload = jsonb_set(snapshot_payload, '{questions,20,explanation}', to_jsonb($2::text))
          where id = $1 and status = 'pending'`,
        [pendingId, unsupported[0]],
      );
    } finally {
      await database.db.exec(
        "alter table public.question_set_library_entries enable trigger question_set_library_admission_teaching_rationale_gate",
      );
    }
    const legacy = await inspect(pendingId);
    expect(legacy.snapshot_payload.questions[20].explanation).toBe(unsupported[0]);
    await expect(decide(pendingId, true, legacy))
      .rejects.toThrow(/teaching explanation/i);
    expect((await inspect(pendingId)).status).toBe("pending");

    // A valid, independently reviewed set remains approvable, with all
    // source text/keys unchanged. No generated rationale becomes source-verified.
    const validId = await submit("r146-valid-review", substantive) as string;
    const valid = await inspect(validId);
    await decide(validId, true, valid);
    const approved = await inspect(validId);
    expect(approved.status).toBe("approved");
    expect(approved.snapshot_payload).toEqual(valid.snapshot_payload);
  } finally {
    await database.close();
  }
});
