// @vitest-environment node
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accountOperationClient } from "../account/supabase";
import { makeSeed } from "../seed";
import { saveCloudMediaIndex } from "./cloudMediaCache";
import { readSyncBaseline, saveSyncBaseline } from "./syncBaseline";
import { pushTimeout, SupabaseSyncTransport } from "./supabaseTransport";
import type { SnapshotEnvelope } from "./syncTypes";

vi.mock("../account/supabase", () => ({ accountOperationClient: vi.fn(), loadSupabase: vi.fn() }));
vi.mock("./syncBaseline", () => ({ readSyncBaseline: vi.fn(async () => undefined), saveSyncBaseline: vi.fn(async () => undefined) }));
vi.mock("./cloudContent", async original => ({ ...(await original<object>()), uploadCloudContent: vi.fn(async () => undefined) }));
vi.mock("./cloudMedia", async original => ({
  ...(await original<object>()), findMissingWorkspaceMedia: vi.fn(async () => []), uploadCloudMedia: vi.fn(async () => []),
}));
vi.mock("./cloudOriginals", () => ({ ORIGINALS_BUCKET: "workspace-originals", uploadCloudOriginals: vi.fn(async () => undefined) }));
vi.mock("./cloudMediaCache", () => ({ saveCloudMediaIndex: vi.fn(async () => undefined) }));

const owner = "11111111-1111-4111-8111-111111111111";
const hash = "a".repeat(64);
const accepted = { data: { status: "accepted", revision: 72, revision_id: "revision-id", content_hash: hash, idempotent: true }, error: null, status: 200 };

function fixture(rpc: ReturnType<typeof vi.fn>) {
  let accountChanged = false;
  const assertCurrent = vi.fn(async () => {
    if (accountChanged) throw new Error("The signed-in account changed. This operation was stopped.");
  });
  const chain = {
    select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(async () => ({ data: null, error: null, status: 200 })),
    single: vi.fn(async (): Promise<{
      data: { id: string; revision: number; content_hash: string; reason: string } | null;
      error: { message: string } | null; status: number;
    }> => ({
      data: { id: "revision-id", revision: 72, content_hash: hash, reason: "manual" }, error: null, status: 200,
    })),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  const client = { from: vi.fn(() => chain), rpc } as unknown as SupabaseClient;
  vi.mocked(accountOperationClient).mockResolvedValue({ client, userId: owner, assertCurrent,
    resumable: { endpoint: "https://example.invalid/storage/v1/upload/resumable", headers: { authorization: "fixture", apikey: "fixture" } } });
  const state = makeSeed();
  const text = JSON.stringify(state);
  const envelope: SnapshotEnvelope = {
    accountUserId: owner, schemaVersion: 35, contentHash: hash, payload: state,
    packed: { _axomCloudFormat: 2, _axomDeltaFormat: 1, _axomHashFormat: 2, content: text, expandedBytes: text.length, media: [], sources: [] },
    contentObjects: [], payloadBytes: text.length, deviceId: "fixture-device", baseRevision: 71,
    idempotencyKey: "fixture-stable-retry-key", reason: "manual",
  };
  return { envelope, rpc, chain, changeAccount: () => { accountChanged = true; } };
}

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

describe("cloud RPC abort and receipt boundaries", () => {
  it("does not mark an interrupted upload protected and safely replays the identical idempotency key", async () => {
    const controller = new AbortController();
    const requestedBudgets: number[] = [];
    vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => {
      requestedBudgets.push(ms);
      return controller.signal;
    });
    let first = true;
    const rpc = vi.fn((_name: string, _args: Record<string, unknown>) => ({
      abortSignal: (signal: AbortSignal) => {
        if (!first) return Promise.resolve(accepted);
        first = false;
        return new Promise(resolve => signal.addEventListener("abort", () =>
          resolve({ data: null, error: { message: "The request was aborted" }, status: 0 }), { once: true }));
      },
    }));
    const x = fixture(rpc);
    const pending = new SupabaseSyncTransport().push(x.envelope);
    await vi.waitFor(() => expect(requestedBudgets).toHaveLength(1));
    expect(requestedBudgets[0]).toBeGreaterThanOrEqual(75_000);
    controller.abort(new DOMException("deadline exceeded", "TimeoutError"));
    await expect(pending).rejects.toMatchObject({ failure: { kind: "network", status: 0, phase: "revision" } });
    expect(x.chain.single).not.toHaveBeenCalled();
    expect(saveCloudMediaIndex).not.toHaveBeenCalled();
    expect(saveSyncBaseline).not.toHaveBeenCalled();
    await expect(new SupabaseSyncTransport().push(x.envelope)).resolves.toMatchObject({
      status: "accepted", revision: 72, contentHash: hash,
    });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[0][1].p_idempotency_key).toBe("fixture-stable-retry-key");
    expect(rpc.mock.calls[1][1].p_idempotency_key).toBe(rpc.mock.calls[0][1].p_idempotency_key);
    expect(x.chain.single).toHaveBeenCalledOnce();
    expect(saveSyncBaseline).toHaveBeenCalledOnce();
  });

  it("bounds a legacy unabortable RPC and ignores even a late accepted reply", async () => {
    let finish!: (response: typeof accepted) => void;
    const rpc = vi.fn(() => new Promise<typeof accepted>(resolve => { finish = resolve; }));
    const x = fixture(rpc);
    vi.useFakeTimers();
    try {
      const pending = new SupabaseSyncTransport().push(x.envelope);
      // Let the async preflight reach the RPC and schedule the deadline.
      const rejection = expect(pending).rejects.toMatchObject({
        failure: { kind: "network", status: 0, phase: "revision", reason: "request-timeout" },
      });
      await vi.waitFor(() => expect(rpc).toHaveBeenCalledOnce());
      await vi.advanceTimersByTimeAsync(76_000);
      await rejection;
      finish(accepted);
      await Promise.resolve();
      expect(x.chain.single).not.toHaveBeenCalled();
      expect(saveCloudMediaIndex).not.toHaveBeenCalled();
      expect(saveSyncBaseline).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it("budgets each delta-to-full fallback independently while counting both transmitted bodies", async () => {
    const budgets: number[] = [];
    vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => {
      budgets.push(ms);
      return new AbortController().signal;
    });
    const rpc = vi.fn((name: string, _args: Record<string, unknown>) => ({
      abortSignal: () => Promise.resolve(name === "push_workspace_delta_v2"
        ? { data: null, error: { code: "PT428", message: "stale delta baseline" }, status: 428 }
        : accepted),
    }));
    const x = fixture(rpc);
    const before = structuredClone(x.envelope.packed!);
    x.envelope.packed!.content = JSON.stringify({ ...JSON.parse(before.content), payloadPadding: "x".repeat(120_000) });
    x.envelope.payloadBytes = 200_000;
    vi.mocked(readSyncBaseline).mockResolvedValueOnce({ revision: 71, contentHash: hash, packed: before });
    const result = await new SupabaseSyncTransport().push(x.envelope);
    expect(result.status).toBe("accepted");
    expect(rpc.mock.calls.map(call => call[0])).toEqual(["push_workspace_delta_v2", "push_workspace_revision_v2"]);
    const bytes = rpc.mock.calls.map(call => new TextEncoder().encode(JSON.stringify(call[1])).length);
    expect(bytes.every(value => value > 100_000)).toBe(true);
    expect(budgets).toEqual(bytes.map(pushTimeout));
    expect(result.transferBytes).toBe(bytes[0] + bytes[1]);
    expect(rpc.mock.calls[0][1].p_idempotency_key).toBe(rpc.mock.calls[1][1].p_idempotency_key);
    expect(saveSyncBaseline).toHaveBeenCalledOnce();
  });

  it("does not accept a late success receipt after the initiating account changes", async () => {
    let finish!: (response: typeof accepted) => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const rpc = vi.fn(() => ({
      abortSignal: () => {
        entered();
        return new Promise<typeof accepted>(resolve => { finish = resolve; });
      },
    }));
    const x = fixture(rpc);
    const pending = new SupabaseSyncTransport().push(x.envelope);
    await started;
    x.changeAccount();
    finish(accepted);
    await expect(pending).rejects.toMatchObject({
      failure: { kind: "auth", status: 0, phase: "receipt", reason: "account-changed" },
    });
    expect(x.chain.single).not.toHaveBeenCalled();
    expect(saveSyncBaseline).not.toHaveBeenCalled();
  });

  it("reconciles overlapping legacy requests under one key without treating newer edits as protected", async () => {
    const updatedHash = "b".repeat(64);
    let commitFirst!: () => void;
    const firstCommit = new Promise<void>(resolve => { commitFirst = resolve; });
    let requests = 0;
    const originalResponse = { ...accepted, data: { ...accepted.data, idempotent: false } };
    const replayResponse = { ...accepted, data: { ...accepted.data, idempotent: true } };
    const updatedResponse = {
      ...accepted,
      data: { ...accepted.data, revision: 73, revision_id: "revision-new", content_hash: updatedHash, idempotent: false },
    };
    // The first request keeps running on the server after the client times out.
    // The retry waits behind the server's owner lock, then replays that first revision.
    const rpc = vi.fn((_name: string, _args: Record<string, unknown>) => {
      requests += 1;
      if (requests === 1) return firstCommit.then(() => originalResponse);
      if (requests === 2) return firstCommit.then(() => replayResponse);
      return Promise.resolve(updatedResponse);
    });
    const x = fixture(rpc);
    x.chain.single.mockImplementation(async () => ({
      data: requests === 3
        ? { id: "revision-new", revision: 73, content_hash: updatedHash, reason: "manual" }
        : { id: "revision-id", revision: 72, content_hash: hash, reason: "manual" },
      error: null, status: 200,
    }));
    vi.useFakeTimers();
    try {
      const first = new SupabaseSyncTransport().push(x.envelope);
      const timedOut = expect(first).rejects.toMatchObject({
        failure: { kind: "network", status: 0, phase: "revision", reason: "request-timeout" },
      });
      await vi.waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
      await vi.advanceTimersByTimeAsync(76_000);
      await timedOut;
      expect(x.chain.single).not.toHaveBeenCalled();
      expect(saveSyncBaseline).not.toHaveBeenCalled();

      // Local edits change the attempted hash, not the already-sent retry key.
      const edited: SnapshotEnvelope = {
        ...x.envelope, contentHash: updatedHash,
        packed: { ...x.envelope.packed!, content: JSON.stringify({ fixture: "edited while acknowledgement was missing" }) },
      };
      const retry = new SupabaseSyncTransport().push(edited);
      await vi.waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
      expect(x.chain.single).not.toHaveBeenCalled();
      commitFirst();
      const replayed = await retry;
      expect(replayed).toMatchObject({
        status: "accepted", revision: 72, idempotent: true, contentHash: hash,
      });
      expect(rpc.mock.calls[1][1].p_idempotency_key).toBe(rpc.mock.calls[0][1].p_idempotency_key);
      expect(x.chain.single).toHaveBeenCalledTimes(1);
      // The first receipt verifies the OLD server hash, not the newer local state.
      expect(saveSyncBaseline).not.toHaveBeenCalled();

      // The separately tested coordinator issues a fresh key after a stale replay.
      // Only its new receipt may protect the newer content.
      const newest = await new SupabaseSyncTransport().push({
        ...edited, baseRevision: 72, idempotencyKey: "fixture-new-edit-key",
      });
      expect(newest).toMatchObject({
        status: "accepted", revision: 73, idempotent: false, contentHash: updatedHash,
      });
      expect(rpc.mock.calls[2][1].p_idempotency_key).not.toBe(rpc.mock.calls[1][1].p_idempotency_key);
      expect(x.chain.single).toHaveBeenCalledTimes(2);
      expect(saveSyncBaseline).toHaveBeenCalledTimes(1);
      expect(vi.mocked(saveSyncBaseline).mock.calls[0][1].contentHash).toBe(updatedHash);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a late committed write unconfirmed until a same-key retry passes owner-scoped receipt readback", async () => {
    let commit!: () => void;
    const firstCommit = new Promise<void>(resolve => { commit = resolve; });
    let calls = 0;
    const rpc = vi.fn((_name: string, _args: Record<string, unknown>) => {
      const requestNumber = ++calls;
      return firstCommit.then(() => ({
        ...accepted, data: { ...accepted.data, idempotent: requestNumber !== 1 },
      }));
    });
    const x = fixture(rpc);
    x.chain.single
      .mockResolvedValueOnce({ data: null, error: { message: "synthetic receipt read unavailable" }, status: 503 })
      .mockResolvedValueOnce({
        data: { id: "revision-id", revision: 72, content_hash: hash, reason: "manual" },
        error: null, status: 200,
      });
    vi.useFakeTimers();
    try {
      const pending = new SupabaseSyncTransport().push(x.envelope);
      const timedOut = expect(pending).rejects.toMatchObject({
        failure: { kind: "network", phase: "revision", reason: "request-timeout" },
      });
      await vi.waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
      await vi.advanceTimersByTimeAsync(76_000);
      await timedOut;
      expect(x.chain.single).not.toHaveBeenCalled();
      expect(saveCloudMediaIndex).not.toHaveBeenCalled();

      const firstRetry = new SupabaseSyncTransport().push(x.envelope);
      await vi.waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
      commit();
      await expect(firstRetry).rejects.toMatchObject({
        failure: { kind: "server", phase: "receipt", status: 503 },
      });
      expect(saveCloudMediaIndex).not.toHaveBeenCalled();
      expect(saveSyncBaseline).not.toHaveBeenCalled();

      const verifiedRetry = await new SupabaseSyncTransport().push(x.envelope);
      expect(verifiedRetry).toMatchObject({
        status: "accepted", idempotent: true, revision: 72, contentHash: hash,
      });
      expect(rpc).toHaveBeenCalledTimes(3);
      expect(new Set(rpc.mock.calls.map(call => call[1].p_idempotency_key)).size).toBe(1);
      expect(x.chain.single).toHaveBeenCalledTimes(2);
      expect(saveCloudMediaIndex).toHaveBeenCalledOnce();
      expect(saveSyncBaseline).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
