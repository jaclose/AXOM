export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

export interface InstallPromptSnapshot {
  prompt: BeforeInstallPromptEvent | null;
  installed: boolean;
}

let snapshot: InstallPromptSnapshot = { prompt: null, installed: false };
const listeners = new Set<(value: InstallPromptSnapshot) => void>();
let initialized = false;

function publish(next: InstallPromptSnapshot) {
  snapshot = next;
  for (const listener of listeners) listener(snapshot);
}

/** Capture the browser's one-use event for the whole app lifetime. */
export function initializeInstallPromptCapture() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches
    || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  snapshot = { ...snapshot, installed: standalone };
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    publish({ prompt: event as BeforeInstallPromptEvent, installed: false });
  });
  window.addEventListener("appinstalled", () => publish({ prompt: null, installed: true }));
}

export function getInstallPromptSnapshot() {
  return snapshot;
}

export function subscribeInstallPrompt(listener: (value: InstallPromptSnapshot) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function consumeInstallPrompt() {
  publish({ ...snapshot, prompt: null });
}

initializeInstallPromptCapture();
