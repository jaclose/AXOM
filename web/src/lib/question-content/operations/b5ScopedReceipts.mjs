#!/usr/bin/env node
/**
 * Agent2 B5-scoped historical-receipt reconciliation.
 *
 * Agent0's B4-only gate enumerates one shared result directory and therefore
 * calls existing B5 records "B4 orphans". These are NOT B4 source jobs.
 * Reconcile by exact sourceKey into an immutable NEW B5 metadata namespace;
 * never rewrite old result JSON, question packages, originals or cloud data.
 *
 * Run from web/: node src/lib/question-content/operations/b5ScopedReceipts.mjs
 * Optional --verify-only checks existing B5 attestations without writing.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, mkdir, writeFile, stat, realpath } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { queueJobs, receiptConsistent } from "./bulkQueue.ts";

export const FORMAT = "axom-b5-source-reclassification-v1";
const SHA = /^[a-f0-9]{64}$/;
const sourceLimit = 128 * 1024 ** 2;
const packageLimit = 32 * 1024 ** 2;
const repo = fileURLToPath(new URL("../../../../../", import.meta.url));
const artifacts = join(repo, "artifacts/qbank-6way-20261014");
const privateRoot = join(artifacts, "role-2-corpus-v2");
const resultsRoot = join(privateRoot, "results");
const packagesRoot = join(privateRoot, "packages");
const outRoot = join(privateRoot, "b5-scoped-v1");
const verifiedOnly = process.argv.includes("--verify-only");
const hash = value => createHash("sha256").update(value).digest("hex");
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const safeRoot = (name, root) => resolve(name).startsWith(resolve(root) + sep);
const originalExists = value => typeof value === "string" && existsSync(value);

export function classifyB5Identity(key) {
  if (typeof key !== "string") throw new Error("The B5 source has no canonical identity.");
  if (/^byte:[a-f0-9]{64}$/.test(key)) {
    return { kind:"byte-sha256", expectedSha256:key.slice(5), requiresUnmountedSourceRecovery:false };
  }
  if (/^path:\/[^\0\r\n]{1,2048}$/.test(key)) {
    return { kind:"path-only", expectedSha256:null, requiresUnmountedSourceRecovery:true };
  }
  throw new Error("B5 source identity is invalid or ambiguously formatted.");
}

export function assertB5Conservation(receipt) {
  assert(receipt && receipt.schemaVersion===1, "Historical source receipt has the wrong schema.");
  assert(receipt.batch==="B5" || receipt.batch==="B4", "Source is not a historical B4/B5 receipt.");
  assert(receiptConsistent(receipt), "Historical source receipt has inconsistent unverified question accounting.");
  const c=receipt;
  assert(c.detected===c.canonicalReadable+c.rejected, "Extracted source rows were lost.");
  assert(c.canonicalReadable===c.reviewRequired+c.unresolved, "Review/unresolved rows do not conserve the source.");
  assert(c.ready===0 && c.accountCloudReadbackVerified===false
    && c.answerIndependentlyVerified===false, "Source receipt incorrectly claims accepted answers/cloud access.");
  assert(["review-prepared","unavailable","no-questions"].includes(c.status),
    "B5 historical receipt needs manual classification before re-attestation.");
  if (c.status==="review-prepared") {
    assert(c.detected>0 && c.packagePath && SHA.test(c.packageQuestionsSha256??""),
      "A prepared source lacks a verifiable private review package.");
  } else {
    assert(c.detected===0 && !c.packagePath,
      "A missing or nonquestion source incorrectly claims accepted questions.");
  }
  return true;
}

export function summarizeB5Scoped(receipts) {
  const totals={total:0,byteIdentified:0,pathOnlyUnmounted:0,
    readyForPractice:0,reviewRequired:0,unresolved:0,rejected:0,detected:0,parsed:0,
    sourceOriginalsReverifiedNow:0,unavailable:0,reviewPackages:0,noQuestions:0,
    packagesIntegrityVerified:0,cloudVerified:0,figureAssetsVerified:0,
    inventoryByteIdentityUnavailableToday:0, historicalRecordsPreserved:0};
  for(const entry of receipts){
    assert(entry?.format===FORMAT && entry.batch==="B5", "B5 summary contains an unscoped receipt.");
    totals.total++;
    if(entry.sourceIdentity.kind==="path-only")totals.pathOnlyUnmounted++;
    else totals.byteIdentified++;
    if(entry.sourceIdentity.currentOriginalShaVerified)totals.sourceOriginalsReverifiedNow++;
    else if(entry.sourceIdentity.kind==="byte-sha256")totals.inventoryByteIdentityUnavailableToday++;
    if(entry.status==="unavailable")totals.unavailable++;
    if(entry.status==="review-prepared"){
      totals.reviewPackages++;
      if(entry.reviewPackage?.originalPackageShaVerified)totals.packagesIntegrityVerified++;
    }
    if(entry.status==="no-questions")totals.noQuestions++;
    for(const [field,target] of [
      ["detected","detected"],["canonicalReadable","parsed"],
      ["reviewRequired","reviewRequired"],["unresolved","unresolved"],
      ["rejected","rejected"],["ready","readyForPractice"],
    ])totals[target]+=entry.counts[field];
    totals.figureAssetsVerified+=entry.reviewPackage?.verifiedFigureAssetFiles??0;
    if(entry.historicalReceipt.sha256)totals.historicalRecordsPreserved++;
    if(entry.accountCloudReadbackVerified===true)totals.cloudVerified++;
  }
  assert(totals.detected===totals.parsed+totals.rejected, "B5 reconciliation detected/parsed conservation failed.");
  assert(totals.parsed===totals.reviewRequired+totals.unresolved, "B5 question-hold conservation failed.");
  assert(totals.readyForPractice===0&&totals.cloudVerified===0, "B5 provisional questions or cloud receipts were incorrectly promoted.");
  return totals;
}

async function streamedDigest(filename) {
  const sh=createHash("sha256");
  for await (const bytes of createReadStream(filename,{ highWaterMark: 256 * 1024 })) sh.update(bytes);
  return sh.digest("hex");
}
async function readBounded(path,cap) {
  const before=await stat(path);
  assert(before.isFile() && before.size<=cap, "Private source/package is not a bounded regular file.");
  return readFile(path);
}
async function recheckOriginal(job,receipt,identity) {
  const eligible=[job.source_path,...(job.equivalent_paths??[])];
  const chosen=receipt.originalPath ?? eligible.find(originalExists);
  assert(!chosen || eligible.includes(chosen), "Receipt points outside the authorized canonical original locations.");
  const visible=chosen && existsSync(chosen);
  if(!visible){
    assert(receipt.status==="unavailable", "A previously prepared original unexpectedly disappeared; review before classifying it.");
    return { ...identity, currentOriginalShaVerified:false, currentOriginalAvailable:false,
      sourceBytesVerifiedNow:0, currentOriginalReason:"not-mounted-or-inaccessible" };
  }
  const original=await realpath(chosen);
  // Re-attest old byte identities but never assign a SHA to a path-only row.
  assert(identity.kind==="byte-sha256", "An unclassified path-only source needs Agent1's original-byte inventory first.");
  const before=await stat(original);
  assert(before.isFile() && before.size>0 && before.size<=sourceLimit, "Current original does not meet source bounds.");
  if(receipt.sourceBytes!==undefined)
    assert(receipt.sourceBytes===before.size, "The source original's byte size changed since the prepared receipt.");
  const current=await streamedDigest(original);
  const after=await stat(original);
  assert(before.size===after.size && before.mtimeMs===after.mtimeMs, "The source original changed while verifying it.");
  assert(current===identity.expectedSha256, "Source content changed; no B5 reclassification can certify this SHA.");
  assert(receipt.status!=="unavailable", "Original has reappeared but prior unavailable disposition was not reprocessed.");
  return {...identity, currentOriginalShaVerified:true, currentOriginalAvailable:true,
    sourceBytesVerifiedNow:before.size, currentOriginalReason:"byte-sha256-matched-current-original"};
}

async function recheckReviewPackage(receipt,expectedSourceSha) {
  assert(receipt.packagePath && safeRoot(receipt.packagePath,packagesRoot),
    "An old review package points outside the authorized private corpus.");
  const root=await realpath(packagesRoot);
  const folder=await realpath(receipt.packagePath);
  assert(safeRoot(folder,root), "A private package resolves outside its storage root.");
  const questionBytes=await readBounded(join(folder,"questions.json"),packageLimit);
  assert(hash(questionBytes)===receipt.packageQuestionsSha256,
    "Original question JSON has changed since its historical source receipt.");
  const original=JSON.parse(questionBytes.toString("utf8"));
  const preparedBytes=await readBounded(join(folder,"prepared-bank.json"),packageLimit);
  const prepared=JSON.parse(preparedBytes.toString("utf8"));
  assert(Array.isArray(original.questions)&&Array.isArray(prepared.pkg?.questions),
    "Saved review-only question file is structurally invalid.");
  assert(original.questions.length===receipt.detected &&
    prepared.pkg.questions.length===receipt.detected,
    "Stored review question count disagrees with the original source receipt.");
  assert(prepared.unreadableQuestions===receipt.rejected,
    "Stored review package lost or reclassified rejected rows.");
  let sourceAnswerCandidates=0, missingSourceAnswers=0;
  const unique=new Set(), seenAssets=new Map();
  for(const question of prepared.pkg.questions){
    assert(typeof question.id==="string"&&!unique.has(question.id), "Review package has duplicate question IDs.");
    unique.add(question.id);
    assert(question.provenance?.sourceChecksum==="sha256:"+expectedSourceSha,
      "Prepared B5 question lacks the canonical original checksum.");
    if(question.correctAnswer) {
      sourceAnswerCandidates++;
      assert((question.flags??[]).some(f=>[
        "answer_needs_review","source_inconsistency","media_association_uncertain",
        "table_parse_uncertain",
      ].includes(f.type)), "A source answer could enter practice without reviewer confirmation.");
    }else missingSourceAnswers++;
    for(const asset of question.assets??[]){
      assert(typeof asset.filename==="string" && /^[a-zA-Z0-9._-]+$/.test(asset.filename)
        && !asset.filename.includes("..") && /^sha256:[a-f0-9]{64}$/.test(asset.checksum??""),
        "A source-media filename or content hash is malformed.");
      const prior=seenAssets.get(asset.filename);
      assert(!prior||prior===asset.checksum, "Source figures claim incompatible bytes under one filename.");
      seenAssets.set(asset.filename,asset.checksum);
    }
  }
  assert(sourceAnswerCandidates+missingSourceAnswers===receipt.detected,
    "The answer evidence ledger does not conserve question candidates.");
  assert(sourceAnswerCandidates===receipt.reviewRequired &&
    missingSourceAnswers===receipt.unresolved,
    "A source answer/held question classification differs from original preparation.");
  assert(seenAssets.size===receipt.imageAssets, "Preserved figure count differs from original receipt.");
  for(const [name,digest] of seenAssets){
    const file=join(folder,"assets",name);
    assert(safeRoot(file,join(folder,"assets")), "A source image path is unsafe.");
    assert(await streamedDigest(file)===digest.slice(7),"A preserved source image has changed.");
  }
  // This is a PACKAGE/ORIGINAL verification, not a new saved/imported bank.
  return {originalPackagePath:folder, originalPackageShaVerified:true,
    questionsJsonSha256:hash(questionBytes),
    preparedBankSha256:hash(preparedBytes),
    questionCandidates:receipt.detected,answerLabelCandidatesReviewHeld:sourceAnswerCandidates,
    answerUnresolved:missingSourceAnswers,
    verifiedFigureAssetFiles:seenAssets.size,
    packageRebuilt:false,packageUploaded:false,scoredPracticeAllowed:false};
}

async function immutableWrite(target,value,verifyOnly=false) {
  const bytes=Buffer.from(JSON.stringify(value,null,2)+"\n");
  if(verifyOnly || existsSync(target)){
    assert(existsSync(target), "Expected B5 attestation file is absent: "+target);
    const previously=await readFile(target);
    assert(hash(previously)===hash(bytes),"An earlier B5 attestation differs; do not overwrite it.");
    return "verified-existing";
  }
  await mkdir(resolve(target,".."),{recursive:true});
  await writeFile(target,bytes,{flag:"wx"});
  return "created-new";
}

export async function runB5Scoped({ verifyOnly=verifiedOnly, sourceRoot=artifacts, targetRoot=outRoot }={}) {
  const priority=JSON.parse(await readFile(join(sourceRoot,"agent-2-priority-batches.json"),"utf8"));
  const all=JSON.parse(await readFile(join(sourceRoot,"agent-2-import-inputs-deduplicated.json"),"utf8"));
  const jobs=queueJobs(priority,all,"B5");
  assert(jobs.length===41, "B5 priority manifest changed; reconcile source-job scope before continuing.");
  const allKeys=new Map();
  for(const [i,job] of all.entries()){
    assert(!allKeys.has(job.canonical_input_key), "Two full-corpus jobs claim one canonical source key.");
    allKeys.set(job.canonical_input_key,i);
  }
  const lead=JSON.parse(await readFile(join(sourceRoot,"lead-b4-acceptance.json"),"utf8"));
  const cross=lead.orphanCrosswalk;
  assert(cross?.total===41 && cross.matchedToOtherCurrentBatch===41 &&
    cross.byAssignedBatch?.B5===41 && cross.verifiedPreparedReviewPackages===6,
    "Agent0's crosswalk is incomplete; do not reclassify B5 sources by position alone.");
  const crossByKey=new Map();
  for(const row of cross.rows){
    // Crosswalk only has a displayed source ID, but B5 indices + canonical
    // full-queue membership establish exact identity without guessing SHA.
    assert(row.currentBatches?.length===1 && row.currentBatches[0]==="B5" &&
      Number.isSafeInteger(row.receiptIndex) && row.receiptIndex>=0 && row.receiptIndex<41,
      "Lead source crosswalk contains an ambiguous or unassigned B5 receipt.");
    assert(!crossByKey.has(row.receiptIndex), "Agent0's crosswalk reused a B5 receipt index.");
    crossByKey.set(row.receiptIndex,row);
  }
  const originalFiles=(await readdir(sourceRoot===artifacts ? resultsRoot : join(sourceRoot,"role-2-corpus-v2/results")))
    .filter(name=>name.startsWith("B5-")&&name.endsWith(".json"));
  assert(originalFiles.length===41,"Expected exactly 41 preserved historical B5 result files.");
  const legacy=new Map();
  for(const file of originalFiles){
    const absolute=join(sourceRoot,"role-2-corpus-v2/results",file);
    const bytes=await readFile(absolute);
    const record=JSON.parse(bytes.toString("utf8"));
    assert(!legacy.has(record.sourceKey),"Historical B5 source identities are duplicated.");
    legacy.set(record.sourceKey,{record,file,sha256:hash(bytes),path:absolute});
  }
  const attestations=[];
  for(const [batchIndex,job] of jobs.entries()){
    const key=job.canonical_input_key,history=legacy.get(key);
    assert(history, "Missing historical B5 receipt for exact canonical source identity.");
    const {record}=history;
    assertB5Conservation(record);
    assert(record.queueIndex===batchIndex && record.sourcePath===job.source_path,
      "Historical source receipt does not belong to this exact B5 original and index.");
    const leadRow=crossByKey.get(batchIndex);
    assert(leadRow?.currentJobIndex===allKeys.get(key) &&
      leadRow.status===record.status &&
      leadRow.receiptBatch===record.batch &&
      leadRow.classification==="currently_queued_other_batch",
      "Lead B4 orphan crosswalk does not match B5's canonical source identity.");
    const identity=classifyB5Identity(key);
    assert(leadRow.sourceIdentity===identity.kind, "Lead source-identity basis differs from the canonical job.");
    if(identity.kind==="path-only"){
      assert(record.status==="unavailable" && !originalExists(job.source_path)
        && !record.sourceSha256 && !record.inventoryChecksumVerified,
        "Path-only source is not a verified byte-identified inaccessible original.");
    }else{
      assert(record.sourceSha256===identity.expectedSha256, "Stored source checksum differs from Agent1 inventory.");
    }
    const fresh=await recheckOriginal(job,record,identity);
    const reviewPackage=record.status==="review-prepared"
      ?await recheckReviewPackage(record,identity.expectedSha256):null;
    assert(Boolean(reviewPackage)===Boolean(leadRow.preparedPackageChecksumVerified),
      "Lead B5 preserved-package status disagrees with the actual verified original package.");
    const scoped={
      schemaVersion:1,format:FORMAT,batch:"B5",batchQueueIndex:batchIndex,
      fullCanonicalJobIndex:allKeys.get(key),sourceKey:key,status:record.status,
      sourceIdentity:fresh,
      historicalReceipt:{
        name:history.file,sha256:history.sha256,batchLabel:record.batch,
        historicalQueueIndex:record.queueIndex,unchanged:true,
        classifiedAsB4OrphanBySharedDirectoryAudit:true,
      },
      counts:{
        detected:record.detected,canonicalReadable:record.canonicalReadable,
        ready:0,reviewRequired:record.reviewRequired,
        unresolved:record.unresolved,rejected:record.rejected,
        imageAssets:record.imageAssets,
      },
      reviewPackage,
      independentOriginalAnswerKeyVerified:false,
      officialAcademicWeekVerified:false,
      accountCloudReadbackVerified:false,
      questionBankPublished:false,
      sourceContentCopied:false,
      originalReceiptOverwritten:false,
    };
    attestations.push(scoped);
  }
  const totals=summarizeB5Scoped(attestations);
  assert(totals.total===41 && totals.byteIdentified===35 && totals.pathOnlyUnmounted===6
    && totals.unavailable===33 && totals.reviewPackages===6
    && totals.noQuestions===2 && totals.packagesIntegrityVerified===6
    && totals.detected===36 && totals.parsed===36
    && totals.reviewRequired===25 && totals.unresolved===11 &&
    totals.figureAssetsVerified===0, "The required B5 crosswalk truth counts changed; stop instead of silently certifying a different source set.");
  const receipts=[];
  for(const entry of attestations){
    const name="b5-"+String(entry.batchQueueIndex).padStart(3,"0")+
      "-"+hash(entry.sourceKey).slice(0,16)+".json";
    const action=await immutableWrite(join(targetRoot,"receipts",name),entry,verifyOnly);
    receipts.push({batchQueueIndex:entry.batchQueueIndex,sourceKeyDigest:hash(entry.sourceKey),
      file:name,sha256:hash(Buffer.from(JSON.stringify(entry,null,2)+"\n")),action});
  }
  const summary={
    schemaVersion:1,format:FORMAT,batch:"B5",countBasis:"41 canonical B5 sources; not additive to B4 or B0/B1/B3 source inventories",
    preparedReviewQuestionCountsAreCandidatesOnly:true,
    oldReceiptsPreserved:41,originalReviewPackagesReused:6,
    ...totals,
    completeSourceIdentityCoverage:false,
    completeAcademicContentCoverage:false,
    ownerAuthenticatedCloudReadbacks:0,
    verifiedScoredQuestions:0,
    metadataOnly:true,legacyReceiptsStillInSharedFolder:true,
    b4OrphanGateWillRemainIncompleteUntilAgent0FiltersByBatch:true,
    sourceSSDNotMounted:true,
    records:receipts.map(record=>({batchQueueIndex:record.batchQueueIndex,
      sourceKeyDigest:record.sourceKeyDigest,file:record.file,sha256:record.sha256})),
  };
  const action=await immutableWrite(join(targetRoot,"b5-reconciliation.json"),summary,verifyOnly);
  // Re-read history to ensure no other worker changed any original during
  // this reclassification. No source or legacy package is ever mutated.
  for(const entry of attestations){
    const original=legacy.get(entry.sourceKey);
    assert(hash(await readFile(original.path))===original.sha256,
      "Historical receipt changed during B5 reclassification.");
  }
  console.log("B5_SCOPED_RECONCILIATION",JSON.stringify({
    target:targetRoot,mode:verifyOnly?"verify-only":action,
    sourceReceipts:attestations.length,byteIdentified:totals.byteIdentified,
    pathOnlyUnmounted:totals.pathOnlyUnmounted,
    reverifiedLiveOriginalSha:totals.sourceOriginalsReverifiedNow,
    inaccessibleByteIdentities:totals.inventoryByteIdentityUnavailableToday,
    statuses:{unavailable:totals.unavailable,reviewPrepared:totals.reviewPackages,
      noQuestions:totals.noQuestions},
    detected:totals.detected,parsed:totals.parsed,
    ready:0,reviewRequired:totals.reviewRequired,unresolved:totals.unresolved,
    rejected:totals.rejected,figures:totals.figureAssetsVerified,
    preservedPackages:totals.packagesIntegrityVerified,
    backendReadbacks:0,
  }));
  return {summary,receipts};
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  runB5Scoped().catch(error=>{
    console.error("B5_SCOPED_RECONCILIATION_FAILED",
      error instanceof Error?error.message:"Unknown B5 metadata error.");
    process.exitCode=1;
  });
}
