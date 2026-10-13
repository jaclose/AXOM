import { sha256 } from "../compressedText";

interface Digest { hash: string; bytes: number }
const cache = new WeakMap<object, Promise<Digest>>();
const encoder = new TextEncoder();

/** Versioned tree digest of canonical JSON. Unchanged Zustand records retain
 * their hashes, so an answer never serializes every source document again.
 * The byte count still measures the complete canonical JSON for restore limits. */
export function workspaceDigest(value: unknown): Promise<Digest> {
  return digest(value, 0);
}
function digest(value: unknown, depth: number, ancestors = new Set<object>()): Promise<Digest> {
  if (depth > 64) return Promise.reject(new Error("Workspace nesting exceeds the safe sync limit."));
  if (!value || typeof value !== "object") {
    const text = JSON.stringify(value) ?? "null";
    const bytes = encoder.encode(text);
    return sha256(bytes).then(hash => ({ hash, bytes: bytes.length }));
  }
  if (ancestors.has(value)) return Promise.reject(new Error("A circular value cannot be synchronized."));
  const existing = cache.get(value);
  if (existing) return existing;
  const path = new Set(ancestors).add(value);
  const result = (async () => {
    if (Array.isArray(value)) {
      const children = await Promise.all(Array.from(value, item => digest(item, depth + 1, path)));
      return { hash: await sha256(encoder.encode(JSON.stringify(["array", children.map(child => child.hash)]))),
        bytes: 2 + Math.max(0, children.length - 1) + children.reduce((sum, child) => sum + child.bytes, 0) };
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).filter(key => !["undefined", "function", "symbol"].includes(typeof record[key])).sort();
    const children = await Promise.all(keys.map(key => digest(record[key], depth + 1, path)));
    return { hash: await sha256(encoder.encode(JSON.stringify(["object", keys.map((key, i) => [key, children[i].hash])]))),
      bytes: 2 + Math.max(0, keys.length - 1) + keys.reduce((sum, key, i) => sum + encoder.encode(JSON.stringify(key)).length + 1 + children[i].bytes, 0) };
  })();
  cache.set(value, result);
  void result.catch(() => cache.delete(value));
  return result;
}
