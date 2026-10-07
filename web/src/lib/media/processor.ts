export type MediaKind = "audio" | "image" | "video" | "unknown";
export type MediaProcessingState =
  | "queued"
  | "inspecting"
  | "optimizing"
  | "generating-preview"
  | "ready"
  | "skipped"
  | "failed"
  | "cancelled";

export interface MediaInput {
  id: string;
  name: string;
  path: string;
  kind: MediaKind;
  sizeBytes: number;
  mimeType?: string;
}

export interface MediaInspection {
  input: MediaInput;
  state: MediaProcessingState;
  /** The sender's declared MIME type. This is not a verified container/codec. */
  declaredMimeType?: string;
  codec?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  bitrateKbps?: number;
  sampleRate?: number;
  reason?: string;
  /** A byte-budget observation, not a claim about codec efficiency. */
  withinSizeBudget?: boolean;
  optimizationCandidate?: boolean;
}

export interface OptimizationOptions {
  preferDesktop?: boolean;
  maxWidth?: number;
  maxHeight?: number;
  targetBitrateKbps?: number;
  allowLossy?: boolean;
  force?: boolean;
}

export interface OptimizationResult {
  input: MediaInput;
  state: MediaProcessingState;
  originalSizeBytes: number;
  optimizedSizeBytes?: number;
  spaceSavedBytes?: number;
  codec?: string;
  durationSeconds?: number;
  wasOptimized: boolean;
  reason?: string;
  outputPath?: string;
}

/** Result supplied by a real desktop transcoder. The adapter owns file creation. */
export interface TranscodedMedia {
  outputPath: string;
  outputSizeBytes: number;
  codec?: string;
  durationSeconds?: number;
}

export type DesktopTranscoder = (
  input: MediaInput,
  options: OptimizationOptions | undefined,
  signal?: AbortSignal,
) => Promise<TranscodedMedia>;

export interface MediaProcessor {
  inspect(input: MediaInput): Promise<MediaInspection>;
  optimize(input: MediaInput, options?: OptimizationOptions, signal?: AbortSignal): Promise<OptimizationResult>;
}

export const AUDIO_EFFICIENCY_LIMIT_BYTES = 12 * 1024 * 1024;
export const IMAGE_EFFICIENCY_LIMIT_BYTES = 2.5 * 1024 * 1024;
export const VIDEO_EFFICIENCY_LIMIT_BYTES = 30 * 1024 * 1024;

export function classifyMediaKind(mimeType?: string, fileName?: string): MediaKind {
  const raw = `${mimeType ?? ""} ${fileName ?? ""}`.toLowerCase();
  if (/(audio|mp3|wav|m4a|aac|ogg|flac)/.test(raw)) return "audio";
  if (/(video|mp4|webm|mov|m4v)/.test(raw)) return "video";
  if (/(image|png|jpe?g|gif|webp|avif|svg)/.test(raw)) return "image";
  return "unknown";
}

export function getOptimizationPolicy(kind: MediaKind): { thresholdBytes: number; recommend: string } {
  switch (kind) {
    case "audio":
      return { thresholdBytes: AUDIO_EFFICIENCY_LIMIT_BYTES, recommend: "Prefer AAC/Opus for long ambient layers and keep source files as the canonical copy." };
    case "image":
      return { thresholdBytes: IMAGE_EFFICIENCY_LIMIT_BYTES, recommend: "Downscale aggressively only when original resolution is unreasonable for ambient scenes." };
    case "video":
      return { thresholdBytes: VIDEO_EFFICIENCY_LIMIT_BYTES, recommend: "Generate poster images and avoid re-encoding unless a desktop pipeline is available." };
    default:
      return { thresholdBytes: 0, recommend: "No optimization policy defined for this media type." };
  }
}

export async function inspectMediaInput(input: MediaInput): Promise<MediaInspection> {
  const kind = input.kind || classifyMediaKind(input.mimeType, input.name);
  const threshold = getOptimizationPolicy(kind).thresholdBytes;
  return {
    input,
    state: "ready",
    declaredMimeType: input.mimeType,
    withinSizeBudget: threshold > 0 && input.sizeBytes <= threshold,
    optimizationCandidate: threshold > 0 && input.sizeBytes > threshold,
    reason: threshold === 0
      ? "No size budget is defined for this media type."
      : input.sizeBytes > threshold
        ? "This file is above AXOM’s size budget. Its codec and quality have not been inspected."
        : "This file is within AXOM’s size budget. Its codec and quality have not been inspected.",
  };
}

export class BrowserMediaProcessor implements MediaProcessor {
  async inspect(input: MediaInput): Promise<MediaInspection> {
    return inspectMediaInput(input);
  }

  async optimize(input: MediaInput, _options?: OptimizationOptions, _signal?: AbortSignal): Promise<OptimizationResult> {
    const inspection = await this.inspect(input);
    return {
      input,
      state: "skipped",
      originalSizeBytes: input.sizeBytes,
      optimizedSizeBytes: input.sizeBytes,
      spaceSavedBytes: 0,
      wasOptimized: false,
      reason: "Browser optimization is unavailable here. Desktop transcoding is the only safe place for lossy conversion.",
      codec: inspection.codec,
      durationSeconds: inspection.durationSeconds,
      outputPath: undefined,
    };
  }
}

export class DesktopMediaProcessor implements MediaProcessor {
  constructor(private readonly transcode?: DesktopTranscoder) {}

  async inspect(input: MediaInput): Promise<MediaInspection> {
    const base = await inspectMediaInput(input);
    return {
      ...base,
      reason: this.transcode
        ? "A desktop transcoder is configured. The file can be optimized when it is above the size budget."
        : "No desktop transcoder is configured. The original will be kept unchanged.",
      optimizationCandidate: Boolean(this.transcode) && base.optimizationCandidate,
      state: this.transcode ? "ready" : "skipped",
    };
  }

  async optimize(input: MediaInput, options?: OptimizationOptions, signal?: AbortSignal): Promise<OptimizationResult> {
    if (signal?.aborted) {
      return {
        input,
        state: "cancelled",
        originalSizeBytes: input.sizeBytes,
        wasOptimized: false,
        reason: "Optimization was cancelled before it started.",
      };
    }
    if (!this.transcode) {
      return {
        input,
        state: "skipped",
        originalSizeBytes: input.sizeBytes,
        optimizedSizeBytes: input.sizeBytes,
        spaceSavedBytes: 0,
        wasOptimized: false,
        reason: "No desktop transcoder is configured. The original was not changed.",
      };
    }
    const threshold = getOptimizationPolicy(input.kind).thresholdBytes;
    if (input.sizeBytes <= threshold && !options?.force) {
      return {
        input,
        state: "skipped",
        originalSizeBytes: input.sizeBytes,
        optimizedSizeBytes: input.sizeBytes,
        spaceSavedBytes: 0,
        wasOptimized: false,
        reason: "The file is within AXOM’s size budget. The original was not changed.",
      };
    }

    try {
      const derivative = await this.transcode(input, options, signal);
      if (signal?.aborted) {
        return { input, state: "cancelled", originalSizeBytes: input.sizeBytes, wasOptimized: false, reason: "Optimization was cancelled." };
      }
      if (!derivative.outputPath || derivative.outputPath === input.path) {
        throw new Error("A transcoder must write a separate derivative and keep the original unchanged.");
      }
      if (!Number.isSafeInteger(derivative.outputSizeBytes) || derivative.outputSizeBytes <= 0) {
        throw new Error("The transcoder returned an invalid derivative size.");
      }
      return {
        input,
        state: "ready",
        originalSizeBytes: input.sizeBytes,
        optimizedSizeBytes: derivative.outputSizeBytes,
        spaceSavedBytes: Math.max(0, input.sizeBytes - derivative.outputSizeBytes),
        wasOptimized: true,
        reason: derivative.outputSizeBytes < input.sizeBytes
          ? "A separate playback derivative was created. The original is unchanged."
          : "A separate playback derivative was created. It is not smaller than the original.",
        codec: derivative.codec,
        durationSeconds: derivative.durationSeconds,
        outputPath: derivative.outputPath,
      };
    } catch (error) {
      if (signal?.aborted) {
        return { input, state: "cancelled", originalSizeBytes: input.sizeBytes, wasOptimized: false, reason: "Optimization was cancelled." };
      }
      return {
        input,
        state: "failed",
        originalSizeBytes: input.sizeBytes,
        wasOptimized: false,
        reason: error instanceof Error ? error.message : "The desktop processor failed. The original is unchanged.",
      };
    }
  }
}

export const DEFAULT_MEDIA_PROCESSOR: MediaProcessor = new BrowserMediaProcessor();
