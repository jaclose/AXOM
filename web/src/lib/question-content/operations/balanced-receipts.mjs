#!/usr/bin/env node
// Agent2: verify balanced T1–T5 existing B4 review packages without copying
// source PDFs or figures. Per-SHA/page/image/evidence metadata remains private.
// Run after bounded bulk-prepare --indices windows. No remote/cloud writes.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, writeFile, mkdir, readdir, rename, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { queueJobs, receiptConsistent } from "./bulkQueue.ts";
import { inventoryPdfRasterObjects } from "./sourceMediaInventory.mjs";

const checkout=fileURLToPath(new URL("../../../../../",import.meta.url));
const artifacts=join(checkout,"artifacts/qbank-6way-20261014");
const corpus=join(artifacts,"role-2-corpus-v2");
const destination=join(corpus,"balanced-round4");
const limit=100;
const digest=async filename=>{
  const hash=createHash("sha256");
  for await(const chunk of createReadStream(filename,{highWaterMark:256*1024}))hash.update(chunk);
  return hash.digest("hex");
};
const fileIn=(file,parent)=>{
  const path=resolve(file),root=resolve(parent);
  return path.startsWith(root+sep);
};
const writeAtomic=async(filename,value)=>{
  await mkdir(dirname(filename),{recursive:true});
  const temporary=filename+".tmp-"+process.pid;
  await writeFile(temporary,JSON.stringify(value,null,2)+"\n");
  await rename(temporary,filename);
};
export function summarizeEvidenceQuestions(questions,verdicts,sourcePages) {
  const result={pagesMapped:0,invalidPageReferences:0,figuresReferenced:0,
    answeredCandidates:0,unanswered:0,
    declaredEvidence:{},reviewHeld:0,unresolved:0,ready:0,
    malformedChoices:0,numberedQuestionRecords:0};
  const perQuestion=[];
  for(const question of questions){
    const page=question.source?.page;
    if(Number.isSafeInteger(page)&&page>=1){
      result.pagesMapped++;
      if(sourcePages>0&&page>sourcePages)result.invalidPageReferences++;
    }
    if(Number.isSafeInteger(question.source?.questionNumber))result.numberedQuestionRecords++;
    const status=verdicts.get(question.id)?.readiness??"unresolved";
    if(status==="ready")result.ready++;
    else if(status==="needs-review")result.reviewHeld++;
    else result.unresolved++;
    const choiceCount=question.choices?.length??0;
    if(choiceCount<2||choiceCount>8)result.malformedChoices++;
    const answer=question.correctAnswer;
    const evidence=answer?.evidence??"unknown";
    if(answer)result.answeredCandidates++;else result.unanswered++;
    result.declaredEvidence[evidence]=(result.declaredEvidence[evidence]??0)+1;
    const images=(question.assets??[]).map(asset=>({
      assetId:asset.id,
      filename:asset.filename,
      role:asset.role,
      sourceSha256:asset.checksum??null,
      hasPlacedFigure:Boolean(question.stem?.some(block=>block.type==="image"&&block.assetId===asset.id)
        || question.choices?.some(choice=>choice.blocks?.some(block=>block.type==="image"&&block.assetId===asset.id))),
    }));
    result.figuresReferenced+=images.length;
    perQuestion.push({
      canonicalId:question.id,
      sourceSet:question.source?.set??null,
      sourceQuestionNumber:question.source?.questionNumber??null,
      sourcePage:page??null,
      status,
      answerEvidenceKind:evidence,
      answerRequiresConfirmation:status!=="ready",
      choiceCount,
      imageReferences:images,
      reviewFlagTypes:(question.flags??[]).map(flag=>flag.type),
    });
  }
  return {result,perQuestion};
}

async function main(){
  const triage=JSON.parse(await readFile(join(artifacts,"agent0-pdf-triage-metadata.json"),"utf8"));
  const balanced=triage.balancedNextAfterB3;
  if(!Array.isArray(balanced)||balanced.length!==limit)throw new Error("Agent0 balanced source manifest must contain exactly 100 selections.");
  const [priority,canonical]=await Promise.all([
    readFile(join(artifacts,"agent-2-priority-batches.json"),"utf8").then(JSON.parse),
    readFile(join(artifacts,"agent-2-import-inputs-deduplicated.json"),"utf8").then(JSON.parse),
  ]);
  const jobs=queueJobs(priority,canonical,"B4");
  const byDigest=new Map();
  for(const [index,job] of jobs.entries()){
    const key=job.canonical_input_key;
    if(key?.startsWith("byte:")){
      const digest=key.slice(5);
      if(byDigest.has(digest))throw new Error("B4 canonical job SHA collision in priority manifest.");
      byDigest.set(digest,{index,job});
    }
  }
  const byIndex=new Map();
  const filenames=(await readdir(join(corpus,"results"))).filter(name=>name.startsWith("B4-")&&name.endsWith(".json"));
  for(const filename of filenames){
    const entry=JSON.parse(await readFile(join(corpus,"results",filename),"utf8"));
    if(byIndex.has(entry.queueIndex))throw new Error("Multiple B4 receipts share queue index "+entry.queueIndex);
    byIndex.set(entry.queueIndex,entry);
  }
  const unique=new Set(balanced.map(row=>row.source_sha256));
  if(unique.size!==limit)throw new Error("Agent0 balanced source queue contains repeated source SHA.");
  const originalRoots=[
    join(process.env.HOME??"","Downloads"),
    join(process.env.HOME??"","Developer","AXOM"),
    join(process.env.HOME??"","Desktop"),
    join(process.env.HOME??"","Medical School"),
  ];
  let vite;
  const aggregate={sourcesScheduled:limit,sourceReceiptsVerified:0,shaVerifiedOriginals:0,
    processedFiles:0,failedFiles:0,candidatesDetected:0,canonicallyReadable:0,
    readyForScoredPractice:0,needsReview:0,unresolved:0,rejected:0,
    figuresReferenced:0,imageBytesVerified:0,pagesMapped:0,invalidPageReferences:0,
    perTermHint:{},evidenceKinds:{},sourcesWithNoMappedFigures:0,
    incompleteChoiceRecords:0,sourceIndependentlyAnswerVerified:0,
    sourceRasterImageObjectsObserved:0,sourceRasterPagesObserved:0,
    sourcesContainingRasterImages:0,sourceRasterSurveysFailed:0,
    ownerAuthenticatedCloudReadbacks:0};
  const perSource=[],failures=[];
  try{
    vite=await createServer({root:join(checkout,"web"),
      server:{middlewareMode:true,hmr:false},appType:"custom",optimizeDeps:{noDiscovery:true}});
    const assess=await vite.ssrLoadModule("/src/lib/question-content/assessBank.ts");
    const reader=await vite.ssrLoadModule("/src/lib/privateLibrary/install.ts");
    for(const [rank,item] of balanced.entries()){
      const sha=item.source_sha256;
      const match=byDigest.get(sha);
      if(!match){failures.push({rank,sha,reason:"Source not in canonical B4 SHA inventory."});continue;}
      const receipt=byIndex.get(match.index);
      if(!receipt||!receiptConsistent(receipt) ||
        !["review-prepared","review-partial"].includes(receipt.status)||
        receipt.sourceSha256!==sha){
        failures.push({rank,sha,reason:"Source has no eligible canonical review-package receipt."});continue;
      }
      const original=receipt.originalPath;
      if(!original||!existsSync(original)||!originalRoots.some(root=>fileIn(original,root))){
        failures.push({rank,sha,reason:"Authorized original is not currently accessible; no replacement attempted."});continue;
      }
      if((await stat(original)).size>128*1024*1024){
        failures.push({rank,sha,reason:"Original exceeds bounded 128 MB review limit."});continue;
      }
      if(await digest(original)!==sha){
        failures.push({rank,sha,reason:"Original SHA changed since inventory; source revision requires review."});continue;
      }
      aggregate.shaVerifiedOriginals++;
      const directory=receipt.packagePath;
      if(!directory||!fileIn(directory,join(corpus,"packages"))){
        failures.push({rank,sha,reason:"Prepared package path is outside private packages directory."});continue;
      }
      const raw=await readFile(join(directory,"questions.json"));
      if(createHash("sha256").update(raw).digest("hex")!==receipt.packageQuestionsSha256){
        failures.push({rank,sha,reason:"Prepared question file does not match receipt SHA."});continue;
      }
      const bank=reader.readPreparedBank(JSON.parse(await readFile(join(directory,"prepared-bank.json"),"utf8")));
      const allIssues=bank.issues??[];
      const assessment=assess.assessBank(bank.pkg,allIssues,bank.pkg.questions.flatMap(q=>q.assets).map(a=>({name:a.filename})));
      const parsed=bank.pkg.questions.length;
      const rejected=receipt.rejected;
      if(parsed!==receipt.canonicalReadable ||
        parsed+rejected!==receipt.detected ||
        assessment.counts.ready!==receipt.ready ||
        assessment.counts["needs-review"]!==receipt.reviewRequired ||
        assessment.counts.unresolved!==receipt.unresolved){
        failures.push({rank,sha,reason:"Canonical question/answer-readiness counts disagree with B4 receipt."});continue;
      }
      const {result,perQuestion}=summarizeEvidenceQuestions(bank.pkg.questions,assessment.verdicts,receipt.sourcePages??0);
      if(result.ready!==0){
        failures.push({rank,sha,reason:"Source unexpectedly contains a scored-practice-ready answer; stop until independent key evidence is verified."});continue;
      }
      const files=new Map();
      for(const question of bank.pkg.questions)for(const asset of question.assets??[]){
        if(!/^[a-zA-Z0-9._-]+$/.test(asset.filename)||asset.filename.includes("..")){
          throw new Error("Unsafe source image name in bank "+sha);
        }
        const prior=files.get(asset.filename);
        if(prior&&prior!==asset.checksum)throw new Error("Same name claims different figure bytes in source "+sha);
        files.set(asset.filename,asset.checksum);
      }
      for(const [filename,checksum] of files){
        const full=join(directory,"assets",filename);
        if(!checksum||!existsSync(full)||(await digest(full))!==(checksum.startsWith("sha256:")?checksum.slice(7):checksum))
          throw new Error("Medical source figure failed checksum validation, SHA "+sha);
      }
      if(files.size!==receipt.imageAssets){
        throw new Error("Figure count and source receipt do not agree, SHA "+sha);
      }
      // Read only XObject metadata: full slide figures remain in the original
      // and are never misreported as question-linked extracted PNGs.
      const raster=inventoryPdfRasterObjects(original,receipt.sourcePages??0);
      if(raster.complete){
        aggregate.sourceRasterImageObjectsObserved+=raster.embeddedRasterImageObjects;
        aggregate.sourceRasterPagesObserved+=raster.pageNumbersWithRasterImages.length;
        if(raster.embeddedRasterImageObjects)aggregate.sourcesContainingRasterImages++;
      }else aggregate.sourceRasterSurveysFailed++;
      const term=String(item.term??"unassigned");
      aggregate.perTermHint[term]=(aggregate.perTermHint[term]??0)+1;
      aggregate.sourceReceiptsVerified++;
      aggregate.processedFiles++;
      aggregate.candidatesDetected+=receipt.detected;
      aggregate.canonicallyReadable+=parsed;
      aggregate.readyForScoredPractice+=result.ready;
      aggregate.needsReview+=result.reviewHeld;
      aggregate.unresolved+=result.unresolved;
      aggregate.rejected+=rejected;
      aggregate.figuresReferenced+=files.size;
      aggregate.imageBytesVerified+=files.size;
      aggregate.pagesMapped+=result.pagesMapped;
      aggregate.invalidPageReferences+=result.invalidPageReferences;
      aggregate.incompleteChoiceRecords+=result.malformedChoices;
      if(files.size===0)aggregate.sourcesWithNoMappedFigures++;
      for(const [key,count] of Object.entries(result.declaredEvidence))
        aggregate.evidenceKinds[key]=(aggregate.evidenceKinds[key]??0)+count;
      const audit={
        schemaVersion:1,rank,sourceSha256:sha,canonicalB4Index:match.index,
        originalPath:original,sourceBytes:receipt.sourceBytes,
        originalChecksumVerified:true,sourcePages:receipt.sourcePages??null,
        termHint:term,moduleHint:item.module??null,weekHint:item.week??null,
        officialWeekVerified:false,
        extraction:{detected:receipt.detected,parsed,ready:0,reviewHeld:result.reviewHeld,
          unresolved:result.unresolved,rejected,figures:files.size,
          mappedSourcePages:result.pagesMapped,invalidPageReferences:result.invalidPageReferences,
          malformedChoiceRows:result.malformedChoices},
        sourceAnswerEvidence:{...result.declaredEvidence,
          authoritativeKeyComparedToOriginal:false,userConfirmed:false,
          answerAwarePracticeAllowed:false},
        imageByteChecksumsVerified:files.size,
        originalRasterInventory:raster,
        originalContainsUnmappedFigurePossibility:true,
        questions:perQuestion.map(question=>({
          ...question,
          sourcePageHasRasterImageObject:raster.complete && question.sourcePage!==null
            ? raster.pageNumbersWithRasterImages.includes(question.sourcePage) : null,
          rasterSourceObjectNotQuestionMapped:true,
        })),
        localReviewOnly:true,installedToBackend:false,ownerAuthenticatedCloudReadback:false,
      };
      await writeAtomic(join(destination,"per-sha",sha+".json"),audit);
      perSource.push({rank,sourceSha256:sha,b4Index:match.index,sourcePages:audit.sourcePages,
        termHint:term,detected:receipt.detected,parsed,ready:0,
        reviewHeld:result.reviewHeld,unresolved:result.unresolved,rejected,
        mappedImageAssets:files.size,pageMapped:result.pagesMapped,answerEvidence:result.declaredEvidence});
    }
  }finally{await vite?.close().catch(()=>{});}
  aggregate.failedFiles=failures.length;
  const summary={
    schemaVersion:1,batchName:"Round4 balanced T1–T5 source extraction",
    generatedAt:new Date().toISOString(),sourceSelection:"agent0-pdf-triage-metadata.json/balancedNextAfterB3",
    countBasis:"100 byte-distinct inventory sources; question candidates not unique verified questions",
    sourceAccessNote:"JDabSSD unmounted: 1,280 other sources remain inaccessible, not rejected.",
    ...aggregate,
    conservationOK:aggregate.candidatesDetected===aggregate.canonicallyReadable+aggregate.rejected
      && aggregate.canonicallyReadable===aggregate.readyForScoredPractice+aggregate.needsReview+aggregate.unresolved,
    perSource,failures,
    artifactsRoot:destination,
    noCloudFilesCreated:true,noPublicReleaseAuthorized:true,
  };
  await writeAtomic(join(destination,"balanced-summary.json"),summary);
  console.log("BALANCED_ROUND4_SUMMARY",JSON.stringify({
    sources:aggregate.processedFiles,failures:aggregate.failedFiles,
    detected:aggregate.candidatesDetected,parsed:aggregate.canonicallyReadable,
    ready:aggregate.readyForScoredPractice,review:aggregate.needsReview,
    unresolved:aggregate.unresolved,rejected:aggregate.rejected,
    figures:aggregate.imageBytesVerified,pageMapped:aggregate.pagesMapped,
    termHints:aggregate.perTermHint,conservationOK:summary.conservationOK,
    backendReadback:0,
  }));
  if(!summary.conservationOK||aggregate.failedFiles)process.exitCode=1;
}
main().catch(error=>{console.error("BALANCED_ROUND4_FAILED",error.message);process.exitCode=1});
