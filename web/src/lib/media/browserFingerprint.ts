export interface BrowserFingerprintProgress {
  processedBytes: number;
  totalBytes: number;
  fraction: number;
}

export interface BrowserFingerprintOptions {
  signal?: AbortSignal;
  onProgress?: (progress: BrowserFingerprintProgress) => void;
}

export interface BrowserFingerprint {
  sha256: string;
  sizeBytes: number;
}

type FingerprintWorkerReply =
  | { type: "progress"; id: number; processedBytes: number; totalBytes: number }
  | { type: "complete"; id: number; sha256: string; sizeBytes: number }
  | { type: "failed"; id: number; message: string };

interface PendingFingerprint {
  resolve: (fingerprint: BrowserFingerprint) => void;
  reject: (error: Error) => void;
  onProgress?: BrowserFingerprintOptions["onProgress"];
  signal?: AbortSignal;
  onAbort?: () => void;
}

function abortError(): Error {
  const error = new Error("Fingerprinting was cancelled.");
  error.name = "AbortError";
  return error;
}

function defaultWorkerFactory(): Worker {
  return new Worker(new URL("./fingerprint.worker.ts", import.meta.url), { type: "module", name: "axom-media-fingerprint" });
}

/** Incremental SHA-256 in a dedicated worker. Only one-MiB slices are read at a time. */
export class BrowserFingerprintService {
  private worker: Worker | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, PendingFingerprint>();
  private disposed = false;

  constructor(private readonly workerFactory: () => Worker = defaultWorkerFactory) {}

  fingerprint(blob: Blob, options: BrowserFingerprintOptions = {}): Promise<BrowserFingerprint> {
    if (this.disposed) return Promise.reject(new Error("Fingerprint service has been disposed."));
    if (options.signal?.aborted) return Promise.reject(abortError());
    if (!Number.isSafeInteger(blob.size) || blob.size < 0) return Promise.reject(new Error("The media file has an invalid size."));
    let worker: Worker;
    try { worker = this.getWorker(); }
    catch (error) { return Promise.reject(error instanceof Error ? error : new Error("A media worker could not start.")); }

    const id = this.nextId++;
    return new Promise<BrowserFingerprint>((resolve, reject) => {
      const pending: PendingFingerprint = { resolve, reject, onProgress: options.onProgress, signal: options.signal };
      if (options.signal) {
        pending.onAbort = () => {
          worker.postMessage({ type: "cancel", id });
          this.finish(id, abortError());
        };
        options.signal.addEventListener("abort", pending.onAbort, { once: true });
      }
      this.pending.set(id, pending);
      worker.postMessage({ type: "fingerprint", id, blob });
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const id of this.pending.keys()) this.finish(id, abortError());
    this.worker?.terminate();
    this.worker = null;
  }

  private getWorker(): Worker {
    if (this.worker) return this.worker;
    this.worker = this.workerFactory();
    this.worker.onmessage = (event: MessageEvent<FingerprintWorkerReply>) => this.receive(event.data);
    this.worker.onerror = (event) => {
      const error = new Error(event.message || "The fingerprint worker failed.");
      for (const id of this.pending.keys()) this.finish(id, error);
      this.worker?.terminate();
      this.worker = null;
    };
    this.worker.onmessageerror = () => {
      const error = new Error("The fingerprint worker returned unreadable data.");
      for (const id of this.pending.keys()) this.finish(id, error);
    };
    return this.worker;
  }

  private receive(message: FingerprintWorkerReply): void {
    const pending = this.pending.get(message.id);
    if (!pending) return;
    if (message.type === "progress") {
      const fraction = message.totalBytes === 0 ? 1 : message.processedBytes / message.totalBytes;
      pending.onProgress?.({ processedBytes: message.processedBytes, totalBytes: message.totalBytes, fraction });
      return;
    }
    if (message.type === "complete") {
      if (pending.signal?.aborted) this.finish(message.id, abortError());
      else this.finish(message.id, undefined, { sha256: message.sha256, sizeBytes: message.sizeBytes });
      return;
    }
    this.finish(message.id, new Error(message.message || "Fingerprinting failed."));
  }

  private finish(id: number, error?: Error, fingerprint?: BrowserFingerprint): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    if (pending.onAbort) pending.signal?.removeEventListener("abort", pending.onAbort);
    if (error) pending.reject(error);
    else if (fingerprint) pending.resolve(fingerprint);
    else pending.reject(new Error("Fingerprint worker returned no result."));
  }
}
