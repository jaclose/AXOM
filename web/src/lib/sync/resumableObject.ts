/** Common immutable-object tus transfer for account originals and reviewed
 * academic packages. Supabase Storage owns the bytes and access policies;
 * this module creates no alternate object store or index. */
export const RESUMABLE_CHUNK_BYTES = 6 * 1024 * 1024;

export interface ResumableStorageConfig {
  endpoint: string;
  headers: Record<string, string>;
}

export async function uploadResumableObject(
  blob: Blob,
  bucket: string,
  objectPath: string,
  checksum: string,
  config: ResumableStorageConfig,
  assertCurrent: () => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  const aborted = () => new DOMException("The upload was cancelled. Local originals and prepared questions are unchanged.", "AbortError");
  if (signal?.aborted) throw aborted();
  const { Upload } = await import("tus-js-client");
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error); else resolve();
    };
    const verify = async () => {
      if (signal?.aborted) throw aborted();
      await assertCurrent();
      if (signal?.aborted) throw aborted();
    };
    const upload = new Upload(blob, {
      endpoint: config.endpoint,
      headers: config.headers,
      chunkSize: RESUMABLE_CHUNK_BYTES,
      uploadDataDuringCreation: true,
      retryDelays: null,
      removeFingerprintOnSuccess: true,
      // Preserve the original upload's deployed fingerprint so partially
      // transferred originals are still resumable after this refactor.
      fingerprint: async () => bucket === "workspace-originals"
        ? `axom-original-v1:${config.endpoint}:${objectPath}:${checksum}`
        : `axom-immutable-v1:${config.endpoint}:${bucket}:${objectPath}:${checksum}`,
      metadata: { bucketName: bucket, objectName: objectPath, contentType: blob.type, cacheControl: "31536000" },
      onBeforeRequest: verify,
      onError: () => finish(signal?.aborted ? aborted() : new Error("The file upload was interrupted. Keep the local source and retry when connected.")),
      onSuccess: () => finish(signal?.aborted ? aborted() : undefined),
    });
    const onAbort = () => {
      // tus retains its fingerprint so the next authorized attempt can
      // resume this upload without re-sending all completed chunks.
      void upload.abort().catch(() => undefined);
      finish(aborted());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) { onAbort(); return; }
    void upload.findPreviousUploads().then(async previous => {
      await verify();
      const endpoint = new URL(config.endpoint);
      const matching = previous.find(item => {
        if (!item.uploadUrl) return false;
        // Supabase's resumable upload URLs expire after 24 hours. An old
        // fingerprint is not a reusable credential or a permanent retry token.
        const created = item.creationTime ? Date.parse(item.creationTime) : NaN;
        if (Number.isFinite(created) && (Date.now() - created > 23 * 60 * 60 * 1000 || created > Date.now() + 5 * 60_000)) return false;
        try {
          const url = new URL(item.uploadUrl);
          return url.origin === endpoint.origin && url.pathname.startsWith(`${endpoint.pathname}/`);
        } catch { return false; }
      });
      if (matching) upload.resumeFromPreviousUpload(matching);
      await verify();
      upload.start();
    }).catch(error => finish(error instanceof Error ? error : new Error("The resumable transfer could not start.")));
  });
}
