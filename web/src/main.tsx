import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { runStorageMigrations } from "./lib/storageMigrations";
import { installThemeSync } from "./lib/theme";
import { installPaletteSync } from "./lib/palette";
import { installMotionSync } from "./lib/motionPreference";
import { installChunkRecovery, registerWebWorker } from "./lib/webUpdates";
import { storeHydration } from "./lib/storeHydration";
import { startStartupIntro } from "./lib/startupIntro";
import { endPresentation, revealApp } from "./lib/presentation";
import { AppErrorBoundary } from "./components/shell/AppErrorBoundary";
import "./styles/global.css";
import "./styles/components.css";
import "./styles/shell.css";
import "./styles/pages.css";
import "./styles/motion.css";
import "./styles/journal-notebook.css";
import "./styles/tour.css";
import "./styles/loop.css";
import "./styles/questionbank.css";
import "./styles/appearance.css";
import "./styles/focus.css";
import "./styles/account.css";
import "./styles/settings.css";
import "./styles/startupIntro.css";
import "./styles/presentation.css";
import "./styles/dock.css";
import "./styles/soundscapes.css";
import "./styles/energy.css";
import "./styles/trackers.css";
import "./styles/exam-sim.css";

// The inline head script prevents a first-paint flash; this keeps the chosen
// theme synchronized with OS and cross-tab changes for the rest of the session.
installThemeSync();
installPaletteSync();
installMotionSync();

// Dev-only handle so browser tests and debugging reach the app's LIVE store.
// Importing "/src/lib/store.ts" from a test can resolve to a different module
// instance once HMR has timestamped the app's copy, silently writing nowhere.
if (import.meta.env.DEV) {
  (window as Window & { __AXOM_DEV__?: Promise<unknown> }).__AXOM_DEV__ = Promise.all([
    import("./lib/store"),
    import("./lib/pomodoro"),
    import("./lib/soundscapes/store"),
  ]).then(([{ useStore }, { usePomodoro }, { useSoundscape, soundscapeAnalyser }]) => ({ useStore, usePomodoro, useSoundscape, soundscapeAnalyser }));
}

installChunkRecovery();

// Pure decoration: migrations and hydration run in parallel and never await
// media. The player releases inputs on skip, failure, or its hard deadline.
const startupIntro = startStartupIntro();
// Without a film, the workspace still settles in quietly as it first renders.
if (!startupIntro.playing) revealApp("open");

async function bootstrap() {
  const rootElement = document.getElementById("root");
  if (!rootElement) return;
  rootElement.setAttribute("role", "status");
  rootElement.textContent = "Opening AXOM — loading your saved workspace…";
  const startupStatus = await runStorageMigrations();
  // Do not even import the store when older code sees newer persisted data.
  // Importing App starts Zustand hydration and could otherwise rewrite it.
  if (!startupStatus.ok && startupStatus.fromVersion > startupStatus.toVersion) {
    showStartupError(startupStatus.errorMessage);
    return;
  }
  const { default: App } = await import("./App");
  // Importing App starts Zustand's IndexedDB hydration. Do not mount setup,
  // daily-rollover writers, or tour/Promise initializers against the seed.
  await storeHydration.wait();
  rootElement.removeAttribute("role");
  const analyticsEnabled = import.meta.env.PROD && (
    location.hostname.endsWith(".vercel.app") || import.meta.env.VITE_ENABLE_ANALYTICS === "true"
  );
  createRoot(rootElement).render(
    <StrictMode>
      <AppErrorBoundary><App startupStatus={startupStatus} /></AppErrorBoundary>
      {analyticsEnabled && (
        <>
          <Analytics />
          <SpeedInsights />
        </>
      )}
    </StrictMode>,
  );
}

function showStartupError(message?: string) {
  startupIntro.dismiss();
  endPresentation();
  // This fallback must not depend on a lazy module: that may be what failed.
  const root = document.getElementById("root");
  if (!root) return;
  const panel = document.createElement("main");
  panel.style.cssText = "max-width:640px;margin:12vh auto;padding:32px;font:16px system-ui;line-height:1.6";
  const heading = document.createElement("h1");
  heading.textContent = "AXOM could not finish opening";
  const detail = document.createElement("p");
  detail.textContent = message ?? "Reconnect and try again. Your local data has not been cleared. If this happened after an update, keep your browser data and install the latest compatible build.";
  const retry = document.createElement("button");
  retry.textContent = "Try opening AXOM again";
  retry.onclick = () => window.location.reload();
  panel.append(heading, detail, retry);
  root.replaceChildren(panel);
}

void bootstrap().catch((error: unknown) => showStartupError(error instanceof Error ? error.message : undefined));

registerWebWorker();
