import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
const A = randomUUID(), B = randomUUID(), C = randomUUID(), R = randomUUID();
let db: PGlite; let challenge: string;
const pool = ["one", "two", "three"].map((id, i) => ({ key: `bank:${id}`, bankId: "bank", questionId: id, sourceChecksum: `sha256:${"a".repeat(64)}`, answerKey: ["A", "B", "C"][i], eligible: true }));
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon,authenticated,service_role;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema public grant all on functions to anon,authenticated,service_role;
    create schema auth; create table auth.users(id uuid primary key); insert into auth.users values('${A}'),('${B}');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to anon,authenticated,service_role; grant execute on function auth.uid() to anon,authenticated,service_role;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,unique(bucket_id,name));
    alter table storage.objects enable row level security; grant usage on schema storage to anon,authenticated,service_role;
    grant all on storage.objects to authenticated,service_role;`);
  for (const migration of ["20261011190000_academic_library", "20261013200000_daily_academic_challenges"]) await db.exec(readFileSync(new URL(`../../../../supabase/migrations/${migration}.sql`, import.meta.url), "utf8"));
  await db.query("insert into public.academic_collections(id,owner_id,title,module,term,visibility,review_status) values($1,$2,'Synthetic course','TEST','Term 1','shared','approved')", [C,A]);
  await db.query("insert into public.academic_revisions(id,collection_id,content_hash,template_text,provenance,status,approved_at) values($1,$2,$3,'plan','{}','ready',now())", [R,C,"a".repeat(64)]);
  const result = await db.query<{ id: string }>("select public.academic_publish_challenge($1,(now() at time zone 'UTC')::date,$2) id", [R,JSON.stringify(pool)]);
  challenge=result.rows[0].id;
}, 30_000);
afterAll(async () => db?.close());
async function as<T = { value: Record<string, unknown> }>(user: string, sql: string, params: unknown[] = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub','${user}',false); set role authenticated;`);
  try { return (await db.query<T>(sql, params)).rows; } finally { await db.exec("reset role;"); }
}
const join = (user: string, alias: string, visible = true) => as(user,"select public.academic_join_challenge($1,$2,$3)",[challenge,alias,visible]);
const answer = (user: string, key: string, choice: string, assisted = false, event = randomUUID()) => as(user,"select public.academic_submit_challenge($1,$2,$3,$4,$5) value",[challenge,key,choice,assisted,event]);
it("denies anonymous access, client publication and raw answers; catalog contains no key", async () => {
  const acl = await db.query<{ allowed: boolean }>("select has_function_privilege('anon','public.academic_daily_challenges()','execute') allowed");
  expect(acl.rows[0].allowed).toBe(false);
  await expect(as(A,"select * from public.academic_challenge_attempts")).rejects.toThrow(/permission denied/);
  await expect(as(A,"select * from public.academic_challenges")).rejects.toThrow(/permission denied/);
  await expect(as(A,"select public.academic_publish_challenge($1,current_date,$2)",[R,JSON.stringify(pool)])).rejects.toThrow(/permission denied/);
  const page=await as(A,"select public.academic_daily_challenges() value");
  expect(JSON.stringify(page)).not.toContain("answerKey");
  await expect(answer(A,"bank:one","A")).rejects.toThrow(/Opt in/);
});
it("validates first eligible answers, retries, repeats, assistance, ties and opt out", async () => {
  await join(A,"Alpha"); await join(B,"Beta");
  const event=randomUUID();
  expect((await answer(A,"bank:one","A",false,event))[0].value).toMatchObject({ accepted:true,points:1,replayed:false });
  expect((await answer(A,"bank:one","A",false,event))[0].value).toMatchObject({ accepted:true,points:1,replayed:true });
  await expect(answer(A,"bank:one","B",false,event)).rejects.toThrow(/identity/);
  expect((await answer(A,"bank:one","A"))[0].value).toMatchObject({ accepted:false,points:0 });
  expect((await answer(A,"bank:two","B",true))[0].value).toMatchObject({ points:0 });
  expect((await answer(A,"bank:two","B"))[0].value).toMatchObject({ accepted:false,points:0 });
  await expect(answer(A,"outside","A")).rejects.toThrow(/outside/);
  expect((await answer(B,"bank:one","A"))[0].value).toMatchObject({ points:1 });
  const board=(await as(A,"select public.academic_challenge_standings($1) value",[challenge]))[0].value;
  expect(board.rows).toEqual([{ alias:"Alpha",points:1,answered:2,rank:1,you:true },{ alias:"Beta",points:1,answered:1,rank:1,you:false }]);
  expect(JSON.stringify(board)).not.toContain(A); expect(JSON.stringify(board)).not.toContain("answer_key");
  await join(B,"Beta",false);
  expect((await as(A,"select public.academic_challenge_standings($1) value",[challenge]))[0].value.participants).toBe(1);
  await expect(answer(B,"bank:three","C")).rejects.toThrow(/Opt in/);
});
it("keeps published pools immutable and denies closed or inaccessible challenges", async () => {
  const same=await db.query<{ id: string }>("select public.academic_publish_challenge($1,current_date,$2) id",[R,JSON.stringify(pool)]);
  expect(same.rows[0].id).toBe(challenge);
  await expect(db.query("select public.academic_publish_challenge($1,current_date,$2)",[R,JSON.stringify(pool.slice(0,1))])).rejects.toThrow(/immutable/);
  await db.query("update public.academic_challenges set day=current_date-1 where id=$1",[challenge]);
  await expect(answer(A,"bank:three","C")).rejects.toThrow(/closed/);
  await db.query("update public.academic_collections set visibility='private' where id=$1",[C]);
  await expect(as(B,"select public.academic_challenge_standings($1)",[challenge])).rejects.toThrow(/unavailable/);
  await expect(join(A,"Alpha",false)).resolves.toBeDefined();
});
