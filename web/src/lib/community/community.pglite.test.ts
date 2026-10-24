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
    "create table public.ai_usage(user_id uuid not null references auth.users(id),day date not null,requests integer not null default 0,primary key(user_id,day));",
    "create table public.academic_collections(id uuid primary key,owner_id uuid references auth.users(id),title text not null,module text not null,term text not null,visibility text not null default 'private',review_status text not null default 'pending',withdrawn boolean not null default false,current_revision_id uuid,updated_at timestamptz default now());",
    "create table public.academic_revisions(id uuid primary key,collection_id uuid references public.academic_collections(id),ready_questions integer not null default 0,review_questions integer not null default 0);",
  ].join("\n"));
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
    await as(B,"update public.social_connections set status='accepted',accepted_at=now() where id=$1",[id]);
    await expect(as(B,"update public.social_connections set requester_id=$1 where id=$2",[B,id])).rejects.toThrow(/Only the recipient|row-level security/);

    const post = await as<{id:string}>(A,"insert into public.social_posts(user_id,kind,activity_day,minutes,cards,questions,caption) values($1,'progress',current_date,80,30,9,'Study day') returning id",[A]);
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
    await expect(as(B,"select public.axom_operator_set_role($1,'admin')",[C])).rejects.toThrow(/Only the verified owner/);
    await expect(as(B,"select public.axom_operator_set_ai($1,true,1000)",[B])).rejects.toThrow(/Only the verified owner/);
    await expect(as(B,"insert into public.axom_operator_roles(user_id,role) values($1,'owner')",[B])).rejects.toThrow(/permission denied/);

    await db.query("insert into public.axom_operator_roles(user_id,role) values($1,'owner')",[A]);
    await as(A,"select public.axom_operator_set_role($1,'admin')",[B]);
    expect(await as(B,"select public.axom_operator_role() as role")).toEqual([{role:"admin"}]);
    await expect(as(B,"select public.axom_operator_set_role($1,'owner')",[B])).rejects.toThrow(/Only the verified owner/);
    await expect(as(A,"select public.axom_operator_set_role($1,'member')",[A])).rejects.toThrow(/Invalid role change/);
    await as(A,"select public.axom_operator_set_ai($1,true,2)",[B]);
    expect(await as(B,"select public.consume_ai_quota() as remaining")).toEqual([{remaining:1}]);
    expect(await as(B,"select public.consume_ai_quota() as remaining")).toEqual([{remaining:0}]);
    expect(await as(B,"select public.consume_ai_quota() as remaining")).toEqual([{remaining:-1}]);
    await as(A,"select public.axom_operator_set_ai($1,false,2)",[B]);
    expect(await as(B,"select public.consume_ai_quota() as remaining")).toEqual([{remaining:-1}]);
    const log = await as<{action:string}>(A,"select action from public.axom_operator_audit");
    expect(log.map(item=>item.action)).toEqual(expect.arrayContaining(["account.role","ai.policy"]));
    expect(await as(B,"select * from public.axom_operator_audit")).toEqual([]);
  });
});