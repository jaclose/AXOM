/**
 * Read-only, fail-closed source-to-cloud Course Tracker identity audit.
 *
 * Inputs are explicit ledgers supplied by independently authorized producers.
 * The checker never derives original IDs or weeks from installed receipts.
 * It does NOT connect to Supabase or verify the truth of producer attestations.
 *
 * node scripts/operations/academic-tracker-identity.mjs --source <private-source-ledger.json> --readback <private-installed-readback.json> [--out <local-report.json>] [--strict]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function verifyTrackerIdentity({source, readback, now = new Date()} = {}) {
  const errors = [], blockers = [];
  const sha = /^[0-9a-f]{64}$/;
  const schemas = {
    source: "axom-academic-tracker-source-membership-v1",
    readback: "axom-academic-tracker-installed-readback-v1",
  };
  const integer = n => Number.isSafeInteger(n) && n >= 0;
  // Source-stated curriculum weeks are one-based; zero is a count, never Week 0.
  const validWeek = n => Number.isSafeInteger(n) && n >= 1;
  const validName = v => typeof v === "string" && v.length > 0 && v.trim() === v;
  const sourceRows = Array.isArray(source?.activities) ? source.activities : [];
  const installedRows = Array.isArray(readback?.activities) ? readback.activities : [];
  if (source?.schema !== schemas.source || !Array.isArray(source?.activities))
    errors.push("Missing or invalid source-extracted activity membership ledger.");
  if (readback?.schema !== schemas.readback || !Array.isArray(readback?.activities))
    errors.push("Missing or invalid installed-activity readback ledger.");
  if (!integer(source?.expectedActivityCount) || source.expectedActivityCount !== sourceRows.length)
    errors.push("Source membership count is missing or disagrees with enumerated original activity IDs.");
  if (!integer(readback?.reportedActivityCount) || readback.reportedActivityCount !== installedRows.length)
    errors.push("Installed readback count is missing or disagrees with enumerated cloud activity IDs.");
  if (source?.originalReadbackVerified !== true)
    blockers.push("Source activity membership requires independent original-source readback, not a cloud-derived reconstruction.");
  if (readback?.ownerAuthenticated !== true || readback?.cloudReadbackVerified !== true)
    blockers.push("Installed activity membership requires authenticated learner/owner cloud readback.");
  const nowMs = new Date(now).getTime(), receiptMs = Date.parse(readback?.observedAt ?? "");
  if (!Number.isFinite(nowMs) || !Number.isFinite(receiptMs) || receiptMs > nowMs + 5 * 60000 || nowMs - receiptMs > 60 * 60000)
    blockers.push("Installed activity readback is missing, stale, or future-dated; obtain a current authenticated receipt.");
  function index(rows, kind) {
    const out = new Map();
    for (const row of rows) {
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        errors.push(`Invalid ${kind} activity record; expected an object.`);
        continue;
      }
      const id = row.activityId;
      if (!validName(id) || typeof row.sourceSha256 !== "string" || !sha.test(row.sourceSha256)
        || !validName(row.term) || !validName(row.module)
        || !["explicit", "unassigned", ...(kind === "installed" ? ["inferred"] : [])].includes(row.weekBasis)
        || (row.weekBasis === "unassigned"
          ? (row.week !== null && row.week !== undefined)
          : !validWeek(row.week))) {
        errors.push(`Invalid ${kind} activity identity/source SHA/module/week evidence.`);
        continue;
      }
      if (kind === "installed" && row.installed !== true) {
        blockers.push("Installed activity receipt reports an uninstalled record.");
      }
      if (out.has(id)) errors.push(`Duplicate ${kind} canonical activity ID.`);
      else out.set(id, row);
    }
    return out;
  }
  const expected = index(sourceRows, "source"), actual = index(installedRows, "installed");
  let missing = 0, unexpected = 0, mismatched = 0;
  for (const [id, original] of expected) {
    const installed = actual.get(id);
    if (!installed) { missing++; continue; }
    if (original.sourceSha256 !== installed.sourceSha256 || original.term !== installed.term
      || original.module !== installed.module || original.weekBasis !== installed.weekBasis
      || (original.week ?? null) !== (installed.week ?? null)) mismatched++;
  }
  for (const id of actual.keys()) if (!expected.has(id)) unexpected++;
  if (missing) errors.push(`${missing} original source activity identities are absent from readback.`);
  if (unexpected) errors.push(`${unexpected} installed activity identities lack source membership.`);
  if (mismatched) errors.push(`${mismatched} canonical activity identities differ in source SHA, term, module, or week.`);
  const identityMatched = errors.length === 0 && blockers.filter(x => x.startsWith("Installed activity receipt")).length === 0;
  return {
    schema: "axom-academic-tracker-identity-audit-v1",
    // This is agreement between supplied ledgers, not independent proof that
    // source extraction, Supabase authorization, rights or deployment are true.
    identityMatched,
    complete: identityMatched && blockers.length === 0,
    errors, blockers,
    counts: {
      declared: sourceRows.length, readback: installedRows.length,
      validSourceIdentities: expected.size, validReadbackIdentities: actual.size,
      missing, unexpected, mismatched,
    },
    verificationBoundary: "Declared source/readback evidence only; no live Supabase, source-byte, clinical, rights, or hosted acceptance performed by this audit.",
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2), flags = new Map();
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--strict") { flags.set("strict", true); continue; }
      if (!["--source", "--readback", "--out"].includes(args[i]) || !args[i + 1])
        throw new Error("Expected --source, --readback, optional --out and --strict.");
      if (flags.has(args[i])) throw new Error("Duplicate CLI argument.");
      flags.set(args[i], args[++i]);
    }
    if (!flags.has("--source") || !flags.has("--readback"))
      throw new Error("Both source membership and authenticated readback files are required.");
    const source = JSON.parse(readFileSync(resolve(flags.get("--source")), "utf8"));
    const readback = JSON.parse(readFileSync(resolve(flags.get("--readback")), "utf8"));
    const report = verifyTrackerIdentity({ source, readback });
    if (flags.has("--out")) writeFileSync(resolve(flags.get("--out")), JSON.stringify(report, null, 2) + "\n");
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    if (flags.get("strict") && !report.complete) process.exitCode = 1;
  } catch (error) {
    process.stderr.write("Academic Tracker identity audit failed: " + (error instanceof Error ? error.message : String(error)) + "\n");
    process.exitCode = 2;
  }
}
