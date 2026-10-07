/** Original PDFs stay on this device, outside workspace snapshots and cloud sync. */
const DATABASE = "axom-decode-originals-v1";
const STORE = "originals";

function openSources(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("The original PDF could not be opened on this device."));
    request.onblocked = () => reject(new Error("Close other AXOM tabs and try attaching the PDF again."));
  });
}

export async function sourceChecksum(bytes: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function saveOriginalPdf(documentId: string, file: Blob): Promise<void> {
  const db = await openSources();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).put(file, documentId);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(new Error("The original PDF could not be saved. Check device storage and retry."));
      transaction.onabort = () => reject(new Error("Saving the original PDF was interrupted."));
    });
  } finally { db.close(); }
}

export async function readOriginalPdf(documentId: string): Promise<Blob | undefined> {
  const db = await openSources();
  try {
    return await new Promise<Blob | undefined>((resolve, reject) => {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).get(documentId);
      request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : undefined);
      request.onerror = () => reject(new Error("AXOM could not read the original PDF."));
    });
  } finally { db.close(); }
}
