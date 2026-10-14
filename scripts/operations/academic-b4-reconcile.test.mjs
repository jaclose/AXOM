import test from "node:test";
import assert from "node:assert/strict";
import { attestSourceBytes, reconcileB4 } from "./academic-b4-reconcile.mjs";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const a = "a".repeat(64);
const b = "b".repeat(64);
const base = (i, key, extra = {}) => ({
  schemaVersion: 1, adapterVersion: "axom-existing-parsers-bulk-v2-20261014",
  batch: "B4", queueIndex: i, sourceKey: key, sourceSha256: key.startsWith("byte:") ? key.slice(5) : undefined,
  status: "review-partial", inventoryChecksumVerified: key.startsWith("byte:"),
  detected: 3, canonicalReadable: 2, ready: 0, reviewRequired: 1, unresolved: 1, rejected: 1,
  imageAssets: 0, accountCloudReadbackVerified: false, answerIndependentlyVerified: false,
  packagePath: "/private/packages/sha", packageQuestionsSha256: a, reasons: ["Unverified source review"], ...extra,
});
const packages = () => ({ valid: true, questions: 3, unreadable: 1 });

test("accepts independently verified B4 receipt coverage while never certifying 3 unreviewed medical questions", () => {
  const jobs = [{ canonical_input_key: "byte:" + a }];
  const r = reconcileB4(jobs, [base(0, "byte:" + a)], packages);
  assert.equal(r.sourceReceiptCoverageComplete, true, r.errors.join(";"));
  assert.equal(r.sourceIdentityCoverageComplete, true);
  assert.equal(r.academicReleaseComplete, false);
  assert.equal(r.verifiedScorableQuestionCount, 0);
  assert.equal(r.totals.canonicalReadable, 2);
  assert.equal(r.totals.detected, 3);
  assert.equal(r.totals.packagesVerified, 1);
});

test("retains path-only source exceptions as disposition evidence, never immutable SHA proof", () => {
  const key = "path:/Volumes/JDabSSD/Medical School/source1.pdf";
  const r = reconcileB4([{ canonical_input_key: key }], [base(0, key, {
    status: "unavailable", detected: 0, canonicalReadable: 0, reviewRequired: 0, unresolved: 0, rejected: 0,
    packagePath: undefined, packageQuestionsSha256: undefined,
  })]);
  assert.equal(r.sourceReceiptCoverageComplete, true, r.errors.join(";"));
  assert.equal(r.sourceIdentityCoverageComplete, false);
  assert.equal(r.pathOnlySourceJobs, 1);
  assert.equal(r.totals.missingSources, 1);
});

test("explicit old prepared receipt without byte rehash is an unresolved evidence gap, not a fabricated success", () => {
  const r = reconcileB4([{ canonical_input_key: "byte:" + a }],
    [base(0, "byte:" + a, { inventoryChecksumVerified: undefined })], packages);
  assert.equal(r.sourceReceiptCoverageComplete, true, r.errors.join(";"));
  assert.equal(r.sourceIdentityCoverageComplete, false);
  assert.equal(r.totals.unverifiedByteProofSources, 1);
  assert.equal(r.academicReleaseComplete, false);
});

test("forged answer/scored readiness and invalid question conservation are rejected", () => {
  const jobs = [{ canonical_input_key: "byte:" + a }];
  for (const changed of [
    { ready: 1 }, { accountCloudReadbackVerified: true },
    { answerIndependentlyVerified: true }, { canonicalReadable: 3 },
    { detected: 4 }, { rejected: 0 },
  ]) {
    const r = reconcileB4(jobs, [base(0, "byte:" + a, changed)], packages);
    assert.equal(r.sourceReceiptCoverageComplete, false, JSON.stringify(changed));
    assert.ok(r.errors.length > 0);
  }
});

test("detects mismatched original SHA, missing or duplicate receipts, and changed file metadata", () => {
  const jobs = [{ canonical_input_key: "byte:" + a }, { canonical_input_key: "byte:" + b }];
  const first = base(0, "byte:" + a);
  assert.equal(reconcileB4(jobs, [first], packages).missingReceipts, 1);
  assert.equal(reconcileB4(jobs, [first, first], packages).sourceReceiptCoverageComplete, false);
  assert.equal(reconcileB4([jobs[0]], [base(0, "byte:" + a, { sourceSha256: b })], packages)
    .sourceReceiptCoverageComplete, false);
  assert.equal(reconcileB4([jobs[0]], [first], () => ({ valid: false }))
    .sourceReceiptCoverageComplete, false);
});

test("review-partial packages preserve all detected rows, even rejected parser candidates", () => {
  const jobs = [{ canonical_input_key: "byte:" + a }];
  const row = base(0, "byte:" + a, { detected: 14, canonicalReadable: 9,
    reviewRequired: 0, unresolved: 9, rejected: 5 });
  const okay = reconcileB4(jobs, [row], () => ({ valid: true, questions: 14, unreadable: 5 }));
  assert.equal(okay.sourceReceiptCoverageComplete, true, okay.errors.join(";"));
  const truncated = reconcileB4(jobs, [row], () => ({ valid: true, questions: 9, unreadable: 5 }));
  assert.equal(truncated.sourceReceiptCoverageComplete, false);
});

test("orphan receipts from an older processing queue remain explicit, including prepared review-only packages", () => {
  const jobs = [{ canonical_input_key: "byte:" + a }];
  const original = base(0, "byte:" + a);
  const old = base(0, "byte:" + b);
  const r = reconcileB4(jobs, [original, old], packages);
  assert.equal(r.sourceReceiptCoverageComplete, false);
  assert.equal(r.orphanReceipts, 1);
  assert.equal(r.orphanPreparedReceipts, 1);
  assert.equal(r.receivedSourceDispositions, 1);
  assert.equal(r.totals.detected, 3);
  assert.equal(r.verifiedCloudQuestionCount, 0);
  assert.ok(r.errors.some(message => message.includes("Orphan B4 source receipt")));
});

test("optional live source SHA recheck streams exact original bytes without altering questions or cloud state", async () => {
  const root = mkdtempSync(join(tmpdir(), "axom-b4-hash-"));
  try {
    const bytes = Buffer.from("%PDF-1.4\nSynthetic placeholder for checksum audit\n");
    const sourceFile = join(root, "synthetic.pdf");
    writeFileSync(sourceFile, bytes);
    const actual = createHash("sha256").update(bytes).digest("hex");
    const original = base(0, "byte:" + actual, {
      originalPath: sourceFile, sourceBytes: bytes.length,
      inventoryChecksumVerified: undefined, sourceIndependentlyVerified: false,
    });
    const audit = await attestSourceBytes([original]);
    assert.equal(audit.failures.length, 0, JSON.stringify(audit.failures));
    assert.equal(audit.inspected, 1);
    assert.equal(audit.bytesRead, bytes.length);
    assert.ok(audit.proven.has("byte:" + actual));
    const result = reconcileB4([{ canonical_input_key: "byte:" + actual }],
      [original], packages, audit.proven);
    assert.equal(result.sourceReceiptCoverageComplete, true);
    assert.equal(result.totals.unverifiedByteProofSources, 0);
    assert.equal(result.verifiedScorableQuestionCount, 0);
    writeFileSync(sourceFile, "%PDF-1.4\nAltered original\n");
    const invalid = await attestSourceBytes([original]);
    assert.equal(invalid.proven.size, 0);
    assert.ok(invalid.failures.length > 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
