import type { NoctyriumState } from "../types";
import { SyncPushError, failureOf, type FailureDetails } from "./syncFailure";
import { deviceId, read, write } from "./syncMetadata";
import {
  BLOCKED_RECHECK_MS, MAX_SNAPSHOT_BYTES, PAUSED_RECHECK_MS, RECONNECT_DELAY_MS, RETRY_STEPS_MS,
  restingStatus, retryDelay, waitBeforeAutomatic,
} from "./syncPolicy";
import { snapshotWorkspace } from "./workspaceSnapshot";
import type { ProtectionStatus, RevisionReason, SyncMetadata, SyncTransport } from "./syncTypes";

const UPLOAD_LOCK = "axom.sync.upload";
/** Statuses that report a problem. A new local change does not hide them. */
const HELD: ReadonlySet<ProtectionStatus> = new Set<ProtectionStatus>(["conflict", "blocked", "paused", "retrying"]);

export interface SyncClock {
  now(): number;
  random(): number;
}

/**
 * Pushes debounced workspace snapshots as immutable server revisions.
 *
 * Guarantees:
 * - A pending upload keeps one idempotency key across retries, so a retry
 *   after a lost response can never create a duplicate revision.
 * - Pending state is persisted, so a reload or crash resumes the upload.
 * - A stale base revision is preserved server-side as a conflict and surfaced
 *   as "conflict"; nothing is overwritten silently in either direction.
 * - Failure is bounded (syncPolicy.ts). A failed upload waits longer each
 *   time and settles at one try every half hour; a refused upload is not
 *   repeated for an hour. The wait is stored with the pending state, so a
 *   reload, another tab or a new local change cannot shorten it. Only an
 *   upload the learner asks for runs at once.
 * - One tab uploads at a time, and an unchanged workspace is not uploaded.
 */
export class SyncCoordinator {
  private timer: number | undefined;
  private running = false;
  private disposed = false;
  private status: ProtectionStatus = "saved-locally";
  private listeners = new Set<(status: ProtectionStatus) => void>();

  constructor(
    private transport: SyncTransport,
    private state: () => NoctyriumState,
    private delay = 3000,
    initialStatus: ProtectionStatus = "saved-locally",
    private clock: SyncClock = { now: () => Date.now(), random: () => Math.random() },
  ) {
    this.status = initialStatus;
  }

  subscribe(listener: (status: ProtectionStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  currentStatus(): ProtectionStatus {
    return this.status;
  }

  /** Mark the workspace dirty and schedule a debounced upload. */
  queue(): void {
    const meta = read();
    if (!meta.pending || !meta.pendingIdempotencyKey) {
      write({ ...meta, pending: true, pendingIdempotencyKey: meta.pendingIdempotencyKey ?? crypto.randomUUID() });
    }
    if (!HELD.has(this.status)) {
      const next = navigator.onLine ? "saved-locally" : "offline";
      if (next !== this.status) this.set(next);
    }
    this.schedule(this.delay);
  }

  /**
   * Upload now if there is something to upload. An automatic call keeps to the
   * stored wait; any other reason is the learner's request and skips it.
   */
  async flush(reason: RevisionReason = "automatic"): Promise<void> {
    if (this.running || this.disposed) return;
    const automatic = reason === "automatic";
    const meta = read();
    if (automatic) {
      if (!meta.pending) return;
      // A conflict waits for an explicit decision; automatic uploads pause.
      if (meta.conflictServerRevision !== undefined) {
        this.set("conflict");
        return;
      }
    }
    if (!navigator.onLine) {
      this.set("offline");
      return;
    }
    if (automatic) {
      const wait = waitBeforeAutomatic(meta, this.clock.now());
      if (wait > 0) {
        this.rest(meta);
        this.schedule(wait);
        return;
      }
    }
    this.running = true;
    try {
      const outcome = await this.exclusively(automatic, () => this.upload(reason));
      // Another tab is uploading. Its result arrives through the shared state; look again shortly.
      if (outcome === "busy") this.schedule(Math.max(this.delay, RECONNECT_DELAY_MS));
    } finally {
      this.running = false;
    }
  }

  /**
   * Resolve a conflict by keeping this device: rebase onto the server's
   * current revision and upload. The server's version stays in history.
   */
  async keepThisDevice(serverRevision: number): Promise<void> {
    write({
      ...read(),
      baseRevision: serverRevision,
      conflictServerRevision: undefined,
      pending: true,
      pendingIdempotencyKey: crypto.randomUUID(),
    });
    await this.flush("manual");
  }

  /** The app just started: pick a pending upload back up, keeping to its stored wait. */
  resume(): void {
    if (read().pending) this.schedule(0);
  }

  /** The network is back. An upload that never left the device is worth trying again soon. */
  reconnect = (): void => {
    const meta = read();
    if (!meta.pending) return;
    if (meta.lastError?.kind === "network" && meta.nextAttemptAt) write({ ...meta, nextAttemptAt: undefined });
    this.schedule(RECONNECT_DELAY_MS);
  };

  /** Another tab changed the shared state: show its outcome and keep to its clock. */
  adopt(): void {
    if (this.running || this.disposed) return;
    const meta = read();
    this.rest(meta);
    if (meta.pending) this.schedule(this.delay);
    else this.cancel();
  }

  dispose(): void {
    this.disposed = true;
    this.cancel();
    this.listeners.clear();
  }

  /** One tab uploads at a time. An automatic upload steps aside; a requested one waits its turn. */
  private async exclusively(automatic: boolean, run: () => Promise<void>): Promise<"done" | "busy"> {
    const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
    let started = false;
    if (locks) {
      try {
        return await locks.request(UPLOAD_LOCK, { ifAvailable: automatic }, async (lock) => {
          if (!lock) return "busy" as const;
          started = true;
          await run();
          return "done" as const;
        });
      } catch (error) {
        // Some contexts expose the lock API and then refuse it. Protection matters more than the lock.
        if (started) throw error;
      }
    }
    await run();
    return "done";
  }

  private async upload(reason: RevisionReason): Promise<void> {
    const automatic = reason === "automatic";
    if (automatic) {
      // Another tab may have finished, or failed, while this one waited for its turn.
      const meta = read();
      const wait = meta.pending ? waitBeforeAutomatic(meta, this.clock.now()) : 0;
      if (!meta.pending || wait > 0) {
        this.rest(meta);
        if (wait > 0) this.schedule(wait);
        return;
      }
    }
    this.set("syncing");
    try {
      // A second pass only follows a replayed retry that stored older content (see below).
      for (let pass = 0; pass < 2; pass += 1) {
        const meta = read();
        const envelope = await snapshotWorkspace(this.state(), {
          deviceId: deviceId(),
          baseRevision: meta.baseRevision,
          idempotencyKey: meta.pendingIdempotencyKey,
          reason,
        });
        // Nothing changed since the last protected version. Only safe when this
        // key was never sent: a sent upload may have landed without its answer.
        if (automatic && envelope.contentHash === meta.lastHash && meta.lastProtectedAt && meta.sentIdempotencyKey !== envelope.idempotencyKey) {
          write({ ...read(), pending: false, pendingIdempotencyKey: undefined, attempt: 0, lastError: undefined, nextAttemptAt: undefined });
          this.set("protected");
          return;
        }
        write({ ...read(), lastAttemptAt: this.iso(0), lastPayloadBytes: envelope.payloadBytes });
        if (envelope.payloadBytes > MAX_SNAPSHOT_BYTES) {
          throw new SyncPushError({ kind: "rejected", rejection: "too-large", status: 0 }, "The workspace is larger than an account can store.");
        }
        write({ ...read(), sentIdempotencyKey: envelope.idempotencyKey });
        const result = await this.transport.push(envelope);
        if (result.status === "conflict") {
          write({
            ...read(),
            pending: false,
            pendingIdempotencyKey: undefined,
            attempt: 0,
            conflictServerRevision: result.serverRevision,
            lastError: undefined,
            nextAttemptAt: undefined,
          });
          this.set("conflict");
          return;
        }
        // A replayed retry answers with the revision the first try stored. If the
        // workspace changed in between, that revision is older than what is on
        // this device now: record it as the base and upload again under a new key.
        const stale = result.idempotent && result.contentHash !== undefined && result.contentHash !== envelope.contentHash;
        write({
          ...read(),
          baseRevision: result.revision,
          pending: stale,
          pendingIdempotencyKey: stale ? crypto.randomUUID() : undefined,
          lastHash: stale ? result.contentHash : envelope.contentHash,
          lastProtectedAt: this.iso(0),
          attempt: 0,
          conflictServerRevision: undefined,
          lastError: undefined,
          nextAttemptAt: undefined,
        });
        if (!stale) {
          this.set("protected");
          return;
        }
      }
      this.rest(read());
      this.schedule(this.delay);
    } catch (error) {
      this.fail(failureOf(error));
    }
  }

  /** Record a failed upload and decide when, if ever, to try again by itself. */
  private fail(failure: FailureDetails): void {
    const current = read();
    const attempt = current.attempt + 1;
    const refused = failure.kind === "rejected";
    // Measured as too large on this device and never sent. It needs no clock:
    // the next local change measures the workspace again.
    const neverSent = refused && failure.rejection === "too-large" && failure.status === 0;
    const retry = refused ? null : retryDelay(attempt, this.clock.random);
    const wait = neverSent ? 0 : refused ? BLOCKED_RECHECK_MS : retry ?? PAUSED_RECHECK_MS;
    write({
      ...current,
      pending: true,
      attempt: Math.min(attempt, RETRY_STEPS_MS.length + 1),
      lastError: { ...failure, at: this.iso(0) },
      nextAttemptAt: wait > 0 ? this.iso(wait) : undefined,
    });
    console.warn("[AXOM] Account upload failed", { ...failure, attempt, nextAttemptAt: wait > 0 ? this.iso(wait) : "after the next change" });
    this.rest(read());
    if (wait > 0) this.schedule(wait);
  }

  /** Arm the next automatic upload: after `minDelay`, and never before the stored wait ends. */
  private schedule(minDelay: number): void {
    this.cancel();
    if (this.disposed) return;
    const wait = Math.max(minDelay, waitBeforeAutomatic(read(), this.clock.now()));
    this.timer = window.setTimeout(() => void this.flush(), wait);
  }

  private cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private iso(offsetMs: number): string {
    return new Date(this.clock.now() + offsetMs).toISOString();
  }

  /** Show what the stored state says. Always announced: times may have changed while the status did not. */
  private rest(meta: SyncMetadata): void {
    this.set(restingStatus(meta));
  }

  private set(status: ProtectionStatus): void {
    this.status = status;
    this.listeners.forEach((listener) => listener(status));
  }
}
