import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
let db: PGlite;
let day: string;
let legacyUpgrade: { visibility: string; minutes: number; share_source: string; revision: number };
type Preferences = { discoverable: boolean; shareMode: string; revision: number };

beforeAll(async () => {
  db = new PGlite({ parsers: { 1082: value => value } });
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon,authenticated,service_role;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema public grant all on functions to anon,authenticated,service_role;
    create schema auth;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to anon,authenticated,service_role;
    grant execute on function auth.uid() to anon,authenticated,service_role;
    create table public.privacy_requests(user_id uuid,kind text,status text,failure_code text);
  `);
  const barrierSource = readFileSync(new URL("../../../../supabase/migrations/20261016011812_harden_privacy_request_barrier.sql", import.meta.url), "utf8");
  const barrier = barrierSource.match(/create or replace function public\.axom_account_accepts_cloud_writes\(\)[\s\S]*?\$\$;/)?.[0];
  if (!barrier) throw new Error("The account privacy barrier is missing");
  await db.exec(barrier);
  await db.exec(readFileSync(new URL("../../../../supabase/migrations/20261101190000_community_social.sql", import.meta.url), "utf8"));
  const legacyOwner = "44444444-4444-4444-8444-444444444444";
  await db.query("insert into auth.users(id,email) values($1,'legacy@example.test')", [legacyOwner]);
  await db.query("insert into social_profiles(user_id,handle,display_name,discoverable) values($1,'legacy','Legacy learner',false)", [legacyOwner]);
  await db.query("insert into social_posts(user_id,kind,visibility,activity_day,minutes) values($1,'progress','private',current_date,45)", [legacyOwner]);
  await db.exec(readFileSync(new URL("../../../../supabase/migrations/20261106020000_community_experience.sql", import.meta.url), "utf8"));
  legacyUpgrade = (await db.query<typeof legacyUpgrade>("select visibility,minutes,share_source,revision::integer from social_posts where user_id=$1", [legacyOwner])).rows[0];
  await db.query("delete from auth.users where id=$1", [legacyOwner]);
  for (const [id, handle] of [[A, "atlas"], [B, "briar"], [C, "cedar"]]) {
    await db.query("insert into auth.users(id,email) values($1,$2)", [id, `${handle}@example.test`]);
    await prefs(id, "off");
    await as(id, "select axom_create_community_profile($1,$1,'')", [handle]);
  }
  day = (await db.query<{ day: string }>("select (now() at time zone 'UTC')::date as day")).rows[0].day;
}, 30_000);
afterAll(async () => { await db?.close(); });
afterEach(async () => { await db.exec("delete from social_posts; delete from social_connections; delete from social_progress_blocks;"); });

async function as<T = Record<string, unknown>>(who: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  return db.transaction(async tx => {
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [who ?? ""]);
    await tx.exec(`set local role ${who ? "authenticated" : "anon"}`);
    return (await tx.query<T>(sql, params)).rows;
  });
}
async function prefs(who: string, mode: string, discoverable = true): Promise<Preferences> {
  return (await as<{ value: Preferences }>(who, "select public.axom_save_community_preferences($1,$2) value", [discoverable, mode]))[0].value;
}
async function sync(who: string, consent: number, expected: number | null, minutes: number, onDay = day) {
  return (await as<{ value: { action: string; revision: number } }>(who,
    "select public.axom_sync_community_day($1,$2,0,0,$3,$4) value", [onDay, minutes, consent, expected]))[0].value;
}
async function connect() {
  const [request] = await as<{ id: string }>(A, "insert into social_connections(requester_id,addressee_id) values($1,$2) returning id", [A, B]);
  await as(B, "update social_connections set status='accepted',accepted_at=now() where id=$1", [request.id]);
  return request.id;
}

describe("Community consent and conversation policies in PostgreSQL", () => {
  it("upgrades existing private progress without publishing or relabeling it as automatic", () => {
    expect(legacyUpgrade).toEqual({ visibility: "private", minutes: 45, share_source: "manual", revision: 1 });
  });
  it("seeds conservative signup choices including malformed metadata, non-email accounts and explicit choices", async () => {
    const cases = [null, {}, { axom_community_preferences: false }, { axom_community_preferences: { discoverable: "true", shareMode: 12 } },
      { axom_community_preferences: { discoverable: true, shareMode: "friends" } }];
    for (let index = 0; index < cases.length; index++) {
      const id = `44444444-4444-4444-8444-${String(index).padStart(12, "0")}`;
      await db.query("insert into auth.users(id,raw_user_meta_data) values($1,$2)", [id, JSON.stringify(cases[index])]);
      const [read] = await as<{ value: Preferences }>(id, "select public.axom_community_preferences() value");
      expect(read.value).toEqual({ discoverable: index === 4, shareMode: index === 4 ? "friends" : "off", revision: 1 });
      expect(await as(id, "select * from social_profiles where user_id=$1", [id])).toEqual([]);
    }
    await expect(as(null, "select public.axom_community_preferences()")).rejects.toThrow(/permission denied/);
    expect(await as(B, "select user_id from social_preferences where user_id=$1", [A])).toEqual([]);
    await expect(as(A, "update social_preferences set share_mode='community' where user_id=$1", [A])).rejects.toThrow(/permission denied/);
  });

  it("atomically revokes automatic days, rejects delayed writes, and preserves manual posts", async () => {
    const preference = await prefs(A, "community");
    const first = await sync(A, preference.revision, 0, 60);
    expect(first).toEqual({ action: "inserted", revision: 1 });
    const [automatic] = await as<{ id: string }>(B, "select id from social_posts where user_id=$1 and kind='progress'", [A]);
    expect(automatic.id).toBeTruthy();
    const [manual] = await as<{ id: string }>(A, "insert into social_posts(user_id,kind,visibility,caption) values($1,'update','community','A deliberate update') returning id", [A]);
    await as(B, "insert into social_comments(post_id,user_id,body) values($1,$2,'Well done')", [automatic.id, B]);
    const off = await prefs(A, "off");
    expect(off.revision).toBeGreaterThan(preference.revision);
    expect(await as(B, "select id from social_posts where id=$1", [automatic.id])).toEqual([]);
    expect(await as(B, "select id from social_comments where post_id=$1", [automatic.id])).toEqual([]);
    expect(await as(B, "select id from social_posts where id=$1", [manual.id])).toEqual([{ id: manual.id }]);
    await expect(sync(A, preference.revision, first.revision, 90)).rejects.toThrow(/permission changed/);
    const enabledAgain = await prefs(A, "community");
    await expect(sync(A, preference.revision, first.revision, 100)).rejects.toThrow(/permission changed/);
    expect((await sync(A, enabledAgain.revision, null, 100)).action).toBe("kept-private");
    expect(await as(B, "select id from social_posts where id=$1", [automatic.id])).toEqual([]);
    await as(A, "delete from social_posts where user_id=$1", [A]);
  });

  it("creates a profile with the current account choice and leaves atomically", async () => {
    const id = "44444444-4444-4444-8444-000000000004";
    // Signup chose discoverable, then the owner changed their mind before creating a profile.
    await prefs(id, "friends", false);
    await expect(as(id, "insert into social_profiles(user_id,handle,display_name,discoverable) values($1,'legacy_visible','Legacy',true)", [id]))
      .rejects.toThrow(/permission denied/);
    await as(id, "select axom_create_community_profile('quiet_member','Quiet member','A new learner')");
    expect(await as(id, "select discoverable from social_profiles where user_id=$1", [id])).toEqual([{ discoverable: false }]);
    await expect(as(id, "update social_profiles set discoverable=true where user_id=$1", [id])).rejects.toThrow(/permission denied/);
    await as(id, "update social_profiles set display_name='Quiet learner',bio='Learning together' where user_id=$1", [id]);
    await expect(as(id, "delete from social_profiles where user_id=$1", [id])).rejects.toThrow(/permission denied/);
    expect((await as<{ value: Preferences }>(id, "select axom_community_preferences() value"))[0].value).toMatchObject({ shareMode: "friends", discoverable: false });
    await expect(as(id, "select axom_create_community_profile('second_member','Overwrite','')")).rejects.toThrow(/duplicate key/);
    await as(id, "select axom_leave_community()");
    expect(await as(id, "select user_id from social_profiles where user_id=$1", [id])).toEqual([]);
    expect((await as<{ value: Preferences }>(id, "select axom_community_preferences() value"))[0].value).toMatchObject({ shareMode: "off", discoverable: false });
  });

  it("supports decreasing and zero corrections while rejecting stale and concurrent devices", async () => {
    const preference = await prefs(A, "friends");
    const created = await sync(A, preference.revision, 0, 90);
    expect(created.action).toBe("inserted");
    expect(await sync(A, preference.revision, null, 25)).toEqual({ action: "conflict", revision: created.revision });
    const corrected = await sync(A, preference.revision, created.revision, 25);
    expect(corrected).toEqual({ action: "updated", revision: created.revision + 1 });
    expect(await sync(A, preference.revision, created.revision, 120)).toEqual({ action: "conflict", revision: corrected.revision });
    expect(await sync(A, preference.revision, null, 25)).toEqual({ action: "unchanged", revision: corrected.revision });
    const cleared = await sync(A, preference.revision, corrected.revision, 0);
    expect(cleared.action).toBe("updated");
    expect(await as(A, "select minutes from social_posts where user_id=$1", [A])).toEqual([{ minutes: 0 }]);
    await as(A, "delete from social_posts where user_id=$1", [A]);
  });

  it("narrows past automatic audiences and never widens old friends days or manual days", async () => {
    const friendId = await connect();
    const community = await prefs(A, "community");
    await sync(A, community.revision, 0, 60);
    expect(await as(C, "select minutes from social_posts where user_id=$1", [A])).toEqual([{ minutes: 60 }]);
    const friends = await prefs(A, "friends");
    expect(await as(C, "select minutes from social_posts where user_id=$1", [A])).toEqual([]);
    expect(await as(B, "select minutes from social_posts where user_id=$1", [A])).toEqual([{ minutes: 60 }]);
    const [current] = await as<{ revision: number }>(A, "select revision from social_posts where user_id=$1", [A]);
    const wider = await prefs(A, "community");
    await sync(A, wider.revision, current.revision, 70);
    expect(await as(C, "select minutes from social_posts where user_id=$1", [A])).toEqual([]);
    await expect(sync(A, friends.revision, current.revision, 99)).rejects.toThrow(/permission changed/);
    await as(A, "delete from social_posts where user_id=$1", [A]);
    await as(A, "delete from social_connections where id=$1", [friendId]);
  });

  it("lets an explicit author publish correct an existing day with a version check", async () => {
    const preference = await prefs(A, "friends");
    const automatic = await sync(A, preference.revision, 0, 80);
    await expect(as(A, "select axom_publish_community_day($1,10,0,0,'Corrected','private',$2)", [day, automatic.revision + 1])).rejects.toThrow(/changed on another device/);
    await as(A, "select axom_publish_community_day($1,10,0,0,'Corrected','private',$2)", [day, automatic.revision]);
    expect(await as(A, "select minutes,share_source,visibility from social_posts where user_id=$1", [A]))
      .toEqual([{ minutes: 10, share_source: "manual", visibility: "private" }]);
    expect((await sync(A, preference.revision, null, 90)).action).toBe("kept-private");
    await as(A, "delete from social_posts where user_id=$1", [A]);
  });

  it("does not recreate an automatic day after removal, until the author deliberately publishes it again", async () => {
    const preference = await prefs(A, "community");
    await sync(A, preference.revision, 0, 55);
    await as(A, "delete from social_posts where user_id=$1", [A]);
    expect(await sync(A, preference.revision, 0, 55)).toEqual({ action: "kept-private", revision: 0 });
    expect(await as(B, "select * from social_progress_blocks where user_id=$1", [A])).toEqual([]);
    await expect(as(A, "delete from social_progress_blocks where user_id=$1", [A])).rejects.toThrow(/permission denied/);
    await as(A, "select axom_publish_community_day($1,40,0,0,'Revised','friends',0)", [day]);
    expect(await as(A, "select minutes,share_source from social_posts where user_id=$1", [A])).toEqual([{ minutes: 40, share_source: "manual" }]);
    expect(await as(A, "select * from social_progress_blocks where user_id=$1", [A])).toEqual([]);
  });

  it("keeps deleted manual and private days suppressed across reloads and refuses legacy automatic REST writes", async () => {
    const preference = await prefs(A, "community");
    await as(A, "select axom_publish_community_day($1,40,0,0,'For me','private',0)", [day]);
    await as(A, "delete from social_posts where user_id=$1", [A]);
    expect(await sync(A, preference.revision, 0, 40)).toEqual({ action: "kept-private", revision: 0 });
    await expect(as(A, "insert into social_posts(user_id,kind,visibility,activity_day,minutes,cards,questions) values($1,'progress','community',$2,40,0,0)", [A, day]))
      .rejects.toThrow(/row-level security/);
    await as(A, "select axom_publish_community_day($1,20,0,0,'Chosen again','friends',0)", [day]);
    await prefs(A, "off");
    await expect(as(A, "update social_posts set minutes=50,cards=10,questions=5,visibility='community' where user_id=$1", [A]))
      .rejects.toThrow(/permission denied/);
    await as(A, "delete from social_posts where user_id=$1", [A]);
    await expect(as(A, "insert into social_posts(user_id,kind,visibility,activity_day,minutes) values($1,'progress','community',$2,40)", [A, day]))
      .rejects.toThrow(/row-level security/);
    const reenabled = await prefs(A, "community");
    expect(await sync(A, reenabled.revision, 0, 50)).toEqual({ action: "kept-private", revision: 0 });
  });

  it("accepts the latest current local calendar day worldwide and rejects dates future everywhere", async () => {
    const [dates] = (await db.query<{ latest: string; future: string }>(
      "select ((now() at time zone 'UTC') + interval '14 hours')::date latest, ((now() at time zone 'UTC') + interval '14 hours')::date + 1 future",
    )).rows;
    const preference = await prefs(A, "community");
    expect((await sync(A, preference.revision, 0, 45, dates.latest)).action).toBe("inserted");
    await as(A, "select axom_publish_community_day($1,30,0,0,'Local day','friends',1)", [dates.latest]);
    await expect(sync(A, preference.revision, 0, 20, dates.future)).rejects.toThrow(/Invalid study day/);
    await expect(as(A, "select axom_publish_community_day($1,20,0,0,'Future','friends',0)", [dates.future])).rejects.toThrow(/Invalid progress post/);
    await expect(db.query("insert into social_posts(user_id,kind,activity_day) values($1,'progress',$2)", [A, dates.future]))
      .rejects.toThrow(/social_posts_activity_day_check/);
  });

  it("keeps provenance, row identity and revisions server-owned", async () => {
    await expect(as(A, "insert into social_posts(user_id,kind,visibility,activity_day,minutes,share_source) values($1,'progress','community',$2,10,'automatic')", [A, day])).rejects.toThrow(/permission denied/);
    const preference = await prefs(A, "friends");
    await sync(A, preference.revision, 0, 50);
    await expect(as(A, "update social_posts set revision=10 where user_id=$1", [A])).rejects.toThrow(/permission denied/);
    await expect(as(A, "update social_posts set activity_day=activity_day-1 where user_id=$1", [A])).rejects.toThrow(/permission denied/);
    await as(A, "update social_posts set caption='Chosen by me',visibility='private' where user_id=$1", [A]);
    expect(await as(A, "select share_source,revision from social_posts where user_id=$1", [A])).toEqual([{ share_source: "manual", revision: 2 }]);
    expect((await sync(A, preference.revision, null, 99)).action).toBe("kept-private");
    await as(A, "delete from social_posts where user_id=$1", [A]);
    for (const signature of ["public.axom_community_preferences()", "public.axom_save_community_preferences(boolean,text)",
      "public.axom_create_community_profile(text,text,text)", "public.axom_leave_community()",
      "public.axom_sync_community_day(date,integer,integer,integer,bigint,bigint)",
      "public.axom_publish_community_day(date,integer,integer,integer,text,text,bigint)"])
      expect((await db.query<{ allowed: boolean }>("select has_function_privilege('anon',$1,'execute') allowed", [signature])).rows[0].allowed).toBe(false);
  });

  it("keeps reply access tied to friendship and post audience, with author and host removal", async () => {
    const friendId = await connect();
    const [post] = await as<{ id: string }>(A, "insert into social_posts(user_id,kind,visibility,caption) values($1,'study_invite','friends','Join me for a study session') returning id", [A]);
    await expect(as(C, "insert into social_comments(user_id,post_id,body) values($1,$2,'Invisible')", [C, post.id])).rejects.toThrow(/row-level security/);
    await expect(as(B, "insert into social_comments(user_id,post_id,body) values($1,$2,'Forged')", [A, post.id])).rejects.toThrow(/row-level security/);
    const [reply] = await as<{ id: string }>(B, "insert into social_comments(user_id,post_id,body) values($1,$2,'Count me in') returning id", [B, post.id]);
    expect(await as(A, "select body from social_comments where id=$1", [reply.id])).toEqual([{ body: "Count me in" }]);
    expect(await as(A, "update social_comments set body='Changed by host' where id=$1 returning id", [reply.id])).toEqual([]);
    await as(B, "update social_comments set body='After class works' where id=$1", [reply.id]);
    await expect(as(B, "update social_comments set user_id=$1 where id=$2", [A, reply.id])).rejects.toThrow(/permission denied/);
    await as(A, "update social_posts set visibility='private' where id=$1", [post.id]);
    expect(await as(B, "select body from social_comments where id=$1", [reply.id])).toEqual([]);
    expect(await as(B, "update social_comments set body='Cannot edit hidden' where id=$1 returning id", [reply.id])).toEqual([]);
    await as(A, "update social_posts set visibility='friends' where id=$1", [post.id]);
    await as(A, "delete from social_connections where id=$1", [friendId]);
    expect(await as(B, "select body from social_comments where id=$1", [reply.id])).toEqual([]);
    await as(A, "delete from social_comments where id=$1", [reply.id]);
    expect((await db.query("select id from social_comments where id=$1", [reply.id])).rows).toEqual([]);
    await as(A, "delete from social_posts where id=$1", [post.id]);
  });

  it("identifies a hidden incoming requester without exposing their private activity", async () => {
    await prefs(A, "off", false);
    const [request] = await as<{ id: string }>(A, "insert into social_connections(requester_id,addressee_id) values($1,$2) returning id", [A, B]);
    expect(await as(B, "select handle from social_profiles where user_id=$1", [A])).toEqual([{ handle: "atlas" }]);
    expect(await as(C, "select handle from social_profiles where user_id=$1", [A])).toEqual([]);
    await as(A, "delete from social_connections where id=$1", [request.id]);
    expect(await as(B, "select handle from social_profiles where user_id=$1", [A])).toEqual([]);
  });

  it("blocks writes during deletion and cascades preferences, replies and posts after Auth deletion", async () => {
    const D = "55555555-5555-4555-8555-555555555555";
    await db.query("insert into auth.users(id) values($1)", [D]);
    await prefs(D, "off");
    await as(D, "select axom_create_community_profile('departing','Departing','')");
    const [post] = await as<{ id: string }>(D, "insert into social_posts(user_id,kind,visibility,caption) values($1,'update','community','Goodbye') returning id", [D]);
    await as(B, "insert into social_comments(user_id,post_id,body) values($1,$2,'See you')", [B, post.id]);
    await db.query("insert into social_progress_blocks(user_id,activity_day) values($1,$2)", [D, day]);
    await db.query("insert into privacy_requests(user_id,kind,status) values($1,'deletion','processing')", [D]);
    await expect(prefs(D, "friends")).rejects.toThrow(/deletion cleanup/);
    await expect(as(D, "insert into social_comments(user_id,post_id,body) values($1,$2,'Blocked')", [D, post.id])).rejects.toThrow(/deletion cleanup/);
    // Trusted deletion must succeed even if a pooled connection retained the
    // removed learner's subject; a real authenticated request remains barred.
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [D]);
    await db.query("delete from auth.users where id=$1", [D]);
    await db.query("select set_config('request.jwt.claim.sub','',false)");
    expect((await db.query("select user_id from social_preferences where user_id=$1", [D])).rows).toEqual([]);
    expect((await db.query("select id from social_posts where user_id=$1", [D])).rows).toEqual([]);
    expect((await db.query("select id from social_comments where post_id=$1", [post.id])).rows).toEqual([]);
    expect((await db.query("select user_id from social_progress_blocks where user_id=$1", [D])).rows).toEqual([]);
    await expect(prefs(D, "friends")).rejects.toThrow(/deletion cleanup/);
  });
});
