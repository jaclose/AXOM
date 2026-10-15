#!/usr/bin/env node
/**
 * Independent, metadata-only acceptance gate for Agent 2's B4 private corpus.
 *
 * Uses existing SHA-indexed priority queue and bulkQueue receipt contract.
 * Does not change sources, execute parsers, inspect answer text for correctness,
 * create a question store, upload to Supabase, or certify scored-practice keys.
 *
 * Usage: node scripts/operations/academic-b4-reconcile.mjs
 */
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const checkout = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const dataRoot = join(checkout, "artifacts/qbank-6way-20261014");
const privateRoot = join(dataRoot, "role-2-corpus-v2");
const SHA = /^[0-9a-f]{64}$/;
const DONE = new Set(["review-prepared", "review-partial"]);
const STATES = new Set([
  "unavailable", "source-over-limit", "unsupported-format",
  "checksum-mismatch", "extraction-error", "no-questions",
  "review-prepared", "review-partial",
]);
const validCount = value => Number.isSafeInteger(value) && value >= 0;

export function partitionReceiptBatches(receipts) {
  const batches = { B4: [], B5: [] };
  receipts.forEach((receipt, index) => {
    if (receipt?.batch !== "B4" && receipt?.batch !== "B5")
      throw new Error(`Receipt index ${index} has unsupported batch ${JSON.stringify(receipt?.batch)}.`);
    batches[receipt.batch].push(receipt);
  });
  return batches;
}

export function reconcileB4(jobs, receipts, inspectPackage = () => ({ valid: true }), freshSourceProof = new Set()) {
  const errors = [], byStatus = {}, seen = new Set(), orphanReceipts = [];
  const totals = { detected: 0, canonicalReadable: 0, ready: 0, reviewRequired: 0,
    unresolved: 0, rejected: 0, imageAssets: 0, packagesVerified: 0,
    byteCheckedSources: 0, missingSources: 0, unverifiedByteProofSources: 0 };
  const expected = new Map();
  let pathOnlySources = 0;
  jobs.forEach((job, index) => {
    const key = job?.canonical_input_key;
    const byteSha = typeof key === "string" && /^byte:[a-f0-9]{64}$/.test(key);
    const sourcePath = typeof key === "string" && key.startsWith("path:/") && key.length <= 2048;
    if (!(byteSha || sourcePath) || expected.has(key)) {
      errors.push(`B4 queue index ${index} has no unique, supported canonical source identity.`);
      return;
    }
    if (sourcePath) pathOnlySources++;
    expected.set(key, { index, sha: byteSha ? key.slice(5) : undefined,
      displayId: byteSha ? key.slice(5, 17) : createHash("sha256").update(key).digest("hex").slice(0, 12) });
  });
  for (const receipt of receipts) {
    const key = receipt?.sourceKey;
    const item = expected.get(key);
    if (!item) {
      // A prior queue revision may have prepared an original subsequently
      // removed from this B4 window. Preserve its receipt and private package
      // for source-inventory reconciliation rather than deleting it.
      const source = typeof key === "string" ? createHash("sha256").update(key).digest("hex").slice(0, 12) : "invalid";
      orphanReceipts.push({ source, status: receipt?.status ?? "unknown",
        index: validCount(receipt?.queueIndex) ? receipt.queueIndex : null });
      errors.push(`Orphan B4 source receipt ${source} is absent from the active canonical queue.`);
      continue;
    }
    if (seen.has(key)) { errors.push(`Duplicate B4 receipt ${item.displayId}.`); continue; }
    seen.add(key);
    if (receipt.schemaVersion !== 1 || receipt.batch !== "B4"
      || !receipt.adapterVersion?.startsWith("axom-existing-parsers-bulk-")
      || receipt.queueIndex !== item.index
      || (item.sha && receipt.sourceSha256 !== item.sha)
      || (!item.sha && receipt.sourceSha256 !== undefined && !SHA.test(receipt.sourceSha256))
      || (!item.sha && receipt.inventoryChecksumVerified === true)
      || !STATES.has(receipt.status) || !Array.isArray(receipt.reasons))
      errors.push(`Invalid B4 receipt metadata ${item.displayId}.`);
    if (!["detected", "canonicalReadable", "ready", "reviewRequired", "unresolved", "rejected", "imageAssets"]
      .every(field => validCount(receipt[field]))
      || receipt.detected !== receipt.ready + receipt.reviewRequired + receipt.unresolved + receipt.rejected
      || receipt.canonicalReadable > receipt.detected || receipt.ready !== 0
      || receipt.accountCloudReadbackVerified !== false || receipt.answerIndependentlyVerified !== false)
      errors.push(`Unsafe candidate/answer/cloud counts ${item.displayId}.`);
    // Old (already persisted) review receipts can lack a boolean byte proof.
    // Keep their source disposition visible without certifying file integrity.
    const hashProven = receipt.inventoryChecksumVerified === true
      || receipt.sourceIndependentlyVerified === true || freshSourceProof.has(key);
    if (DONE.has(receipt.status) && item.sha && !hashProven)
      totals.unverifiedByteProofSources++;
    byStatus[receipt.status] = (byStatus[receipt.status] ?? 0) + 1;
    for (const name of ["detected","canonicalReadable","ready","reviewRequired","unresolved","rejected","imageAssets"])
      totals[name] += validCount(receipt[name]) ? receipt[name] : 0;
    if (hashProven && item.sha) totals.byteCheckedSources++;
    if (receipt.status === "unavailable") totals.missingSources++;
    if (DONE.has(receipt.status)) {
      // Review-partial packages deliberately retain every detected original
      // candidate in questions.json and separately state which failed to parse.
      if (receipt.canonicalReadable + receipt.rejected !== receipt.detected
        || receipt.ready + receipt.reviewRequired + receipt.unresolved !== receipt.canonicalReadable)
        errors.push(`Prepared source lost or miscounted candidate rows ${item.displayId}.`);
      if (!receipt.packagePath || !SHA.test(receipt.packageQuestionsSha256 ?? "")) {
        errors.push(`Prepared candidate lacks a verifiable private package ${item.displayId}.`);
      } else {
        const check = inspectPackage(receipt);
        if (!check.valid || check.questions !== receipt.detected || check.unreadable !== receipt.rejected)
          errors.push(`Prepared question package checksum/record mismatch ${item.displayId}.`);
        else totals.packagesVerified++;
      }
    } else if (receipt.detected > 0) errors.push(`Unprepared source claims questions ${item.displayId}.`);
  }
  const missing = [...expected.keys()].filter(key => !seen.has(key));
  if (missing.length) errors.push(`${missing.length} B4 sources have no disposition receipt.`);
  return {
    format: "axom-b4-corpus-acceptance-v1",
    sourceReceiptCoverageComplete: errors.length === 0 && !missing.length,
    sourceIdentityCoverageComplete: errors.length === 0 && !missing.length
      && pathOnlySources === 0 && totals.unverifiedByteProofSources === 0,
    pathOnlySourceJobs: pathOnlySources,
    academicReleaseComplete: false,
    verifiedCloudQuestionCount: 0,
    verifiedScorableQuestionCount: 0,
    queuedSources: jobs.length,
    receivedSourceDispositions: seen.size,
    missingReceipts: missing.length,
    orphanReceipts: orphanReceipts.length,
    orphanPreparedReceipts: orphanReceipts.filter(row => DONE.has(row.status)).length,
    orphanReceiptSamples: orphanReceipts.slice(0, 12),
    byStatus, totals,
    errors: errors.slice(0, 80),
    caveats: [
      "All B4 questions are STRUCTURAL extraction candidates, NOT source-key-verified or ready for scored practice.",
      "A missing source on the unplugged SSD is not a parser failure and must be retried after remount.",
    `${pathOnlySources} originals are path-only priority exceptions; an old path is not a verified immutable byte identity.`,
    `${totals.unverifiedByteProofSources} prepared sources have no accepted source-hash attestation. Legacy receipt fields and optional fresh rehash are accepted; answers remain review-only.`,
      "No owner-authenticated Supabase cloud data receipt is claimed by this audit.",
    ],
  };
}

/**
 * Independently reconciles the B5 queue found beside B4 receipts. B5 rows are
 * review/disposition evidence only: they cannot contribute to B4 coverage,
 * answer readiness or authenticated cloud acceptance.
 */
export function reconcileB5(jobs, receipts, inspectPackage = () => ({ valid: true })) {
  const errors = [], byStatus = {}, seen = new Set(), orphanReceipts = [];
  const totals = { detected: 0, canonicalReadable: 0, ready: 0, reviewRequired: 0,
    unresolved: 0, rejected: 0, imageAssets: 0, packagesVerified: 0,
    byteCheckedSources: 0, missingSources: 0 };
  const expected = new Map();
  let pathOnlySources = 0;
  jobs.forEach((job, index) => {
    const key = job?.canonical_input_key;
    const byteSha = typeof key === "string" && /^byte:[a-f0-9]{64}$/.test(key);
    const sourcePath = typeof key === "string" && key.startsWith("path:/") && key.length <= 2048;
    if (!(byteSha || sourcePath) || expected.has(key)) {
      errors.push(`B5 queue index ${index} has no unique, supported canonical source identity.`);
      return;
    }
    if (sourcePath) pathOnlySources++;
    expected.set(key, { index, sha: byteSha ? key.slice(5) : undefined,
      displayId: byteSha ? key.slice(5, 17) : createHash("sha256").update(key).digest("hex").slice(0, 12) });
  });
  for (const receipt of receipts) {
    const key = receipt?.sourceKey;
    const item = expected.get(key);
    if (!item) {
      const source = typeof key === "string"
        ? createHash("sha256").update(key).digest("hex").slice(0, 12) : "invalid";
      orphanReceipts.push({ source, status: receipt?.status ?? "unknown",
        index: validCount(receipt?.queueIndex) ? receipt.queueIndex : null });
      errors.push(`Orphan B5 source receipt ${source} is absent from the active B5 queue.`);
      continue;
    }
    if (seen.has(key)) { errors.push(`Duplicate B5 receipt ${item.displayId}.`); continue; }
    seen.add(key);
    if (receipt.schemaVersion !== 1 || receipt.batch !== "B5"
      || !receipt.adapterVersion?.startsWith("axom-existing-parsers-bulk-")
      || receipt.queueIndex !== item.index
      || (item.sha && receipt.sourceSha256 !== item.sha)
      || (!item.sha && receipt.sourceSha256 !== undefined && !SHA.test(receipt.sourceSha256))
      || (!item.sha && receipt.inventoryChecksumVerified === true)
      || !STATES.has(receipt.status) || !Array.isArray(receipt.reasons))
      errors.push(`Invalid B5 receipt metadata ${item.displayId}.`);
    if (![
      "detected", "canonicalReadable", "ready", "reviewRequired", "unresolved", "rejected", "imageAssets",
    ].every(field => validCount(receipt[field]))
      || receipt.detected !== receipt.ready + receipt.reviewRequired + receipt.unresolved + receipt.rejected
      || receipt.canonicalReadable > receipt.detected || receipt.ready !== 0
      || receipt.accountCloudReadbackVerified !== false || receipt.answerIndependentlyVerified !== false)
      errors.push(`Unsafe B5 candidate/answer/cloud counts ${item.displayId}.`);
    const hashProven = item.sha && (receipt.inventoryChecksumVerified === true
      || receipt.sourceIndependentlyVerified === true);
    byStatus[receipt.status] = (byStatus[receipt.status] ?? 0) + 1;
    for (const name of ["detected", "canonicalReadable", "ready", "reviewRequired", "unresolved", "rejected", "imageAssets"])
      totals[name] += validCount(receipt[name]) ? receipt[name] : 0;
    if (hashProven) totals.byteCheckedSources++;
    if (receipt.status === "unavailable") totals.missingSources++;
    if (DONE.has(receipt.status)) {
      if (receipt.canonicalReadable + receipt.rejected !== receipt.detected
        || receipt.ready + receipt.reviewRequired + receipt.unresolved !== receipt.canonicalReadable)
        errors.push(`Prepared B5 source lost or miscounted candidate rows ${item.displayId}.`);
      if (!receipt.packagePath || !SHA.test(receipt.packageQuestionsSha256 ?? "")) {
        errors.push(`Prepared B5 candidate lacks a verifiable private package ${item.displayId}.`);
      } else {
        const check = inspectPackage(receipt);
        if (!check.valid || check.questions !== receipt.detected || check.unreadable !== receipt.rejected)
          errors.push(`Prepared B5 question package checksum/record mismatch ${item.displayId}.`);
        else totals.packagesVerified++;
      }
    } else if (receipt.detected > 0) errors.push(`Unprepared B5 source claims questions ${item.displayId}.`);
  }
  const missing = [...expected.keys()].filter(key => !seen.has(key));
  if (missing.length) errors.push(`${missing.length} B5 sources have no disposition receipt.`);
  return {
    format: "axom-b5-corpus-crosswalk-v1",
    sourceReceiptCoverageComplete: errors.length === 0 && !missing.length,
    sourceIdentityCoverageComplete: errors.length === 0 && !missing.length
      && pathOnlySources === 0 && totals.byteCheckedSources === jobs.length,
    academicReleaseComplete: false,
    verifiedCloudQuestionCount: 0,
    verifiedScorableQuestionCount: 0,
    queuedSources: jobs.length,
    receivedSourceDispositions: seen.size,
    missingReceipts: missing.length,
    orphanReceipts: orphanReceipts.length,
    orphanReceiptSamples: orphanReceipts.slice(0, 12),
    pathOnlySourceJobs: pathOnlySources,
    byStatus,
    totals,
    errors: errors.slice(0, 80),
    caveats: [
      "B5 receipts are source dispositions and structural review candidates, never B4 coverage.",
      "No B5 answer is independently verified or ready for scored practice.",
      "No owner-authenticated Supabase cloud data receipt is claimed by this crosswalk.",
    ],
  };
}

/**
 * Historical B4 receipts may have been written after a worker switched to
 * the B5 triage window without changing its receipt prefix. Do not delete
 * or silently count them in B4. Crosswalk by exact canonical source key to
 * the *current* full queue and preserve any prepared review-only packages.
 * This never treats a path-only source or a parser result as answer evidence.
 */
export function crosswalkB4Orphans(receipts, activeB4Jobs, canonicalJobs, priority, inspectPackage = () => ({ valid: false })) {
  const active = new Set(activeB4Jobs.map(job => job?.canonical_input_key));
  const byKey = new Map(canonicalJobs.map((job, index) => [job.canonical_input_key, { job, index }]));
  const batchOwnership = new Map();
  for (const group of priority.processing_order ?? []) {
    const keys = Array.isArray(group.job_indices)
      ? group.job_indices.map(index => canonicalJobs[index]?.canonical_input_key)
      : (group.jobs ?? []).map(job => job.canonical_input_key);
    for (const key of keys) {
      if (!key) continue;
      if (!batchOwnership.has(key)) batchOwnership.set(key, new Set());
      batchOwnership.get(key).add(group.id);
    }
  }
  const batchPositions = new Map();
  for (const group of priority.processing_order ?? []) {
    const keys = Array.isArray(group.job_indices)
      ? group.job_indices.map(index => canonicalJobs[index]?.canonical_input_key)
      : (group.jobs ?? []).map(job => job.canonical_input_key);
    keys.forEach((key,index) => { if(key) batchPositions.set(group.id+"|"+key,index); });
  }
  const rows = [];
  for (const receipt of receipts) {
    if (!receipt?.sourceKey || active.has(receipt.sourceKey)) continue;
    const entry = byKey.get(receipt.sourceKey);
    const owningBatches = [...(batchOwnership.get(receipt.sourceKey) ?? [])].filter(x => x !== "B4");
    const sha = receipt.sourceKey.startsWith("byte:") ? receipt.sourceKey.slice(5) : null;
    const checksumMatches = sha !== null && SHA.test(sha) && receipt.sourceSha256 === sha;
    const hasPreparedPackage = DONE.has(receipt.status) && Boolean(receipt.packagePath);
    const packaged = hasPreparedPackage ? inspectPackage(receipt) : undefined;
    rows.push({
      sourceKey: receipt.sourceKey,
      sourceSha256: sha && SHA.test(sha) ? sha : null,
      sourceId: sha?.slice(0, 12) ?? createHash("sha256").update(receipt.sourceKey).digest("hex").slice(0, 12),
      ...(entry?.job?.source_path ? { originalSourcePath: entry.job.source_path } : {}),
      ...(owningBatches.length === 1 ? { targetBatchPosition: batchPositions.get(owningBatches[0]+"|"+receipt.sourceKey) ?? null } : {}),
      receiptBatch: receipt.batch, receiptIndex: receipt.queueIndex,
      currentJobIndex: entry?.index ?? null,
      currentBatches: owningBatches,
      status: receipt.status ?? "unknown",
      immutableShaSupported: checksumMatches,
      sourceIdentity: sha ? "byte-sha256" : "path-only",
      preparedReviewPackagePreserved: hasPreparedPackage,
      preparedPackageChecksumVerified: packaged?.valid === true,
      ...(hasPreparedPackage ? { privatePackagePath: receipt.packagePath,
        packageQuestionsSha256: receipt.packageQuestionsSha256 ?? null } : {}),
      // A prepared package is a source-review artifact. No implicit evidence
      // that it is independently answered, licensed or cloud-installed.
      answerVerified: false,
      accountCloudReadbackVerified: false,
      classification: owningBatches.length === 1 && entry
        ? "currently_queued_other_batch" : entry ? "ambiguous_current_queue_batch"
          : "absent_from_current_canonical_queue",
      nextAction: owningBatches.length === 1 && entry
        ? "Issue a fresh source/review receipt in the actual owning batch after re-verifying original SHA; preserve original B4 receipt and package."
        : "Agent 1 must reconcile source identity and root before selecting any import batch.",
    });
  }
  return {
    total: rows.length,
    byStatus: Object.fromEntries([...new Set(rows.map(x => x.status))].map(k => [k, rows.filter(x => x.status === k).length])),
    byAssignedBatch: Object.fromEntries([...new Set(rows.flatMap(x => x.currentBatches))].map(k =>
      [k, rows.filter(x => x.currentBatches.includes(k)).length])),
    matchedToOtherCurrentBatch: rows.filter(x => x.classification === "currently_queued_other_batch").length,
    preservedPreparedReviewPackages: rows.filter(x => x.preparedReviewPackagePreserved).length,
    verifiedPreparedReviewPackages: rows.filter(x => x.preparedPackageChecksumVerified).length,
    byteShaConfirmedByReceipt: rows.filter(x => x.immutableShaSupported).length,
    pathOnlySources: rows.filter(x => x.sourceIdentity === "path-only").length,
    rows,
    caveat: "A receipt in an incorrect batch is not a validated, installed or cloud-verified collection. No original/source bytes modified.",
  };
}

/** A versioned, zero-copy migration PLAN, never a silent receipt rewrite. */
export function buildB5ReclassificationHandoff(orphanCrosswalk, priority) {
  const group = priority?.processing_order?.find(g => g.id === "B5");
  if (!Array.isArray(group?.jobs)) throw new Error("Current B5 source queue is missing.");
  const canonicalKeys = group.jobs.map(job => job.canonical_input_key);
  if (canonicalKeys.some(key => typeof key !== "string" || !key.length)
    || new Set(canonicalKeys).size !== canonicalKeys.length)
    throw new Error("B5 queue has missing or duplicate canonical source keys.");
  const queueFingerprint = createHash("sha256").update(JSON.stringify(canonicalKeys)).digest("hex");
  const matched = new Set(), tasks = [];
  for (const row of orphanCrosswalk?.rows ?? []) {
    if (row.classification !== "currently_queued_other_batch"
      || row.currentBatches.length !== 1 || row.currentBatches[0] !== "B5"
      || !Number.isSafeInteger(row.targetBatchPosition)
      || group.jobs[row.targetBatchPosition]?.canonical_input_key !== row.sourceKey)
      throw new Error("Historical B4 receipt cannot be safely attributed to the current B5 queue.");
    if (matched.has(row.sourceKey)) throw new Error("Duplicate historical source identity in B5 migration evidence.");
    matched.add(row.sourceKey);
    if (row.preparedReviewPackagePreserved && !row.preparedPackageChecksumVerified)
      throw new Error("Unverified historical package cannot be reused during B5 migration.");
    tasks.push({
      targetBatch: "B5",
      targetQueuePosition: row.targetBatchPosition,
      originalSourcePath: row.originalSourcePath ?? null,
      canonicalInputKey: row.sourceKey,
      sourceSha256: row.sourceSha256,
      oldReceiptBatch: row.receiptBatch,
      oldReceiptIndex: row.receiptIndex,
      oldReceiptStatus: row.status,
      sourceIdentity: row.sourceIdentity,
      originalCurrentlyAccessible: typeof row.originalSourcePath === "string"
        ? existsSync(row.originalSourcePath) : false,
      ...(row.preparedReviewPackagePreserved ? {
        existingPrivateReviewPackagePath: row.privatePackagePath,
        existingQuestionsSha256: row.packageQuestionsSha256,
        packageChecksumVerified: true,
      } : {}),
      validatedCorrectAnswers: 0,
      authenticatedCloudReadbackVerified: false,
      status: row.preparedReviewPackagePreserved
        ? "review_package_reusable_after_source_confirmation" : "needs_original_or_source_review",
      nextAction: row.sourceIdentity === "path-only"
        ? "Reconnect academic drive and hash the original; do not use path string as a checksum."
        : row.preparedReviewPackagePreserved
          ? "Confirm original SHA and author/reviewer rights, then reissue B5 receipt referencing existing immutable private package without copying it."
          : "Reopen original in actual B5 batch, retain the historical B4 receipt for provenance.",
    });
  }
  tasks.sort((a,b) => a.targetQueuePosition-b.targetQueuePosition);
  const unresolvedB5 = canonicalKeys.filter(key => !matched.has(key));
  return {
    format: "axom-b5-orphan-reclassification-plan-v1",
    sourceQueueSha256: queueFingerprint,
    totalB5Jobs: canonicalKeys.length, matchedHistoricalReceipts: tasks.length,
    missingFromHistoricalReceipts: unresolvedB5.length,
    missingCurrentB5Keys: unresolvedB5,
    sourcesWithoutByteSha256: tasks.filter(t => t.sourceIdentity === "path-only").length,
    existingReviewPackagesReusable: tasks.filter(t => t.packageChecksumVerified).length,
    actionsCompleted: 0,
    permissionedCloudInstallations: 0,
    noSourceOrPreparedPackageBytesCopied: true,
    note: "A plan to adopt prior review-only receipt identities; no answers certified, no original or private package modified, no cloud upload.",
    tasks,
  };
}

function readCandidate(receipt) {
  const root = realpathSync(join(privateRoot, "packages"));
  const folder = resolve(receipt.packagePath);
  if (!folder.startsWith(root + sep) || !existsSync(folder)) return { valid: false };
  const real = realpathSync(folder);
  if (!real.startsWith(root + sep)) return { valid: false };
  const questionsFile = join(real, "questions.json");
  if (!existsSync(questionsFile) || statSync(questionsFile).size > 32 * 1048576) return { valid: false };
  const bytes = readFileSync(questionsFile);
  const checksum = createHash("sha256").update(bytes).digest("hex");
  if (checksum !== receipt.packageQuestionsSha256) return { valid: false };
  try {
    const parsed = JSON.parse(bytes.toString("utf8"));
    const prepared = JSON.parse(readFileSync(join(real, "prepared-bank.json"), "utf8"));
    return { valid: Array.isArray(parsed.questions) && validCount(prepared.unreadableQuestions),
      questions: parsed.questions?.length, unreadable: prepared.unreadableQuestions };
  } catch { return { valid: false }; }
}

/**
 * Optional, bounded current-byte attestation. Streams source originals without
 * copying them or repeating question extraction. Historic receipts can be
 * checked against today's actual file bytes even if an older importer used a
 * different boolean field name. No correct answers or cloud claims result.
 */
export async function attestSourceBytes(receipts) {
  const proven = new Set(), failures = [];
  let bytesRead = 0, inspected = 0;
  for (const receipt of receipts) {
    if (!DONE.has(receipt.status) || !receipt.sourceKey?.startsWith("byte:")) continue;
    const sha = receipt.sourceKey.slice(5);
    const sourcePath = receipt.originalPath;
    if (!SHA.test(sha) || !sourcePath || !existsSync(sourcePath)) {
      failures.push({ source: sha.slice(0, 12), code: "missing_original" });
      continue;
    }
    try {
      const path = realpathSync(sourcePath);
      const before = statSync(path);
      if (!before.isFile() || before.size < 1 || before.size > 128 * 1024 ** 2
        || before.size !== receipt.sourceBytes) {
        failures.push({ source: sha.slice(0, 12), code: "source_size_changed_or_out_of_bounds" });
        continue;
      }
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(path, { highWaterMark: 256 * 1024 })) hash.update(chunk);
      const after = statSync(path);
      inspected++;
      bytesRead += before.size;
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || hash.digest("hex") !== sha)
        failures.push({ source: sha.slice(0, 12), code: "source_sha_mismatch_or_changed_during_read" });
      else proven.add(receipt.sourceKey);
    } catch (error) {
      failures.push({ source: sha.slice(0, 12), code: error && typeof error === "object"
        && "code" in error ? "read_" + String(error.code).slice(0, 24) : "source_read_failed" });
    }
  }
  return { proven, failures, inspected, bytesRead };
}

function queuedJobsForBatch(queue, sourceJobs, batchId) {
  const selected = queue?.processing_order?.find(item => item.id === batchId);
  if (Array.isArray(selected?.job_indices)) {
    return selected.job_indices.map(index => {
      if (!Number.isSafeInteger(index) || index < 0 || index >= sourceJobs.length)
        throw new Error(`${batchId} queue has an out-of-range source index.`);
      return sourceJobs[index];
    });
  }
  if (Array.isArray(selected?.jobs)) {
    return selected.jobs.map((job, index) => {
      if (typeof job?.canonical_input_key !== "string")
        throw new Error(`${batchId} queue position ${index} has no canonical source identity.`);
      if (Number.isSafeInteger(job.queue_index)) {
        if (job.queue_index < 0 || job.queue_index >= sourceJobs.length
          || sourceJobs[job.queue_index]?.canonical_input_key !== job.canonical_input_key)
          throw new Error(`${batchId} queue position ${index} disagrees with the canonical source inventory.`);
        return sourceJobs[job.queue_index];
      }
      return job;
    });
  }
  throw new Error(`${batchId} source queue is unavailable.`);
}

export async function runB4(root = dataRoot, log = console.log) {
  const queue = JSON.parse(readFileSync(join(root, "agent-2-priority-batches.json"), "utf8"));
  const sourceJobs = JSON.parse(readFileSync(join(root, "agent-2-import-inputs-deduplicated.json"), "utf8"));
  const jobs = queuedJobsForBatch(queue, sourceJobs, "B4");
  const b5Jobs = queuedJobsForBatch(queue, sourceJobs, "B5");
  const resultDir = join(root, "role-2-corpus-v2/results");
  const receipts = readdirSync(resultDir).filter(name => /^[A-Za-z0-9-]+\.json$/.test(name))
    .map(name => JSON.parse(readFileSync(join(resultDir, name), "utf8")));
  const receiptBatches = partitionReceiptBatches(receipts);
  const liveAudit = process.argv.includes("--verify-source-bytes")
    ? await attestSourceBytes(receiptBatches.B4) : undefined;
  const result = reconcileB4(jobs, receiptBatches.B4, readCandidate, liveAudit?.proven);
  const b5Crosswalk = reconcileB5(b5Jobs, receiptBatches.B5, readCandidate);
  result.b5Crosswalk = b5Crosswalk;
  // Preserve the legacy lead-report field consumed by the scoped B5 verifier,
  // but derive it exclusively from explicitly labeled B5 receipts. It is
  // compatibility evidence, never part of B4 coverage or orphan accounting.
  result.orphanCrosswalk = crosswalkB4Orphans(
    receiptBatches.B5, jobs, sourceJobs, queue, readCandidate,
  );
  if (result.orphanCrosswalk.total !== receiptBatches.B5.length)
    throw new Error("B5 compatibility crosswalk omitted a labeled B5 receipt.");
  if (liveAudit) {
    result.freshOriginalsHashed = liveAudit.inspected;
    result.freshBytesRead = liveAudit.bytesRead;
    result.freshOriginalsConfirmed = liveAudit.proven.size;
    result.freshSourceFailures = liveAudit.failures;
    if (liveAudit.failures.length) {
      result.sourceIdentityCoverageComplete = false;
      result.errors.push(...liveAudit.failures.slice(0, 12).map(row =>
        `Fresh original ${row.source} failed SHA-256 inspection (${row.code}).`));
    }
  }
  const target = join(root, "lead-b4-acceptance.json");
  mkdirSync(dirname(target), { recursive: true });
  // This private crosswalk references existing immutable packages; it never
  // copies an original file or changes a cloud account.
  const handoffPath = join(root, "agent0-b5-reclassification-handoff.json");
  const handoffTmp = handoffPath + ".tmp-agent0";
  writeFileSync(handoffTmp, JSON.stringify({ createdAt: new Date().toISOString(), ...b5Crosswalk }, null, 2) + "\n");
  renameSync(handoffTmp, handoffPath);
  writeFileSync(target, JSON.stringify({ generatedAt: new Date().toISOString(), ...result }, null, 2) + "\n");
  log(JSON.stringify({ sourceReceiptCoverageComplete: result.sourceReceiptCoverageComplete,
    academicReleaseComplete: result.academicReleaseComplete,
    sourceIdentityCoverageComplete: result.sourceIdentityCoverageComplete,
    pathOnlySourceJobs: result.pathOnlySourceJobs,
    ...(liveAudit ? { freshOriginalsHashed: liveAudit.inspected,
      freshBytesRead: liveAudit.bytesRead, freshOriginalsConfirmed: liveAudit.proven.size,
      freshSourceFailures: liveAudit.failures.length } : {}),
    queuedSources: result.queuedSources, receivedSourceDispositions: result.receivedSourceDispositions,
    orphanReceipts: result.orphanReceipts, orphanPreparedReceipts: result.orphanPreparedReceipts,
    b5Crosswalk: { queuedSources: b5Crosswalk.queuedSources,
      receivedSourceDispositions: b5Crosswalk.receivedSourceDispositions,
      sourceReceiptCoverageComplete: b5Crosswalk.sourceReceiptCoverageComplete,
      sourceIdentityCoverageComplete: b5Crosswalk.sourceIdentityCoverageComplete,
      pathOnlySourceJobs: b5Crosswalk.pathOnlySourceJobs,
      reviewRequired: b5Crosswalk.totals.reviewRequired,
      unresolved: b5Crosswalk.totals.unresolved,
      ready: b5Crosswalk.totals.ready,
      verifiedCloudQuestionCount: b5Crosswalk.verifiedCloudQuestionCount,
      errors: b5Crosswalk.errors.length,
      handoff: handoffPath },
    byStatus: result.byStatus, totals: result.totals, errors: result.errors.length, report: target }, null, 2));
  if (!result.sourceReceiptCoverageComplete || !b5Crosswalk.sourceReceiptCoverageComplete)
    process.exitCode = 1;
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runB4();
