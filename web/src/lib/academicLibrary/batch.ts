/**
 * Owner-authenticated private academic receipt.
 *
 * This is a readback of the existing academic revisions and Storage objects,
 * not a second QBank or persistence store. No service-role key is accepted:
 * accountOperationClient binds every request to the signed-in user's token.
 * Do not use this to certify a new-device login; that requires a separate
 * session/browser acceptance test.
 */
import { accountOperationClient, loadSupabase } from "../account/supabase";
import { assessBank } from "../question-content/assessBank";
import { readImageInfo, sha256 } from "../question-content/assets";
import { readCatalog, readPreparedBank } from "../privateLibrary/install";
import { academicLibraryReader } from "./client";
import { academicAssetPath, assertAcademicFigureBudget, assertAcademicQuestionsInstallable, assertInstallableAcademicImage, academicCollectionId, uploadAcademicCourse, type AcademicUpload, type AcademicUploadResult } from "./upload";

export interface VerifiedAcademicSource {
  sha256: string;
  /** Only independently ready answers, not every extracted candidate. */
  questionCount: number;
  reviewCount: number;
  /** Source-question asset references; a reused figure can count twice. */
  figureReferences: number;
  /** Count of distinct immutable image paths verified from Storage. */
  distinctFigureFiles: number;
  figureReadbackVerified: true;
  /** Original file may intentionally stay local while its questions sync. */
  originalFileStatus: "cloud-verified" | "local-only" | "not-provided";
  /** Stable source question IDs, not a count inferred from filenames. */
  readyQuestionIds: string[];
  readbackVerified: true;
  ownerAuthenticated: true;
}

export interface VerifiedAcademicCourse {
  collectionId: string;
  revisionId: string;
  readyQuestions: number;
  reviewQuestions: number;
  sourceReceipts: VerifiedAcademicSource[];
  verifiedFiles: number;
  /** Originals larger than the backend limit are not claimed to be synced. */
  localOnlyOriginals: AcademicUpload["localOnlyOriginals"];
}

const decodeJson = (bytes: Uint8Array): unknown => JSON.parse(new TextDecoder().decode(bytes));
const toHash = (value: string) => value.replace(/^sha256:/, "");
const equal = (left: readonly string[], right: readonly string[]) => left.length === right.length
  && left.every((value, index) => value === right[index]);
const requireCurrent = (current: () => Promise<void>, signal?: AbortSignal) => async () => {
  if (signal?.aborted) throw new DOMException("Academic readback was cancelled; locally saved work remains intact.", "AbortError");
  await current();
  if (signal?.aborted) throw new DOMException("Academic readback was cancelled; locally saved work remains intact.", "AbortError");
};

/** The operation-scoped Supabase client deliberately has auth disabled when
 * created with accessToken(). Identity must be checked through the shared
 * session-owning Auth client, NEVER through the scoped Storage client or by
 * decoding a user-editable JWT field. Recheck the pinned session afterwards. */
async function assertOwnerFromAuth(ownerId: string, current: () => Promise<void>): Promise<void> {
  await current();
  const shared = await loadSupabase();
  if (!shared) throw new Error("Account Auth is unavailable for a verified academic receipt.");
  let identity: Awaited<ReturnType<typeof shared.auth.getUser>>;
  try {
    identity = await shared.auth.getUser();
  } catch {
    throw new Error("Owner identity was not verified by Supabase Auth.");
  }
  await current();
  if (identity.error || identity.data.user?.id !== ownerId)
    throw new Error("Owner identity was not verified by Supabase Auth.");
}

/**
 * The readback is deliberately independent of an upload's success callback:
 * a fresh operation-scoped, authenticated client queries the active revision,
 * enumerates the real manifest, then downloads and validates every referenced
 * bank, original and figure. This is still not proof of cross-device login.
 */
export async function verifyAcademicCourseReadback(
  upload: AcademicUpload,
  result: AcademicUploadResult,
  expectedAccountId: string,
  signal?: AbortSignal,
): Promise<VerifiedAcademicCourse> {
  if (result.status !== "active") throw new Error("The revision is superseded; only the active revision can receive an installed-source receipt.");
  const scope = await accountOperationClient();
  const assertCurrent = requireCurrent(scope.assertCurrent, signal);
  if (scope.userId !== expectedAccountId) throw new Error("The signed-in account differs from the private collection's owner.");
  // getUser performs a real Auth request. A parsed JWT or an accepted Storage
  // callback by itself never authorizes a cloud receipt.
  await assertOwnerFromAuth(expectedAccountId, assertCurrent);

  const expectedId = await academicCollectionId(expectedAccountId, upload.catalogId);
  if (result.collection_id !== expectedId) throw new Error("The saved collection ID does not match the prepared source identity.");
  const course = await scope.client.rpc("academic_course", { collection: result.collection_id });
  if (course.error || !course.data || course.data.owned !== true
    || course.data.current_revision_id !== result.revision_id
    || course.data.ready_questions !== upload.metadata.ready_questions
    || course.data.review_questions !== upload.metadata.review_questions)
    throw new Error("The owner's current academic course and verified question totals could not be re-read.");
  const revision = await scope.client.from("academic_revisions")
    .select("id,status,collection_id,content_hash,ready_questions,review_questions")
    .eq("id", result.revision_id).single();
  if (revision.error || revision.data?.status !== "ready"
    || revision.data.collection_id !== result.collection_id || revision.data.content_hash !== upload.hash
    || revision.data.ready_questions !== upload.metadata.ready_questions
    || revision.data.review_questions !== upload.metadata.review_questions)
    throw new Error("The academic revision record is unavailable or inconsistent with the reviewed package.");
  await assertCurrent();

  const reader = await academicLibraryReader(scope.client, result.revision_id);
  const expectedFiles = new Map(upload.files.map(file => [file.path, file]));
  if (reader.files.length !== expectedFiles.size) throw new Error("Cloud file counts differ from the prepared academic manifest.");
  for (const file of reader.files) {
    const expected = expectedFiles.get(file.path);
    if (!expected || file.sha256 !== expected.sha256 || file.byte_size !== expected.byte_size
      || file.mime_type !== expected.mime_type || file.object_path !== `${result.collection_id}/${file.sha256}`)
      throw new Error("A cloud academic-file reference differs from its source manifest.");
  }
  const readPaths = new Set<string>();
  const readVerified = async (path: string) => {
    await assertCurrent();
    const bytes = await reader(path);
    readPaths.add(path);
    return bytes;
  };
  const catalog = readCatalog(decodeJson(await readVerified("catalog.json")));
  if (catalog.id !== upload.catalogId || !equal(catalog.sources.map(source => source.checksum), upload.provenance.sourceChecksums))
    throw new Error("The stored source-catalog identity differs from the reviewed import.");
  await assertCurrent();

  let readyTotal = 0;
  let reviewTotal = 0;
  const receipts: VerifiedAcademicSource[] = [];
  const seenSources = new Set<string>();
  const seenQuestionIds = new Set<string>();
  const oversized = new Map(upload.localOnlyOriginals.map(item => [item.sourceId, item]));
  // Do not retain large downloaded originals in memory or in a parallel cache.
  for (const source of catalog.sources) {
    await assertCurrent();
    if (seenSources.has(source.checksum)) throw new Error("The saved catalog contains a duplicate source SHA.");
    seenSources.add(source.checksum);
    const localOriginal = oversized.get(source.id);
    if (localOriginal && (localOriginal.sha256 !== source.checksum || source.originalFile))
      throw new Error("A purported local-only original conflicts with the cloud source catalog.");
    if (source.originalFile) {
      const bytes = await readVerified(source.originalFile);
      if (await sha256(bytes) !== `sha256:${source.checksum}`)
        throw new Error("A restored original document differs from its source SHA-256.");
    }
    if (!source.bankFile) continue;
    const bank = readPreparedBank(decodeJson(await readVerified(source.bankFile)));
    const expectedSourceHash = toHash(source.checksum);
    const figures = new Set<string>();
    const availableAssets: { name: string }[] = [];
    const figureContent = new Map<string, string>();
    const figureSizes = new Map<string, number>();
    assertAcademicFigureBudget(bank.pkg.questions);
    for (const question of bank.pkg.questions) {
      if (seenQuestionIds.has(question.id)) throw new Error("Duplicate question identities across stored source collections require review.");
      seenQuestionIds.add(question.id);
      const claimedHash = question.provenance.sourceChecksum;
      if (claimedHash && toHash(claimedHash) !== expectedSourceHash)
        throw new Error("The stored question points to a different original source version.");
      for (const asset of question.assets) {
        if (!asset.checksum) throw new Error("A stored question figure lacks a content checksum.");
        const path = academicAssetPath(source.bankFile, asset.filename);
        const prior = figureContent.get(path);
        if (prior && prior !== asset.checksum) throw new Error("A source path points to conflicting figure bytes.");
        if (!prior) {
          await assertCurrent();
          const bytes = await readVerified(path);
          const stored = reader.files.find(file => file.path === path);
          if (!stored) throw new Error("An academic figure has no authenticated Storage manifest entry.");
          assertInstallableAcademicImage(bytes, stored.mime_type);
          const image = readImageInfo(bytes)!;
          if (await sha256(bytes) !== asset.checksum)
            throw new Error("A referenced clinical figure failed authenticated byte-level readback.");
          if (asset.mimeType && asset.mimeType !== image.mimeType)
            throw new Error("A clinical figure's declared MIME type differs from its restored bytes.");
          figureContent.set(path, asset.checksum);
          figureSizes.set(asset.filename, bytes.length);
        }
        availableAssets.push({ name: asset.filename });
        figures.add(path);
      }
    }
    assertAcademicFigureBudget(bank.pkg.questions, figureSizes);
    const assessed = assessBank(bank.pkg, bank.issues, availableAssets);
    const ready = assessed.counts.ready;
    const review = assessed.counts["needs-review"] + assessed.counts.unresolved + (bank.unreadableQuestions ?? 0);
    if (ready !== source.ready || review !== source.review)
      throw new Error("The owner's restored bank no longer agrees with its source review statuses.");
    assertAcademicQuestionsInstallable(bank, assessed.issues, ready, review);
    const readyQuestions = bank.pkg.questions.filter(question => assessed.verdicts.get(question.id)?.readiness === "ready");
    const references = readyQuestions.reduce((count, question) => count + question.assets.length, 0);
    readyTotal += ready; reviewTotal += review;
    receipts.push({
      sha256: source.checksum, questionCount: ready, reviewCount: review,
      figureReferences: references, distinctFigureFiles: figures.size,
      originalFileStatus: source.originalFile ? "cloud-verified" : localOriginal ? "local-only" : "not-provided",
      readyQuestionIds: readyQuestions.map(question => question.id),
      figureReadbackVerified: true, readbackVerified: true, ownerAuthenticated: true,
    });
  }
  if (readyTotal !== upload.metadata.ready_questions || reviewTotal !== upload.metadata.review_questions)
    throw new Error("The restored source counts do not reconcile with the active revision.");
  // Uploaded template/auxiliary objects count as verified only after actual
  // Storage byte readback. A metadata index is not a file-level receipt.
  for (const item of reader.files) {
    if (!readPaths.has(item.path)) await readVerified(item.path);
  }
  await assertCurrent();
  return {
    collectionId: result.collection_id, revisionId: result.revision_id,
    readyQuestions: readyTotal, reviewQuestions: reviewTotal, sourceReceipts: receipts,
    verifiedFiles: reader.files.length, localOnlyOriginals: upload.localOnlyOriginals,
  };
}

/** One lazy job at a time. The callback can write its checkpoint to the
 * existing private operations ledger; this function creates no new datastore.
 * Replays use the uploader's deterministic collection and revision hashes. */
export interface AcademicBatchJob {
  /** Stable caller-supplied private label, not source text or account secrets. */
  key: string;
  prepare(signal?: AbortSignal): Promise<AcademicUpload>;
}
export type AcademicBatchOutcome =
  | { key: string; state: "verified"; receipt: VerifiedAcademicCourse }
  | { key: string; state: "superseded"; collectionId: string; revisionId: string }
  | { key: string; state: "duplicate-input"; duplicateOf: string }
  | { key: string; state: "failed"; category: "network" | "identity" | "validation" | "integrity" | "unknown"; message: string }
  | { key: string; state: "cancelled" }
  | { key: string; state: "auth-blocked"; message: string };

export interface AcademicBatchReport {
  expected: number;
  processed: number;
  verified: number;
  superseded: number;
  duplicateInputs: number;
  failed: number;
  cancelled: number;
  authBlocked: number;
  pending: number;
  /** RPC currently has no inserted-vs-idempotent-replay flag. Never fabricate. */
  inserted: null;
  alreadyPresentOnServer: null;
  serverConfirmed: number;
  reviewRequired: number;
  verifiedReadyQuestions: number;
  verifiedFigures: number;
  outcomes: AcademicBatchOutcome[];
}

export async function uploadAcademicBatch(
  jobs: readonly AcademicBatchJob[],
  options: {
    onOutcome?: (item: AcademicBatchOutcome) => void | Promise<void>;
    progress?: (message: string) => void;
    signal?: AbortSignal;
  } = {},
): Promise<AcademicBatchReport> {
  if (options.signal?.aborted) throw new DOMException("Academic batch was cancelled before authentication.", "AbortError");
  if (!jobs.length || jobs.length > 100
    || jobs.some(job => !job || typeof job.prepare !== "function" || typeof job.key !== "string"
      || !job.key || job.key.length > 150)
    || new Set(jobs.map(job => job.key)).size !== jobs.length)
    throw new Error("A private academic batch must contain 1–100 uniquely identified source jobs.");
  const firstOperation = await accountOperationClient();
  await firstOperation.assertCurrent();
  await assertOwnerFromAuth(firstOperation.userId, firstOperation.assertCurrent);
  const ownerAccountId = firstOperation.userId;
  const outcomes: AcademicBatchOutcome[] = [];
  const handled = new Map<string, { digest: string; key: string; verified: boolean }>();
  for (const job of jobs) {
    if (options.signal?.aborted) break;
    let outcome: AcademicBatchOutcome;
    try {
      // Refresh operation scope between jobs, not halfway through an immutable
      // transfer. This permits legitimate token renewal during long batches.
      const operation = await accountOperationClient();
      if (operation.userId !== ownerAccountId) throw new Error("The signed-in account changed during the academic batch.");
      await operation.assertCurrent();
      const upload = await job.prepare(options.signal);
      const prior = handled.get(upload.catalogId);
      if (prior && prior.digest !== upload.hash)
        throw new Error("Two prepared academic imports share an ID but disagree on their source content. Split or review these versions explicitly.");
      if (prior?.verified) {
        outcome = { key: job.key, state: "duplicate-input", duplicateOf: prior.key };
      } else {
        // An earlier FAILED attempt is not a completed duplicate. Retry it;
        // academic_create_revision and immutable Storage paths are replay-safe.
        if (!prior) handled.set(upload.catalogId, { digest: upload.hash, key: job.key, verified: false });
        const saved = await uploadAcademicCourse(operation.client, operation.userId, upload, async () => {
          if (options.signal?.aborted) throw new DOMException("Upload cancelled", "AbortError");
          await operation.assertCurrent();
        }, message => options.progress?.(`${job.key}: ${message}`), operation.resumable, options.signal);
        if (saved.status === "superseded") outcome = { key: job.key, state: "superseded", collectionId: saved.collection_id, revisionId: saved.revision_id };
        else {
          outcome = { key: job.key, state: "verified",
            receipt: await verifyAcademicCourseReadback(upload, saved, operation.userId, options.signal) };
          handled.set(upload.catalogId, { digest: upload.hash, key: job.key, verified: true });
        }
      }
    } catch (error) {
      if (options.signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        outcome = { key: job.key, state: "cancelled" };
      } else if (error instanceof Error && /account changed|signed-in account|session was refreshed|Owner identity was not verified|Account Auth is unavailable/i.test(error.message)) {
        outcome = { key: job.key, state: "auth-blocked", message: "Owner authorization changed or expired. Sign in again, then replay the same private batch." };
      } else {
        // Never put source text, backend credentials or raw responses into the
        // receipt ledger. Caller can inspect the error in a secure debugger.
        const detail = error instanceof Error ? error.message : "";
        const category = /checksum|sha256|corrupt|integrity|mismatch/i.test(detail) ? "integrity"
          : /sign in|owner|account|auth|permission|jwt/i.test(detail) ? "identity"
          : /unreviewed|source identity|unsupported|invalid|reconcile/i.test(detail) ? "validation"
          : /network|fetch|connection|timeout|503|offline/i.test(detail) ? "network" : "unknown";
        outcome = { key: job.key, state: "failed", category,
          message: "Private academic upload/readback was not completed. Preserve the prepared package and retry this source." };
      }
    }
    outcomes.push(outcome);
    await options.onOutcome?.(outcome);
    if (outcome.state === "cancelled" || outcome.state === "auth-blocked") break;
  }
  const verified = outcomes.filter(x => x.state === "verified");
  return {
    expected: jobs.length, processed: outcomes.length,
    verified: verified.length, superseded: outcomes.filter(x => x.state === "superseded").length,
    duplicateInputs: outcomes.filter(x => x.state === "duplicate-input").length,
    failed: outcomes.filter(x => x.state === "failed").length,
    cancelled: outcomes.filter(x => x.state === "cancelled").length,
    authBlocked: outcomes.filter(x => x.state === "auth-blocked").length,
    pending: jobs.length - outcomes.length,
    inserted: null, alreadyPresentOnServer: null, serverConfirmed: verified.length,
    reviewRequired: verified.reduce((sum, item) => sum + item.receipt.reviewQuestions, 0),
    verifiedReadyQuestions: verified.reduce((sum, item) => sum + item.receipt.readyQuestions, 0),
    verifiedFigures: verified.reduce((sum, item) => sum + item.receipt.sourceReceipts.reduce((acc, source) => acc + source.figureReferences, 0), 0),
    outcomes,
  };
}

/**
 * Adapter for Agent 0's existing strict academic-reconcile CLI. Do not
 * generate a green ledger from local installations, mocks, RPC acknowledgments
 * or pending upload states: only owner-authenticated, re-read source receipts.
 *
 * A duplicate source SHA across two live collections is a provenance conflict,
 * not permission to count the questions twice. Resolve it in the source ledger.
 */
export function academicReconciliationLedger(report: AcademicBatchReport): {
  sources: Array<Pick<VerifiedAcademicSource,
    "sha256" | "questionCount" | "readbackVerified" | "ownerAuthenticated" |
    "figureReferences" | "figureReadbackVerified">>;
} {
  const sources: ReturnType<typeof academicReconciliationLedger>["sources"] = [];
  const seen = new Set<string>();
  const verified = report.outcomes.filter(row => row.state === "verified");
  if (verified.length !== report.verified || report.serverConfirmed !== report.verified)
    throw new Error("The academic batch counts do not reconcile; no cloud ledger can be issued.");
  for (const row of verified) {
    for (const source of row.receipt.sourceReceipts) {
      if (source.readbackVerified !== true || source.ownerAuthenticated !== true
        || source.figureReadbackVerified !== true || !/^[a-f0-9]{64}$/.test(source.sha256)
        || !Number.isSafeInteger(source.questionCount) || source.questionCount < 0
        || !Number.isSafeInteger(source.figureReferences) || source.figureReferences < 0)
        throw new Error("An academic source has no independently verified readback receipt.");
      if (seen.has(source.sha256))
        throw new Error("Two academic collections claim the same source SHA. Reconcile canonical ownership before issuing the receipt ledger.");
      seen.add(source.sha256);
      sources.push({
        sha256: source.sha256, questionCount: source.questionCount,
        readbackVerified: true, ownerAuthenticated: true,
        figureReferences: source.figureReferences, figureReadbackVerified: true,
      });
    }
  }
  return { sources: sources.sort((a, b) => a.sha256.localeCompare(b.sha256)) };
}
