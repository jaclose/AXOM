import { compressText, decompressText, MAX_EXPANDED_TEXT_BYTES, sha256 } from "./compressedText";

const FORMAT = "axom-packed-workspace-fallback";
const VERSION = 1;

/** These are fingerprints/pointers only, never a second copy of the old workspace. */
export interface LegacyFallbackBinding {
  primaryFingerprint: string | null;
  scopedFingerprint: string | null;
  activeUser: string | null;
  marker: string | null;
}

export interface PackedFallbackBinding {
  name: string;
  userId: string;
  valueFingerprint: string;
  baseFingerprint: string | null;
  /** Generation observed before an offline save from an empty workspace.
   * Optional to retain legacy v1 envelope compatibility. */
  deletionGeneration?: string | null;
  legacy: LegacyFallbackBinding;
}

interface PackedFallbackEnvelope extends PackedFallbackBinding {
  format: typeof FORMAT;
  version: typeof VERSION;
  expandedBytes: number;
  sha256: string;
  payload: string;
}

export interface PackedFallbackCopy extends PackedFallbackBinding {
  raw: string;
  value: string;
}

/** A separate atomic record leaves older raw records and their markers intact. */
export const packedFallbackKey = (name: string): string => `${name}:packed-fallback:v1`;

export class PackedFallbackError extends Error {
  constructor(message = "The compressed workspace fallback could not be verified. Keep this tab open and export saved work.", options?: ErrorOptions) {
    super(message, options);
    this.name = "PackedFallbackError";
  }
}

export function isPackedFallbackError(error: unknown): error is Error {
  return error instanceof Error && error.name === "PackedFallbackError";
}

/** Return no representation when the same browser cannot restore it or it saves no space. */
export async function packVaultFallback(value: string, binding: PackedFallbackBinding): Promise<string | undefined> {
  if (typeof DecompressionStream === "undefined") return undefined;
  const bytes = new TextEncoder().encode(value);
  if (bytes.byteLength > MAX_EXPANDED_TEXT_BYTES) throw new PackedFallbackError("This workspace exceeds the supported compressed recovery size.");
  const payload = await compressText(value);
  if (payload === value) return undefined;
  const envelope: PackedFallbackEnvelope = {
    ...binding, format: FORMAT, version: VERSION,
    expandedBytes: bytes.byteLength, sha256: await sha256(bytes), payload,
  };
  const raw = JSON.stringify(envelope);
  return raw.length < value.length ? raw : undefined;
}

/** A bad reserved record is an error, never permission to silently use stale raw data. */
export async function unpackVaultFallback(raw: string, name: string): Promise<PackedFallbackCopy> {
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.format !== FORMAT || value.version !== VERSION || value.name !== name
      || typeof value.userId !== "string" || typeof value.valueFingerprint !== "string"
      || !nullableString(value.baseFingerprint)
      || (value.deletionGeneration !== undefined && (
        !nullableString(value.deletionGeneration)
        || (typeof value.deletionGeneration === "string" && value.deletionGeneration.length === 0)
      )) || !isRecord(value.legacy)
      || !nullableString(value.legacy.primaryFingerprint) || !nullableString(value.legacy.scopedFingerprint)
      || !nullableString(value.legacy.activeUser) || !nullableString(value.legacy.marker)
      || typeof value.expandedBytes !== "number" || !Number.isSafeInteger(value.expandedBytes)
      || value.expandedBytes < 1 || value.expandedBytes > MAX_EXPANDED_TEXT_BYTES
      || typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sha256)
      || typeof value.payload !== "string") throw new PackedFallbackError();
    const envelope = value as unknown as PackedFallbackEnvelope;
    const decoded = await decompressText(envelope.payload, envelope.expandedBytes);
    const bytes = new TextEncoder().encode(decoded);
    if (bytes.byteLength !== envelope.expandedBytes || await sha256(bytes) !== envelope.sha256) throw new PackedFallbackError();
    const workspace: unknown = JSON.parse(decoded);
    if (!isRecord(workspace) || !isRecord(workspace.state)) throw new PackedFallbackError();
    return { name: envelope.name, userId: envelope.userId, valueFingerprint: envelope.valueFingerprint,
      baseFingerprint: envelope.baseFingerprint, deletionGeneration: envelope.deletionGeneration,
      legacy: envelope.legacy, raw, value: decoded };
  } catch (cause) {
    if (isPackedFallbackError(cause)) throw cause;
    throw new PackedFallbackError(undefined, { cause });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}
