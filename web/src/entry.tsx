import { shouldOpenWorkspace } from "./lib/landing/entry";

const STARTUP_RELOAD_KEY = "axom.startup-reload.v1";
const WEB_WORKER_PATH = "./sw.js";

function registerStartupWorker(): Promise<ServiceWorkerRegistration | undefined> {
  if ("__TAURI_INTERNALS__" in window || !import.meta.env.PROD || !("serviceWorker" in navigator) || !/^https?:$/.test(location.protocol)) {
    return Promise.resolve(undefined);
  }
  return navigator.serviceWorker.register(WEB_WORKER_PATH, { updateViaCache: "none" }).then((registration) => {
    const announce = () => {
      if (registration.waiting) window.dispatchEvent(new Event("axom:web-update-ready"));
    };
    announce();
    registration.addEventListener("updatefound", () => {
      registration.installing?.addEventListener("statechange", announce);
    });
    return registration;
  }).catch(() => undefined);
}

async function activateWaitingStartupUpdate(): Promise<void> {
  if ("__TAURI_INTERNALS__" in window || !("serviceWorker" in navigator) || !/^https?:$/.test(location.protocol)) return;
  const registered = await startupWorkerRegistration;
  const registration = registered
    ?? await navigator.serviceWorker.getRegistration(new URL(WEB_WORKER_PATH, document.baseURI))
    ?? await registerStartupWorker();
  if (!registration) return;
  await registration.update();
  if (registration.installing) await waitForStartupWorker(registration.installing, "installed");
  if (!registration.waiting) return;
  const worker = registration.waiting;
  const activated = waitForStartupWorker(worker, "activated");
  worker.postMessage({ type: "AXOM_ACTIVATE_UPDATE" });
  await activated;
}

function waitForStartupWorker(worker: ServiceWorker, expected: "installed" | "activated"): Promise<void> {
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

const openWorkspace = () => shouldOpenWorkspace(new URL(location.href), "__TAURI_INTERNALS__" in window,
  window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);

const workspaceRequested = openWorkspace();
// Register before loading the workspace so a stale shell can still stage its replacement.
const startupWorkerRegistration = workspaceRequested ? registerStartupWorker() : Promise.resolve(undefined);

async function openEntry() {
  if (workspaceRequested) {
    await import("./main");
    return;
  }
  document.documentElement.dataset.landing = "true";
  const [{ createRoot }, { default: LandingPage }] = await Promise.all([
    import("react-dom/client"), import("./components/landing/LandingPage"),
  ]);
  const root = document.getElementById("root");
  if (root) createRoot(root).render(<LandingPage />);
  // Back/forward and legacy hash links must enter the canonical workspace too.
  window.addEventListener("hashchange", () => { if (openWorkspace()) location.reload(); });
}

function showStartupError(): void {
  const root = document.getElementById("root");
  if (!root) return;
  const message = document.createElement("p");
  message.textContent = "AXOM could not load. Check your connection or try again after an update.";
  const retry = document.createElement("button");
  retry.textContent = "Try again";
  retry.onclick = async () => {
    retry.disabled = true;
    retry.textContent = "Checking for updates…";
    try { await activateWaitingStartupUpdate(); } catch { /* Reload still asks the network for the latest shell. */ }
    try { sessionStorage.removeItem(STARTUP_RELOAD_KEY); } catch { /* Storage can be unavailable. */ }
    location.reload();
  };
  root.replaceChildren(message, retry);
}

async function reloadAfterAssetFailure(error: unknown): Promise<boolean> {
  if (!import.meta.env.PROD || !/preload|dynamically imported module|module script failed/i.test(String(error))) return false;
  try {
    if (sessionStorage.getItem(STARTUP_RELOAD_KEY) === "1") return false;
    sessionStorage.setItem(STARTUP_RELOAD_KEY, "1");
  } catch {
    return false;
  }
  // The workspace has not mounted, so refreshing its worker cannot interrupt edits.
  const root = document.getElementById("root");
  if (root) root.textContent = "AXOM is checking for a newer app version…";
  try { await activateWaitingStartupUpdate(); } catch { /* Reload still asks the network for the latest shell. */ }
  location.reload();
  return true;
}

void openEntry().then(() => {
  try { sessionStorage.removeItem(STARTUP_RELOAD_KEY); } catch { /* Storage can be unavailable. */ }
}).catch((error: unknown) => {
  // Nothing has opened yet, so one reload can recover an asset replaced by a deployment.
  void reloadAfterAssetFailure(error).then((reloading) => { if (!reloading) showStartupError(); });
});
