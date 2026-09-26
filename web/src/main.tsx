import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import { runStorageMigrations } from "./lib/storageMigrations";
import { installThemeSync } from "./lib/theme";
import { installChunkRecovery, registerWebWorker } from "./lib/webUpdates";
import { storeHydration } from "./lib/storeHydration";
import { startStartupIntro } from "./lib/startupIntro";
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
import "./styles/startupIntro.css";

// The inline head script prevents a first-paint flash; this keeps the chosen
// theme synchronized with OS and cross-tab changes for the rest of the session.
installThemeSync();
installChunkRecovery();

// Pure decoration: migrations and hydration run in parallel and never await
// media. The player releases inputs on skip, failure, or its hard deadline.
const startupIntro = startStartupIntro();

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
      {analyticsEnabled && <Analytics />}
    </StrictMode>,
  );
}

function showStartupError(message?: string) {
  startupIntro.dismiss();
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
