import { APP_RELEASE_VERSION, STORAGE_KEYS } from "./brand";

export const UPDATE_CHECK_INTERVAL = 15 * 60_000;
export const UPDATE_DOWNLOAD_TIMEOUT = 10 * 60_000;
export type UpdatePhase = "idle" | "checking" | "current" | "available" | "downloading" | "ready" | "preparing" | "installing" | "restarting" | "disabled" | "error";
export interface UpdateState {
  phase: UpdatePhase;
  desktop: boolean;
  version?: string;
  buildId?: string;
  notes?: string;
  lastChecked?: number;
  downloadedBytes: number;
  totalBytes?: number;
  error?: string;
  deferred: boolean;
  /** Installation/activation succeeded; retry only the checkpoint and restart. */
  restartPending: boolean;
}
export interface NativeUpdate {
  version: string;
  body?: string;
  download: (onEvent: (event: DownloadProgress) => void, options?: { timeout: number }) => Promise<void>;
  install: () => Promise<void>;
  close: () => Promise<void>;
}
type DownloadProgress =
  | { event: "Started"; data: { contentLength?: number } }
  | { event: "Progress"; data: { chunkLength: number } }
  | { event: "Finished" };
export interface WebVersion { version: string; buildId?: string; notes?: string | string[] }
export interface UpdateDependencies {
  desktop: boolean;
  enabled: boolean;
  now: () => number;
  online: () => boolean;
  desktopConfigured: () => Promise<boolean>;
  checkNative: () => Promise<NativeUpdate | null>;
  checkWeb: () => Promise<WebVersion | null>;
  checkpoint: () => Promise<unknown>;
  activateWeb: () => Promise<void>;
  restart: () => Promise<void>;
  readDeferred: () => string | null;
  writeDeferred: (value: string) => void;
}

/** Explicit lifecycle shared by Settings, automatic notices, and native menus.
 * Downloads do not install. Only apply() can checkpoint/install/restart. */
export function createUpdateController(deps: UpdateDependencies) {
  let state: UpdateState = { phase: "idle", desktop: deps.desktop, downloadedBytes: 0, deferred: false, restartPending: false };
  let candidate: NativeUpdate | null = null;
  let operation: Promise<void> | null = null;
  let lastAttempt: number | undefined;
  let downloaded = false;
  const listeners = new Set<() => void>();
  const update = (patch: Partial<UpdateState>) => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  };
  const run = (job: () => Promise<void>) => {
    if (operation) return operation;
    operation = job().catch((error: unknown) => {
      update({ phase: "error", error: error instanceof Error ? error.message : "The update could not finish. Please try again." });
    }).finally(() => { operation = null; });
    return operation;
  };
  const identity = () => state.buildId ?? state.version ?? "";
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    check(manual = false) {
      if (operation) return operation;
      // A failed checkpoint or restart must not discard already verified bytes,
      // or replace an installed candidate with one for the still-running build.
      if (downloaded || state.restartPending || state.phase === "restarting" || (!manual && state.phase === "available")) return Promise.resolve();
      if (!manual && lastAttempt !== undefined && deps.now() - lastAttempt < UPDATE_CHECK_INTERVAL) return Promise.resolve();
      return run(async () => {
        if (!deps.enabled) {
          update({ phase: "disabled", error: "Update checks are available in installed desktop apps and hosted production builds." });
          return;
        }
        if (!deps.online()) {
          // Do not advance the throttle while offline; the online event retries.
          if (manual) update({ phase: "error", error: "You’re offline. Reconnect to check for updates; your current app remains available." });
          return;
        }
        lastAttempt = deps.now();
        const previous = candidate;
        candidate = null;
        update({
          phase: "checking", error: undefined, version: undefined, buildId: undefined,
          notes: undefined, downloadedBytes: 0, totalBytes: undefined, deferred: false,
        });
        if (previous) await previous.close().catch(() => undefined);
        if (deps.desktop && !await deps.desktopConfigured()) {
          update({ phase: "disabled", error: "Automatic updates are not configured for this local build. Install a signed release to receive in-app updates." });
          return;
        }
        const result = deps.desktop ? await deps.checkNative() : await deps.checkWeb();
        if (deps.desktop) candidate = result as NativeUpdate | null;
        const web = !deps.desktop ? result as WebVersion | null : null;
        update({
          phase: result ? "available" : "current",
          version: result?.version,
          buildId: web?.buildId,
          notes: candidate?.body?.slice(0, 20_000) ?? normalizeUpdateNotes(web?.notes),
          downloadedBytes: 0,
          totalBytes: undefined,
          lastChecked: deps.now(),
          deferred: result ? deps.readDeferred() === (web?.buildId ?? result.version) : false,
        });
      });
    },
    defer() { deps.writeDeferred(identity()); update({ deferred: true }); },
    download() {
      return run(async () => {
        if (!candidate) throw new Error("Check for an app update before downloading.");
        if (downloaded) { update({ phase: "ready", error: undefined }); return; }
        if (!deps.online()) throw new Error("Reconnect to download the update.");
        update({ phase: "downloading", error: undefined, downloadedBytes: 0, totalBytes: undefined });
        await candidate.download((event) => {
          if (event.event === "Started") update({ totalBytes: event.data.contentLength });
          if (event.event === "Progress") update({ downloadedBytes: state.downloadedBytes + event.data.chunkLength });
        }, { timeout: UPDATE_DOWNLOAD_TIMEOUT });
        downloaded = true;
        update({ phase: "ready" });
      });
    },
    apply() {
      return run(async () => {
        if (deps.desktop && !state.restartPending && (!candidate || !downloaded)) throw new Error("Download the update before installing it.");
        if (!deps.desktop && !state.version) throw new Error("Check for a web update before refreshing.");
        update({ phase: "preparing", error: undefined });
        await deps.checkpoint();
        if (!state.restartPending) {
          if (deps.desktop) {
            update({ phase: "installing" });
            await candidate!.install();
          } else {
            await deps.activateWeb();
          }
          // Tauri consumes the downloaded bytes when installation succeeds.
          // A failed relaunch must never invoke install() a second time.
          update({ restartPending: true });
        }
        update({ phase: "restarting" });
        await deps.restart();
      });
    },
    retryConnection() {
      if (state.phase === "error") lastAttempt = undefined;
    },
    hasDownloaded: () => downloaded,
  };
}

export function isDesktopApp(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Older manifests used string arrays; new releases share plain text with desktop. */
export function normalizeUpdateNotes(notes: unknown): string | undefined {
  const text = typeof notes === "string" ? notes
    : Array.isArray(notes) ? notes.filter((note): note is string => typeof note === "string").slice(0, 100).join("\n") : undefined;
  return text?.trim().slice(0, 20_000) || undefined;
}

/** Build identity catches a web deploy even when its semver is unchanged. */
export function isDifferentWebBuild(manifest: WebVersion, version = APP_RELEASE_VERSION, buildId = import.meta.env.VITE_BUILD_ID): boolean {
  return manifest.version !== version || Boolean(manifest.buildId && buildId && manifest.buildId !== buildId);
}

function storageRead(): string | null {
  try { return sessionStorage.getItem(STORAGE_KEYS.updateDeferredVersion); } catch { return null; }
}

export const appUpdates = createUpdateController({
  desktop: isDesktopApp(),
  enabled: isDesktopApp() || import.meta.env.PROD,
  now: Date.now,
  online: () => typeof navigator === "undefined" || navigator.onLine !== false,
  desktopConfigured: async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const status = await invoke<{ updaterConfigured: boolean }>("desktop_status");
    return status.updaterConfigured;
  },
  checkNative: async () => (await import("@tauri-apps/plugin-updater")).check({ timeout: 15_000 }),
  checkWeb: async () => {
    if (!/^https?:$/.test(location.protocol)) return null;
    const url = new URL("version.json", document.baseURI);
    url.searchParams.set("check", String(Date.now()));
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`Update check failed (${response.status}). Try again later.`);
    const manifest: unknown = await response.json();
    if (!manifest || typeof manifest !== "object" || !("version" in manifest) || typeof manifest.version !== "string" || !manifest.version.trim()) {
      throw new Error("The update service returned an invalid version manifest. Try again later.");
    }
    const raw = manifest as Record<string, unknown>;
    const parsed: WebVersion = {
      version: manifest.version,
      buildId: typeof raw.buildId === "string" ? raw.buildId : undefined,
      notes: normalizeUpdateNotes(raw.notes),
    };
    return isDifferentWebBuild(parsed) ? parsed : null;
  },
  checkpoint: async () => (await import("./updateCheckpoint")).createUpdateCheckpoint(isDesktopApp()),
  activateWeb: async () => (await import("./webUpdates")).activateWaitingWebUpdate(),
  restart: async () => {
    if (isDesktopApp()) await (await import("@tauri-apps/plugin-process")).relaunch();
    else window.location.reload();
  },
  readDeferred: storageRead,
  writeDeferred: (value) => {
    try { sessionStorage.setItem(STORAGE_KEYS.updateDeferredVersion, value); } catch { /* device preference only */ }
  },
});
