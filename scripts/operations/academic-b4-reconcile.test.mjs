import test from "node:test";
import assert from "node:assert/strict";
import { reconcileB4 } from "./academic-b4-reconcile.mjs";

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
