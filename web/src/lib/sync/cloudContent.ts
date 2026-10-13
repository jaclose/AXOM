import type { SupabaseClient } from "@supabase/supabase-js";
import { compressText, decompressText, sha256 } from "../compressedText";
import type { NoctyriumState } from "../types";

export const CONTENT_BUCKET = "workspace-content";
export const MAX_CONTENT_OBJECT_BYTES = 8 * 1024 * 1024;
const QUESTION_FIELDS = ["content", "stem", "options", "correctKey", "correctAnswerText", "explanation", "choiceRationales", "analyses", "extraction", "citation"] as const;
const DOCUMENT_FIELDS = ["rawText", "pageTexts"] as const;
export interface ContentReference { collection: "questions" | "documents"; id: string; hash: string; byteSize: number; expandedBytes: number }
export interface ContentUpload { reference: ContentReference; content: string }
// Zustand preserves untouched record identities. Cache projections so ordinary
// answer updates never recompress every source document in a large library.
const cache = new WeakMap<object, Promise<ContentUpload>>();
const contentCache = new Map<string, string>();
let cachedBytes = 0;
function cacheContent(hash: string, content: string) {
  if (contentCache.has(hash)) return;
  contentCache.set(hash, content);
  cachedBytes += content.length * 2;
  while (cachedBytes > 32 * 1024 * 1024 && contentCache.size) {
    const [key, oldest] = contentCache.entries().next().value!;
    contentCache.delete(key);
    cachedBytes -= oldest.length * 2;
  }
}

export async function splitCloudContent(state: NoctyriumState): Promise<{ workspace: NoctyriumState; objects: ContentUpload[] }> {
  const workspace = { ...state };
  const objects: ContentUpload[] = [];
  for (const collection of ["documents", "questions"] as const) {
    const fields = collection === "documents" ? DOCUMENT_FIELDS : QUESTION_FIELDS;
    const compact: Record<string, unknown>[] = [];
    for (const record of state[collection] ?? []) {
      let projection = cache.get(record);
      if (!projection) {
        projection = (async () => {
          const source = record as unknown as Record<string, unknown>;
          const text = JSON.stringify(Object.fromEntries(fields.filter((key) => source[key] !== undefined).map((key) => [key, source[key]])));
          const content = await compressText(text);
          const bytes = new TextEncoder().encode(content);
          if (bytes.length > MAX_CONTENT_OBJECT_BYTES) throw new Error("A source document exceeds the compressed file limit. Split the source into smaller files before syncing.");
          return { reference: { collection, id: record.id, hash: await sha256(bytes), byteSize: bytes.length, expandedBytes: new TextEncoder().encode(text).length }, content };
        })();
        cache.set(record, projection);
      }
      const object = await projection;
      objects.push(object);
      cacheContent(object.reference.hash, object.content);
      const copy: Record<string, unknown> = { ...record };
      for (const field of fields) delete copy[field];
      compact.push(copy);
    }
    // Wire-only projection. Canonical workspace consumers receive hydrated records.
    Object.assign(workspace, { [collection]: compact });
  }
  return { workspace, objects };
}

export function readContentReferences(value: unknown): ContentReference[] {
  if (!Array.isArray(value) || value.length > 30_000) throw new Error("The source-content index is invalid.");
  const ids = new Set<string>();
  let expanded = 0;
  return value.map((entry: ContentReference) => {
    const key = `${entry?.collection}:${entry?.id}`;
    if (!entry || !["questions", "documents"].includes(entry.collection) || typeof entry.id !== "string" || !entry.id || ids.has(key)
      || !/^[a-f0-9]{64}$/.test(entry.hash) || !Number.isSafeInteger(entry.byteSize) || entry.byteSize <= 0 || entry.byteSize > MAX_CONTENT_OBJECT_BYTES
      || !Number.isSafeInteger(entry.expandedBytes) || entry.expandedBytes < 0) throw new Error("The source-content index is invalid.");
    expanded += entry.expandedBytes;
    if (expanded > 256 * 1024 * 1024) throw new Error("The source library exceeds the safe restore size.");
    ids.add(key);
    return entry;
  });
}

export async function uploadCloudContent(client: SupabaseClient, userId: string, objects: ContentUpload[], previous: ContentReference[], assertCurrent: () => Promise<void>): Promise<void> {
  const known = new Set(previous.map((entry) => entry.hash));
  for (const { reference, content } of objects) {
    if (known.has(reference.hash)) continue;
    await assertCurrent();
    const path = `${userId}/${reference.hash}`;
    const bucket = client.storage.from(CONTENT_BUCKET);
    const result = await bucket.upload(path, new Blob([content], { type: "text/plain" }), { contentType: "text/plain", upsert: false, cacheControl: "31536000" });
    if (result.error) {
      if (!("statusCode" in result.error) || String(result.error.statusCode) !== "409") throw result.error;
      const existing = await bucket.download(path);
      if (existing.error || !existing.data || await sha256(new Uint8Array(await existing.data.arrayBuffer())) !== reference.hash) throw new Error("A source file could not be verified in your account.");
    }
    known.add(reference.hash);
  }
  await assertCurrent();
}

export async function hydrateCloudContent(client: SupabaseClient, userId: string, state: NoctyriumState, value: unknown, assertCurrent: () => Promise<void>): Promise<NoctyriumState> {
  const references = readContentReferences(value);
  const workspace = { ...state, questions: [...state.questions], documents: [...state.documents] };
  const byId = { questions: new Map(state.questions.map((q, i) => [q.id, i])), documents: new Map(state.documents.map((d, i) => [d.id, i])) };
  if (references.length !== state.questions.length + state.documents.length) throw new Error("This account version is missing source records.");
  // Bounded concurrency keeps a large library from opening thousands of requests.
  let cursor = 0;
  async function worker() {
    while (cursor < references.length) {
      const reference = references[cursor++];
      const index = byId[reference.collection].get(reference.id);
      if (index === undefined) throw new Error("A source reference does not belong to this workspace.");
      await assertCurrent();
      let packed = contentCache.get(reference.hash);
      if (packed === undefined) {
        const { data, error } = await client.storage.from(CONTENT_BUCKET).download(`${userId}/${reference.hash}`);
        if (error || !data || data.size !== reference.byteSize || await sha256(new Uint8Array(await data.arrayBuffer())) !== reference.hash) throw new Error("A source file could not be downloaded or verified. Your current workspace is unchanged.");
        packed = await data.text();
        cacheContent(reference.hash, packed);
      }
      const text = await decompressText(packed, reference.expandedBytes);
      if (new TextEncoder().encode(text).length !== reference.expandedBytes) throw new Error("A source file has an invalid expanded size.");
      const source = JSON.parse(text) as Record<string, unknown>;
      const allowed: readonly string[] = reference.collection === "documents" ? DOCUMENT_FIELDS : QUESTION_FIELDS;
      if (!source || typeof source !== "object" || Array.isArray(source) || Object.keys(source).some((key) => !allowed.includes(key))) throw new Error("A source file contains unexpected fields.");
      Object.assign(workspace[reference.collection][index] = { ...workspace[reference.collection][index] }, source);
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, references.length) }, worker));
  await assertCurrent();
  return workspace;
}

export function clearCloudContentCache(): void { contentCache.clear(); cachedBytes = 0; }
