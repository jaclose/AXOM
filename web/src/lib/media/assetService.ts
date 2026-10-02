import type { MediaJob, MediaJobQueue } from "./jobs";
import { BrowserFingerprintService, type BrowserFingerprintProgress } from "./browserFingerprint";
import { mediaAssetId, type MediaAsset, type MediaAssetInput, type MediaAssetRepository, type MediaInspectionResult, type MediaKind, type MediaMetadata } from "./model";

export interface MediaMetadataInspector {
  inspect(input: Pick<MediaAssetInput, "blob" | "declaredMimeType" | "kind">, signal?: AbortSignal): Promise<Omit<MediaMetadata, "declaredMimeType">>;
}

export interface MediaFingerprintService {
  fingerprint(blob: Blob, options?: { signal?: AbortSignal; onProgress?: (progress: BrowserFingerprintProgress) => void }): Promise<{ sha256: string; sizeBytes: number }>;
  dispose(): void;
}

export interface MediaAssetServiceOptions {
  jobs: MediaJobQueue;
  fingerprinter?: MediaFingerprintService;
  inspector?: MediaMetadataInspector;
  repository?: MediaAssetRepository;
  now?: () => Date;
  onJob?: (job: MediaJob) => void;
}

export interface MediaAssetIngestResult {
  asset: MediaAsset;
  duplicate: boolean;
}

const DEFAULT_PROVENANCE = { category: "unknown" as const };

function resultOf<T>(job: MediaJob): T {
  return job.result as T;
}

function abortError(): Error {
  const error = new Error("Media processing was cancelled.");
  error.name = "AbortError";
  return error;
}

async function withAbortSignals<T>(signals: Array<AbortSignal | undefined>, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const active = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  const abort = () => controller.abort();
  for (const signal of active) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", abort, { once: true });
  }
  try {
    if (controller.signal.aborted) throw abortError();
    return await run(controller.signal);
  } finally {
    for (const signal of active) signal.removeEventListener("abort", abort);
  }
}

/** Browser metadata inspection is advisory. Unsupported codecs never block original preservation. */
export class BrowserMediaMetadataInspector implements MediaMetadataInspector {
  async inspect(
    input: Pick<MediaAssetInput, "blob" | "declaredMimeType" | "kind">,
    signal?: AbortSignal,
  ): Promise<Omit<MediaMetadata, "declaredMimeType">> {
    if (signal?.aborted) throw abortError();
    if (input.kind !== "audio") return { inspection: "partial", warnings: ["This first inspector reads audio duration only."] };
    if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") {
      return { inspection: "partial", warnings: ["Audio metadata is unavailable in this environment."] };
    }

    const url = URL.createObjectURL(input.blob);
    const element = document.createElement("audio");
    element.preload = "metadata";
    element.muted = true;
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = window.setTimeout(() => finish({ inspection: "partial", warnings: ["The browser did not return audio duration metadata in time."] }), 10_000);
      const cleanup = () => {
        window.clearTimeout(timer);
        element.removeEventListener("loadedmetadata", onMetadata);
        element.removeEventListener("error", onError);
        signal?.removeEventListener("abort", onAbort);
        element.removeAttribute("src");
        element.load();
        URL.revokeObjectURL(url);
      };
      const finish = (metadata: Omit<MediaMetadata, "declaredMimeType">) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(metadata);
      };
      const onMetadata = () => finish(Number.isFinite(element.duration) && element.duration > 0
        ? { durationSeconds: element.duration, inspection: "complete" }
        : { inspection: "partial", warnings: ["The browser reported no usable duration."] });
      const onError = () => finish({ inspection: "partial", warnings: ["The browser could not decode metadata for this audio format. The original remains usable in supported players."] });
      const onAbort = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(abortError());
      };
      element.addEventListener("loadedmetadata", onMetadata, { once: true });
      element.addEventListener("error", onError, { once: true });
      signal?.addEventListener("abort", onAbort, { once: true });
      element.src = url;
      element.load();
    });
  }
}

/**
 * Content-addressed media boundary. Fingerprinting and inspection are actual
 * jobs; original insertion is atomic through the repository contract, so two
 * concurrent same-file imports cannot create two canonical originals.
 */
export class MediaAssetService {
  private readonly fingerprinter: MediaFingerprintService;
  private readonly inspector: MediaMetadataInspector;
  private readonly now: () => Date;
  private readonly unsubscribeJobs: () => void;

  constructor(private readonly options: MediaAssetServiceOptions) {
    this.fingerprinter = options.fingerprinter ?? new BrowserFingerprintService();
    this.inspector = options.inspector ?? new BrowserMediaMetadataInspector();
    this.now = options.now ?? (() => new Date());
    this.unsubscribeJobs = options.jobs.subscribe((jobs) => {
      for (const job of jobs) options.onJob?.(job);
    });
  }

  async inspect(input: MediaAssetInput, signal?: AbortSignal): Promise<MediaInspectionResult> {
    const fingerprintJob = this.options.jobs.enqueue({
      assetId: input.name || "unnamed-media",
      type: "fingerprint",
      run: ({ signal: jobSignal, reportProgress }) => withAbortSignals([signal, jobSignal], (combinedSignal) => this.fingerprinter.fingerprint(input.blob, {
        signal: combinedSignal,
        onProgress: ({ fraction }: BrowserFingerprintProgress) => reportProgress(fraction),
      })),
    });
    const fingerprintResult = resultOf<Awaited<ReturnType<MediaFingerprintService["fingerprint"]>>>(await fingerprintJob.completed);
    const inspectionJob = this.options.jobs.enqueue({
      assetId: fingerprintResult.sha256,
      type: "inspect",
      run: ({ signal: jobSignal }) => withAbortSignals([signal, jobSignal], async (combinedSignal) => {
        const metadata = await this.inspector.inspect(input, combinedSignal);
        return { ...metadata, declaredMimeType: input.declaredMimeType || "application/octet-stream" } satisfies MediaMetadata;
      }),
    });
    const metadata = resultOf<MediaMetadata>(await inspectionJob.completed);
    return {
      assetId: mediaAssetId(fingerprintResult.sha256),
      sizeBytes: fingerprintResult.sizeBytes,
      sha256: fingerprintResult.sha256,
      ...metadata,
    };
  }

  async ingest(input: MediaAssetInput, signal?: AbortSignal): Promise<MediaAssetIngestResult> {
    if (!this.options.repository) throw new Error("No media repository is configured for original storage.");
    const inspection = await this.inspect(input, signal);
    if (signal?.aborted) throw abortError();
    const existing = await this.options.repository.findByHash(inspection.sha256);
    if (existing) return { asset: existing, duplicate: true };

    const createdAt = this.now().toISOString();
    const candidate: MediaAsset = {
      id: inspection.assetId,
      kind: input.kind,
      original: {
        name: input.name,
        mimeType: input.declaredMimeType || "application/octet-stream",
        byteSize: input.blob.size,
        sha256: inspection.sha256,
        addedAt: createdAt,
      },
      metadata: {
        declaredMimeType: inspection.declaredMimeType,
        durationSeconds: inspection.durationSeconds,
        width: inspection.width,
        height: inspection.height,
        sampleRate: inspection.sampleRate,
        channels: inspection.channels,
        inspection: inspection.inspection,
        warnings: inspection.warnings,
      },
      derivatives: [],
      provenance: input.provenance ?? DEFAULT_PROVENANCE,
      sync: { state: "local-only" },
    };
    const stored = await this.options.repository.insertOriginalIfAbsent(candidate, input.blob);
    return { asset: stored.asset, duplicate: !stored.created };
  }

  dispose(): void {
    this.unsubscribeJobs();
    this.fingerprinter.dispose();
  }
}

export function mediaKindForMime(mimeType: string): MediaKind | undefined {
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  return undefined;
}
