#!/usr/bin/env node
// Usage from web/:
// node src/lib/question-content/operations/bulk-prepare.mjs --batch B4 --offset 0 --limit 40
// --dry-run inventories only; --retry-errors reattempts non-successful jobs.
// EXPLICITLY PRIVATE and LOCAL. No Supabase, network upload, source-file
// rewriting, new parser/database/schema, Git staging, or auto-verified keys.
import { createServer } from "vite";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, stat, open, rename, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareCorpusSource, SUPPORTED_CORPUS_EXTENSIONS } from "./sourceAdapters.mjs";
import { queueJobs, queueWindow, inventorySha, recoveredSourcePath, corpusExtension,
  inputSignatureProblem, dispositionCounts, receiptConsistent } from "./bulkQueue.ts";

const repo = fileURLToPath(new URL("../../../../../", import.meta.url));
const webRoot = join(repo, "web");
const artifacts = join(repo, "artifacts/qbank-6way-20261014");
const output = join(artifacts, "role-2-corpus-v2");
const ADAPTER_VERSION = "axom-existing-parsers-bulk-v2-20261014";
const MAX_FILE_BYTES = 128 * 1024 * 1024;
const args = process.argv.slice(2);
const argument = (key, fallback) => {
  const index = args.indexOf(key);
  return index < 0 ? fallback : args[index + 1];
};
const batch = argument("--batch", "B4");
const offset = Number(argument("--offset", "0"));
const limit = Number(argument("--limit", "40"));
const indicesArgument = argument("--indices", null);
const dryRun = args.includes("--dry-run");
const force = args.includes("--force");
if (args.includes("--help")) {
  console.log("AXOM private source preparer: --batch B4 --offset 0 --limit 40 | --indices 475,1256 [--dry-run] [--force].");
  console.log("No account cloud writes. Removable SSD originals must be mounted. Output is Git-ignored.");
  process.exit(0);
}
const loadJson = async path => JSON.parse(await readFile(path, "utf8"));
const writeAtomic = async (path, value) => {
  await mkdir(dirname(path), { recursive: true });
  const tmp = path + ".tmp-" + process.pid;
  await writeFile(tmp, typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n", { flag: "w" });
  await rename(tmp, path);
};
const hashBuffer = buffer => createHash("sha256").update(buffer).digest("hex");
const stablePathId = job => {
  const raw = job.canonical_input_key || job.source_path;
  return createHash("sha256").update(raw).digest("hex").slice(0, 24);
};
const safeAssetName = name => typeof name === "string" && /^[a-z0-9][a-z0-9._-]{0,200}$/i.test(name)
  && !name.includes("..") && name !== ".";
const stringifyIssue = error => {
  const detail = error instanceof Error ? error.message : String(error);
  return detail.slice(0, 700);
};
const now = () => new Date().toISOString();
const emit = message => console.log(JSON.stringify(message));

let vite, services, cancelled = false;
process.on("SIGINT", () => { cancelled = true; console.error("Stopping after the current source; current checkpoint remains intact."); });
process.on("SIGTERM", () => { cancelled = true; console.error("Stopping after the current source; current checkpoint remains intact."); });

async function tools() {
  if (services) return services;
  vite = await createServer({
    root: webRoot, server: { middlewareMode: true, hmr: false },
    appType: "custom", optimizeDeps: { noDiscovery: true },
  });
  const [
    pdf, docx, text, fromDrafts, input, pack, assessment, native, zipIndex, zipInput
  ] = await Promise.all([
    vite.ssrLoadModule("/src/lib/question-content/batchPreparePdf.ts"),
    vite.ssrLoadModule("/src/lib/question-content/docx/extractDocxBank.ts"),
    vite.ssrLoadModule("/src/lib/question-content/batchPrepareText.ts"),
    vite.ssrLoadModule("/src/lib/question-content/fromDrafts.ts"),
    vite.ssrLoadModule("/src/lib/questionImport.ts"),
    vite.ssrLoadModule("/src/lib/question-content/packageJson.ts"),
    vite.ssrLoadModule("/src/lib/question-content/assessBank.ts"),
    vite.ssrLoadModule("/src/lib/privateLibrary/install.ts"),
    vite.ssrLoadModule("/src/lib/privateLibrary/zipIndex.ts"),
    vite.ssrLoadModule("/src/lib/privateLibrary/fileInput.ts"),
  ]);
  services = { ...pdf, ...docx, ...text, ...fromDrafts, ...input, ...pack, ...assessment, ...native, ...zipIndex, ...zipInput };
  return services;
}
async function preparedPackage(sourcePath, sourceBytes, digest, extension) {
  const api = await tools();
  const processed = await prepareCorpusSource(sourcePath, sourceBytes, digest, extension, api);
  const manifest = api.serializeManifest(processed.pkg.manifest);
  const questions = api.serializeQuestionsFile(processed.pkg);
  const round = api.parsePackage(manifest, questions);
  const assets = await Promise.all(processed.files.map(async file => ({
    name: file.name,
    bytes: new Uint8Array(await file.arrayBuffer()),
  })));
  if (assets.some(asset => !safeAssetName(asset.name)))
    throw new Error("Source contains an invalid generated asset path; no question was installed.");
  const assetNames = assets.map(a => a.name);
  if (assetNames.length !== new Set(assetNames).size)
    throw new Error("The same generated asset filename occurs twice; preserve the source for review.");
  const checked = api.readPreparedBank({
    pkg: processed.pkg, issues: processed.issues,
    sourceText: processed.sourceText, sourceBytes: processed.sourceBytes,
    notes: processed.notes,
    unreadableQuestions: Math.max(0, processed.detected - (round.package?.questions.length ?? 0)),
  });
  const assessment = api.assessBank(checked.pkg, checked.issues, assets.map(asset => ({ name: asset.name })));
  const readable = checked.pkg.questions.length;
  const rejected = Math.max(0, processed.detected - readable);
  const ready = assessment.counts.ready;
  if (ready) throw new Error("Headless academic source import unexpectedly produced scored-practice-ready records; manual source review is required.");
  const reviewRequired = assessment.counts["needs-review"];
  const unresolved = assessment.counts.unresolved;
  if (reviewRequired + unresolved + rejected !== processed.detected)
    throw new Error("Parser accounting mismatch. No file was marked prepared.");
  for (const asset of assets) {
    const expected = processed.pkg.questions.flatMap(q => q.assets).find(item => item.filename === asset.name)?.checksum;
    const actual = "sha256:" + hashBuffer(asset.bytes);
    if (!expected || expected !== actual) throw new Error("Generated source image checksum mismatch; retain original for review.");
  }
  return { processed, manifest, questions, assets, checked,
    readable, rejected, ready, reviewRequired, unresolved };
}
async function storePackage(digest, outcome) {
  const parent = join(output, "packages");
  await mkdir(parent, { recursive: true });
  const path = join(parent, digest);
  // Never reuse an older package simply because its directory exists. An
  // interrupted or corrupted receipt must create a new verified revision.
  // Preserve previous private revisions for diffing/recovery.
  const destination = existsSync(path) ? path + "-revision-" + Date.now() : path;
  const temporary = join(parent, ".preparing-" + digest + "-" + process.pid);
  await mkdir(temporary, { recursive: true });
  try {
    await writeFile(join(temporary, "manifest.json"), outcome.manifest);
    await writeFile(join(temporary, "questions.json"), outcome.questions);
    await writeFile(join(temporary, "prepared-bank.json"), JSON.stringify({
      pkg: outcome.processed.pkg,
      issues: outcome.checked.issues,
      sourceText: outcome.processed.sourceText,
      sourceBytes: outcome.processed.sourceBytes,
      notes: outcome.processed.notes,
      unreadableQuestions: outcome.rejected,
    }));
    if (outcome.assets.length) {
      await mkdir(join(temporary, "assets"));
      for (const asset of outcome.assets) await writeFile(join(temporary, "assets", asset.name), asset.bytes);
    }
    await rename(temporary, destination);
    return destination;
  } catch (error) {
    await rm(temporary, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

async function run() {
  const priority = await loadJson(join(artifacts, "agent-2-priority-batches.json"));
  const all = await loadJson(join(artifacts, "agent-2-import-inputs-deduplicated.json"));
  const jobs = queueJobs(priority, all, batch);
  const selectedIndices = indicesArgument === null ? null : indicesArgument.split(",").map(value => Number(value.trim()));
  if (selectedIndices && (selectedIndices.length < 1 || selectedIndices.length > 200
    || new Set(selectedIndices).size !== selectedIndices.length
    || selectedIndices.some(index => !Number.isSafeInteger(index) || index < 0 || index >= jobs.length)))
    throw new Error("--indices must contain 1–200 unique, valid source-job positions.");
  const window = selectedIndices ? selectedIndices.map(index => jobs[index]) : queueWindow(jobs, offset, limit);
  const inventory = { batch, queueItems: jobs.length, requestedWindow: window.length,
    offset, sourceCopiesMovedOrMissing: 0, sourceFilesExisting: 0, byExtension: {} };
  for (const job of window) {
    const extension = corpusExtension(job.source_path);
    inventory.byExtension[extension] = (inventory.byExtension[extension] ?? 0) + 1;
    if (recoveredSourcePath(job, existsSync)) inventory.sourceFilesExisting++;
    else inventory.sourceCopiesMovedOrMissing++;
  }
  if (dryRun) {
    emit({ operation: "dry-run", ...inventory, note: "No sources parsed, no local packages or cloud writes." });
    return;
  }
  await mkdir(output, { recursive: true });
  const lockPath = join(output, ".bulk-preparer.lock");
  let lock;
  try {
    lock = await open(lockPath, "wx");
  } catch {
    throw new Error("An academic import processor lock exists. Do not start overlapping corpus writes; inspect " + lockPath);
  }
  const runId = selectedIndices ? batch + "-indices-" + createHash("sha256").update(selectedIndices.join(",")).digest("hex").slice(0, 14)
    : batch + "-" + offset + "-" + limit;
  const receipts = [], startedAt = Date.now();
  const maxRunBytes = Math.min(2 * 1024 ** 3, Math.max(64 * 1024 ** 2,
    Number(argument("--budget-mb", "512")) * 1024 * 1024));
  let processedBytes = 0, skippedExisting = 0, stoppedByBudget = false;
  try {
    for (const [relativeIndex, job] of window.entries()) {
      if (cancelled) break;
      const queueIndex = selectedIndices ? selectedIndices[relativeIndex] : offset + relativeIndex;
      const sourceKey = job.canonical_input_key || "path:" + stablePathId(job);
      const keyId = stablePathId(job);
      const receiptPath = join(output, "results", batch + "-" + keyId + ".json");
      const originalPath = recoveredSourcePath(job, existsSync);
      const extension = corpusExtension(originalPath ?? job.source_path);
      const base = {
        schemaVersion: 1, adapterVersion: ADAPTER_VERSION,
        batch, queueIndex, sourceKey, inputExtension: extension,
        sourcePath: job.source_path,
        detected: 0, canonicalReadable: 0, ready: 0, reviewRequired: 0,
        unresolved: 0, rejected: 0, imageAssets: 0,
        inventoryChecksumVerified: false,
        answerIndependentlyVerified: false,
        accountCloudReadbackVerified: false,
        reasons: [], createdAt: now(),
      };
      let existing;
      if (existsSync(receiptPath)) {
        try { existing = await loadJson(receiptPath); } catch {
          emit({ warning: "Prior receipt unreadable, retrying source", batch, queueIndex });
        }
      }
      if (!originalPath) {
        const receipt = { ...base, sourceSha256: inventorySha(job),
          status: "unavailable",
          reasons: ["Original path and all known equivalent locations are inaccessible. Reconnect the source SSD and resume."],
        };
        if (!receiptConsistent(receipt)) throw new Error("Invalid unavailable source receipt.");
        await writeAtomic(receiptPath, receipt); receipts.push(receipt);
        emit({ batch, at: queueIndex + 1, status: receipt.status });
        continue;
      }
      let receipt;
      try {
        const metadata = await stat(originalPath);
        if (!metadata.isFile()) throw new Error("Source location is not a regular file.");
        if (metadata.size > MAX_FILE_BYTES) {
          receipt = { ...base, originalPath, sourceBytes: metadata.size,
            sourceSha256: inventorySha(job), status: "source-over-limit",
            reasons: ["Academic original exceeds 128 MB; retain it and split into smaller bounded sources or request an approved large-source transport."],
          };
        } else if (processedBytes + metadata.size > maxRunBytes) {
          stoppedByBudget = true;
          emit({ event: "budget-paused", batch, nextIndex: queueIndex,
            budgetMB: Math.round(maxRunBytes / 1024 ** 2),
            instruction: "Resume the same batch window with a new --offset." });
          break;
        } else {
          processedBytes += metadata.size;
          const bytes = new Uint8Array(await readFile(originalPath));
          const actualSha = hashBuffer(bytes);
          const expectedSha = inventorySha(job);
          const checked = expectedSha === undefined ? false : actualSha === expectedSha;
          if (expectedSha && !checked) {
            receipt = { ...base, originalPath, sourceBytes: bytes.byteLength,
              sourceSha256: actualSha, status: "checksum-mismatch",
              reasons: ["Current source SHA-256 differs from the inventory. No extraction was accepted; rerun Agent 1 source inventory."],
            };
          } else if (inputSignatureProblem(bytes, extension, basename(originalPath))) {
            receipt = { ...base, originalPath, sourceBytes: bytes.byteLength,
              sourceSha256: actualSha, inventoryChecksumVerified: checked,
              status: "unsupported-format",
              reasons: [inputSignatureProblem(bytes, extension, basename(originalPath))],
            };
          } else if (!SUPPORTED_CORPUS_EXTENSIONS.has(extension)) {
            receipt = { ...base, originalPath, sourceBytes: bytes.byteLength,
              sourceSha256: actualSha, inventoryChecksumVerified: checked,
              status: "unsupported-format",
              reasons: ["Unsupported original file type. Convert slide decks to PDF with all figures retained, then import the new source as a separate revision."],
            };
          } else if (
            !force && existing?.adapterVersion === ADAPTER_VERSION
            && existing?.sourceSha256 === actualSha
            && ["review-prepared", "review-partial"].includes(existing.status)
            && existing.packagePath && existsSync(join(existing.packagePath, "questions.json"))
            && existing.packageQuestionsSha256 === hashBuffer(await readFile(join(existing.packagePath, "questions.json")))
            && receiptConsistent(existing)
          ) {
            receipt = { ...existing, originalPath, inventoryChecksumVerified: checked };
            skippedExisting++;
          } else {
            const outcome = await preparedPackage(originalPath, bytes, actualSha, extension);
            const detected = outcome.processed.detected;
            const status = detected === 0 ? "no-questions"
              : outcome.rejected > 0 ? "review-partial" : "review-prepared";
            const packagePath = detected > 0 ? await storePackage(actualSha, outcome) : undefined;
            receipt = {
              ...base, originalPath, sourceBytes: bytes.byteLength,
              sourceSha256: actualSha, inventoryChecksumVerified: checked,
              status, detected, canonicalReadable: outcome.readable,
              ready: 0, reviewRequired: outcome.reviewRequired,
              unresolved: outcome.unresolved, rejected: outcome.rejected,
              imageAssets: outcome.assets.length,
              ocrApplied: Boolean(outcome.processed.ocrApplied),
              sourcePages: outcome.processed.sourcePages,
              pageMapped: outcome.processed.pageMapped,
              ...(packagePath ? {
                packagePath,
                packageQuestionsSha256: hashBuffer(Buffer.from(outcome.questions, "utf8")),
              } : {}),
              reasons: detected === 0
                ? ["Parser found no credible questions. Original retained for visual/manual inspection or optional OCR."]
                : [
                    "Locally prepared review candidates only; no account write, source answer verification or community publication.",
                    ...(outcome.rejected ? [outcome.rejected + " candidate rows failed canonical structure checks."] : []),
                    ...outcome.processed.notes.slice(0, 5),
                  ],
            };
          }
        }
      } catch (error) {
        receipt = { ...base, originalPath, sourceSha256: inventorySha(job),
          status: "extraction-error", reasons: [stringifyIssue(error)] };
      }
      if (!receiptConsistent(receipt)) {
        receipt = { ...base, originalPath, sourceSha256: inventorySha(job),
          status: "extraction-error",
          reasons: ["AXOM conservation checks failed for this source. Original left untouched; manual review required."],
        };
      }
      await writeAtomic(receiptPath, receipt);
      receipts.push(receipt);
      emit({ batch, at: queueIndex + 1, status: receipt.status,
        candidates: receipt.detected, review: receipt.reviewRequired,
        unresolved: receipt.unresolved, rejected: receipt.rejected,
        media: receipt.imageAssets, shaPrefix: receipt.sourceSha256?.slice(0, 10) });
    }
  } finally {
    await vite?.close().catch(() => {});
    await lock.close().catch(() => {});
    await rm(lockPath, { force: true }).catch(() => {});
  }
  const totals = dispositionCounts(receipts);
  const report = { schemaVersion: 1, adapterVersion: ADAPTER_VERSION, batch, runId,
    selected: window.length, audited: receipts.length, skippedExisting,
    sourceBytesRead: processedBytes, stoppedByBudget, cancelled,
    durationMs: Date.now() - startedAt, completedAt: now(),
    ...totals, noCloudPersistencePerformed: true };
  await writeAtomic(join(output, "reports", runId + ".json"), report);
  emit({ event: "run-summary", ...report });
}
run().catch(async error => {
  try { await vite?.close(); }
  catch (cleanupError) { console.error(JSON.stringify({ event: "vite-shutdown-warning", detail: stringifyIssue(cleanupError) })); }
  console.error(JSON.stringify({ error: stringifyIssue(error), status: "failed-without-full-completion" }));
  process.exitCode = 1;
});
