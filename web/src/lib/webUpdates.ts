import { isDesktopApp } from "./appUpdates";

const WORKER_PATH = "./sw.js";

export function registerWebWorker(): void {
  if (isDesktopApp() || !import.meta.env.PROD || !("serviceWorker" in navigator) || !/^https?:$/.test(location.protocol)) return;
  const register = () => {
    void navigator.serviceWorker.register(WORKER_PATH, { updateViaCache: "none" }).then((registration) => {
      // Installation stages a successor; activation needs explicit consent.
      const announce = () => {
        if (registration.waiting) window.dispatchEvent(new Event("axom:web-update-ready"));
      };
      announce();
      registration.addEventListener("updatefound", () => {
        registration.installing?.addEventListener("statechange", announce);
      });
    }).catch(() => { /* Offline startup still uses the already-installed worker. */ });
  };
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}

/** Called only after an explicit refresh click and a verified data checkpoint. */
export async function activateWaitingWebUpdate(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration(new URL(WORKER_PATH, document.baseURI));
  if (!registration) return;
  await registration.update();
  if (registration.installing) await waitForWorker(registration.installing, "installed");
  if (!registration.waiting) return;
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

/** A failed screen can contain unsaved input, so never automatically reload. */
export function installChunkRecovery(): void {
  window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    window.dispatchEvent(new Event("axom:chunk-load-error"));
  });
}
