#!/usr/bin/env node
// Read-only reconciliation of private, local, review-only academic corpus jobs.
// Produces a metadata-only, Gitignored handoff for Agents 0/1/3. Never uploads.
import { createHash } from "node:crypto";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { queueJobs, receiptConsistent, dispositionCounts } from "./bulkQueue.ts";

const repo = fileURLToPath(new URL("../../../../../", import.meta.url));
const root = join(repo, "artifacts/qbank-6way-20261014");
const base = join(root, "role-2-corpus-v2");
const batch = process.argv.includes("--batch") ? process.argv[process.argv.indexOf("--batch") + 1] : "B4";
const hash = data => createHash("sha256").update(data).digest("hex");
const fingerprintText = blocks => (blocks ?? []).map(block => block.type === "text" ? block.text
  : block.type === "rich_text" ? block.html.replace(/<[^>]+>/g, " ")
  : block.type === "table" ? block.rows?.flat().join(" ") ?? ""
  : "").join(" ").normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
const assertSafe = (condition, error) => { if (!condition) throw new Error(error); };
async function reconcile() {
  const priority = JSON.parse(await readFile(join(root,"agent-2-priority-batches.json"),"utf8"));
  const all = JSON.parse(await readFile(join(root,"agent-2-import-inputs-deduplicated.json"),"utf8"));
  const jobs = queueJobs(priority, all, batch);
  const byKey = new Map();
  for (const filename of await readdir(join(base, "results"))) {
    if (!filename.startsWith(batch+"-") || !filename.endsWith(".json")) continue;
    const receipt = JSON.parse(await readFile(join(base, "results",filename),"utf8"));
    assertSafe(Number.isSafeInteger(receipt.queueIndex) && receipt.queueIndex >= 0 && receipt.queueIndex < jobs.length,
      "Out-of-range source job in saved receipt: "+filename);
    assertSafe(!byKey.has(receipt.queueIndex),"Duplicate source receipt for job "+receipt.queueIndex);
    assertSafe(receiptConsistent(receipt),"Invalid per-source accounting for job "+receipt.queueIndex);
    byKey.set(receipt.queueIndex,receipt);
  }
  const missingReceiptJobs = [];
  const checked = [], review = [], unavailable = [], rejected = [];
  const fingerprints = new Map();
  let assetBytesVerified = 0, figureAssetsVerified = 0, packageBytesVerified = 0;
  const quality = { questionCandidates:0, structurallyPlausibleMCQ:0, underTwoChoices:0,
    aboveEightChoices:0, optionContentMissing:0, sourcePageMapped:0,
    explanationPresent:0, printedAnswerClaim:0, imageAssetQuestionRows:0,
    imageOnlyOCRSourceFiles:0 };
  for (let index = 0; index < jobs.length; index++) {
    const receipt = byKey.get(index);
    if (!receipt) { missingReceiptJobs.push(index); continue; }
    checked.push(receipt);
    if (receipt.status === "unavailable") { unavailable.push({index,sha:receipt.sourceSha256??null});continue; }
    if (!["review-prepared","review-partial"].includes(receipt.status)) {
      rejected.push({index,status:receipt.status,sha:receipt.sourceSha256??null,reasons:receipt.reasons.slice(0,2)});
      continue;
    }
    assertSafe(receipt.packagePath && existsSync(join(receipt.packagePath,"questions.json")),
      "Saved question package missing for job "+index);
    const questionBytes = await readFile(join(receipt.packagePath,"questions.json"));
    assertSafe(hash(questionBytes) === receipt.packageQuestionsSha256,
      "Stored question file has changed since its source-level receipt: "+index);
    packageBytesVerified += questionBytes.byteLength;
    const bank = JSON.parse(await readFile(join(receipt.packagePath,"prepared-bank.json"),"utf8"));
    const sourceSha = receipt.sourceSha256;
    assertSafe(Array.isArray(bank.pkg?.questions) && bank.pkg.questions.length === receipt.detected,
      "Prepared bank count differs from source receipt: "+index);
    const perSourceQuality={plausibleMCQ:0,excessiveChoices:0,noChoices:0,sourcePageMapped:0,answerCandidates:0};
    if(receipt.ocrApplied)quality.imageOnlyOCRSourceFiles++;
    for (const question of bank.pkg.questions) {
      quality.questionCandidates++;
      assertSafe(question.provenance?.sourceChecksum === "sha256:"+sourceSha,
        "Question lacks canonical original identity: "+index);
      if (question.correctAnswer) assertSafe(
        (question.flags??[]).some(flag=>["answer_needs_review","media_association_uncertain","source_inconsistency"].includes(flag.type)),
        "A question has an unreviewed answer incorrectly marked ready: "+index
      );
      const stem=fingerprintText(question.stem),choices=(question.choices??[]).map(choice=>fingerprintText(choice.blocks));
      const n=choices.length;
      if(n<2){quality.underTwoChoices++;perSourceQuality.noChoices++;}
      if(n>8){quality.aboveEightChoices++;perSourceQuality.excessiveChoices++;}
      if(question.source?.page!==undefined){quality.sourcePageMapped++;perSourceQuality.sourcePageMapped++;}
      if(question.explanation?.length)quality.explanationPresent++;
      if(question.correctAnswer){quality.printedAnswerClaim++;perSourceQuality.answerCandidates++;}
      if(question.assets?.length)quality.imageAssetQuestionRows++;
      const complete=n>=2 && n<=8 && choices.every(text=>text.length>0) && stem.length>=20;
      if(!complete && n>=2 && n<=8)quality.optionContentMissing++;
      if(complete){quality.structurallyPlausibleMCQ++;perSourceQuality.plausibleMCQ++;}
      if(!complete || stem.length<30)continue;
      const signature=hash(stem+"||"+choices.join("||"));
      const history=fingerprints.get(signature)??[];
      history.push({original:sourceSha,questionId:question.id});
      fingerprints.set(signature,history);
    }
    const seenImages=new Set();
    const assets=bank.pkg.questions.flatMap(question=>question.assets??[]);
    for (const asset of assets) {
      if(seenImages.has(asset.filename))continue;
      seenImages.add(asset.filename);
      const filename=join(receipt.packagePath,"assets",asset.filename);
      assertSafe(existsSync(filename),"Prepared question image missing for "+index);
      const img=await readFile(filename);
      assertSafe("sha256:"+hash(img)===asset.checksum,"Saved medical image changed since source extraction: "+index);
      assetBytesVerified+=img.byteLength;
      figureAssetsVerified++;
    }
    assertSafe(seenImages.size===receipt.imageAssets,
      "Figure asset count differs from source receipt: "+index);
    const oldField=receipt.sourceIndependentlyVerified;
    const inventoryMatches=receipt.inventoryChecksumVerified??oldField??false;
    review.push({index,sha:sourceSha,detected:receipt.detected,
      canonicalReadable:receipt.canonicalReadable,reviewRequired:receipt.reviewRequired,
      unresolved:receipt.unresolved,rejected:receipt.rejected,figures:receipt.imageAssets,
      inventoryChecksumVerified:Boolean(inventoryMatches),localPackage:receipt.packagePath,
      quality:perSourceQuality,ocrApplied:Boolean(receipt.ocrApplied)});
  }
  const overlapGroups=[...fingerprints.entries()].filter(([,references])=>references.length>1)
    .map(([signature,references])=>({signature,references}));
  const totals=dispositionCounts(checked);
  const report={
    schemaVersion:1,batch,generatedAt:new Date().toISOString(),
    uniqueQueueJobsExpected:jobs.length,sourceReceiptsPresent:checked.length,
    missingReceiptJobs,sourceOriginalsCurrentlyUnavailable:unavailable.length,
    countPolicy:"All questions are unverified extraction candidates; no scored practice or Supabase installation is certified.",
    ...totals,
    imageFileIntegrityVerified:figureAssetsVerified,
    imageBytesIntegrityVerified:assetBytesVerified,
    questionBytesIntegrityVerified:packageBytesVerified,
    exactCandidateOverlapGroups:overlapGroups.length,
    suspectedDuplicateExcess:overlapGroups.reduce((sum,entry)=>sum+entry.references.length-1,0),
    localReviewPackageCount:review.length,
    quality,
    sourceMetadataOnly:true,ownerAuthenticatedCloudReadbackCount:0,
    readyForSourceReview:review,
    unavailableSourceJobs:unavailable,
    otherExceptions:rejected,
    exactDuplicateHints:overlapGroups,
  };
  const target = join(base,"corpus-"+batch+"-reconciliation.json");
  await writeFile(target,JSON.stringify(report,null,2)+"\n");
  console.log("CORPUS_RECONCILIATION",JSON.stringify({
    batch,files:checked.length,missingReceipts:missingReceiptJobs.length,
    statuses:totals.statuses,candidates:totals.detected,readable:totals.canonicalReadable,
    review:totals.reviewRequired,unresolved:totals.unresolved,rejected:totals.rejected,
    media:figureAssetsVerified,duplicateHints:overlapGroups.length,
    mcqPlausible:quality.structurallyPlausibleMCQ,tooManyChoices:quality.aboveEightChoices,
    missingChoices:quality.underTwoChoices,ocrSources:quality.imageOnlyOCRSourceFiles,cloudVerified:0,
  }));
  if(missingReceiptJobs.length)process.exitCode=2;
}
reconcile().catch(error=>{console.error("RECONCILIATION_FAILED",error.message);process.exitCode=1});
