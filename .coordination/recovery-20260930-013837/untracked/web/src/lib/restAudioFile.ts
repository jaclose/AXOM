const DATABASE = "axom-device-alarm";
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("audio");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Device storage is unavailable for this alarm."));
  });
}
export async function saveRestAudio(file: File): Promise<void> {
  if (!/\.(wav|m4a|mp3)$/i.test(file.name)) throw new Error("Choose a WAV, M4A, or MP3 sound.");
  if (!file.size || file.size > 8 * 1024 * 1024) throw new Error("Choose a sound smaller than 8 MB.");
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("audio", "readwrite");
      transaction.objectStore("audio").put(file, "custom");
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(new Error("The alarm sound could not be saved."));
      transaction.onabort = () => reject(new Error("The alarm sound could not be saved."));
    });
  } finally { db.close(); }
}
export async function readRestAudio(): Promise<Blob | undefined> {
  const db = await database();
  try {
    return await new Promise<Blob | undefined>((resolve, reject) => {
      const request = db.transaction("audio").objectStore("audio").get("custom");
      request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : undefined);
      request.onerror = () => reject(new Error("The saved alarm sound is unavailable."));
    });
  } finally { db.close(); }
}
