import { createHash, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { supabasePlatform } from "../sync/supabasePlatform.testing";
import { inspectTrackerPlan, trackerManifestHash } from "./trackerReview";

const OWNER = "11111111-1111-4111-8111-111111111111";
const REVIEWER = "22222222-2222-4222-8222-222222222222";
const LEARNER = "33333333-3333-4333-8333-333333333333";
const OTHER_REVIEWER = "44444444-4444-4444-8444-444444444444";
const H = "a".repeat(64);
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const plan = (nonce = "source") => `T1 - SAMPLE - Course plan:\n@week-policy: explicit\n@source: ${nonce}; week placement unverified\nWeek 2:\nLecture 01 Example [Lecture]\nUnscheduled:\nSG 01 Further discussion [Small Group]`;
let db: PGlite;
let questionGateBefore: unknown;
const questionGate = () => db.query(`select oid::regprocedure::text signature,pg_get_functiondef(oid) definition
  from pg_proc where oid in ('public.academic_review(uuid,boolean)'::regprocedure,
  'public.academic_review(uuid,boolean,uuid)'::regprocedure,
  'public.academic_community_review(uuid,uuid,boolean)'::regprocedure) order by signature`);

beforeAll(async () => {
  db = await supabasePlatform();
  const directory = new URL("../../../../supabase/migrations/", import.meta.url);
  for (const file of readdirSync(directory).filter(name => name.endsWith(".sql")).sort()) {
    if (file === "20261122002007_academic_tracker_review.sql") questionGateBefore = (await questionGate()).rows;
    await db.exec(readFileSync(new URL(file, directory), "utf8"));
  }
  for (const id of [OWNER, REVIEWER, LEARNER, OTHER_REVIEWER]) {
    await db.query("insert into auth.users(id,email) values($1,$2)", [id, `${id}@test.invalid`]);
  }
  await db.query("insert into public.academic_reviewers values($1),($2)", [REVIEWER, OTHER_REVIEWER]);
}, 30_000);
afterAll(async () => db?.close());

async function as<T = Record<string, unknown>>(user: string, sql: string, params: unknown[] = []) {
  return db.transaction(async tx => {
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
    await tx.exec("set local role authenticated");
    return (await tx.query<T>(sql, params)).rows;
  });
}
interface Target {
  collection_id: string; revision_id: string; content_hash: string; template_hash: string; manifest_hash: string;
  reviewer_id: string; template_text: string; shape: { activities: number; stated_week_activities: number; unstated_week_activities: number; sections: number };
}
async function target(collection: string, revision: string, user = REVIEWER) {
  return (await as<{ value: Target | null }>(user, "select public.academic_tracker_review_target($1,$2) value", [collection, revision]))[0].value;
}
async function approve(t: Target, user = REVIEWER, checked = true) {
  return as(user, "select public.academic_approve_tracker($1,$2,$3,$4,$5,$6,$7,$8) value",
    [t.collection_id, t.revision_id, t.content_hash, t.template_hash, t.manifest_hash,
      t.shape.activities, t.shape.stated_week_activities, checked]);
}
async function pending(collection: string) {
  expect((await db.query("select review_status from public.academic_collections where id=$1", [collection])).rows).toEqual([{ review_status: "pending" }]);
  expect((await db.query("select count(*)::integer n from public.academic_tracker_reviews where collection_id=$1", [collection])).rows).toEqual([{ n: 0 }]);
}
async function seed(options: { collection?: string; text?: string; ready?: number; held?: number; hash?: string; share?: boolean } = {}) {
  const collection = options.collection ?? randomUUID();
  const text = options.text ?? plan(randomUUID());
  const contentHash = options.hash ?? hash(randomUUID());
  const catalog = JSON.stringify({ format: "axom-private-library", schemaVersion: 1, id: "synthetic", version: "v1",
    templates: [{ file: "templates/plan.txt", name: "Plan", checksum: hash(text) }], sources: [] });
  const files = [{ path: "catalog.json", sha256: hash(catalog), byte_size: Buffer.byteLength(catalog), mime_type: "application/json" },
    { path: "templates/plan.txt", sha256: hash(text), byte_size: Buffer.byteLength(text), mime_type: "text/plain" }];
  const [created] = await as<{ value: { collection_id: string; revision_id: string } }>(OWNER,
    "select public.academic_create_revision($1,$2,$3,$4,$5,$6) value", [
      JSON.stringify({ title: "Synthetic tracker", module: "SAMPLE", term: "Term 1", ready_questions: options.ready ?? 0, review_questions: options.held ?? 0 }),
      text, JSON.stringify({ sourceChecksums: [hash(text)] }), JSON.stringify(files), contentHash, collection,
    ]);
  for (const file of files) await as(OWNER, "insert into storage.objects(bucket_id,name,metadata) values('academic-content',$1,$2) on conflict do nothing",
    [`${collection}/${file.sha256}`, JSON.stringify({ size: file.byte_size })]);
  await as(OWNER, "select public.academic_finish_revision($1)", [created.value.revision_id]);
  if (options.share !== false) await as(OWNER, "select public.academic_set_visibility($1,'shared')", [collection]);
  return { ...created.value, text, files: files.map(file => ({ ...file, object_path: `${collection}/${file.sha256}` })) };
}

describe("exact-revision tracker approval", () => {
  it("replays the complete migration chain without changing any question approval function", async () => {
    expect((await questionGate()).rows).toEqual(questionGateBefore);
    const c = await seed();
    await expect(as(REVIEWER, "select public.academic_review($1,true,$2)", [c.collection_id, c.revision_id])).rejects.toThrow(/Explanation review attestation/);
    await pending(c.collection_id);
  });

  it("compares real client/SQL shape and manifest hashes and atomically approves the exact stored plan", async () => {
    const c = await seed();
    const t = (await target(c.collection_id, c.revision_id))!;
    expect(t.template_hash).toBe(hash(c.text));
    expect(t.manifest_hash).toBe(await trackerManifestHash(c.files, c.collection_id));
    expect(inspectTrackerPlan(c.text, { module: "SAMPLE", term: "Term 1" })).toMatchObject({ activities: 2, statedWeekActivities: 1, unstatedWeekActivities: 1 });
    expect(t.shape).toEqual({ activities: 2, stated_week_activities: 1, unstated_week_activities: 1, sections: 1 });
    expect((await as<{ value: boolean }>(LEARNER, "select public.academic_can_read($1) value", [c.collection_id]))[0].value).toBe(false);
    await approve(t);
    const audit = (await db.query("select reviewer_id,activity_count,stated_week_activity_count,unstated_week_activity_count,template_hash,manifest_hash from public.academic_tracker_reviews where revision_id=$1", [c.revision_id])).rows[0];
    expect(audit).toEqual({ reviewer_id: REVIEWER, activity_count: 2, stated_week_activity_count: 1, unstated_week_activity_count: 1, template_hash: t.template_hash, manifest_hash: t.manifest_hash });
    expect((await as<{ value: boolean }>(LEARNER, "select public.academic_can_read($1) value", [c.collection_id]))[0].value).toBe(true);
    expect((await db.query("select template_text,ready_questions,review_questions from public.academic_revisions where id=$1", [c.revision_id])).rows[0])
      .toEqual({ template_text: c.text, ready_questions: 0, review_questions: 0 });
    await expect(approve(t)).rejects.toThrow(/submission changed/);
  });

  it("requires actual reviewer membership and denies client audit/table/helper forgery", async () => {
    const c = await seed(), t = (await target(c.collection_id, c.revision_id))!;
    for (const user of [OWNER, LEARNER, ""]) {
      await expect(target(c.collection_id, c.revision_id, user)).rejects.toThrow(/Reviewer access/);
      await expect(approve(t, user)).rejects.toThrow(/Reviewer access/);
    }
    await expect(as(LEARNER, "insert into public.academic_tracker_reviews(revision_id) values($1)", [c.revision_id])).rejects.toThrow(/permission denied/);
    const permissions = (await db.query(`select
      has_function_privilege('anon','public.academic_tracker_review_target(uuid,uuid)','execute') target,
      has_function_privilege('anon','public.academic_approve_tracker(uuid,uuid,text,text,text,integer,integer,boolean)','execute') approve,
      has_function_privilege('authenticated','public.academic_tracker_manifest_hash(uuid)','execute') helper,
      has_table_privilege('authenticated','public.academic_tracker_reviews','select') audit`)).rows[0];
    expect(permissions).toEqual({ target: false, approve: false, helper: false, audit: false });
    await pending(c.collection_id);
  });

  it("cannot relabel ready or held questions as trackers, including undeclared bank files", async () => {
    for (const options of [{ ready: 1 }, { held: 1 }]) {
      const c = await seed(options);
      expect(await target(c.collection_id, c.revision_id)).toBeNull();
      await pending(c.collection_id);
    }
    for (const path of ["banks/questions.json", "bank.json", "notes.txt"]) {
      const c = await seed(), t = (await target(c.collection_id, c.revision_id))!;
      await db.query("insert into public.academic_files(revision_id,path,object_path,sha256,byte_size,mime_type) values($1,$2,$3,$4,2,'application/json')",
        [c.revision_id, path, `${c.collection_id}/${H}`, H]);
      await expect(approve(t)).rejects.toThrow(/tracker-only catalog/);
      await pending(c.collection_id);
    }
  });

  it("rejects wrong audience, withdrawn/nonpending/uploading state and community submissions", async () => {
    for (const mutation of ["visibility='private'", "withdrawn=true", "review_status='rejected'"]) {
      const c = await seed(), t = (await target(c.collection_id, c.revision_id))!;
      await db.query(`update public.academic_collections set ${mutation} where id=$1`, [c.collection_id]);
      expect(await target(c.collection_id, c.revision_id)).toBeNull();
      await expect(approve(t)).rejects.toThrow(/submission changed/);
    }
    const group = await seed(), groupTarget = (await target(group.collection_id, group.revision_id))!;
    const gid = randomUUID(); await db.query("insert into public.academic_groups(id,name) values($1,'Synthetic group')", [gid]);
    await db.query("update public.academic_collections set visibility='group',group_id=$1 where id=$2", [gid, group.collection_id]);
    await expect(approve(groupTarget)).rejects.toThrow(/submission changed/);
    const c = await seed(), t = (await target(c.collection_id, c.revision_id))!;
    await db.query("insert into public.academic_community_submissions(collection_id,revision_id,rights_attested_at) values($1,$2,now())", [c.collection_id, c.revision_id]);
    await expect(approve(t)).rejects.toThrow(/tracker-only pending/);
    await pending(c.collection_id);
    const uploading = await seed(), uploadTarget = (await target(uploading.collection_id, uploading.revision_id))!;
    await db.query("update public.academic_revisions set status='uploading' where id=$1", [uploading.revision_id]);
    await expect(approve(uploadTarget)).rejects.toThrow(/submission changed/);
  });

  it("rejects stale revision, content, plan, manifest, observed counts and unchecked attestation without partial approval", async () => {
    const c = await seed(), t = (await target(c.collection_id, c.revision_id))!;
    for (const property of ["content_hash", "template_hash", "manifest_hash"] as const) {
      await expect(approve({ ...t, [property]: H })).rejects.toThrow(/content changed/);
      await pending(c.collection_id);
    }
    await expect(approve({ ...t, shape: { ...t.shape, activities: 3 } })).rejects.toThrow(/observations differ/);
    await expect(approve(t, REVIEWER, false)).rejects.toThrow(/plan review required/);
    await pending(c.collection_id);
    await seed({ collection: c.collection_id });
    await expect(approve(t)).rejects.toThrow(/submission changed/);
    await pending(c.collection_id);
    const changed = await seed(), previous = (await target(changed.collection_id, changed.revision_id))!;
    await db.query("update public.academic_revisions set template_text=template_text||E'\nFurther review [Review]' where id=$1", [changed.revision_id]);
    await expect(approve(previous)).rejects.toThrow(/content changed/);
    await pending(changed.collection_id);
  });

  it("rechecks reviewer revocation at decision time and derives the actor rather than accepting one", async () => {
    const c = await seed(), t = (await target(c.collection_id, c.revision_id))!;
    await db.query("delete from public.academic_reviewers where user_id=$1", [OTHER_REVIEWER]);
    await expect(approve(t, OTHER_REVIEWER)).rejects.toThrow(/Reviewer access/);
    await db.query("insert into public.academic_reviewers values($1)", [OTHER_REVIEWER]);
    await approve(t, OTHER_REVIEWER);
    expect((await db.query("select reviewer_id from public.academic_tracker_reviews where revision_id=$1", [c.revision_id])).rows[0])
      .toEqual({ reviewer_id: OTHER_REVIEWER });
  });

  it("rejects empty/malformed plans and bad weeks while preserving explicitly unscheduled activity", async () => {
    for (const text of ["", "not a plan", "SAMPLE - Empty:", "SAMPLE - Plan:\nNo activity kind", "SAMPLE - Plan:\nWeek 61:\nExample [Lecture]",
      "SAMPLE - Plan:\nExample Week 61 [Lecture]", "SAMPLE - Plan:\nUnknown [Wrong]", "Week 1:\nExample [Lecture]"]) {
      await expect(db.query("select public.academic_tracker_plan_shape($1)", [text])).rejects.toThrow();
    }
    const text = "SAMPLE - Plan:\n@week-policy: explicit\nUnscheduled:\nExample [Lecture]";
    expect((await db.query("select public.academic_tracker_plan_shape($1) value", [text])).rows[0])
      .toEqual({ value: { activities: 1, stated_week_activities: 0, unstated_week_activities: 1, sections: 1 } });
  });

  it("retains hashes and time if a reviewer who approved another owner's tracker is deleted", async () => {
    const user = randomUUID(); await db.query("insert into auth.users(id,email) values($1,'deleted-reviewer@test.invalid')", [user]);
    await db.query("insert into public.academic_reviewers values($1)", [user]);
    const c = await seed(), t = (await target(c.collection_id, c.revision_id, user))!;
    await approve(t, user);
    const before = (await db.query<Record<string, unknown>>("select * from public.academic_tracker_reviews where revision_id=$1", [c.revision_id])).rows[0];
    await db.query("delete from auth.users where id=$1", [user]);
    const after = (await db.query("select * from public.academic_tracker_reviews where revision_id=$1", [c.revision_id])).rows[0];
    expect(after).toEqual({ ...before, reviewer_id: null });
    expect((await db.query("select owner_id,review_status from public.academic_collections where id=$1", [c.collection_id])).rows[0])
      .toEqual({ owner_id: OWNER, review_status: "approved" });
  });
});
