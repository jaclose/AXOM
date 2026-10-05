# AXOM Lifecycle & Deployment Architecture

This document defines the "Zero-Maintenance" shell for AXOM, moving it from a development project to a production-grade application.

## 1. The Build Pipeline (CI/CD)
To eliminate manual errors and ZIP distributions, AXOM follows a "Push-to-Prod" flow.

### Workflow: GitHub Actions $\rightarrow$ Vercel/GitHub Pages
- **Trigger**: Push to `main` branch.
- **Validation**:
    - `npm run lint`: Static analysis of TypeScript/React code.
    - `npm run test:e2e`: Playwright tests for critical paths (Auth, Dashboard, Anki).
- **Build**: `npm run build` $\rightarrow$ generates `/dist`.
- **Versioning**: A custom script `scripts/bump-version.mjs` extracts `APP_RELEASE_VERSION` from `brand.ts` and writes it to `public/version.json`.
- **Deployment**: Atomic deploy of `/dist` to hosting.

## 2. The Update Engine (Client-Side)
The application must be self-healing and self-updating.

### Version Polling
- **Mechanism**: `UpdateAvailableWatcher.tsx` polls `/version.json` every 15 minutes.
- **Comparison**: Uses `isNewerVersion()` from `brand.ts`.
- **Resolution**: 
    - **Web**: `window.location.reload(true)` to clear cache.
    - **Native**: Triggers Tauri/Electron auto-updater to download binary in background.

### State Preservation during Updates
To avoid "Update Fatigue," AXOM uses a `state-bridge`:
- Current `store` state is mirrored to `localStorage` every 60 seconds.
- Upon reload, the app checks `lastSeenBuild`. If a version jump occurred, it runs `storageMigrations.ts` before rendering the UI.

## 3. Native Shell (The .app Wrapper)
AXOM is delivered as a native macOS/Windows application via Tauri.

- **Backend**: Rust (Tauri) handles file system access (Local Vault) and system notifications.
- **Frontend**: Vite/React bundle served as a local asset.
- **Auto-Update**: Tauri's built-in updater checks the GitHub Release API and prompts the user to "Restart to Update."
