import { workspaceDigest } from "./workspaceDigest";
import { splitCloudContent, readContentReferences, type ContentReference } from "./cloudContent";
import { decompressText, MAX_EXPANDED_TEXT_BYTES } from "../compressedText";
import { readMediaManifest, type CloudMediaReference } from "./cloudMedia";
import { SyncPushError } from "./syncFailure";
import type { NoctyriumState } from "../types";
import type { SnapshotEnvelope } from "./syncTypes";

export interface CloudSnapshot {
  _axomCloudFormat: 2;
  /** Plain compact JSON permits authenticated, revision-bound partial writes. */
  _axomDeltaFormat?: 1;
  _axomHashFormat?: 1 | 2;
  content: string;
  expandedBytes: number;
  media: CloudMediaReference[];
  sources: ContentReference[];
}
export async function prepareCloudSnapshot(envelope: SnapshotEnvelope): Promise<SnapshotEnvelope> {
  if (envelope.payloadBytes > MAX_EXPANDED_TEXT_BYTES) throw new SyncPushError({ kind: "rejected", rejection: "too-large", status: 0 }, "This workspace exceeds the safe account restore size.");
  const { workspace, objects, references } = await splitCloudContent(envelope.payload);
  const text = JSON.stringify(workspace);
  const packed: CloudSnapshot = { _axomCloudFormat: 2, _axomDeltaFormat: 1, _axomHashFormat: 2, content: text, expandedBytes: new TextEncoder().encode(text).length, media: [], sources: references };
  return { ...envelope, contentHash: await contentCheckpointHash(workspace, references), packed, contentObjects: objects, payloadBytes: new TextEncoder().encode(JSON.stringify(packed)).length };
}

export async function decodeCloudSnapshot(value: unknown): Promise<{ payload: NoctyriumState; media?: CloudMediaReference[]; sources?: ContentReference[]; hashFormat?: 1 | 2 }> {
  if (!value || typeof value !== "object") throw new Error("This protected version is invalid.");
  const candidate = value as Partial<CloudSnapshot>;
  if (!("_axomCloudFormat" in candidate)) return { payload: value as NoctyriumState };
  if (candidate._axomCloudFormat !== 2 || (candidate._axomHashFormat !== undefined && candidate._axomHashFormat !== 1 && candidate._axomHashFormat !== 2) || typeof candidate.content !== "string" || !Number.isSafeInteger(candidate.expandedBytes)
    || candidate.expandedBytes! < 0 || candidate.expandedBytes! > MAX_EXPANDED_TEXT_BYTES) throw new Error("This version needs a newer AXOM or is damaged.");
  const text = await decompressText(candidate.content, candidate.expandedBytes);
  const bytes = new TextEncoder().encode(text);
  if (bytes.length !== candidate.expandedBytes) throw new Error("This protected version failed its integrity check. Your current workspace is unchanged.");
  const sources = readContentReferences(candidate.sources);
  if (candidate.expandedBytes! + sources.reduce((total, entry) => total + entry.expandedBytes, 0) > MAX_EXPANDED_TEXT_BYTES) throw new Error("This workspace exceeds the safe restore size.");
  return { payload: JSON.parse(text) as NoctyriumState, media: readMediaManifest(candidate.media), sources, hashFormat: candidate._axomHashFormat };
}

/** Integrity covers every learner field and immutable source digest without downloading the source graph. */
export async function contentCheckpointHash(workspace: NoctyriumState, sources: ContentReference[]): Promise<string> {
  return (await workspaceDigest({ format: 2, workspace, sources })).hash;
}
