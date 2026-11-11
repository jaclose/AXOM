import test from "node:test";
import assert from "node:assert/strict";
import { verifyTrackerIdentity } from "./academic-tracker-identity.mjs";

const A = "a".repeat(64), B = "b".repeat(64), C = "c".repeat(64);
const NOW = "2026-11-11T20:50:00.000Z";
const first = () => ({
  activityId: "synthetic:T1:FTM:W2:1", sourceSha256: A,
  term: "T1", module: "FTM", weekBasis: "explicit", week: 2,
});
const second = () => ({
  activityId: "synthetic:T1:FTM:W2:2", sourceSha256: B,
  term: "T1", module: "FTM", weekBasis: "explicit", week: 2,
});
function fixture() {
  const source = {
    schema: "axom-academic-tracker-source-membership-v1",
    expectedActivityCount: 2, originalReadbackVerified: true,
    activities: [first(), second()],
  };
  const readback = {
    schema: "axom-academic-tracker-installed-readback-v1",
    reportedActivityCount: 2, ownerAuthenticated: true, cloudReadbackVerified: true,
    observedAt: NOW,
    activities: source.activities.map(activity => ({ ...activity, installed: true })),
  };
  return { source, readback };
}
const audit = ({ source, readback }) => verifyTrackerIdentity({ source, readback, now: NOW });
const incomplete = (f, description) => {
  const result = audit(f);
  assert.equal(result.complete, false, description + ": " + JSON.stringify(result));
  return result;
};

test("exact original IDs, source hashes, source-week filing and owner readback agree", () => {
  const result = audit(fixture());
  assert.equal(result.complete, true, JSON.stringify(result));
  assert.equal(result.identityMatched, true);
  assert.deepEqual(result.counts, {
    declared: 2, readback: 2, validSourceIdentities: 2, validReadbackIdentities: 2,
    missing: 0, unexpected: 0, mismatched: 0,
  });
  assert.match(result.verificationBoundary, /no live Supabase/);
});

test("same-count foreign ID substitution fails rather than trusting week cardinality", () => {
  const f = fixture();
  f.readback.activities[1].activityId = "synthetic:FOREIGN:SAME-WEEK";
  const result = incomplete(f, "Foreign activity cannot substitute a same-week source member");
  assert.equal(result.counts.missing, 1);
  assert.equal(result.counts.unexpected, 1);
});

test("same canonical ID from a different source SHA is held", () => {
  const f = fixture();
  f.readback.activities[1].sourceSha256 = C;
  assert.equal(incomplete(f, "Source collision").counts.mismatched, 1);
});

test("same count and IDs with swapped week or weekBasis are not verified", () => {
  for (const changed of [{ week: 3 }, { weekBasis: "inferred" }, { weekBasis: "unassigned", week: null }]) {
    const f = fixture();
    Object.assign(f.readback.activities[0], changed);
    assert.equal(incomplete(f, "Refiled activity").counts.mismatched, 1);
  }
});

test("course module and term mismatches cannot be hidden by equal counts", () => {
  for (const changed of [{ module: "CPR" }, { term: "T2" }]) {
    const f = fixture();
    Object.assign(f.readback.activities[0], changed);
    assert.equal(incomplete(f, "Scope mismatch").counts.mismatched, 1);
  }
});

test("duplicate source or installed IDs are errors, not deduplicated successes", () => {
  for (const ledger of ["source", "readback"]) {
    const f = fixture();
    f[ledger].activities[1].activityId = f[ledger].activities[0].activityId;
    assert.ok(incomplete(f, "Duplicate IDs").errors.some(x => x.includes("Duplicate")));
  }
});

test("missing and incorrect producer denominators never certify zero or two", () => {
  for (const ledger of ["source", "readback"]) {
    const countKey = ledger === "source" ? "expectedActivityCount" : "reportedActivityCount";
    for (const invalid of [undefined, null, "2", -1, 1, 3, 1.5]) {
      const f = fixture();
      f[ledger][countKey] = invalid;
      assert.ok(incomplete(f, "Bad denominator").errors.some(x => x.includes("count")));
    }
  }
  const f = fixture();
  f.source.activities = [];
  f.readback.activities = [];
  f.source.expectedActivityCount = 0;
  f.readback.reportedActivityCount = 0;
  assert.equal(audit(f).complete, true, "Explicit independently attested empty scope is valid.");
});

test("original proof and authenticated cloud readback are distinct required attestations", () => {
  const f = fixture();
  f.source.originalReadbackVerified = false;
  assert.ok(incomplete(f, "Source extraction proof").blockers.some(x => x.includes("original-source")));
  const g = fixture();
  g.readback.ownerAuthenticated = false;
  assert.ok(incomplete(g, "Owner auth").blockers.some(x => x.includes("authenticated")));
  const h = fixture();
  h.readback.cloudReadbackVerified = false;
  assert.ok(incomplete(h, "Cloud readback").blockers.some(x => x.includes("authenticated")));
});

test("no missing or stale/future-dated readback may certify identity", () => {
  for (const observedAt of [undefined, null, "bad", "2026-11-11T19:00:00.000Z", "2026-11-11T21:00:00.000Z"]) {
    const f = fixture();
    f.readback.observedAt = observedAt;
    assert.ok(incomplete(f, "Readback freshness").blockers.some(x => x.includes("stale")));
  }
});

test("source-ledger may preserve genuinely unassigned original week without inventing filing", () => {
  const f = fixture();
  for (const row of [f.source.activities[1], f.readback.activities[1]]) {
    row.weekBasis = "unassigned";
    delete row.week;
  }
  assert.equal(audit(f).complete, true);
  f.readback.activities[1].weekBasis = "inferred";
  f.readback.activities[1].week = 2;
  assert.equal(incomplete(f, "Inferred is not original").counts.mismatched, 1);
});

test("malformed source weeks and non-source-based inferred originals fail closed", () => {
  for (const changed of [{ week: "2" }, { week: -1 }, { week: 2.5 }, { weekBasis: "inferred" },
    { weekBasis: "unassigned", week: 2 }]) {
    const f = fixture();
    Object.assign(f.source.activities[0], changed);
    assert.ok(incomplete(f, "Malformed original filing").errors.some(x => x.includes("Invalid source")));
  }
});

test("invalid source SHAs, absent IDs and malformed rows cannot disappear", () => {
  for (const changed of [{ sourceSha256: "invalid" }, { sourceSha256: null },
    { activityId: "" }, { activityId: " space " }]) {
    const f = fixture();
    Object.assign(f.source.activities[0], changed);
    assert.ok(incomplete(f, "Malformed source").errors.some(x => x.includes("Invalid source")));
  }
  for (const bad of [null, [], 42]) {
    const f = fixture();
    f.readback.activities[1] = bad;
    assert.ok(incomplete(f, "Malformed installed row").errors.some(x => x.includes("Invalid installed")));
  }
});

test("uninstalled cloud activity cannot pass even with identical IDs and scope", () => {
  const f = fixture();
  f.readback.activities[1].installed = false;
  assert.ok(incomplete(f, "Uninstalled row").blockers.some(x => x.includes("uninstalled")));
});

test("no IDs or source paths leak in serialized audit output", () => {
  const f = fixture();
  f.readback.activities[1].activityId = "synthetic:PRIVATE-ID-NOT-FOR-REPORT";
  const serialized = JSON.stringify(incomplete(f, "Sanitized report"));
  assert.equal(serialized.includes("PRIVATE-ID-NOT-FOR-REPORT"), false);
  assert.equal(serialized.includes(first().activityId), false);
  assert.equal(serialized.includes(A), false);
});

test("absent source/readback ledgers are coverage failures, not empty fixtures", () => {
  const r = verifyTrackerIdentity({ now: NOW });
  assert.equal(r.complete, false);
  assert.ok(r.errors.length > 0);
  assert.ok(r.blockers.length > 0);
});
