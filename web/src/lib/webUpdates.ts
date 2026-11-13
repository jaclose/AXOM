const WORKER_PATH = "./sw.js";

/** Called only after an explicit refresh click and a verified data checkpoint. */
export async function activateWaitingWebUpdate(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration(new URL(WORKER_PATH, document.baseURI));
  if (!registration) return;
  // An update() promise completing is not proof that a replacement worker
  // installed. Keep the current window open when the old worker remains active.
  const previouslyActive = registration.active;
  await registration.update();
  if (registration.installing) await waitForWorker(registration.installing, "installed");
  if (!registration.waiting) {
    // Another tab may have activated a different worker while update() ran.
    // This is worker-identity evidence, not proof of the expected build ID.
    if (registration.active && registration.active !== previouslyActive
      && registration.active.state === "activated") return;
    throw new Error("The new web build could not be staged. Your current app remains open; check your connection and try again.");
  }
  const worker = registration.waiting;
  const activated = waitForWorker(worker, "activated");
  worker.postMessage({ type: "AXOM_ACTIVATE_UPDATE" });
  await activated;
}

function waitForWorker(worker: ServiceWorker, expected: "installed" | "activated"): Promise<void> {
  if (worker.state === expected || worker.state === "activated") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); worker.removeEventListener("statechange", check); };
    const check = () => {
      if (worker.state === expected || worker.state === "activated") { cleanup(); resolve(); }
      else if (worker.state === "redundant") { cleanup(); reject(new Error("The new web build could not be staged. Check your connection and try again.")); }
    };
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("Preparing the web update timed out. Your current app is still open; try again later."));
    }, 20_000);
    worker.addEventListener("statechange", check);
    check();
  });
}

/**
 * A failed screen can contain unsaved input, so never automatically reload.
 * The error is announced (the update watcher offers a review) but NOT
 * swallowed: preventDefault() would make the failed import resolve to
 * `undefined`, turning a clear "chunk failed" into a TypeError deep inside the
 * caller. Route screens surface it through RouteErrorBoundary instead.
 */
export function installChunkRecovery(): void {
  window.addEventListener("vite:preloadError", () => {
    window.dispatchEvent(new Event("axom:chunk-load-error"));
  });
}
