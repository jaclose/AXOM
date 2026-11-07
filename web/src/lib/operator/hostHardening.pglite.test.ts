import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const OWNER = "11111111-1111-4111-8111-111111111111";
const LEARNER = "22222222-2222-4222-8222-222222222222";
const MODERATOR = "33333333-3333-4333-8333-333333333333";
const GROUP = "44444444-4444-4444-8444-444444444444";
const SUBMITTED = "55555555-5555-4555-8555-555555555555";
const STALE = "66666666-6666-4666-8666-666666666666";
const WITHDRAWN = "77777777-7777-4777-8777-777777777777";
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon,authenticated,service_role;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema public grant all on functions to anon,authenticated,service_role;
    create schema auth;
    -- Same email type as Supabase Auth: varchar(255), not text.
    create table auth.users(id uuid primary key,email varchar(255),created_at timestamptz not null default now(),last_sign_in_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to anon,authenticated,service_role;
    grant execute on function auth.uid() to anon,authenticated,service_role;
    create table public.account_profiles(user_id uuid primary key references auth.users(id),display_name text,created_at timestamptz default now(),updated_at timestamptz default now());
    create table public.privacy_requests(user_id uuid,kind text,status text,failure_code text);
    create table public.ai_usage(user_id uuid not null references auth.users(id),day date not null,requests integer not null default 0,primary key(user_id,day));
    create table public.academic_collections(id uuid primary key,owner_id uuid references auth.users(id),title text not null,module text not null,term text not null,visibility text not null default 'private',review_status text not null default 'pending',withdrawn boolean not null default false,current_revision_id uuid,updated_at timestamptz default now());
    create table public.academic_revisions(id uuid primary key,collection_id uuid references public.academic_collections(id),status text not null,ready_questions integer not null default 0,review_questions integer not null default 0);
    create table public.academic_community_submissions(collection_id uuid not null references public.academic_collections(id),revision_id uuid not null references public.academic_revisions(id),status text not null default 'pending',submitted_at timestamptz not null default now(),rights_attested_at timestamptz not null,primary key(collection_id,revision_id));
    alter table public.academic_collections enable row level security;
    alter table public.academic_revisions enable row level security;
    alter table public.academic_community_submissions enable row level security;
    revoke all on public.academic_collections,public.academic_revisions,public.academic_community_submissions from public,anon,authenticated;
  `);
  const barrierSource = readFileSync(new URL("../../../../supabase/migrations/20261016011812_harden_privacy_request_barrier.sql", import.meta.url), "utf8");
  const barrier = barrierSource.match(/create or replace function public\.axom_account_accepts_cloud_writes\(\)[\s\S]*?\$\$;/)?.[0];
  if (!barrier) throw new Error("The account privacy barrier was not found");
  await db.exec(barrier);
  for (const [id, email] of [[OWNER, "owner@example.test"], [LEARNER, "learner@example.test"], [MODERATOR, "moderator@example.test"]]) {
    await db.query("insert into auth.users(id,email) values($1,$2)", [id, email]);
    await db.query("insert into public.account_profiles(user_id,display_name) values($1,$2)", [id, email]);
  }
  for (const name of [
    "20261101190000_community_social.sql",
    "20261101191000_operator_console.sql",
    "20261102160000_operator_privacy_audit_hardening.sql",
    "20261104120000_operator_accounts_email_text.sql",
    "20261107190000_operator_audit_cursor.sql",
  ]) {
    await db.exec(readFileSync(new URL(`../../../../supabase/migrations/${name}`, import.meta.url), "utf8"));
  }
  await db.query("insert into public.axom_operator_roles(user_id,role) values($1,'owner')", [OWNER]);
  await as(OWNER, "select public.axom_operator_set_role($1,'moderator','Verified review assignment')", [MODERATOR]);
}, 30_000);
afterAll(async () => { await db?.close(); });

async function as<T = Record<string, unknown>>(who: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec("reset role;");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [who ?? ""]);
  await db.exec(`set role ${who ? "authenticated" : "anon"};`);
  try { return (await db.query<T>(sql, params)).rows; }
  finally { await db.exec("reset role;"); }
}

describe("forward Host privacy and audit hardening", () => {
  it("binds the single owner to an auth ID and rejects non-operator access", async () => {
    await expect(db.query("insert into public.axom_operator_roles(user_id,role) values($1,'owner')", [LEARNER])).rejects.toThrow(/duplicate key/);
    expect(await as(OWNER, "select public.axom_operator_role() role")).toEqual([{ role: "owner" }]);
    expect(await as(MODERATOR, "select public.axom_operator_role() role")).toEqual([{ role: "moderator" }]);
    expect(await as(LEARNER, "select public.axom_operator_role() role")).toEqual([{ role: null }]);
    await expect(as(LEARNER, "select * from public.axom_operator_review_queue()")).rejects.toThrow(/Operator access required/);
    await expect(as(null, "select * from public.axom_operator_review_queue()")).rejects.toThrow(/permission denied/);
    await expect(as(LEARNER, "insert into public.axom_operator_roles(user_id,role) values($1,'admin')", [LEARNER])).rejects.toThrow(/permission denied/);
  });

  it("lists and searches the account directory with Supabase's varchar email column", async () => {
    const all = await as<{ user_id: string; email: string; role: string | null }>(OWNER,
      "select user_id,email,role from public.axom_operator_accounts('') order by email");
    expect(all.map(row => row.email)).toEqual(["learner@example.test", "moderator@example.test", "owner@example.test"]);
    expect(all.find(row => row.user_id === OWNER)?.role).toBe("owner");
    expect(await as(OWNER, "select email from public.axom_operator_accounts('learner@')")).toEqual([{ email: "learner@example.test" }]);
    expect(await as(OWNER, "select email from public.axom_operator_accounts('nobody-matches')")).toEqual([]);
    await expect(as(MODERATOR, "select * from public.axom_operator_accounts('')")).rejects.toThrow(/Account management access required/);
    await expect(as(LEARNER, "select * from public.axom_operator_accounts('')")).rejects.toThrow(/Account management access required/);
    await expect(as(null, "select * from public.axom_operator_accounts('')")).rejects.toThrow(/permission denied/);
  });

  it("shows only current, ready, explicitly submitted academic metadata", async () => {
    for (const [id, visibility] of [[GROUP, "group"], [SUBMITTED, "private"], [STALE, "group"], [WITHDRAWN, "group"]]) {
      await db.query("insert into public.academic_collections(id,owner_id,title,module,term,visibility,current_revision_id) values($1,$2,$3,'SAMPLE','Term 1',$4,$1)", [id, LEARNER, `Course ${id.slice(0, 4)}`, visibility]);
      await db.query("insert into public.academic_revisions(id,collection_id,status,ready_questions) values($1,$1,'ready',1)", [id]);
    }
    for (const id of [SUBMITTED, STALE, WITHDRAWN]) {
      await db.query("insert into public.academic_community_submissions(collection_id,revision_id,rights_attested_at) values($1,$1,now())", [id]);
    }
    await db.query("update public.academic_collections set current_revision_id=$2 where id=$1", [STALE, GROUP]);
    await db.query("update public.academic_community_submissions set status='withdrawn' where collection_id=$1", [WITHDRAWN]);
    const queue = await as<{ collection_id: string }>(MODERATOR, "select collection_id from public.axom_operator_review_queue()");
    expect(queue).toEqual([{ collection_id: SUBMITTED }]);
    const [overview] = await as<{ value: { academic_review_pending: number; academic_approved: number } }>(MODERATOR, "select public.axom_operator_overview() value");
    expect(overview.value.academic_review_pending).toBe(1);
    expect(overview.value.academic_approved).toBe(0);
    await expect(as(MODERATOR, "select * from public.academic_collections")).rejects.toThrow(/permission denied/);
  });

  it("pages owner audit records deterministically without leaking them to other roles", async () => {
    const ids = [
      "aaaabbbb-1111-4111-8111-aaaaaaaaaaaa",
      "aaaabbbb-2222-4222-8222-bbbbbbbbbbbb",
      "aaaabbbb-3333-4333-8333-cccccccccccc",
    ];
    for (let i = 0; i < ids.length; i++) {
      await db.query("insert into public.axom_operator_audit(id,actor_id,action,metadata,created_at) values($1,$2,'audit.test','{}'::jsonb,$3)",
        [ids[i], OWNER, `2099-11-07T0${i + 1}:00:00Z`]);
    }
    const first = await as<{ id: string; created_at: string }>(OWNER,
      "select id,created_at from public.axom_operator_audit_page(2)");
    expect(first.map((row) => row.id)).toEqual([ids[2], ids[1]]);
    const older = await as<{ id: string }>(OWNER,
      "select id from public.axom_operator_audit_page(2,$1,$2)", [first[1].created_at, first[1].id]);
    expect(older.map((row) => row.id)).toContain(ids[0]);
    expect(older.some((row) => first.some((newer) => newer.id === row.id))).toBe(false);
    await expect(as(LEARNER, "select * from public.axom_operator_audit_page(30)")).rejects.toThrow(/owner/i);
    await expect(as(MODERATOR, "select * from public.axom_operator_audit_page(30)")).rejects.toThrow(/owner/i);
    await expect(as(null, "select * from public.axom_operator_audit_page(30)")).rejects.toThrow(/permission denied/);
    await expect(as(OWNER, "select * from public.axom_operator_audit_page(0)")).rejects.toThrow(/page size/i);
    await expect(as(OWNER, "select * from public.axom_operator_audit_page(2,$1,null)", [first[1].created_at])).rejects.toThrow(/cursor/i);
  });

  it("does not expose private posts to moderation and records a reason for decisions", async () => {
    await as(LEARNER, "insert into public.social_profiles(user_id,handle,display_name,discoverable) values($1,'learner_post','Learner',true)", [LEARNER]);
    await as(MODERATOR, "insert into public.social_profiles(user_id,handle,display_name,discoverable) values($1,'moderator_post','Moderator',true)", [MODERATOR]);
    const [post] = await as<{ id: string }>(LEARNER,
      "insert into public.social_posts(user_id,kind,set_title) values($1,'question_set','Private title') returning id", [LEARNER]);
    await expect(as(LEARNER, "insert into public.social_post_reports(post_id,reporter_id,reason) values($1,$2,'other')", [post.id, LEARNER])).rejects.toThrow(/row-level security/);
    await as(LEARNER, "update public.social_posts set visibility='community' where id=$1", [post.id]);
    await as(MODERATOR, "insert into public.social_post_reports(post_id,reporter_id,reason) values($1,$2,'other')", [post.id, MODERATOR]);
    expect(await as(MODERATOR, "select post_id from public.axom_operator_reports()")).toEqual([{ post_id: post.id }]);
    await as(LEARNER, "update public.social_posts set visibility='private' where id=$1", [post.id]);
    expect(await as(MODERATOR, "select post_id from public.axom_operator_reports()")).toEqual([]);
    await expect(as(MODERATOR, "select public.axom_operator_resolve_report($1,'remove','Review evidence checked')", [post.id])).rejects.toThrow(/Report no longer available/);
    await as(LEARNER, "update public.social_posts set visibility='community' where id=$1", [post.id]);
    await expect(as(MODERATOR, "select public.axom_operator_resolve_report($1,'dismiss','short')", [post.id])).rejects.toThrow(/reason/);
    await as(MODERATOR, "select public.axom_operator_resolve_report($1,'dismiss','Documented false report')", [post.id]);
    expect(await as(MODERATOR, "select post_id from public.axom_operator_reports()")).toEqual([]);
    expect(await as(OWNER, "select metadata->>'reason' reason from public.axom_operator_audit where action='social.report.dismiss'"))
      .toEqual([{ reason: "Documented false report" }]);
    await expect(as(MODERATOR, "select public.axom_operator_resolve_report($1,'dismiss')", [post.id])).rejects.toThrow(/does not exist/);
    expect((await db.query<{ allowed: boolean }>("select has_function_privilege('anon','public.axom_operator_resolve_report(uuid,text,text)','execute') allowed")).rows[0].allowed).toBe(false);
  });
});
