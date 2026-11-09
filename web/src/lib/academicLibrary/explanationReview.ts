import { accountOperationClient } from "../account/supabase";
import { assessBank } from "../question-content/assessBank";
import { hasExplanationBlocks, hasExplanationProse } from "../questionExplanationCoverage";
import { sha256 } from "../question-content/assets";
import type { PackageQuestion } from "../question-content/package";
import type { Readiness } from "../question-content/readiness";
import { readCatalog, readPreparedBank, type LibraryReader } from "../privateLibrary/install";
import { academicLibraryReader } from "./client";
import { academicAssetPath, type AcademicUpload } from "./upload";

export interface ExplanationCoverage {
  readyQuestions: number;
  explainedReadyQuestions: number;
  missingExplanations: number;
}

export interface ExplanationReviewReceipt extends ExplanationCoverage {
  collectionId: string;
  revisionId: string;
  contentHash: string;
}

/** Text presence is only an observation. A reviewer must check the rationale
 * against the source before this revision can enter the official catalog. */
export function hasQuestionExplanation(question: Pick<PackageQuestion, "explanation" | "teaching">): boolean {
  const sourceExplanation = hasExplanationBlocks(question.explanation);
  const reviewedTeaching = question.teaching?.factCheck.humanReviewerApproved === true
    && question.teaching.factCheck.answerChanged === false
    && ["SOURCE_CHECKED", "INDEPENDENTLY_CHECKED"].includes(question.teaching.factCheck.status)
    && hasExplanationProse(question.teaching.whyCorrect);
  return Boolean(sourceExplanation || reviewedTeaching);
}

export function countReadyExplanations(
  questions: readonly Pick<PackageQuestion, "id" | "explanation" | "teaching">[],
  assessment: { verdicts: ReadonlyMap<string, { readiness: Readiness }> },
): ExplanationCoverage {
  let readyQuestions = 0;
  let explainedReadyQuestions = 0;
  for (const question of questions) {
    if (assessment.verdicts.get(question.id)?.readiness !== "ready") continue;
    readyQuestions += 1;
    if (hasQuestionExplanation(question)) explainedReadyQuestions += 1;
  }
  return { readyQuestions, explainedReadyQuestions, missingExplanations: readyQuestions - explainedReadyQuestions };
}

const decode = (bytes: Uint8Array): unknown => JSON.parse(new TextDecoder().decode(bytes));

async function inspectBanks(
  read: LibraryReader, files: readonly { path: string; byte_size: number; sha256: string }[], expectedReady: number,
  assertCurrent?: () => Promise<void>,
): Promise<ExplanationCoverage> {
  const byPath = new Map(files.map(file => [file.path, file]));
  const catalog = readCatalog(decode(await read("catalog.json")));
  await assertCurrent?.();
  let readyQuestions = 0;
  let explainedReadyQuestions = 0;
  const verifiedAssets = new Set<string>();
  for (const source of catalog.sources) {
    if (!source.bankFile) {
      if (source.ready || source.review) throw new Error("A source with questions has no stored bank.");
      continue;
    }
    const bank = readPreparedBank(decode(await read(source.bankFile)));
    await assertCurrent?.();
    const availableAssets = bank.pkg.questions.flatMap(question => question.assets.flatMap(asset => {
      const stored = byPath.get(academicAssetPath(source.bankFile!, asset.filename));
      return stored ? [{ name: asset.filename, size: stored.byte_size }] : [];
    }));
    const assessment = assessBank(bank.pkg, bank.issues, availableAssets);
    for (const question of bank.pkg.questions) {
      if (assessment.verdicts.get(question.id)?.readiness !== "ready") continue;
      for (const asset of question.assets) {
        const path = academicAssetPath(source.bankFile, asset.filename);
        if (verifiedAssets.has(path)) continue;
        const stored = byPath.get(path);
        if (!stored) throw new Error("A ready question's figure is absent from the stored manifest.");
        const bytes = await read(path);
        await assertCurrent?.();
        if (bytes.length !== stored.byte_size || await sha256(bytes) !== `sha256:${stored.sha256}`)
          throw new Error("A ready question's stored figure failed byte-level readback.");
        verifiedAssets.add(path);
      }
    }
    const held = assessment.counts["needs-review"] + assessment.counts.unresolved + (bank.unreadableQuestions ?? 0);
    if (assessment.counts.ready !== source.ready || held !== source.review)
      throw new Error("The stored question statuses differ from the reviewed source counts.");
    const coverage = countReadyExplanations(bank.pkg.questions, assessment);
    readyQuestions += coverage.readyQuestions;
    explainedReadyQuestions += coverage.explainedReadyQuestions;
  }
  if (readyQuestions !== expectedReady) throw new Error("The stored ready question count differs from this revision.");
  return { readyQuestions, explainedReadyQuestions, missingExplanations: readyQuestions - explainedReadyQuestions };
}

/** Upload-free local preview; never put this receipt inside strict upload metadata. */
export function inspectPreparedUploadExplanations(upload: AcademicUpload): Promise<ExplanationCoverage> {
  const files = new Map(upload.files.map(file => [file.path, file]));
  return inspectBanks(async path => {
    const file = files.get(path);
    if (!file) throw new Error("The prepared course is missing a required bank.");
    return file.bytes;
  }, upload.files, Number(upload.metadata.ready_questions));
}

/** Reviewer-only authenticated Storage readback of the exact current revision.
 * The returned count is an observation, not server-verified clinical quality. */
export async function inspectStoredRevisionExplanations(
  collectionId: string, revisionId: string, accountId: string,
): Promise<ExplanationReviewReceipt> {
  const operation = await accountOperationClient();
  if (operation.userId !== accountId) throw new Error("The signed-in account changed. Reopen this course.");
  await operation.assertCurrent();
  const target = await operation.client.rpc("academic_explanation_review_target", {
    collection: collectionId, revision: revisionId,
  });
  await operation.assertCurrent();
  const row = target.data;
  if (target.error || !row || row.collection_id !== collectionId || row.revision_id !== revisionId
    || typeof row.content_hash !== "string" || !/^[a-f0-9]{64}$/.test(row.content_hash)
    || !Number.isSafeInteger(row.ready_questions) || row.ready_questions < 0 || row.ready_questions > 100000) {
    throw new Error("This exact review revision is unavailable. Refresh the course before approving it.");
  }
  const reader = await academicLibraryReader(operation.client, revisionId);
  await operation.assertCurrent();
  const coverage = await inspectBanks(reader, reader.files, row.ready_questions, operation.assertCurrent);
  await operation.assertCurrent();
  return { collectionId, revisionId, contentHash: row.content_hash, ...coverage };
}

export async function attestAcademicExplanations(
  receipt: ExplanationReviewReceipt, accountId: string, rationaleReviewed: boolean,
): Promise<void> {
  if (!rationaleReviewed || receipt.readyQuestions === 0 || receipt.missingExplanations !== 0)
    throw new Error("Review every ready question's explanation before approval.");
  const operation = await accountOperationClient();
  if (operation.userId !== accountId) throw new Error("The signed-in account changed. Reopen this course.");
  await operation.assertCurrent();
  const { error } = await operation.client.rpc("academic_attest_explanations", {
    collection: receipt.collectionId,
    revision: receipt.revisionId,
    content_hash: receipt.contentHash,
    observed_ready_questions: receipt.readyQuestions,
    observed_explained_questions: receipt.explainedReadyQuestions,
    rationale_reviewed: true,
  });
  await operation.assertCurrent();
  if (error) throw new Error("The explanation review could not be saved. The revision may have changed; check it again.");
}
