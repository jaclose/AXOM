import type { NoctyriumState } from "../types";
import { deviceId, read, write } from "./syncMetadata";
import { snapshotWorkspace } from "./workspaceSnapshot";
import type { ProtectionStatus, RevisionReason, SyncTransport } from "./syncTypes";

/**
 * Pushes debounced workspace snapshots as immutable server revisions.
 *
 * Guarantees:
 * - A pending upload keeps one idempotency key across retries, so a retry
 *   after a lost response can never create a duplicate revision.
 * - Pending state is persisted, so a reload or crash resumes the upload.
 * - A stale base revision is preserved server-side as a conflict and surfaced
 *   as "conflict"; nothing is overwritten silently in either direction.
 */
export class SyncCoordinator {
  private timer: number | undefined;
  private running = false;
  private status: ProtectionStatus = "saved-locally";
  private listeners = new Set<(status: ProtectionStatus) => void>();

  constructor(
    private transport: SyncTransport,
    private state: () => NoctyriumState,
    private delay = 3000,
    initialStatus: ProtectionStatus = "saved-locally",
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
    write({
      ...meta,
      pending: true,
      pendingIdempotencyKey: meta.pendingIdempotencyKey ?? crypto.randomUUID(),
    });
    if (this.status !== "conflict") this.set(navigator.onLine ? "saved-locally" : "offline");
    if (this.timer) clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.flush(), this.delay);
  }

  async flush(reason: RevisionReason = "automatic"): Promise<void> {
    if (this.running) return;
    const meta = read();
    if (!meta.pending && reason === "automatic") return;
    // A conflict waits for an explicit decision; automatic uploads pause.
    if (meta.conflictServerRevision !== undefined && reason === "automatic") {
      this.set("conflict");
      return;
    }
    if (!navigator.onLine) {
      this.set("offline");
      return;
    }
    this.running = true;
    this.set("syncing");
    try {
      const envelope = await snapshotWorkspace(this.state(), {
        deviceId: deviceId(),
        baseRevision: meta.baseRevision,
        idempotencyKey: meta.pendingIdempotencyKey,
        reason,
      });
      const result = await this.transport.push(envelope);
      if (result.status === "conflict") {
        write({
          ...read(),
          pending: false,
          pendingIdempotencyKey: undefined,
          attempt: 0,
          conflictServerRevision: result.serverRevision,
        });
        this.set("conflict");
        return;
      }
      write({
        ...read(),
        baseRevision: result.revision,
        pending: false,
        pendingIdempotencyKey: undefined,
        lastHash: envelope.contentHash,
        lastProtectedAt: new Date().toISOString(),
        attempt: 0,
        conflictServerRevision: undefined,
      });
      this.set("protected");
    } catch {
      const current = read();
      write({ ...current, pending: true, attempt: Math.min(current.attempt + 1, 6) });
      this.set("retrying");
      const backoff = Math.min(60_000, 1000 * 2 ** current.attempt);
      this.timer = window.setTimeout(() => void this.flush(), backoff);
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

  reconnect = (): void => {
    if (read().pending) void this.flush();
  };

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.listeners.clear();
  }

  private set(status: ProtectionStatus): void {
    this.status = status;
    this.listeners.forEach((listener) => listener(status));
  }
}
