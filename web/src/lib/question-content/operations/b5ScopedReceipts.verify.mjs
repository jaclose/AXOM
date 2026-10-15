// Synthetic contract tests; no user academic originals or private receipts.
// Execute AFTER Agent0's full-suite process exits:
//   node src/lib/question-content/operations/b5ScopedReceipts.verify.mjs
import assert from "node:assert/strict";
import { assertB5Conservation, classifyB5Identity,
  summarizeB5Scoped, FORMAT } from "./b5ScopedReceipts.mjs";

const sample=(over={})=>({
  schemaVersion:1,adapterVersion:"axom-existing-parsers-bulk-v2-20261014",
  batch:"B5",queueIndex:0,
  sourceKey:"byte:"+"a".repeat(64),sourceSha256:"a".repeat(64),
  status:"review-prepared",packagePath:"/ignored/package",
  packageQuestionsSha256:"b".repeat(64),
  detected:3,canonicalReadable:3,ready:0,reviewRequired:2,unresolved:1,
  rejected:0,imageAssets:0,inventoryChecksumVerified:true,
  answerIndependentlyVerified:false,accountCloudReadbackVerified:false,
  reasons:[],createdAt:"2026-10-15T12:00:00Z",...over,
});

assert.deepEqual(classifyB5Identity("byte:"+"1".repeat(64)),{
  kind:"byte-sha256",expectedSha256:"1".repeat(64),
  requiresUnmountedSourceRecovery:false,
});
assert.deepEqual(classifyB5Identity("path:/Volumes/JDabSSD/only-original.pdf"),{
  kind:"path-only",expectedSha256:null,requiresUnmountedSourceRecovery:true,
});
assert.throws(()=>classifyB5Identity("byte:"+"g".repeat(64)),/invalid|ambiguously/);
assert.throws(()=>classifyB5Identity("path:../not-absolute"),/invalid|ambiguously/);
assert.equal(assertB5Conservation(sample()),true);
assert.throws(()=>assertB5Conservation(sample({ready:1})),/inconsistent|claim|question/);
assert.throws(()=>assertB5Conservation(sample({detected:4})),/inconsistent|lost|conserve/);
assert.throws(()=>assertB5Conservation(sample({accountCloudReadbackVerified:true})),/inconsistent|claim|cloud/);
assert.throws(()=>assertB5Conservation(sample({answerIndependentlyVerified:true})),/inconsistent|claim|answer/);
assert.throws(()=>assertB5Conservation(sample({status:"review-prepared",packageQuestionsSha256:"no-hash"})),/lacks a verifiable/);
assert.throws(()=>assertB5Conservation(sample({
  status:"unavailable",detected:1,canonicalReadable:1,
  reviewRequired:0,unresolved:1,packagePath:undefined,packageQuestionsSha256:undefined,
})),/missing|nonquestion|claims accepted/);
assert.equal(assertB5Conservation(sample({
  status:"unavailable",detected:0,canonicalReadable:0,
  reviewRequired:0,unresolved:0,packagePath:undefined,
  packageQuestionsSha256:undefined,sourceSha256:undefined,
  sourceKey:"path:/Volumes/JDabSSD/test.zip",inventoryChecksumVerified:false,
})),true);

const attestation=(i,status,kind)=>{
  const prepared=status==="review-prepared";
  const path=kind==="path-only";
  return {
    format:FORMAT,batch:"B5",status,batchQueueIndex:i,
    sourceIdentity:{
      kind,expectedSha256:path?null:"c".repeat(64),
      currentOriginalShaVerified:prepared||status==="no-questions",
    },
    historicalReceipt:{sha256:"d".repeat(64)},
    counts:{detected:prepared?3:0,canonicalReadable:prepared?3:0,
      reviewRequired:prepared?2:0,unresolved:prepared?1:0,ready:0,rejected:0},
    reviewPackage:prepared?{originalPackageShaVerified:true,verifiedFigureAssetFiles:0}:null,
    accountCloudReadbackVerified:false,
  };
};
const rows=[
  ...Array.from({length:6},(_,i)=>attestation(i,"review-prepared","byte-sha256")),
  ...Array.from({length:2},(_,i)=>attestation(i+6,"no-questions","byte-sha256")),
  ...Array.from({length:27},(_,i)=>attestation(i+8,"unavailable","byte-sha256")),
  ...Array.from({length:6},(_,i)=>attestation(i+35,"unavailable","path-only")),
];
const tally=summarizeB5Scoped(rows);
assert.deepEqual({
  total:tally.total,byteIdentified:tally.byteIdentified,pathOnlyUnmounted:tally.pathOnlyUnmounted,
  unavailable:tally.unavailable,prepared:tally.reviewPackages,noQuestions:tally.noQuestions,
  liveByteMatches:tally.sourceOriginalsReverifiedNow,
  preserved:tally.packagesIntegrityVerified,cloud:tally.cloudVerified,
},{
  total:41,byteIdentified:35,pathOnlyUnmounted:6,
  unavailable:33,prepared:6,noQuestions:2,liveByteMatches:8,
  preserved:6,cloud:0,
});
assert.equal(tally.detected,18);
assert.equal(tally.reviewRequired,12);
assert.equal(tally.unresolved,6);
assert.throws(()=>summarizeB5Scoped([...rows.slice(0,40),{
  ...rows[40],accountCloudReadbackVerified:true,
}]),/promoted/);
console.log("B5_SCOPED_SYNTHETIC_CONTRACT_PASS",JSON.stringify({
  syntheticAssertions:17,canonicalSources:41,byteIdentified:35,pathOnlyUnmounted:6,
  preparedPackages:6,scoredPracticeReady:0,cloudVerified:0,
  testsUseProprietaryAcademicMaterial:false,
}));
