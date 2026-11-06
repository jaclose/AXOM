import test from "node:test";
import assert from "node:assert/strict";
import { buildCorrespondentTest, sendCorrespondentTest } from "./send-correspondent-poc.mjs";

const env = {
  AXOM_EMAIL_MODE:"test",
  AXOM_EMAIL_TEST_RECIPIENTS:"jdabbagh@sgu.edu",
  AXOM_CORRESPONDENT_ALIAS_DOMAIN:"axom.info",
  AXOM_EMAIL_REPLY_TO:"team@axom.info",
  RESEND_API_KEY:"re_test_never_production",
};
const json = (value,status=200)=>new Response(JSON.stringify(value),{status,headers:{"content-type":"application/json"}});
const sample = { recipient:"jdabbagh@sgu.edu", correspondentId:"vesper", revision:"axom-correspondents-v1", useCase:"welcome" };
test("preview generates a category-labelled subject without contacting a provider", async ()=>{
  let calls=0;
  const result=await sendCorrespondentTest({ ...sample, env, fetcher:async()=>{calls++;throw new Error("no network");} });
  assert.equal(calls,0);
  assert.equal(result.status,"preview");
  assert.match(result.subject,/AXOM POC · WELCOME/);
  assert.equal(result.to,"jdabbagh@sgu.edu");
});
test("send is fail-closed for non-test mode, recipients outside the allowlist, and missing approval", async()=>{
  await assert.rejects(()=>sendCorrespondentTest({ ...sample,env:{...env,AXOM_EMAIL_MODE:"live"},apply:true,approved:true }),/test mode/i);
  await assert.rejects(()=>sendCorrespondentTest({ ...sample,recipient:"stranger@example.com",env,apply:true,approved:true }),/allowlist/i);
  await assert.rejects(()=>sendCorrespondentTest({ ...sample,env,apply:true }),/approval/i);
});
test("alias is rejected when domain has not been verified",async()=>{
  const calls=[];
  const fetcher=async(url,init)=>{calls.push({url,init});return json({data:[{name:"axom.info",status:"pending"}]});};
  await assert.rejects(()=>sendCorrespondentTest({ ...sample,env,apply:true,approved:true,fetcher }),/verified domain/i);
  assert.equal(calls.length,1);
  assert.equal(calls[0].init.method,"GET");
});
test("approved test uses exact recipient, sender, reply-to and stable idempotency key",async()=>{
  const calls=[];
  const fetcher=async(url,init)=>{
    calls.push({url,init});
    return url.endsWith("/domains")?json({data:[{name:"axom.info",status:"verified"}]}):json({id:"test-resend-message-id"});
  };
  const result=await sendCorrespondentTest({ ...sample,env,apply:true,approved:true,fetcher });
  assert.equal(result.status,"accepted");
  assert.equal(result.providerId,"test-resend-message-id");
  const sent=calls.find(c=>c.init.method==="POST");
  assert.ok(sent);
  const body=JSON.parse(sent.init.body);
  assert.deepEqual(body.to,["jdabbagh@sgu.edu"]);
  assert.match(body.from,/AXOM · Vesper <vesper@axom.info>/);
  assert.equal(body.reply_to,"team@axom.info");
  assert.match(body.subject,/AXOM POC · WELCOME/);
  assert.match(body.html,/SOURCE/);
  assert.ok(sent.init.headers["Idempotency-Key"].startsWith("axom-poc-"));
  assert.ok(!JSON.stringify(result).includes(env.RESEND_API_KEY));
});
test("idempotency depends on recipient, use case, identity, revision and immutable content",()=>{
  const first=buildCorrespondentTest({ ...sample,env });
  const same=buildCorrespondentTest({ ...sample,env });
  const different=buildCorrespondentTest({ ...sample,env,revision:"v2" });
  assert.equal(first.idempotencyKey,same.idempotencyKey);
  assert.notEqual(first.idempotencyKey,different.idempotencyKey);
});
test("auth, security and deletion POCs cannot masquerade as a correspondent",()=>{
  for (const useCase of ["auth","security","deletion_completed"]) {
    assert.throws(()=>buildCorrespondentTest({ ...sample,env,useCase }),/welcome/i);
  }
});
