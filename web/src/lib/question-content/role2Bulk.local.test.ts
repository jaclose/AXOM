// @vitest-environment node
// Private, one-off transformation. Output stays under gitignored artifacts.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { describe, expect, it } from "vitest";
import { prepareRawTextBank } from "./batchPrepareText";
import { serializeManifest, serializeQuestionsFile, parsePackage } from "./packageJson";
import { packageToReviewedImport } from "./toReviewedImport";
import { blocksToPlainText } from "./blocks";
import { sha256 } from "./assets";
import { readCatalog, readPreparedBank } from "../privateLibrary/install";
const repo = join(process.cwd(), "..");
const artifacts = join(repo,"artifacts/qbank-6way-20261014");
const output = join(artifacts, "role-2-prepared", "B1");
type Job = { source_path: string; expected_questions: number; canonical_input_key: string; source_ids: string[] };
type LedgerSource = {sourceSha256:string; bankId:string; sourceFile:string; originalPath:string; declaredSets:number; sourceBytes:number;
 expected:number; detected:number; ready:number; needsReview:number; unresolved:number; duplicateStemGroups:number; manifest:string; questionsFile:string;
 packageReviewFile:string; originalFile:string; sourceVerified:boolean; originalAnswerKeyVerified:boolean; cloudReadbackVerified:boolean; notes:string[]};
describe.skipIf(process.env.ROLE2_PRIVATE_B1 !== "1")("private B1 export validation", () => {
 it("builds and validates 18 real canonical packages with original-source receipts", async () => {
  const plan = JSON.parse(readFileSync(join(artifacts,"agent-2-priority-batches.json"),"utf8"));
  const jobs = (plan.processing_order.find((batch:{id:string})=>batch.id==="B1").jobs ?? []) as Job[];
  expect(jobs).toHaveLength(18);
  const sourceRows: LedgerSource[] = [];
  const catalogSources: Array<Record<string,unknown>> = [];
  const fingerprints = new Map<string, Array<{sourceSha256:string;questionId:string}>>();
  mkdirSync(output, { recursive:true });
  for (const job of jobs) {
    const sourceBytes = new Uint8Array(readFileSync(job.source_path));
    const fileName = basename(job.source_path);
    const prepared = await prepareRawTextBank({
      sourceBytes, filename:fileName, expectedSha256:job.canonical_input_key.slice(5),
    });
    expect(prepared.detected).toBe(job.expected_questions);
    expect(prepared.pkg.questions).toHaveLength(prepared.detected);
    expect(prepared.pkg.questions.every(q=>q.provenance.sourceChecksum==="sha256:"+prepared.sourceSha256)).toBe(true);
    const canonicalSave = packageToReviewedImport(prepared.pkg, prepared.issues);
    expect(canonicalSave.held.length + canonicalSave.imports.reduce((n,item)=>n+item.questionIds.length,0)).toBe(prepared.detected);
    expect(prepared.verifiedReadyIds).toHaveLength(0); // derived TXT answer fields require independent source verification
    const manifestText = serializeManifest(prepared.pkg.manifest);
    const questionsText = serializeQuestionsFile(prepared.pkg);
    const roundTrip = parsePackage(manifestText,questionsText);
    expect(roundTrip.package?.questions.length).toBe(prepared.detected);
    expect(roundTrip.issues.filter(i=>i.severity==="error"&&!i.questionId)).toEqual([]);
    const sourceDir = join(output,prepared.sourceSha256);
    mkdirSync(sourceDir,{recursive:true});
    const manifestPath = join(sourceDir,"manifest.json");
    const questionsPath = join(sourceDir,"questions.json");
    const packageReviewPath = join(sourceDir,"prepared-bank.json");
    const originalPath = join(sourceDir,"original.txt");
    const notes = [
      "Imported from labelled academic TXT; original academic correct-answer evidence remains unverified.",
      "Every extracted answer is a review candidate; no scored practice, cloud upload, or community publication has been authorized.",
      "Module, term, and official week are unassigned until curriculum evidence is confirmed.",
      ...prepared.warnings,
    ];
    const held = [...prepared.reviewRequiredIds, ...prepared.unresolvedIds];
    const reviewBank = { pkg: prepared.pkg, issues: prepared.issues,
      sourceText: {rawText:new TextDecoder().decode(sourceBytes).slice(0,400_000)},
      sourceBytes:sourceBytes.byteLength, unreadableQuestions:0, notes };
    expect(readPreparedBank(reviewBank).pkg.questions).toHaveLength(prepared.detected);
    const destManifest = "sources/"+prepared.sourceSha256+"/manifest.json";
    const destQuestions = "sources/"+prepared.sourceSha256+"/questions.json";
    const destBank = "sources/"+prepared.sourceSha256+"/prepared-bank.json";
    const destOriginal = "sources/"+prepared.sourceSha256+"/original.txt";
    // A portable prepared library keeps the original locally; do NOT commit it.
    const privateCollectionDir = join(artifacts,"role-2-prepared","portable-B1");
    mkdirSync(join(privateCollectionDir,"sources",prepared.sourceSha256),{recursive:true});
    writeFileSync(manifestPath,manifestText);
    writeFileSync(questionsPath,questionsText);
    writeFileSync(packageReviewPath,JSON.stringify(reviewBank,null,2)+"\n");
    writeFileSync(originalPath,sourceBytes);
    writeFileSync(join(privateCollectionDir,destManifest),manifestText);
    writeFileSync(join(privateCollectionDir,destQuestions),questionsText);
    writeFileSync(join(privateCollectionDir,destBank),JSON.stringify(reviewBank,null,2)+"\n");
    writeFileSync(join(privateCollectionDir,destOriginal),sourceBytes);
    expect(await sha256(new Uint8Array(readFileSync(join(privateCollectionDir,destOriginal))))).toBe("sha256:"+prepared.sourceSha256);
    for (const question of prepared.pkg.questions) {
      const fingerprint = (await sha256(new TextEncoder().encode(
        blocksToPlainText(question.stem).normalize("NFC").toLowerCase().replace(/\s+/g," ").trim()
        + "|" + question.choices.map(c=>blocksToPlainText(c.blocks)).join("|").toLowerCase().replace(/\s+/g," ").trim()
      ))).slice(7);
      fingerprints.set(fingerprint,[...(fingerprints.get(fingerprint)??[]),{sourceSha256:prepared.sourceSha256,questionId:question.id}]);
    }
    catalogSources.push({
      id:prepared.pkg.manifest.bank.id,
      name:fileName,
      sourcePath:destOriginal,
      checksum:prepared.sourceSha256,
      module:"Unmapped",
      status:"review-required",
      reason:"All extracted answer candidates require original-source confirmation; curriculum scope unassigned.",
      bankFile:destBank,
      originalFile:destOriginal,
      ready:0,
      review:held.length,
    });
    sourceRows.push({
      sourceSha256:prepared.sourceSha256,bankId:prepared.pkg.manifest.bank.id,
      sourceFile:fileName, originalPath:job.source_path,
      declaredSets:prepared.declaredSets,sourceBytes:prepared.sourceBytes,
      expected:job.expected_questions,detected:prepared.detected,
      ready:prepared.verifiedReadyIds.length,needsReview:prepared.reviewRequiredIds.length,
      unresolved:prepared.unresolvedIds.length,duplicateStemGroups:prepared.duplicateStemGroups.length,
      manifest:manifestPath,questionsFile:questionsPath,packageReviewFile:packageReviewPath,originalFile:originalPath,
      sourceVerified:true,originalAnswerKeyVerified:false,cloudReadbackVerified:false,notes:prepared.warnings,
    });
  }
  const portableDir=join(artifacts,"role-2-prepared","portable-B1");
  const catalog={format:"axom-private-library",schemaVersion:1,id:"role2-b1-raw-20261014",version:"2026-10-14-review-only-v1",templates:[],sources:catalogSources};
  expect(readCatalog(catalog).sources).toHaveLength(jobs.length);
  writeFileSync(join(portableDir,"catalog.json"),JSON.stringify(catalog,null,2)+"\n");
  const duplicateGroups=[...fingerprints.entries()].filter(([,occurrences])=>occurrences.length>1)
    .map(([fingerprint,occurrences])=>({fingerprint,occurrences}));
  const totals=sourceRows.reduce((t,row)=>({
    detected:t.detected+row.detected,
    ready:t.ready+row.ready,
    needsReview:t.needsReview+row.needsReview,
    unresolved:t.unresolved+row.unresolved,
  }),{detected:0,ready:0,needsReview:0,unresolved:0});
  const ledger={schemaVersion:1, generatedAt:new Date().toISOString(),category:"B1",
    sourceFilesSubmitted:jobs.length,sourceFilesProcessed:sourceRows.length,sourceFilesFailed:0,
    originalAcademicKeysVerified:0,actualBackendUploadsConfirmed:0,totals,portableCatalog:join(portableDir,"catalog.json"),
    sources:sourceRows,duplicateGroups};
  writeFileSync(join(artifacts,"role-2-b1-prepared-index.json"),JSON.stringify(ledger,null,2)+"\n");
  console.log("B1_PREPARED_TOTALS",JSON.stringify({files:sourceRows.length,...totals,duplicateStemGroups:duplicateGroups.length,
    multipleSourceSets:sourceRows.filter(row=>row.declaredSets>1).map(row=>({name:row.sourceFile,sets:row.declaredSets,detected:row.detected})),
    cloudConfirmed:0}));
  expect(sourceRows.length).toBe(18);
  expect(totals.detected).toBe(349);
  expect(totals.ready).toBe(0);
  expect(totals.needsReview).toBe(349);
 });
});
