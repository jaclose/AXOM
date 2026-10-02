import { describe, expect, it, vi } from "vitest";
import { BrowserFingerprintService } from "./browserFingerprint";

type Request = { type: "fingerprint"; id: number; blob: Blob } | { type: "cancel"; id: number };
type Reply = { type: "progress"; id: number; processedBytes: number; totalBytes: number } | { type: "complete"; id: number; sha256: string; sizeBytes: number } | { type: "failed"; id: number; message: string };

function fakeWorker() {
  const worker = {
    onmessage: null as ((event: MessageEvent<Reply>) => void) | null,
    onerror: null as ((event: ErrorEvent) => void) | null,
    onmessageerror: null as (() => void) | null,
    postMessage: vi.fn<(message: Request) => void>(),
    terminate: vi.fn(),
  };
  return worker as unknown as Worker & typeof worker;
}

describe("BrowserFingerprintService", () => {
  it("reports byte progress and returns a stable hash from a worker reply", async () => {
    const worker = fakeWorker();
    const service = new BrowserFingerprintService(() => worker);
    const progress: number[] = [];
    const blob = new Blob(["three bytes"]);
    const resultPromise = service.fingerprint(blob, { onProgress: (value) => progress.push(value.fraction) });
    const request = worker.postMessage.mock.calls[0][0];
    expect(request.type).toBe("fingerprint");
    if (request.type !== "fingerprint") throw new Error("Expected a fingerprint job.");
    expect(request.blob.size).toBe(blob.size);
    worker.onmessage?.({ data: { type: "progress", id: request.id, processedBytes: 5, totalBytes: blob.size } } as MessageEvent<Reply>);
    worker.onmessage?.({ data: { type: "complete", id: request.id, sha256: "a".repeat(64), sizeBytes: blob.size } } as MessageEvent<Reply>);

    await expect(resultPromise).resolves.toEqual({ sha256: "a".repeat(64), sizeBytes: blob.size });
    expect(progress).toEqual([5 / blob.size]);
  });

  it("signals worker cancellation and never accepts a late digest", async () => {
    const worker = fakeWorker();
    const service = new BrowserFingerprintService(() => worker);
    const controller = new AbortController();
    const result = service.fingerprint(new Blob(["large data"]), { signal: controller.signal });
    const request = worker.postMessage.mock.calls[0][0];
    if (request.type !== "fingerprint") throw new Error("Expected a fingerprint job.");
    const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" });

    controller.abort();
    expect(worker.postMessage).toHaveBeenLastCalledWith({ type: "cancel", id: request.id });
    await rejected;
    worker.onmessage?.({ data: { type: "complete", id: request.id, sha256: "b".repeat(64), sizeBytes: 10 } } as MessageEvent<Reply>);
  });

  it("aborts pending work and terminates the worker on disposal", async () => {
    const worker = fakeWorker();
    const service = new BrowserFingerprintService(() => worker);
    const result = service.fingerprint(new Blob(["payload"]));
    const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" });
    service.dispose();
    await rejected;
    expect(worker.terminate).toHaveBeenCalledOnce();
    await expect(service.fingerprint(new Blob())).rejects.toThrow(/disposed/i);
  });
});
