// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeSeed } from "../seed";
import { SyncCoordinator } from "./syncCoordinator";
import { SyncPushError, classifyPushFailure } from "./syncFailure";
import { SYNC_METADATA_KEY } from "./syncMetadata";
import { BLOCKED_RECHECK_MS, MAX_SNAPSHOT_BYTES, PAUSED_RECHECK_MS, RECONNECT_DELAY_MS, RETRY_STEPS_MS } from "./syncPolicy";
import type { PushResult, SnapshotEnvelope, SyncMetadata, SyncTransport } from "./syncTypes";

const values = new Map<string, string>();
const storage = {
  get length() { return values.size; },
  clear: () => values.clear(),
  getItem: (key: string) => values.get(key) ?? null,
  key: (index: number) => [...values.keys()][index] ?? null,
  removeItem: (key: string) => { values.delete(key); },
  setItem: (key: string, value: string) => { values.set(key, String(value)); },
};

const START = Date.parse("2026-10-01T10:00:00.000Z");
let now = START;
/** random() at 0.5 puts every retry wait exactly on its step. */
const clock = { now: () => now, random: () => 0.5 };
const meta = (): SyncMetadata => JSON.parse(localStorage.getItem(SYNC_METADATA_KEY)!);
const accepted = (revision: number, extra: Partial<Extract<PushResult, { status: "accepted" }>> = {}): PushResult => ({ status: "accepted", revision, revisionId: `r${revision}`, idempotent: false, ...extra });
/** What the account answered before migration 20261001090000 once history was full. */
const historyFull = () => new SyncPushError(classifyPushFailure({ code: "54000", message: "workspace snapshot storage limit reached; reduce the snapshot size before syncing" }, 500), "storage limit");
const down = () => new SyncPushError(classifyPushFailure({ message: "upstream timed out", code: "57014" }, 500), "down");

function coordinator(push: SyncTransport["push"], state = makeSeed) {
  const transport = { push, history: vi.fn(), revision: vi.fn() } as unknown as SyncTransport;
  return new SyncCoordinator(transport, state, 60_000, "saved-locally", clock);
}

let uuid = 0;
beforeEach(() => {
  now = START;
  uuid = 0;
  vi.stubGlobal("localStorage", storage);
  localStorage.clear();
  vi.stubGlobal("crypto", { ...crypto, randomUUID: vi.fn(() => `00000000-0000-4000-8000-${String(uuid += 1).padStart(12, "0")}`), subtle: crypto.subtle });
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("SyncCoordinator", () => {
  it("persists a retryable pending idempotency key and clears it only after acknowledgment", async () => {
    const push = vi.fn<SyncTransport["push"]>().mockRejectedValueOnce(new Error("down")).mockResolvedValue(accepted(1, { idempotent: true }));
    const c = coordinator(push);
    c.queue();
    await c.flush();
    expect(meta().pending).toBe(true);
    now += RETRY_STEPS_MS[0];
    await c.flush();
    expect(meta()).toMatchObject({ pending: false, baseRevision: 1, attempt: 0 });
    expect(meta().lastError).toBeUndefined();
    expect(push.mock.calls[0][0].idempotencyKey).toBe(push.mock.calls[1][0].idempotencyKey);
    c.dispose();
  });

  it("preserves a conflict and requires action instead of overwriting", async () => {
    const push = vi.fn<SyncTransport["push"]>().mockResolvedValue({ status: "conflict", serverRevision: 4, preservedRevisionId: "p" });
    const statuses: string[] = [];
    const c = coordinator(push);
    c.subscribe((status) => statuses.push(status));
    c.queue();
    await c.flush();
    expect(statuses.at(-1)).toBe("conflict");
    expect(meta().baseRevision).toBe(0);
    // A conflict waits for a decision: automatic uploads stay paused.
    c.queue();
    await c.flush();
    expect(push).toHaveBeenCalledTimes(1);
    c.dispose();
  });

  it("stops repeating an upload the account refused", async () => {
    const push = vi.fn<SyncTransport["push"]>().mockRejectedValue(historyFull());
    const c = coordinator(push);
    c.queue();
    await c.flush();
    expect(c.currentStatus()).toBe("blocked");
    expect(meta()).toMatchObject({ pending: true, lastError: { kind: "rejected", rejection: "storage-limit", status: 500, code: "54000" } });
    expect(Date.parse(meta().nextAttemptAt!)).toBe(START + BLOCKED_RECHECK_MS);

    // New local changes, the old one-minute retry clock and a reconnect do not send it again.
    for (const minutes of [1, 2, 10, 59]) {
      now = START + minutes * 60_000;
      c.queue();
      await c.flush();
      c.reconnect();
      await c.flush();
    }
    expect(push).toHaveBeenCalledTimes(1);
    expect(c.currentStatus()).toBe("blocked");

    // After the hour it checks once. If the account now accepts, protection resumes by itself.
    push.mockResolvedValue(accepted(1));
    now = START + BLOCKED_RECHECK_MS;
    await c.flush();
    expect(push).toHaveBeenCalledTimes(2);
    expect(c.currentStatus()).toBe("protected");
    expect(meta()).toMatchObject({ pending: false, attempt: 0, baseRevision: 1 });
    expect(meta().nextAttemptAt).toBeUndefined();
    c.dispose();
  });

  it("lets the learner try a refused upload at once", async () => {
    const push = vi.fn<SyncTransport["push"]>().mockRejectedValueOnce(historyFull()).mockResolvedValue(accepted(1));
    const c = coordinator(push);
    c.queue();
    await c.flush();
    expect(c.currentStatus()).toBe("blocked");
    await c.flush("manual");
    expect(push).toHaveBeenCalledTimes(2);
    expect(c.currentStatus()).toBe("protected");
    c.dispose();
  });

  it("waits longer after each failure, then settles at one try every half hour", async () => {
    const push = vi.fn<SyncTransport["push"]>().mockRejectedValue(down());
    const timers = vi.spyOn(window, "setTimeout");
    const c = coordinator(push);
    c.queue();
    for (const [index, step] of RETRY_STEPS_MS.entries()) {
      await c.flush();
      expect(push).toHaveBeenCalledTimes(index + 1);
      expect(c.currentStatus()).toBe("retrying");
      expect(Date.parse(meta().nextAttemptAt!) - now).toBe(step);
      expect(timers.mock.calls.at(-1)![1]).toBe(step);
      // Early: a local change or a second tab's timer cannot shorten the wait.
      now += step - 1;
      c.queue();
      await c.flush();
      expect(push).toHaveBeenCalledTimes(index + 1);
      now += 1;
    }
    await c.flush();
    expect(c.currentStatus()).toBe("paused");
    expect(Date.parse(meta().nextAttemptAt!) - now).toBe(PAUSED_RECHECK_MS);
    now += PAUSED_RECHECK_MS;
    await c.flush();
    expect(c.currentStatus()).toBe("paused");
    expect(Date.parse(meta().nextAttemptAt!) - now).toBe(PAUSED_RECHECK_MS);
    expect(push).toHaveBeenCalledTimes(RETRY_STEPS_MS.length + 2);
    c.dispose();
  });

  it("keeps the wait across a reload and across tabs", async () => {
    const push = vi.fn<SyncTransport["push"]>().mockRejectedValue(down());
    const first = coordinator(push);
    first.queue();
    await first.flush();
    first.dispose();

    // A reloaded page, or another tab, shares the stored wait.
    const timers = vi.spyOn(window, "setTimeout");
    const reloaded = coordinator(push);
    now += 1_000;
    reloaded.resume();
    expect(timers.mock.calls.at(-1)![1]).toBe(RETRY_STEPS_MS[0] - 1_000);
    await reloaded.flush();
    expect(push).toHaveBeenCalledTimes(1);
    expect(reloaded.currentStatus()).toBe("retrying");
    reloaded.dispose();
  });

  it("tries again soon after the network returns only when the upload never left the device", async () => {
    const push = vi.fn<SyncTransport["push"]>().mockRejectedValueOnce(new TypeError("Failed to fetch")).mockRejectedValue(down());
    const c = coordinator(push);
    c.queue();
    await c.flush();
    expect(meta().lastError).toMatchObject({ kind: "network", status: 0 });
    c.reconnect();
    expect(meta().nextAttemptAt).toBeUndefined();
    now += RECONNECT_DELAY_MS;
    await c.flush();
    expect(push).toHaveBeenCalledTimes(2);
    // The account answered this time, so its wait stands.
    expect(meta().lastError).toMatchObject({ kind: "server", status: 500 });
    c.reconnect();
    now += RECONNECT_DELAY_MS;
    await c.flush();
    expect(push).toHaveBeenCalledTimes(2);
    c.dispose();
  });

  it("does not upload a workspace that has not changed", async () => {
    const push = vi.fn<SyncTransport["push"]>().mockResolvedValue(accepted(1));
    const state = makeSeed();
    const c = coordinator(push, () => state);
    c.queue();
    await c.flush();
    expect(push).toHaveBeenCalledTimes(1);
    now += 60_000;
    c.queue();
    await c.flush();
    expect(push).toHaveBeenCalledTimes(1);
    expect(meta().pending).toBe(false);
    expect(c.currentStatus()).toBe("protected");
    // A request from the learner always uploads.
    c.queue();
    await c.flush("manual");
    expect(push).toHaveBeenCalledTimes(2);
    c.dispose();
  });

  it("spaces automatic uploads by the size of the snapshot", async () => {
    let title = "first";
    const big = "x".repeat(2_500_000);
    const state = () => ({ ...makeSeed(), tasks: [{ id: "t", title: `${title}${big}`, done: false, created: "2026-10-01T00:00:00.000Z" }] }) as ReturnType<typeof makeSeed>;
    const push = vi.fn<SyncTransport["push"]>().mockImplementation(async () => accepted(push.mock.calls.length));
    const c = coordinator(push, state);
    c.queue();
    await c.flush();
    expect(push).toHaveBeenCalledTimes(1);
    const bytes = meta().lastPayloadBytes!;
    expect(bytes).toBeGreaterThan(2_500_000);
    // 5 MB a minute: a 2.5 MB snapshot may start again after about 30 seconds.
    title = "second";
    c.queue();
    now += 20_000;
    await c.flush();
    expect(push).toHaveBeenCalledTimes(1);
    expect(c.currentStatus()).toBe("saved-locally");
    now += 20_000;
    await c.flush();
    expect(push).toHaveBeenCalledTimes(2);
    c.dispose();
  });

  it("measures an oversized workspace on the device and never sends it", async () => {
    const push = vi.fn<SyncTransport["push"]>().mockResolvedValue(accepted(1));
    let size = MAX_SNAPSHOT_BYTES + 10;
    const state = () => ({ ...makeSeed(), tasks: [{ id: "t", title: "x".repeat(size), done: false, created: "2026-10-01T00:00:00.000Z" }] }) as ReturnType<typeof makeSeed>;
    const c = coordinator(push, state);
    c.queue();
    await c.flush();
    expect(push).not.toHaveBeenCalled();
    expect(c.currentStatus()).toBe("blocked");
    expect(meta().lastError).toMatchObject({ kind: "rejected", rejection: "too-large", status: 0 });
    expect(meta().nextAttemptAt).toBeUndefined();
    // Once it is smaller the next change uploads, after the size-based gap.
    size = 1_000;
    now += 5 * 60_000;
    c.queue();
    await c.flush();
    expect(push).toHaveBeenCalledTimes(1);
    expect(c.currentStatus()).toBe("protected");
    c.dispose();
  });

  it("uploads again when a replayed retry stored older content", async () => {
    let title = "written before the answer was lost";
    const seed = makeSeed();
    const state = () => ({ ...seed, tasks: [{ id: "t", title, done: false, created: "2026-10-01T00:00:00.000Z" }] }) as typeof seed;
    const sent: SnapshotEnvelope[] = [];
    const push = vi.fn<SyncTransport["push"]>()
      .mockImplementationOnce(async (envelope) => { sent.push(envelope); throw new TypeError("Failed to fetch"); })
      .mockImplementationOnce(async (envelope) => { sent.push(envelope); return accepted(1, { idempotent: true, contentHash: sent[0].contentHash }); })
      .mockImplementationOnce(async (envelope) => { sent.push(envelope); return accepted(2); });
    const c = coordinator(push, state);
    c.queue();
    await c.flush();
    title = "edited while the retry waited";
    now += RETRY_STEPS_MS[0];
    await c.flush();
    expect(push).toHaveBeenCalledTimes(3);
    expect(sent[1].idempotencyKey).toBe(sent[0].idempotencyKey);
    expect(sent[2].idempotencyKey).not.toBe(sent[0].idempotencyKey);
    expect(sent[2]).toMatchObject({ baseRevision: 1, contentHash: sent[1].contentHash });
    expect(meta()).toMatchObject({ pending: false, baseRevision: 2, lastHash: sent[2].contentHash });
    expect(c.currentStatus()).toBe("protected");
    c.dispose();
  });

  it("does not skip an unchanged workspace when an earlier upload may have landed", async () => {
    const state = makeSeed();
    const push = vi.fn<SyncTransport["push"]>().mockResolvedValueOnce(accepted(1)).mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValue(accepted(2, { idempotent: true }));
    let edited = false;
    const c = coordinator(push, () => (edited ? { ...state, tasks: [{ id: "t", title: "edit", done: false, created: "2026-10-01T00:00:00.000Z" }] } as typeof state : state));
    c.queue();
    await c.flush();
    edited = true;
    now += 60_000;
    c.queue();
    await c.flush();
    expect(push).toHaveBeenCalledTimes(2);
    // The edit is undone, so the content matches the last protected version, but
    // the failed upload may have been stored: ask the account instead of assuming.
    edited = false;
    now += RETRY_STEPS_MS[0];
    await c.flush();
    expect(push).toHaveBeenCalledTimes(3);
    c.dispose();
  });

  it("follows another tab's outcome and stops when disposed", async () => {
    const push = vi.fn<SyncTransport["push"]>().mockResolvedValue(accepted(1));
    const statuses: string[] = [];
    const c = coordinator(push);
    c.subscribe((status) => statuses.push(status));
    c.queue();
    // Another tab uploaded and recorded the result.
    localStorage.setItem(SYNC_METADATA_KEY, JSON.stringify({ ...meta(), pending: false, pendingIdempotencyKey: undefined, baseRevision: 3, lastProtectedAt: new Date(now).toISOString() }));
    c.adopt();
    expect(statuses.at(-1)).toBe("protected");
    await c.flush();
    expect(push).not.toHaveBeenCalled();

    c.queue();
    c.dispose();
    await c.flush();
    await c.flush("manual");
    expect(push).not.toHaveBeenCalled();
  });

  it("lets one tab upload at a time", async () => {
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    // A stand-in for the Web Locks API with the lock already held elsewhere.
    const request = vi.fn(async (_name: string, options: { ifAvailable?: boolean }, run: (lock: object | null) => Promise<unknown>) => {
      if (options.ifAvailable) return run(null);
      await held;
      return run({});
    });
    Object.defineProperty(navigator, "locks", { value: { request }, configurable: true });
    try {
      const push = vi.fn<SyncTransport["push"]>().mockResolvedValue(accepted(1));
      const c = coordinator(push);
      c.queue();
      await c.flush();
      expect(push).not.toHaveBeenCalled();
      expect(request).toHaveBeenCalledWith("axom.sync.upload", { ifAvailable: true }, expect.any(Function));
      // A requested upload waits for its turn instead of stepping aside.
      const manual = c.flush("manual");
      release!();
      await manual;
      expect(push).toHaveBeenCalledTimes(1);
      c.dispose();
    } finally {
      Reflect.deleteProperty(navigator, "locks");
    }
  });
});
