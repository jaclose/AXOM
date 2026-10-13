import { shouldOpenWorkspace } from "./lib/landing/entry";

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

void openEntry().catch(() => {
  const root = document.getElementById("root");
  if (!root) return;
  const message = document.createElement("p");
  message.textContent = "AXOM could not load. Check your connection and try again.";
  const retry = document.createElement("button");
  retry.textContent = "Try again";
  retry.onclick = () => location.reload();
  root.replaceChildren(message, retry);
});
