/** Lossless text compression. The prefix is versioned; legacy plain JSON stays readable. */
const PREFIX = "AXOM_GZIP_V1:";
export const MAX_EXPANDED_TEXT_BYTES = 256 * 1024 * 1024;

export function bytesToBase64(bytes: Uint8Array): string {
  let text = "";
  for (let at = 0; at < bytes.length; at += 16384) text += String.fromCharCode(...bytes.subarray(at, at + 16384));
  return btoa(text);
}

export function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

export async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function compressText(text: string): Promise<string> {
  if (text.length < 4096 || typeof CompressionStream === "undefined") return text;
  const bytes = new TextEncoder().encode(text);
  const stream = new ReadableStream<BufferSource>({ start(controller) { controller.enqueue(bytes); controller.close(); } }).pipeThrough(new CompressionStream("gzip"));
  const compressed = PREFIX + bytesToBase64(new Uint8Array(await new Response(stream).arrayBuffer()));
  return compressed.length < bytes.length ? compressed : text;
}

export async function decompressText(text: string, limit = MAX_EXPANDED_TEXT_BYTES): Promise<string> {
  if (!text.startsWith(PREFIX)) {
    if (new TextEncoder().encode(text).length > limit) throw new Error("This workspace exceeds the safe restore size.");
    return text;
  }
  if (text.length > limit * 2 || typeof DecompressionStream === "undefined") throw new Error("This browser cannot open this compressed workspace. Update your browser and try again.");
  const bytes = base64ToBytes(text.slice(PREFIX.length));
  const reader = new ReadableStream<BufferSource>({ start(controller) { controller.enqueue(bytes); controller.close(); } }).pipeThrough(new DecompressionStream("gzip")).getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const chunks: string[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error("This workspace exceeds the safe restore size.");
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } finally { await reader.cancel().catch(() => undefined); }
}

/** Stable keys let a verified source graph reconstruct the same workspace hash. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) => {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const record = entry as Record<string, unknown>;
      return Object.fromEntries(Object.keys(record).sort().map((key) => [key, record[key]]));
    }
    return entry;
  });
}
