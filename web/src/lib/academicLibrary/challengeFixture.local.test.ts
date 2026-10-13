import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { File } from "node:buffer";
import { createClient } from "@supabase/supabase-js";
import { expect, it } from "vitest";
import { zipLibraryReader } from "../privateLibrary/install";
import { prepareAcademicUpload, uploadAcademicCourse } from "./upload";
import { publishDailyChallenge } from "./challengePublisher";

const statusFile=process.env.AXOM_LOCAL_SUPABASE_STATUS;
const pilot=process.env.AXOM_ACADEMIC_PILOT;
const destination=process.env.AXOM_CHALLENGE_FIXTURE;
it.skipIf(!statusFile || !pilot || !destination)("prepares reviewed source content for two real local challenge learners", async () => {
  const { env }=JSON.parse(readFileSync(statusFile!,"utf8"));
  const url=new URL(env.API_URL);
  if (url.protocol!=="http:" || !["localhost","127.0.0.1"].includes(url.hostname) || !destination!.startsWith("/tmp/axom-")) throw new Error("Fixture setup only permits loopback and a private task temporary file.");
  const options={ auth:{ persistSession:false,autoRefreshToken:false } };
  const admin=createClient(url.href,env.SERVICE_ROLE_KEY,options);
  const users=[];
  for (const alias of ["Daily Alpha","Daily Beta"]) {
    const email=`daily-${randomUUID()}@example.test`,password=`${randomUUID()}-A1!`;
    const created=await admin.auth.admin.createUser({ email,password,email_confirm:true });
    if (created.error || !created.data.user) throw new Error("Synthetic account creation failed.");
    const client=createClient(url.href,env.ANON_KEY,options);
    expect((await client.auth.signInWithPassword({email,password})).error).toBeNull();
    users.push({email,password,alias,id:created.data.user.id,client});
  }
  const [a,b]=users;
  const upload=await prepareAcademicUpload(await zipLibraryReader(new File([readFileSync(pilot!)],"pilot.zip") as unknown as globalThis.File));
  const revision=await uploadAcademicCourse(a.client,a.id,upload,()=>{},()=>{});
  expect((await b.client.rpc("academic_catalog")).data.some((c: { id: string })=>c.id===revision.collection_id)).toBe(false);
  expect((await admin.from("academic_reviewers").insert({user_id:a.id})).error).toBeNull();
  expect((await a.client.rpc("academic_review",{collection:revision.collection_id,approved:true})).error).toBeNull();
  expect((await a.client.rpc("academic_set_visibility",{collection:revision.collection_id,visibility:"shared"})).error).toBeNull();
  const challenge=await publishDailyChallenge(admin,revision.revision_id,new Date().toISOString().slice(0,10),25);
  const listed=await b.client.rpc("academic_daily_challenges"); expect(listed.error).toBeNull();
  const daily=listed.data.find((c: { id: string })=>c.id===challenge);
  expect(daily).toBeDefined(); expect(daily.questionCount).toBeGreaterThan(1);
  expect(JSON.stringify(daily)).not.toContain("answerKey");
  expect((await b.client.from("academic_challenge_attempts").select("*")).error).not.toBeNull();
  writeFileSync(destination!,JSON.stringify({apiUrl:url.href,anonKey:env.ANON_KEY,collection:revision.collection_id,revision:revision.revision_id,challenge,questionCount:daily.questionCount,
    users:users.map(({email,password,alias})=>({email,password,alias}))}),{mode:0o600});
  console.info(JSON.stringify({environment:"loopback",challengeQuestions:daily.questionCount,contentBytes:upload.files.reduce((sum,file)=>sum+file.byte_size,0)}));
},120_000);
