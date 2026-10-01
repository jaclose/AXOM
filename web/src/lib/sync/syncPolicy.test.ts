import { describe, expect, it } from "vitest";
import { SyncPushError, classifyPushFailure, failureOf, type FailureDetails } from "./syncFailure";
import {
  BLOCKED_RECHECK_MS, MAX_SNAPSHOT_BYTES, RETRY_STEPS_MS,
  restingStatus, retryDelay, uploadGap, waitBeforeAutomatic,
} from "./syncPolicy";
import { pushTimeout, readPushResult } from "./supabaseTransport";
import type { SyncMetadata } from "./syncTypes";

const NOW = Date.parse("2026-10-01T10:00:00.000Z");
const iso = (offset: number) => new Date(NOW + offset).toISOString();
const meta = (patch: Partial<SyncMetadata> = {}): SyncMetadata => ({ deviceId: "d", baseRevision: 0, pending: false, attempt: 0, ...patch });

const answers: Array<[{ code?: string; message: string }, number, Partial<FailureDetails>]> = [
  // What production answered: a refusal dressed as a server error.
  [{ code: "54000", message: "workspace snapshot storage limit reached; reduce the snapshot size before syncing" }, 500, { kind: "rejected", rejection: "storage-limit" }],
  [{ code: "54000", message: "conflict storage limit reached; resolve existing conflicts before syncing" }, 500, { kind: "rejected", rejection: "storage-limit" }],
  [{ code: "PT413", message: "snapshot payload too large" }, 413, { kind: "rejected", rejection: "too-large" }],
  [{ code: "P0001", message: "snapshot payload too large" }, 400, { kind: "rejected", rejection: "too-large" }],
  [{ message: "<html>Request Entity Too Large</html>" }, 413, { kind: "rejected", rejection: "too-large" }],
  [{ code: "P0001", message: "invalid snapshot metadata" }, 400, { kind: "rejected", rejection: "refused" }],
  [{ code: "PGRST202", message: "Could not find the function" }, 404, { kind: "rejected", rejection: "refused" }],
  [{ code: "57014", message: "canceling statement due to statement timeout" }, 500, { kind: "server" }],
  [{ code: "53300", message: "too many connections" }, 503, { kind: "server" }],
  [{ message: "<html>bad gateway</html>" }, 502, { kind: "server" }],
  [{ message: "rate limited" }, 429, { kind: "server" }],
  [{ code: "42501", message: "authentication required" }, 401, { kind: "auth" }],
  [{ code: "PGRST301", message: "JWT expired" }, 401, { kind: "auth" }],
  [{ code: "", message: "TypeError: Failed to fetch" }, 0, { kind: "network" }],
  [{ code: "", message: "AbortError: signal timed out" }, 0, { kind: "network" }],
];

describe("how a failed upload is sorted", () => {
  it.each(answers)("%j with HTTP %i", (error, status, expected) => {
    const failure = classifyPushFailure(error, status);
    expect(failure).toMatchObject({ ...expected, status });
    expect(failure.code).toBe(error.code || undefined);
    // Bookkeeping holds codes only, never what the account wrote back.
    expect(JSON.stringify(failure)).not.toContain("snapshot");
  });

  it("treats anything thrown before an answer as a network failure", () => {
    expect(failureOf(new Error("Cloud protection is not configured."))).toEqual({ kind: "network", status: 0 });
    expect(failureOf(new SyncPushError({ kind: "auth", status: 401 }, "x"))).toEqual({ kind: "auth", status: 401 });
  });

  it("never records an answer it cannot read as protected", () => {
    expect(readPushResult({ status: "accepted", revision: 7, revision_id: "r", idempotent: true, content_hash: "h" })).toEqual({ status: "accepted", revision: 7, revisionId: "r", idempotent: true, contentHash: "h" });
    expect(readPushResult({ status: "accepted", revision: "8", revision_id: "r", idempotent: false })).toMatchObject({ revision: 8, contentHash: undefined });
    expect(readPushResult({ status: "conflict", server_revision: 4, preserved_revision_id: null, preserved: false })).toEqual({ status: "conflict", serverRevision: 4, preservedRevisionId: undefined });
    for (const answer of [{ status: "rejected", reason: "too_large" }, { status: "accepted" }, { status: "accepted", revision: null }, { status: "conflict" }, null, "ok", []]) {
      expect(() => readPushResult(answer)).toThrow(SyncPushError);
    }
    try {
      readPushResult({ status: "queued" });
    } catch (error) {
      expect(failureOf(error)).toEqual({ kind: "rejected", rejection: "refused", status: 200 });
    }
  });
});

describe("how often AXOM may upload", () => {
  it("averages five megabytes a minute, with a five-minute ceiling", () => {
    expect(uploadGap(undefined)).toBe(0);
    expect(uploadGap(0)).toBe(0);
    expect(uploadGap(50_000)).toBe(600);
    expect(uploadGap(2_500_000)).toBe(30_000);
    expect(uploadGap(9_600_000)).toBe(115_200);
    expect(uploadGap(MAX_SNAPSHOT_BYTES)).toBe(168_000);
    expect(uploadGap(400_000_000)).toBe(300_000);
  });

  it("steps the retry wait up and spreads it by a fifth either way", () => {
    expect(RETRY_STEPS_MS.map((_, index) => retryDelay(index + 1, () => 0.5))).toEqual([5_000, 15_000, 45_000, 120_000, 300_000, 900_000]);
    expect(retryDelay(1, () => 0)).toBe(4_000);
    expect(retryDelay(1, () => 1)).toBe(6_000);
    expect(retryDelay(RETRY_STEPS_MS.length + 1)).toBeNull();
    for (let attempt = 1; attempt <= RETRY_STEPS_MS.length; attempt += 1) {
      const wait = retryDelay(attempt)!;
      expect(wait).toBeGreaterThanOrEqual(RETRY_STEPS_MS[attempt - 1] * 0.8);
      expect(wait).toBeLessThanOrEqual(RETRY_STEPS_MS[attempt - 1] * 1.2);
    }
  });

  it("waits for whichever is later: the stored wait or the gap after the last upload", () => {
    expect(waitBeforeAutomatic(meta(), NOW)).toBe(0);
    expect(waitBeforeAutomatic(meta({ nextAttemptAt: iso(45_000) }), NOW)).toBe(45_000);
    expect(waitBeforeAutomatic(meta({ nextAttemptAt: iso(-1) }), NOW)).toBe(0);
    expect(waitBeforeAutomatic(meta({ lastAttemptAt: iso(-10_000), lastPayloadBytes: 2_500_000 }), NOW)).toBe(20_000);
    expect(waitBeforeAutomatic(meta({ nextAttemptAt: iso(5_000), lastAttemptAt: iso(-10_000), lastPayloadBytes: 2_500_000 }), NOW)).toBe(20_000);
    // A clock that jumped, or a damaged value, can never park protection for longer than an hour.
    expect(waitBeforeAutomatic(meta({ nextAttemptAt: iso(30 * 24 * 3_600_000) }), NOW)).toBe(BLOCKED_RECHECK_MS);
    expect(waitBeforeAutomatic(meta({ nextAttemptAt: "soon" }), NOW)).toBe(0);
  });

  it("gives a slow connection time, within five minutes", () => {
    expect(pushTimeout(0)).toBe(45_000);
    expect(pushTimeout(1_000_000)).toBe(70_000);
    expect(pushTimeout(9_600_000)).toBe(285_000);
    expect(pushTimeout(14_000_000)).toBe(300_000);
  });
});

describe("what the stored state says protection is doing", () => {
  const failure = { status: 500, at: iso(0) };
  it.each([
    [meta(), "saved-locally"],
    [meta({ lastProtectedAt: iso(0) }), "protected"],
    [meta({ pending: true, lastProtectedAt: iso(0) }), "saved-locally"],
    [meta({ pending: true, attempt: 1, lastError: { ...failure, kind: "server" } }), "retrying"],
    [meta({ pending: true, attempt: RETRY_STEPS_MS.length, lastError: { ...failure, kind: "network", status: 0 } }), "retrying"],
    [meta({ pending: true, attempt: RETRY_STEPS_MS.length + 1, lastError: { ...failure, kind: "server" } }), "paused"],
    [meta({ pending: true, attempt: 1, lastError: { ...failure, kind: "rejected", rejection: "storage-limit" } }), "blocked"],
    [meta({ pending: true, attempt: 1, conflictServerRevision: 4, lastError: { ...failure, kind: "rejected", rejection: "refused" } }), "conflict"],
    // What the previous version left behind while it retried forever: no recorded failure, counter at its cap.
    [meta({ pending: true, attempt: 6, baseRevision: 71, lastProtectedAt: iso(-86_400_000) }), "saved-locally"],
  ] as const)("%j is %s", (state, status) => {
    expect(restingStatus(state)).toBe(status);
  });
});
