import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename } from "node:path";

export type DuplicateKind =
  | "exact-duplicate"
  | "same-filename-different-content"
  | "same-content-different-filename"
  | "unique";

export interface FingerprintEntry {
  path: string;
  name: string;
  size: number;
  hash: string;
}

export interface DuplicateMatch {
  kind: DuplicateKind;
  /** Present for a same-content group. Filename collisions have multiple hashes. */
  hash?: string;
  hashes?: string[];
  paths: string[];
}

export interface FingerprintOptions {
  signal?: AbortSignal;
  onProgress?: (processedBytes: number, totalBytes: number) => void;
}

interface FingerprintedPath {
  path: string;
  name: string;
  size: number;
  hash: string;
}

export function hashBytes(input: Uint8Array | ArrayBuffer | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input instanceof Uint8Array ? input : new Uint8Array(input);
  return createHash("sha256").update(bytes).digest("hex");
}

/** Stream file bytes through SHA-256 so large assets do not load into memory at once. */
export async function fingerprintFile(filePath: string, options: FingerprintOptions = {}): Promise<string> {
  if (options.signal?.aborted) throw abortError();
  const before = await stat(filePath);
  if (!before.isFile()) throw new Error(`Not a regular file: ${filePath}`);

  const hash = createHash("sha256");
  let processedBytes = 0;
  const stream = createReadStream(filePath, { highWaterMark: 1024 * 1024, signal: options.signal });
  for await (const chunk of stream) {
    if (options.signal?.aborted) throw abortError();
    hash.update(chunk);
    processedBytes += chunk.byteLength;
    options.onProgress?.(processedBytes, before.size);
  }
  if (options.signal?.aborted) throw abortError();

  const after = await stat(filePath);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino) {
    throw new Error(`File changed while it was being fingerprinted: ${filePath}`);
  }
  return hash.digest("hex");
}

function abortError(): Error {
  const error = new Error("Fingerprinting was cancelled.");
  error.name = "AbortError";
  return error;
}

/** Identify exact content duplicates and same-name collisions as separate findings. */
export async function detectDuplicateMedia(
  entries: Array<{ path: string; name?: string; size: number }>,
  options: FingerprintOptions = {},
): Promise<DuplicateMatch[]> {
  const byContent = new Map<string, FingerprintedPath[]>();
  const totalBytes = entries.reduce((sum, item) => sum + item.size, 0);
  let completed = 0;
  for (const entry of entries) {
    const fileStat = await stat(entry.path);
    if (!fileStat.isFile()) throw new Error(`Not a regular file: ${entry.path}`);
    if (entry.size !== fileStat.size) throw new Error(`File size changed before fingerprinting: ${entry.path}`);
    const hash = await fingerprintFile(entry.path, {
      signal: options.signal,
      onProgress: (processed) => options.onProgress?.(completed + processed, totalBytes),
    });
    const item = { path: entry.path, name: entry.name ?? basename(entry.path), size: fileStat.size, hash };
    const key = `${item.size}:${hash}`;
    const bucket = byContent.get(key) ?? [];
    bucket.push(item);
    byContent.set(key, bucket);
    completed += fileStat.size;
  }

  const matches: DuplicateMatch[] = [];
  for (const bucket of byContent.values()) {
    if (bucket.length < 2) continue;
    const names = new Set(bucket.map((item) => item.name.toLowerCase()));
    matches.push({
      hash: bucket[0].hash,
      kind: names.size === 1 ? "exact-duplicate" : "same-content-different-filename",
      paths: bucket.map((item) => item.path).sort(),
    });
  }

  const byName = new Map<string, FingerprintedPath[]>();
  for (const bucket of byContent.values()) {
    for (const item of bucket) {
      const key = item.name.toLowerCase();
      const named = byName.get(key) ?? [];
      named.push(item);
      byName.set(key, named);
    }
  }
  for (const bucket of byName.values()) {
    const hashes = [...new Set(bucket.map((item) => item.hash))].sort();
    if (hashes.length < 2) continue;
    matches.push({
      kind: "same-filename-different-content",
      hashes,
      paths: bucket.map((item) => item.path).sort(),
    });
  }

  return matches.sort((a, b) => a.paths[0].localeCompare(b.paths[0]) || a.kind.localeCompare(b.kind));
}

export async function fingerprintSummary(entries: Array<{ path: string; name?: string; size: number }>): Promise<FingerprintEntry[]> {
  const result: FingerprintEntry[] = [];
  for (const entry of entries) {
    const fileStat = await stat(entry.path);
    if (entry.size !== fileStat.size) throw new Error(`File size changed before fingerprinting: ${entry.path}`);
    result.push({
      path: entry.path,
      name: entry.name ?? basename(entry.path),
      size: fileStat.size,
      hash: await fingerprintFile(entry.path),
    });
  }
  return result;
}
