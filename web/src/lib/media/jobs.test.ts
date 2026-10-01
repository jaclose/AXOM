import { describe, expect, it } from "vitest";
import { MediaJobQueue } from "./jobs";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

describe("MediaJobQueue", () => {
  it("tracks truthful progress and completes with the task result", async () => {
    const queue = new MediaJobQueue({ createId: () => "inspect-1" });
    const states: Array<{ state: string; progress?: number }> = [];
    queue.subscribe((jobs) => {
      const job = jobs.find((item) => item.id === "inspect-1");
      if (job) states.push({ state: job.state, progress: job.progress });
    });

    const handle = queue.enqueue({
      assetId: "asset-1",
      type: "inspect",
      run: async ({ reportProgress }) => {
        reportProgress(0.4);
        reportProgress(0.2); // progress never moves backwards
        reportProgress(4); // out-of-range reports are clamped
        return { durationSeconds: 86 };
      },
    });
    const completed = await handle.completed;

    expect(completed).toMatchObject({ state: "completed", progress: 1, attempt: 1, result: { durationSeconds: 86 } });
    expect(states).toContainEqual({ state: "running", progress: 0.4 });
    expect(states.at(-1)?.state).toBe("completed");
  });

  it("respects concurrency and starts queued work in order", async () => {
    const queue = new MediaJobQueue({ concurrency: 1, createId: (() => { let id = 0; return () => `job-${++id}`; })() });
    const firstTask = deferred<string>();
    const started: string[] = [];
    const first = queue.enqueue({ assetId: "a", type: "fingerprint", run: async () => { started.push("first"); return firstTask.promise; } });
    const second = queue.enqueue({ assetId: "b", type: "thumbnail", run: async () => { started.push("second"); return "done"; } });

    expect(started).toEqual(["first"]);
    firstTask.resolve("hash");
    await expect(first.completed).resolves.toMatchObject({ result: "hash", state: "completed" });
    await expect(second.completed).resolves.toMatchObject({ result: "done", state: "completed" });
    expect(started).toEqual(["first", "second"]);
  });

  it("cancels queued work without running it", async () => {
    const queue = new MediaJobQueue({ concurrency: 1, createId: (() => { let id = 0; return () => `queued-${++id}`; })() });
    const firstTask = deferred<void>();
    let queuedRuns = 0;
    const first = queue.enqueue({ assetId: "a", type: "inspect", run: async () => firstTask.promise });
    const second = queue.enqueue({ assetId: "b", type: "preview", run: async () => { queuedRuns += 1; } });
    const cancelled = expect(second.completed).rejects.toMatchObject({ name: "AbortError" });

    expect(queue.cancel(second.id)).toBe(true);
    await cancelled;
    expect(queue.get(second.id)?.state).toBe("cancelled");
    firstTask.resolve();
    await first.completed;
    expect(queuedRuns).toBe(0);
  });

  it("passes cancellation to running work and permits a clean retry", async () => {
    const queue = new MediaJobQueue({ createId: () => "optimise-1" });
    let calls = 0;
    let sawAbort = false;
    const first = queue.enqueue({
      assetId: "asset-2",
      type: "optimize",
      run: async ({ signal }) => {
        calls += 1;
        if (calls === 1) {
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => { sawAbort = true; resolve(); }, { once: true }));
          return "discarded";
        }
        return "derivative-id";
      },
    });
    const cancelled = expect(first.completed).rejects.toMatchObject({ name: "AbortError" });
    expect(queue.cancel(first.id)).toBe(true);
    expect(queue.forget(first.id)).toBe(false);
    await cancelled;
    expect(sawAbort).toBe(true);

    const retry = queue.retry(first.id);
    await expect(retry.completed).resolves.toMatchObject({ state: "completed", attempt: 2, result: "derivative-id" });
  });

  it("records failures, retries them, and releases forgotten terminal jobs", async () => {
    const queue = new MediaJobQueue({ createId: () => "preview-1" });
    let calls = 0;
    const first = queue.enqueue({ assetId: "asset-3", type: "preview", run: async () => {
      calls += 1;
      if (calls === 1) throw new Error("decoder unavailable");
      return "preview-id";
    } });

    await expect(first.completed).rejects.toThrow("decoder unavailable");
    expect(queue.get(first.id)).toMatchObject({ state: "failed", error: "decoder unavailable" });
    const retry = queue.retry(first.id);
    await expect(retry.completed).resolves.toMatchObject({ state: "completed", attempt: 2, result: "preview-id" });
    expect(queue.forget(first.id)).toBe(true);
    expect(queue.get(first.id)).toBeUndefined();
  });

  it("rejects invalid concurrency and does not let a subscriber break a task", async () => {
    expect(() => new MediaJobQueue({ concurrency: 0 })).toThrow(/positive integer/i);
    const queue = new MediaJobQueue();
    queue.subscribe(() => { throw new Error("view failed"); });
    const handle = queue.enqueue({ assetId: "asset-4", type: "thumbnail", run: async () => "ok" });
    await expect(handle.completed).resolves.toMatchObject({ state: "completed", result: "ok" });
  });
});
