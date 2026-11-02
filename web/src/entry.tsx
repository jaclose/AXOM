import { shouldOpenWorkspace } from "./lib/landing/entry";

const STARTUP_RELOAD_KEY = "axom.startup-reload.v1";

const openWorkspace = () => shouldOpenWorkspace(new URL(location.href), "__TAURI_INTERNALS__" in window,
  window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);

async function openEntry() {
  if (openWorkspace()) {
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

function reloadAfterAssetFailure(error: unknown): boolean {
  if (!import.meta.env.PROD || !/preload|dynamically imported module|module script failed/i.test(String(error))) return false;
  try {
    if (sessionStorage.getItem(STARTUP_RELOAD_KEY) === "1") return false;
    sessionStorage.setItem(STARTUP_RELOAD_KEY, "1");
    location.reload();
    return true;
  } catch {
    return false;
  }
}

void openEntry().then(() => {
  try { sessionStorage.removeItem(STARTUP_RELOAD_KEY); } catch { /* Storage can be unavailable. */ }
}).catch((error: unknown) => {
  // Nothing has opened yet, so one reload can recover an asset replaced by a deployment.
  if (reloadAfterAssetFailure(error)) return;
  const root = document.getElementById("root");
  if (!root) return;
  const message = document.createElement("p");
  message.textContent = "AXOM could not load. Check your connection or try again after an update.";
  const retry = document.createElement("button");
  retry.textContent = "Try again";
  retry.onclick = () => location.reload();
  root.replaceChildren(message, retry);
});
