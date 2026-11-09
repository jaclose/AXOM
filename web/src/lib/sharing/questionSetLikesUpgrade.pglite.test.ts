// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { supabasePlatform } from "../sync/supabasePlatform.testing";

const migrations = fileURLToPath(new URL("../../../../supabase/migrations/", import.meta.url));
const upgrade = "20261109070000_question_set_like_revision_integrity.sql";
const owner = "11111111-1111-4111-8111-111111111111";
const learner = "22222222-2222-4222-8222-222222222222";
const reviewer = "33333333-3333-4333-8333-333333333333";

it("upgrades an existing library without deleting active or revoked publication endorsements", async () => {
  const db = await supabasePlatform();
  const source = {
    shareFormatVersion: 1, title: "Synthetic upgrade collection", tags: [],
    orderedQuestionIds: ["q1"],
    questions: [{ id: "q1", stem: "Which synthetic label is keyed?", tags: [], correctKey: "B",
      options: [{ key: "A", text: "First label" }, { key: "B", text: "Second label" }] }],
    createdAt: "2026-11-01T12:00:00.000Z", copyrightNotice: "Synthetic migration acceptance.",
  };
  const as = async <T>(userId: string, sql: string, values: unknown[] = []) => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [userId]);
    await db.exec("set role authenticated");
    try { return (await db.query<T>(sql, values)).rows; }
    finally { await db.exec("reset role"); }
  };
  try {
    for (const file of readdirSync(migrations).filter(file => file.endsWith(".sql") && file < upgrade).sort()) {
      await db.exec(readFileSync(migrations + file, "utf8"));
    }
    await db.query("insert into auth.users(id,email) values($1,'owner@example.test'),($2,'learner@example.test'),($3,'reviewer@example.test')",
      [owner, learner, reviewer]);
    await db.query("insert into public.academic_reviewers(user_id) values($1)", [reviewer]);
    const ids: string[] = [];
    for (const sourceId of ["active-edition", "revoked-edition"]) {
      const [row] = await as<{ id: string }>(owner,
        "select public.submit_question_set_library($1,$2::jsonb,'Synthetic author',true,true) id",
        [sourceId, JSON.stringify(source)]);
      ids.push(row.id);
      await as(reviewer, "select public.review_question_set_library($1,true,'Synthetic source and rights inspected',$2::jsonb,1)",
        [row.id, JSON.stringify(source)]);
      await as(learner, "select public.set_question_set_library_like($1,true)", [row.id]);
    }
    await db.query("select set_config('request.jwt.claim.sub','',false)");
    await db.query("update public.question_set_library_entries set status='rejected' where id=$1", [ids[1]]);
    const before = (await db.query<{ entry_id: string; user_id: string; created_at: string }>(
      "select entry_id,user_id,created_at from public.question_set_library_likes order by entry_id")).rows;
    expect(before).toHaveLength(2);

    await db.exec(readFileSync(migrations + upgrade, "utf8"));

    const retained = (await db.query<{ entry_id: string; user_id: string; created_at: string }>(
      "select entry_id,user_id,created_at from public.question_set_library_likes order by entry_id")).rows;
    expect(retained).toEqual(before);
    const editions = (await db.query<{ entry_id: string; publication_epoch: number }>(
      "select entry_id,publication_epoch from public.question_set_library_likes")).rows;
    expect(editions).toEqual(expect.arrayContaining([
      { entry_id: ids[0], publication_epoch: 1 },
      { entry_id: ids[1], publication_epoch: 0 },
    ]));
    const listings = await as<{ id: string; likes: number; liked: boolean }>(learner,
      "select id,likes,liked from public.list_question_set_library('',0)");
    expect(listings).toEqual([{ id: ids[0], likes: 1, liked: true }]);
    const snapshots = (await db.query<{ snapshot_payload: typeof source }>(
      "select snapshot_payload from public.question_set_library_entries")).rows;
    expect(snapshots).toEqual([{ snapshot_payload: source }, { snapshot_payload: source }]);
  } finally { await db.close(); }
}, 120_000);
