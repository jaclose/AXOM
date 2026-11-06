// AXOM Correspondents · allowlisted, operator-triggered proof-of-concept mail.
// No production automation, no recipient override bypass and no implicit provider sends.
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { AXOM_CORRESPONDENTS, matchCorrespondent, renderCorrespondentIntroduction, correspondentSender } from "../web/src/lib/communications/correspondents.ts";

const emailPattern=/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const sha256=text=>createHash("sha256").update(text).digest("hex");
function assertEnv(env,recipient) {
  if(env.AXOM_EMAIL_MODE!=="test")throw new Error("Only AXOM test mode is permitted for this POC.");
  if(!emailPattern.test(recipient))throw new Error("A valid test recipient is required.");
  const allowed=(env.AXOM_EMAIL_TEST_RECIPIENTS||"").split(",").map(x=>x.trim().toLowerCase()).filter(Boolean);
  if(!allowed.includes(recipient.toLowerCase()))throw new Error("Recipient is not in the test allowlist.");
}
export function buildCorrespondentTest({recipient,correspondentId,revision="v1",useCase="welcome",env=process.env}) {
  assertEnv(env,recipient);
  if(useCase!=="welcome")throw new Error("This POC only supports the welcome introduction, not an auth/security/deletion or report send.");
  const card=AXOM_CORRESPONDENTS.find(c=>c.id===correspondentId);
  if(!card)throw new Error("Choose a valid AXOM Correspondent ID.");
  if(typeof revision!=="string" || !/^[a-zA-Z0-9._-]{2,80}$/.test(revision))throw new Error("Provide a short bounded POC revision token.");
  const match=matchCorrespondent({userKey:"poc-only-account",preferredId:card.id});
  const email=renderCorrespondentIntroduction(match,{displayName:"Alex",useCase:"welcome",poc:true});
  const digest=sha256(JSON.stringify([recipient.toLowerCase(),correspondentId,revision,useCase,email.subject,email.html,email.text]));
  const domain=(env.AXOM_CORRESPONDENT_ALIAS_DOMAIN||"").toLowerCase().trim();
  const idempotencyKey="axom-poc-"+digest;
  return {recipient:recipient.toLowerCase(),match,email,domain,idempotencyKey,revision,useCase};
}
async function providerJson(fetcher,url,options) {
  let response;
  try { response=await fetcher(url,{...options,signal:AbortSignal.timeout(20000)}); }
  catch { throw new Error("Provider request may have reached Resend. Reconcile before retrying."); }
  if(!response.ok)throw new Error("Resend returned HTTP "+response.status+". Inspect the provider status.");
  try{return await response.json();}
  catch {throw new Error("Provider acknowledgement was unreadable; reconcile before retrying.");}
}
export async function sendCorrespondentTest({recipient,correspondentId,revision="v1",useCase="welcome",env=process.env,fetcher=fetch,apply=false,approved=false}) {
  const plan=buildCorrespondentTest({recipient,correspondentId,revision,useCase,env});
  if(!apply)return {status:"preview",to:plan.recipient,subject:plan.email.subject,proposedAlias:plan.match.localPart+"@"+plan.domain,revision,providerCalled:false};
  if(!approved)throw new Error("Explicit operator approval is required for a test send.");
  if(!env.RESEND_API_KEY)throw new Error("RESEND_API_KEY must be configured server-side.");
  if(!plan.domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(plan.domain))throw new Error("A proposed AXOM alias domain must be set.");
  const auth="Bearer "+env.RESEND_API_KEY;
  const domains=await providerJson(fetcher,"https://api.resend.com/domains",{method:"GET",headers:{Authorization:auth}});
  const verified=(Array.isArray(domains.data)?domains.data:[]).filter(d=>d.name?.toLowerCase()===plan.domain && d.status==="verified").map(d=>d.name);
  if(!verified.length)throw new Error("A verified domain is required before sending any AXOM pseudonym email.");
  const sender=correspondentSender(plan.match,{domain:plan.domain,verifiedDomains:verified,replyTo:env.AXOM_EMAIL_REPLY_TO||""},"welcome");
  if(!sender)throw new Error("A verified sender and monitored reply address are required.");
  const payload={
    from:sender.from,to:[plan.recipient],reply_to:sender.replyTo,subject:plan.email.subject,html:plan.email.html,text:plan.email.text,
    headers:{"X-AXOM-POC":"correspondent-welcome","X-AXOM-POC-Revision":revision}
  };
  const result=await providerJson(fetcher,"https://api.resend.com/emails",{
    method:"POST",headers:{Authorization:auth,"Content-Type":"application/json","Idempotency-Key":plan.idempotencyKey},
    body:JSON.stringify(payload)
  });
  if(!result.id)throw new Error("Resend returned no message ID. Reconcile before another attempt.");
  return {status:"accepted",providerId:result.id,to:plan.recipient,subject:payload.subject,from:payload.from,revision,delivered:false};
}
async function cli(argv) {
  if(!argv.length || argv.includes("--help")) {
    process.stdout.write([
      "AXOM Correspondents test mail: preview by default, never live/bulk.",
      "node --experimental-strip-types scripts/send-correspondent-poc.mjs preview --to jdabbagh@sgu.edu --id vesper --revision v1",
      "node --experimental-strip-types scripts/send-correspondent-poc.mjs send-test --to jdabbagh@sgu.edu --id vesper --revision v1 --confirm-allowlisted-send",
      "Requires AXOM_EMAIL_MODE=test, AXOM_EMAIL_TEST_RECIPIENTS, AXOM_CORRESPONDENT_ALIAS_DOMAIN, AXOM_EMAIL_REPLY_TO and RESEND_API_KEY (send only)."
    ].join("\n")+"\n");return;
  }
  const flag=x=>{const i=argv.indexOf("--"+x);return i>=0?argv[i+1]:undefined;};
  const action=argv[0];if(!["preview","send-test"].includes(action))throw new Error("Choose preview or send-test.");
  const output=await sendCorrespondentTest({recipient:flag("to")||"",correspondentId:flag("id")||"",
    revision:flag("revision")||"v1",useCase:"welcome",apply:action==="send-test",approved:argv.includes("--confirm-allowlisted-send")});
  process.stdout.write(JSON.stringify(output,null,2)+"\n");
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  cli(process.argv.slice(2)).catch(error=>{process.stderr.write("AXOM Correspondent POC: "+(error instanceof Error?error.message:"Failed")+"\n");process.exitCode=1;});
}
