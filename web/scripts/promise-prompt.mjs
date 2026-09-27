/* global indexedDB */

/**
 * Finishing setup offers the one-time Promise prompt, whose modal scrim covers
 * the rest of the app. Defer it as a user would, then wait until the deferral
 * reaches the vault: writes are queued asynchronously, and a reload before they
 * land would bring the prompt back.
 */
export async function deferPromisePrompt(page) {
  await page.getByRole("dialog", { name: "A promise to yourself", exact: true })
    .getByRole("button", { name: "Review later", exact: true }).click();
  await page.waitForFunction(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("noctyrium-local-vault");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const raw = await new Promise((resolve, reject) => {
      const request = db.transaction("state").objectStore("state").get("noctyrium-state");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return JSON.parse(raw ?? "null")?.state?.profile?.promisePromptStatus?.state === "deferred";
  });
}
