export type MediaAssetId = `sha256:${string}`;
export type MediaKind = "audio" | "image" | "video";
export type MediaDerivativeKind = "optimized-playback" | "preview" | "thumbnail" | "waveform";
export type MediaSyncState = "local-only" | "queued" | "synced";

export interface MediaProvenance {
  category: "first-party" | "external" | "user-supplied" | "generated" | "unknown";
  sourceName?: string;
  sourceUrl?: string;
  creator?: string;
  license?: string;
  retrievedAt?: string;
  modifications?: string;
}

/** Immutable description of the uploaded/original bytes. Never a derivative. */
export interface MediaOriginal {
  name: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  addedAt: string;
}

/** Disposable or regenerable output, identified separately from the original. */
export interface MediaDerivative {
  id: string;
  assetId: MediaAssetId;
  kind: MediaDerivativeKind;
  mimeType: string;
  byteSize: number;
  sha256: string;
  processor: string;
  createdAt: string;
}

export interface MediaMetadata {
  declaredMimeType: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
  sampleRate?: number;
  channels?: number;
  inspection: "complete" | "partial";
  warnings?: string[];
}

export type MediaAssetMetadata = MediaMetadata;

export interface MediaAsset {
  id: MediaAssetId;
  kind: MediaKind;
  original: MediaOriginal;
  metadata: MediaAssetMetadata;
  derivatives: MediaDerivative[];
  provenance: MediaProvenance;
  /** A future sync mapping; no upload is implied by this field. */
  sync: { state: MediaSyncState; remoteObjectId?: string };
}

export interface MediaReference {
  assetId: MediaAssetId;
  feature: "soundscape" | "question" | "lecture" | "recording" | "generated-media";
  featureRecordId: string;
  role?: string;
  createdAt: string;
}

export interface MediaAssetInput {
  blob: Blob;
  name: string;
  declaredMimeType: string;
  kind: MediaKind;
  provenance: MediaProvenance;
}

export interface MediaInspectionResult extends MediaAssetMetadata {
  /** SHA-256 content identity, distinct from local filename and original record IDs. */
  assetId: MediaAssetId;
  sha256: string;
  sizeBytes: number;
}

export interface MediaAssetRepository {
  findByHash(sha256: string): Promise<MediaAsset | undefined>;
  /** Must atomically enforce one original per hash and return the winner on races. */
  insertOriginalIfAbsent(asset: MediaAsset, original: Blob): Promise<{ asset: MediaAsset; created: boolean }>;
}

export function mediaAssetId(sha256: string): MediaAssetId {
  if (!/^[a-f\d]{64}$/i.test(sha256)) throw new Error("A media asset ID requires a SHA-256 digest.");
  return `sha256:${sha256.toLowerCase()}`;
}
