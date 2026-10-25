import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec([
    "create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;",
    "grant usage on schema public to anon,authenticated,service_role;",
    "alter default privileges in schema public grant all on tables to anon,authenticated,service_role;",
    "alter default privileges in schema public grant all on functions to anon,authenticated,service_role;",
    "create schema auth;",
    "create table auth.users(id uuid primary key,email text,created_at timestamptz not null default now(),last_sign_in_at timestamptz);",
    "create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;",
    "grant usage on schema auth to anon,authenticated,service_role;",
    "grant execute on function auth.uid() to anon,authenticated,service_role;",
    "create table public.account_profiles(user_id uuid primary key references auth.users(id),display_name text,created_at timestamptz default now(),updated_at timestamptz default now());",
    "create table public.privacy_requests(user_id uuid,kind text,status text,failure_code text);",
    "create table public.ai_usage(user_id uuid not null references auth.users(id),day date not null,requests integer not null default 0,primary key(user_id,day));",
    "create table public.academic_collections(id uuid primary key,owner_id uuid references auth.users(id),title text not null,module text not null,term text not null,visibility text not null default 'private',review_status text not null default 'pending',withdrawn boolean not null default false,current_revision_id uuid,updated_at timestamptz default now());",
    "create table public.academic_revisions(id uuid primary key,collection_id uuid references public.academic_collections(id),ready_questions integer not null default 0,review_questions integer not null default 0);",
  ].join("\n"));
  const barrierSource = readFileSync(new URL("../../../../supabase/migrations/20261016011812_harden_privacy_request_barrier.sql", import.meta.url),"utf8");
  const barrier = barrierSource.match(/create or replace function public\.axom_account_accepts_cloud_writes\(\)[\s\S]*?\$\$;/)?.[0];
  if (!barrier) throw new Error("The existing account privacy barrier was not found");
  await db.exec(barrier);
  for (const [id,email] of [[A,"one@example.test"],[B,"two@example.test"],[C,"three@example.test"]]) {
    await db.query("insert into auth.users(id,email) values($1,$2)",[id,email]);
    await db.query("insert into public.account_profiles(user_id,display_name) values($1,$2)",[id,email]);
  }
  for (const name of ["20261024150000_community_social.sql","20261024153000_operator_console.sql"]) {
    await db.exec(readFileSync(new URL("../../../../supabase/migrations/" + name, import.meta.url),"utf8"));
  }
},30_000);
afterAll(async () => { await db?.close(); });

async function as<T = Record<string,unknown>>(who: string | null, sql: string, params: unknown[] = []) {
  await db.exec("reset role;");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[who ?? ""]);
  await db.exec("set role " + (who ? "authenticated" : "anon") + ";");
  try { return (await db.query<T>(sql,params)).rows; }
  finally { await db.exec("reset role;"); }
}

describe("Community and operator security against real Postgres RLS", () => {
  it("denies anonymous reads and spoofed registration, requires opt-in and honors discovery", async () => {
    await expect(as(null,"select * from public.social_profiles")).rejects.toThrow(/permission denied/);
    await expect(as(null,"select public.axom_operator_overview()")).rejects.toThrow(/permission denied/);
    await expect(as(B,"insert into public.social_profiles(user_id,handle,display_name,discoverable) values($1,'wrong_account','Wrong',true)",[A])).rejects.toThrow(/row-level security/);
    for (const [id,handle] of [[A,"learner_one"],[B,"learner_two"],[C,"learner_three"]]) {
      await as(id,"insert into public.social_profiles(user_id,handle,display_name,discoverable) values($1,$2,$2,true)",[id,handle]);
    }
    expect((await as<{handle:string}>(B,"select handle from public.social_profiles order by handle")).map(row=>row.handle))
      .toEqual(["learner_one","learner_three","learner_two"]);
    await as(A,"update public.social_profiles set discoverable=false where user_id=$1",[A]);
    expect(await as(B,"select user_id from public.social_profiles where user_id=$1",[A])).toEqual([]);
    await as(A,"update public.social_profiles set discoverable=true where user_id=$1",[A]);
  });

  it("prevents request forgery and hides friends-only posts immediately after unfriending", async () => {
    await expect(as(A,"insert into public.social_connections(requester_id,addressee_id) values($1,$1)",[A])).rejects.toThrow(/violates check constraint/);
    await expect(as(A,"insert into public.social_connections(requester_id,addressee_id) values($1,$2)",[B,C])).rejects.toThrow(/row-level security/);
    const request = await as<{id:string}>(A,"insert into public.social_connections(requester_id,addressee_id) values($1,$2) returning id",[A,B]);
    const id = request[0].id;
    await expect(as(B,"insert into public.social_connections(requester_id,addressee_id) values($1,$2)",[B,A])).rejects.toThrow(/duplicate key/);
    expect(await as(A,"update public.social_connections set status='accepted',accepted_at=now() where id=$1 returning id",[id])).toEqual([]);
    await expect(as(B,"update public.social_connections set requester_id=$1,status='accepted',accepted_at=now() where id=$2",[B,id]))
      .rejects.toThrow(/Only the recipient/);
    await as(B,"update public.social_connections set status='accepted',accepted_at=now() where id=$1",[id]);
    expect(await as(B,"update public.social_connections set requester_id=$1 where id=$2 returning id",[B,id])).toEqual([]);

    const post = await as<{id:string}>(A,"insert into public.social_posts(user_id,kind,visibility,activity_day,minutes,cards,questions,caption) values($1,'progress','friends',current_date,80,30,9,'Study day') returning id",[A]);
    expect(await as(B,"select id from public.social_posts where id=$1",[post[0].id])).toEqual([{id:post[0].id}]);
    expect(await as(C,"select id from public.social_posts where id=$1",[post[0].id])).toEqual([]);
    expect(await as(B,"update public.social_posts set minutes=999 where id=$1 returning id",[post[0].id])).toEqual([]);
    await as(B,"insert into public.social_reactions(user_id,post_id) values($1,$2)",[B,post[0].id]);
    await expect(as(C,"insert into public.social_reactions(user_id,post_id) values($1,$2)",[C,post[0].id])).rejects.toThrow(/row-level security/);
    await as(B,"delete from public.social_connections where id=$1",[id]);
    expect(await as(B,"select id from public.social_posts where id=$1",[post[0].id])).toEqual([]);
    expect(await as(B,"select user_id from public.social_reactions where post_id=$1",[post[0].id])).toEqual([]);
  });

  it("grants no bootstrap owner by name and requires an audited verified owner for roles and AI quotas", async () => {
    expect(await as(B,"select public.axom_operator_role() as role")).toEqual([{role:null}]);
    await expect(as(B,"select public.axom_operator_accounts('')")).rejects.toThrow(/Account management access required/);
    await expect(as(B,"select public.axom_operator_set_role($1,'admin','Verified policy test')",[C])).rejects.toThrow(/Only the verified owner/);
    await expect(as(B,"select public.axom_operator_set_ai($1,true,1000,'Verified policy test')",[B])).rejects.toThrow(/Only the verified owner/);
    await expect(as(B,"insert into public.axom_operator_roles(user_id,role) values($1,'owner')",[B])).rejects.toThrow(/permission denied/);

    await db.query("insert into public.axom_operator_roles(user_id,role) values($1,'owner')",[A]);
    await as(A,"select public.axom_operator_set_role($1,'admin','Verified policy test')",[B]);
    expect(await as(B,"select public.axom_operator_role() as role")).toEqual([{role:"admin"}]);
    await expect(as(B,"select public.axom_operator_set_role($1,'owner','Verified policy test')",[B])).rejects.toThrow(/Only the verified owner/);
    await expect(as(A,"select public.axom_operator_set_role($1,'member','Verified policy test')",[A])).rejects.toThrow(/Invalid role change/);
    await as(A,"select public.axom_operator_set_ai($1,true,2,'Verified policy test')",[B]);
    expect(await as(B,"select public.consume_ai_quota() as remaining")).toEqual([{remaining:1}]);
    expect(await as(B,"select public.consume_ai_quota() as remaining")).toEqual([{remaining:0}]);
    expect(await as(B,"select public.consume_ai_quota() as remaining")).toEqual([{remaining:-1}]);
    await as(A,"select public.axom_operator_set_ai($1,false,2,'Verified policy test')",[B]);
    expect(await as(B,"select public.consume_ai_quota() as remaining")).toEqual([{remaining:-1}]);
    const log = await as<{action:string}>(A,"select action from public.axom_operator_audit");
    expect(log.map(item=>item.action)).toEqual(expect.arrayContaining(["account.role","ai.policy"]));
    expect(await as(B,"select * from public.axom_operator_audit")).toEqual([]);
  });
  it("keeps an omitted visibility private and denies friends its post and reaction rows", async () => {
    const request = await as<{id:string}>(A,"insert into public.social_connections(requester_id,addressee_id) values($1,$2) returning id",[A,B]);
    await as(B,"update public.social_connections set status='accepted',accepted_at=now() where id=$1",[request[0].id]);
    const [post] = await as<{id:string;visibility:string}>(A,"insert into public.social_posts(user_id,kind,set_title) values($1,'question_set','Private title') returning id,visibility",[A]);
    expect(post.visibility).toBe("private");
    expect(await as(B,"select id from public.social_posts where id=$1",[post.id])).toEqual([]);
    await expect(as(B,"insert into public.social_reactions(user_id,post_id) values($1,$2)",[B,post.id])).rejects.toThrow(/row-level security/);
    await as(A,"update public.social_posts set visibility='friends' where id=$1",[post.id]);
    await as(B,"insert into public.social_reactions(user_id,post_id) values($1,$2)",[B,post.id]);
    await as(A,"update public.social_posts set visibility='private' where id=$1",[post.id]);
    expect(await as(B,"select id from public.social_posts where id=$1",[post.id])).toEqual([]);
    expect(await as(B,"select user_id from public.social_reactions where post_id=$1",[post.id])).toEqual([]);
    await as(A,"delete from public.social_posts where id=$1",[post.id]);
    await as(A,"delete from public.social_connections where id=$1",[request[0].id]);
  });

  it("retains audit events without preventing deletion of a former operator", async () => {
    const departed = "44444444-4444-4444-8444-444444444444";
    await db.query("insert into auth.users(id,email) values($1,'departed@example.test')",[departed]);
    await as(departed,"insert into public.social_profiles(user_id,handle,display_name,discoverable) values($1,'departed_operator','Departed',true)",[departed]);
    const [post] = await as<{id:string}>(departed,"insert into public.social_posts(user_id,kind,visibility,set_title) values($1,'question_set','community','Voluntary announcement') returning id",[departed]);
    await as(B,"insert into public.social_reactions(post_id,user_id) values($1,$2)",[post.id,B]);
    await as(B,"insert into public.social_post_reports(post_id,reporter_id,reason) values($1,$2,'other')",[post.id,B]);
    const [audit] = (await db.query<{id:string}>("insert into public.axom_operator_audit(actor_id,action,target_id) values($1,'test.retention',$2) returning id",[departed,B])).rows;
    await db.query("insert into public.axom_operator_roles(user_id,role,granted_by) values($1,'moderator',$2)",[C,departed]);
    await db.query("insert into public.axom_ai_entitlements(user_id,updated_by) values($1,$2)",[C,departed]);
    await db.query("insert into public.privacy_requests(user_id,kind,status) values($1,'deletion','processing')",[departed]);
    await expect(as(departed,"update public.social_profiles set bio='blocked' where user_id=$1",[departed])).rejects.toThrow(/deletion cleanup/);
    // The trusted Auth deletion worker carries no learner sub. Cascades must
    // erase social records while retaining anonymized administrative evidence.
    await db.query("select set_config('request.jwt.claim.sub','',false)");
    await expect(db.query("delete from auth.users where id=$1",[departed])).resolves.toBeDefined();
    expect((await db.query("select actor_id,action from public.axom_operator_audit where id=$1",[audit.id])).rows)
      .toEqual([{actor_id:null,action:"test.retention"}]);
    expect((await db.query("select id from public.social_posts where user_id=$1",[departed])).rows).toEqual([]);
    expect((await db.query("select * from public.social_reactions where post_id=$1",[post.id])).rows).toEqual([]);
    expect((await db.query("select * from public.social_post_reports where post_id=$1",[post.id])).rows).toEqual([]);
    await db.query("delete from public.privacy_requests where user_id=$1",[departed]);
    expect((await db.query("select granted_by from public.axom_operator_roles where user_id=$1",[C])).rows).toEqual([{granted_by:null}]);
    expect((await db.query("select updated_by from public.axom_ai_entitlements where user_id=$1",[C])).rows).toEqual([{updated_by:null}]);
  });

  it("requires a meaningful audit reason and rejects invalid quota policies without partial writes", async () => {
    for (const reason of [null,"", "short", " ".repeat(9), "x".repeat(501)]) {
      await expect(as(A,"select public.axom_operator_set_role($1,'moderator',$2)",[B,reason])).rejects.toThrow(/reason/);
      await expect(as(A,"select public.axom_operator_set_ai($1,true,60,$2)",[B,reason])).rejects.toThrow(/reason/);
    }
    for (const limit of [null,-1,1001]) {
      await expect(as(A,"select public.axom_operator_set_ai($1,true,$2,'Verified policy test')",[B,limit])).rejects.toThrow(/Invalid AI policy/);
    }
    await as(A,"select public.axom_operator_set_ai($1,true,0,'Pause costly access')",[B]);
    expect(await as(B,"select public.consume_ai_quota() remaining")).toEqual([{remaining:-1}]);
    expect(await as(A,"select metadata->>'reason' reason from public.axom_operator_audit where action='ai.policy' order by created_at desc limit 1"))
      .toEqual([{reason:"Pause costly access"}]);
    await expect(as(A,"update public.axom_operator_audit set metadata='{}'")).rejects.toThrow(/permission denied/);
    await expect(as(A,"delete from public.axom_operator_audit")).rejects.toThrow(/permission denied/);
  });

  it("applies permission revocation immediately to direct RPCs and denies raw privileged writes", async () => {
    await as(A,"select public.axom_operator_set_role($1,'member','Revoke expired access')",[B]);
    await expect(as(B,"select public.axom_operator_overview()")).rejects.toThrow(/Operator access required/);
    await expect(as(B,"select public.axom_operator_accounts('')")).rejects.toThrow(/Account management access required/);
    await expect(as(B,"select public.axom_operator_review_queue()")).rejects.toThrow(/Operator access required/);
    await expect(as(B,"select public.axom_operator_reports()")).rejects.toThrow(/Operator access required/);
    await expect(as(B,"update public.axom_ai_entitlements set enabled=true,daily_limit=1000")).rejects.toThrow(/permission denied/);
    await expect(as(B,"delete from public.axom_operator_roles")).rejects.toThrow(/permission denied/);
    for (const signature of ["public.axom_operator_set_role(uuid,text,text)","public.axom_operator_set_ai(uuid,boolean,integer,text)","public.axom_operator_resolve_report(uuid,text)","public.consume_ai_quota()","private.require_account_write_access()","private.social_write_guard()"])
      expect((await db.query<{allowed:boolean}>("select has_function_privilege('anon',$1,'execute') allowed",[signature])).rows[0].allowed).toBe(false);
    expect((await db.query<{allowed:boolean}>("select has_function_privilege('authenticated','private.require_account_write_access()','execute') allowed")).rows[0].allowed).toBe(false);
  });

  it("blocks new social, operator and AI writes during account deletion while preserving existing data", async () => {
    const [post] = await as<{id:string}>(A,"insert into public.social_posts(user_id,kind,visibility,set_title) values($1,'question_set','community','Shared metadata only') returning id",[A]);
    await as(B,"insert into public.social_reactions(user_id,post_id) values($1,$2)",[B,post.id]);
    await expect(as(B,"insert into public.social_reactions(user_id,post_id) values($1,$2)",[B,post.id])).rejects.toThrow(/duplicate key/);
    await expect(as(B,"insert into public.social_reactions(user_id,post_id) values($1,$2)",[C,post.id])).rejects.toThrow(/row-level security/);
    await as(B,"insert into public.social_post_reports(post_id,reporter_id,reason) values($1,$2,'other')",[post.id,B]);
    await db.query("insert into public.privacy_requests(user_id,kind,status) values($1,'deletion','processing'),($2,'deletion','processing')",[A,B]);
    await expect(as(A,"update public.social_profiles set bio='new data' where user_id=$1",[A])).rejects.toThrow(/deletion cleanup/);
    await expect(as(A,"insert into public.social_posts(user_id,kind,set_title) values($1,'question_set','Blocked write')",[A])).rejects.toThrow(/deletion cleanup/);
    await expect(as(A,"delete from public.social_posts where id=$1",[post.id])).rejects.toThrow(/deletion cleanup/);
    await expect(as(B,"delete from public.social_reactions where user_id=$1",[B])).rejects.toThrow(/deletion cleanup/);
    await expect(as(B,"delete from public.social_post_reports where reporter_id=$1",[B])).rejects.toThrow(/deletion cleanup/);
    await expect(as(A,"insert into public.social_connections(requester_id,addressee_id) values($1,$2)",[A,B])).rejects.toThrow(/deletion cleanup/);
    await expect(as(A,"select public.consume_ai_quota()")).rejects.toThrow(/deletion cleanup/);
    await expect(as(A,"select public.axom_operator_set_role($1,'admin','Verified policy test')",[B])).rejects.toThrow(/deletion cleanup/);
    await expect(as(A,"select public.axom_operator_set_ai($1,true,60,'Verified policy test')",[B])).rejects.toThrow(/deletion cleanup/);
    await expect(as(A,"select public.axom_operator_resolve_report($1,'remove')",[post.id])).rejects.toThrow(/deletion cleanup/);
    expect(await as(A,"select id from public.social_posts where id=$1",[post.id])).toEqual([{id:post.id}]);
    await db.exec("delete from public.privacy_requests");
    await as(A,"select public.axom_operator_resolve_report($1,'dismiss')",[post.id]);
    expect(await as(B,"select * from public.social_post_reports where post_id=$1",[post.id])).toEqual([]);
    await as(A,"delete from public.social_posts where id=$1",[post.id]);
  });

});