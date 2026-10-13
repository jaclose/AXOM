import { loadSupabase } from "../account/supabase";
import { CATALOG_BUCKET, MAX_CATALOG_FILE_BYTES, currentReleases, parseRelease, parseEntry, parseCatalogFile, safeCatalogPath, verifyCatalogBytes, type CatalogEntry, type CatalogRelease } from "./model";
export interface CloudCatalog { releases: CatalogRelease[]; entries: CatalogEntry[]; }
export async function catalogClient() {
  const client = await loadSupabase();
  if (!client) throw new Error("The shared library is not configured on this AXOM build. Your personal material is still available below.");
  return client;
}
function backendError(error: { code?: string; message?: string }): Error {
  if (["42P01", "PGRST205", "PGRST202"].includes(error.code ?? "")) return new Error("The shared library database has not been enabled yet. This is a setup issue, not an empty question bank.");
  return new Error("The shared library could not be reached. Check your connection and retry; your progress is unchanged.");
}
/** Only metadata at startup. All pages are read, or an explicit capacity error is returned. */
export async function listCloudCatalog(signal: AbortSignal): Promise<CloudCatalog> {
  const client = await catalogClient();
  const releases: CatalogRelease[] = [];
  for (let page = 0; page < 20; page++) {
    const { data, error } = await client.from("academic_catalog_releases")
      .select("id,catalog_key,version,title,published_at").eq("status", "published")
      .order("id").range(page * 200, page * 200 + 199).abortSignal(signal);
    if (error) throw backendError(error);
    releases.push(...(data ?? []).map(parseRelease));
    if ((data?.length ?? 0) < 200) break;
    if (page === 19) throw new Error("The shared catalog needs pagination refinement before this many releases can be displayed.");
  }
  const current = currentReleases(releases), entries: CatalogEntry[] = [];
  for (const release of current) {
    for (let page = 0; page < 50; page++) {
      const { data, error } = await client.from("academic_catalog_entries")
        .select("release_id,id,kind,title,module,term,week,question_count,image_question_count,activity_count,payload_path,source_label")
        .eq("release_id", release.id).order("id").range(page * 200, page * 200 + 199).abortSignal(signal);
      if (error) throw backendError(error);
      const parsed = (data ?? []).map(parseEntry);
      if (parsed.some(e => e.release_id !== release.id)) throw new Error("Catalog release identity mismatch.");
      entries.push(...parsed);
      if ((data?.length ?? 0) < 200) break;
      if (page === 49) throw new Error("This release exceeds the supported catalog size. Nothing was silently omitted.");
    }
  }
  return { releases: current, entries };
}
export async function readCloudFile(releaseId: string, path: string, signal: AbortSignal): Promise<Uint8Array> {
  signal.throwIfAborted();
  const client = await catalogClient();
  const { data, error } = await client.from("academic_catalog_files")
    .select("release_id,path,storage_path,sha256,byte_size,mime_type")
    .eq("release_id", releaseId).eq("path", safeCatalogPath(path)).abortSignal(signal).single();
  if (error) throw backendError(error);
  const file = parseCatalogFile(data);
  if (file.release_id !== releaseId || file.path !== path) throw new Error("The catalog returned a different asset.");
  const signed = await client.storage.from(CATALOG_BUCKET).createSignedUrl(file.storage_path, 120);
  signal.throwIfAborted();
  if (signed.error || !signed.data?.signedUrl) throw new Error("This content is not available to this account or its access expired. Refresh the library.");
  const url = new URL(signed.data.signedUrl);
  const standIn = import.meta.env.DEV && typeof window !== "undefined"
    ? (window as Window & { __AXOM_E2E_ACCOUNT__?: { url?: string } }).__AXOM_E2E_ACCOUNT__?.url : undefined;
  const expectedOrigin = standIn ?? import.meta.env.VITE_SUPABASE_URL;
  if (!expectedOrigin || url.origin !== new URL(expectedOrigin).origin) throw new Error("Unexpected content host.");
  const response = await fetch(url, { signal, credentials: "omit", cache: "no-store", redirect: "error" });
  if (!response.ok || !response.body) throw new Error("The content download failed. Retry without changing your existing library.");
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      length += part.value.byteLength;
      if (length > file.byte_size || length > MAX_CATALOG_FILE_BYTES) throw new Error("The content exceeds its declared size.");
      chunks.push(part.value);
    }
  } catch (cause) { await reader.cancel().catch(() => {}); throw cause; }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  await verifyCatalogBytes(file, bytes); signal.throwIfAborted();
  return bytes;
}
