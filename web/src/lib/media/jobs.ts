export type MediaJobType = "inspect" | "fingerprint" | "optimize" | "preview" | "thumbnail";
export type MediaJobState = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface MediaJob {
  id: string;
  assetId: string;
  type: MediaJobType;
  state: MediaJobState;
  /** Fraction complete, reported only by the task that is doing the work. */
  progress?: number;
  attempt: number;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  result?: unknown;
}

export interface MediaJobContext {
  signal: AbortSignal;
  reportProgress: (fraction: number) => void;
}

export interface MediaJobTask {
  assetId: string;
  type: MediaJobType;
  run: (context: MediaJobContext) => Promise<unknown>;
}

export interface MediaJobHandle {
  id: string;
  /** Resolves with the terminal job, or rejects when it fails or is cancelled. */
  completed: Promise<MediaJob>;
}

export interface MediaJobQueueOptions {
  concurrency?: number;
  createId?: () => string;
  now?: () => Date;
}

interface Deferred {
  promise: Promise<MediaJob>;
  resolve: (job: MediaJob) => void;
  reject: (error: Error) => void;
}

interface JobRecord {
  job: MediaJob;
  task: MediaJobTask;
  deferred: Deferred;
}

function createDeferred(): Deferred {
  let resolve!: (job: MediaJob) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<MediaJob>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function abortError(): Error {
  const error = new Error("Media job was cancelled.");
  error.name = "AbortError";
  return error;
}

function defaultId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `media-job-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Small in-memory job coordinator for CPU or I/O media work. It owns queue
 * state, concurrency, cancellation and retries, but never invents progress or
 * persists transient jobs. A future worker can implement the same task API.
 */
export class MediaJobQueue {
  private readonly records = new Map<string, JobRecord>();
  private readonly pending: string[] = [];
  private readonly active = new Map<string, AbortController>();
  private readonly listeners = new Set<(jobs: MediaJob[]) => void>();
  private readonly concurrency: number;
  private readonly createId: () => string;
  private readonly now: () => Date;

  constructor(options: MediaJobQueueOptions = {}) {
    this.concurrency = options.concurrency ?? 1;
    if (!Number.isSafeInteger(this.concurrency) || this.concurrency < 1) {
      throw new RangeError("Media job concurrency must be a positive integer.");
    }
    this.createId = options.createId ?? defaultId;
    this.now = options.now ?? (() => new Date());
  }

  enqueue(task: MediaJobTask): MediaJobHandle {
    if (!task.assetId.trim()) throw new Error("A media job needs an asset ID.");
    const id = this.createId();
    if (this.records.has(id)) throw new Error(`Duplicate media job ID: ${id}`);
    const record: JobRecord = {
      job: {
        id,
        assetId: task.assetId,
        type: task.type,
        state: "queued",
        attempt: 1,
        createdAt: this.now().toISOString(),
      },
      task,
      deferred: createDeferred(),
    };
    this.records.set(id, record);
    this.pending.push(id);
    this.publish();
    this.pump();
    return { id, completed: record.deferred.promise };
  }

  get(id: string): MediaJob | undefined {
    const job = this.records.get(id)?.job;
    return job ? { ...job } : undefined;
  }

  list(): MediaJob[] {
    return [...this.records.values()].map(({ job }) => ({ ...job }));
  }

  subscribe(listener: (jobs: MediaJob[]) => void): () => void {
    this.listeners.add(listener);
    try { listener(this.list()); } catch { /* A view subscriber cannot break the queue. */ }
    return () => this.listeners.delete(listener);
  }

  cancel(id: string): boolean {
    const record = this.records.get(id);
    if (!record || (record.job.state !== "queued" && record.job.state !== "running")) return false;
    record.job = { ...record.job, state: "cancelled", finishedAt: this.now().toISOString() };
    this.active.get(id)?.abort();
    if (!this.active.has(id)) {
      for (let index = this.pending.length - 1; index >= 0; index -= 1) {
        if (this.pending[index] === id) this.pending.splice(index, 1);
      }
      record.deferred.reject(abortError());
    }
    this.publish();
    this.pump();
    return true;
  }

  retry(id: string): MediaJobHandle {
    const record = this.records.get(id);
    if (!record || (record.job.state !== "failed" && record.job.state !== "cancelled")) {
      throw new Error("Only failed or cancelled media jobs can be retried.");
    }
    if (this.active.has(id)) throw new Error("Wait for the cancelled attempt to stop before retrying it.");
    record.job = {
      id: record.job.id,
      assetId: record.job.assetId,
      type: record.job.type,
      state: "queued",
      attempt: record.job.attempt + 1,
      createdAt: record.job.createdAt,
    };
    record.deferred = createDeferred();
    this.pending.push(id);
    this.publish();
    this.pump();
    return { id, completed: record.deferred.promise };
  }

  /** Release a terminal job and its task closure, which may retain large files. */
  forget(id: string): boolean {
    const record = this.records.get(id);
    if (!record || record.job.state === "queued" || record.job.state === "running" || this.active.has(id)) return false;
    this.records.delete(id);
    this.publish();
    return true;
  }

  private publish(): void {
    const jobs = this.list();
    for (const listener of this.listeners) {
      try { listener(jobs); } catch { /* A view subscriber cannot break the queue. */ }
    }
  }

  private pump(): void {
    while (this.active.size < this.concurrency && this.pending.length > 0) {
      const id = this.pending.shift()!;
      const record = this.records.get(id);
      if (!record || record.job.state !== "queued") continue;
      const controller = new AbortController();
      this.active.set(id, controller);
      record.job = { ...record.job, state: "running", startedAt: this.now().toISOString() };
      this.publish();
      void this.run(id, record, controller);
    }
  }

  private async run(id: string, record: JobRecord, controller: AbortController): Promise<void> {
    try {
      const result = await record.task.run({
        signal: controller.signal,
        reportProgress: (fraction) => {
          if (record.job.state !== "running" || controller.signal.aborted || !Number.isFinite(fraction)) return;
          const progress = Math.max(record.job.progress ?? 0, Math.max(0, Math.min(1, fraction)));
          if (progress === record.job.progress) return;
          record.job = { ...record.job, progress };
          this.publish();
        },
      });
      if (controller.signal.aborted || record.job.state === "cancelled") {
        record.deferred.reject(abortError());
        return;
      }
      record.job = { ...record.job, state: "completed", progress: 1, result, finishedAt: this.now().toISOString() };
      record.deferred.resolve({ ...record.job });
    } catch (error) {
      if (controller.signal.aborted || record.job.state === "cancelled") {
        record.job = { ...record.job, state: "cancelled", finishedAt: record.job.finishedAt ?? this.now().toISOString() };
        record.deferred.reject(abortError());
      } else {
        const message = error instanceof Error ? error.message : "Media processing failed.";
        record.job = { ...record.job, state: "failed", error: message, finishedAt: this.now().toISOString() };
        record.deferred.reject(error instanceof Error ? error : new Error(message));
      }
    } finally {
      this.active.delete(id);
      this.publish();
      this.pump();
    }
  }
}
