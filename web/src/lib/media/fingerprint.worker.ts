import { sha256 } from "@noble/hashes/sha2.js";

interface FingerprintRequest { type: "fingerprint"; id: number; blob: Blob }
interface CancelRequest { type: "cancel"; id: number }
type WorkerRequest = FingerprintRequest | CancelRequest;
type WorkerResponse =
  | { type: "progress"; id: number; processedBytes: number; totalBytes: number }
  | { type: "complete"; id: number; sha256: string; sizeBytes: number }
  | { type: "failed"; id: number; message: string };

interface FingerprintWorkerScope {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (message: WorkerResponse) => void;
}

const scope = globalThis as unknown as FingerprintWorkerScope;
const CHUNK_BYTES = 1024 * 1024;
const cancelled = new Set<number>();

scope.onmessage = (event) => {
  const request = event.data;
  if (request.type === "cancel") {
    cancelled.add(request.id);
    return;
  }
  void fingerprint(request);
};

async function fingerprint({ id, blob }: FingerprintRequest): Promise<void> {
  try {
    const digest = sha256.create();
    let processedBytes = 0;
    while (processedBytes < blob.size) {
      if (cancelled.has(id)) {
        cancelled.delete(id);
        return;
      }
      const end = Math.min(blob.size, processedBytes + CHUNK_BYTES);
      digest.update(new Uint8Array(await blob.slice(processedBytes, end).arrayBuffer()));
      processedBytes = end;
      scope.postMessage({ type: "progress", id, processedBytes, totalBytes: blob.size });
    }
    if (cancelled.has(id)) {
      cancelled.delete(id);
      return;
    }
    scope.postMessage({ type: "complete", id, sha256: toHex(digest.digest()), sizeBytes: blob.size });
  } catch (error) {
    if (cancelled.delete(id)) return;
    scope.postMessage({ type: "failed", id, message: error instanceof Error ? error.message : "Fingerprinting failed." });
  }
}

function toHex(bytes: Uint8Array): string {
  let output = "";
  for (const byte of bytes) output += byte.toString(16).padStart(2, "0");
  return output;
}
