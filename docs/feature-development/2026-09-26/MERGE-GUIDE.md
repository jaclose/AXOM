# Merge guide — `origin/main` → `feat/accounts-sync-v1` → `main`

Prepared 2026-09-26. The branch was committed and verified; the merge itself is
yours to run (my automated merge attempt was blocked by a permission check).

## What overlaps, and why "keep the branch version" is correct

`origin/main` (`5f548da`) adds the Higgsfield skills (`29aded0`), the first
Supabase commit (`6eae661`) and the former uncommitted `main` worktree state
(`8178495`). 103 files changed on both sides. 55 are byte-identical and merge
silently. Keep this branch's version of the other 48:

- **Release/updater/intro files**: this branch already contains `main`'s exact
  changes (3-way merged at port time; `main`'s diff sizes were re-checked and
  are identical), plus fixes. The fixes are coalesced vault writes (the
  ported queue lost saves on quick reload), lazy release notes, an update
  feed, optional notarization, and the cinematic policy.
- **Icons and lockfiles**: regenerated here (new squircle icon, merged dependencies).
- **`supabase/config.toml`**: here it mirrors production.
- **`ApplicationCheckerPage.tsx`**: two independent rewrites. `main`'s version
  loads `/data/application_checker/*.json`, a path the web app never serves. This
  branch's version is the built one (271 researched schools, residency explorer,
  e2e-covered). `main`'s engine, data and Anki bridge still arrive unchanged
  but unused, for you to review.

## Commands

```sh
cd ~/Developer/AXOM-accounts-v1
git fetch origin
git merge --no-ff --no-commit origin/main      # conflicts are expected
git checkout ORIG_HEAD -- \
  .github/workflows/release.yml \
  .gitignore \
  CHANGELOG.md \
  docs/DESKTOP-RELEASE.md \
  package-lock.json \
  package.json \
  scripts/release.mjs \
  src-tauri/Cargo.lock \
  src-tauri/Cargo.toml \
  src-tauri/icons/128x128.png \
  src-tauri/icons/128x128@2x.png \
  src-tauri/icons/32x32.png \
  src-tauri/icons/64x64.png \
  src-tauri/icons/Square107x107Logo.png \
  src-tauri/icons/Square142x142Logo.png \
  src-tauri/icons/Square150x150Logo.png \
  src-tauri/icons/Square284x284Logo.png \
  src-tauri/icons/Square30x30Logo.png \
  src-tauri/icons/Square310x310Logo.png \
  src-tauri/icons/Square44x44Logo.png \
  src-tauri/icons/Square71x71Logo.png \
  src-tauri/icons/Square89x89Logo.png \
  src-tauri/icons/StoreLogo.png \
  src-tauri/icons/icon.icns \
  src-tauri/icons/icon.ico \
  src-tauri/icons/icon.png \
  src-tauri/src/lib.rs \
  src-tauri/tauri.conf.json \
  supabase/config.toml \
  web/package-lock.json \
  web/package.json \
  web/scripts/verify-daily-games-offline.mjs \
  web/src/App.tsx \
  web/src/components/shell/AppUpdatePanel.tsx \
  web/src/components/shell/SettingsModal.tsx \
  web/src/components/shell/UpdateAvailableWatcher.tsx \
  web/src/components/shell/WhatsNewWatcher.tsx \
  web/src/lib/brand.ts \
  web/src/lib/localVault.ts \
  web/src/lib/releaseNotes.ts \
  web/src/lib/startupIntro.test.ts \
  web/src/lib/startupIntro.ts \
  web/src/lib/store.ts \
  web/src/lib/storeMigrations.test.ts \
  web/src/main.tsx \
  web/src/pages/ApplicationCheckerPage.tsx \
  web/src/styles/startupIntro.css \
  web/vite.config.ts
git add -A
git commit -m "Merge origin/main into feat/accounts-sync-v1"

cd web && npm run quality && npm run test:e2e:chrome && cd .. && npm run test:release
```

`ORIG_HEAD` is the branch tip before the merge, so every overlapping file is
exactly the verified branch version, while main-only files arrive untouched.

## Landing on `main`

```sh
cd ~/Developer/AXOM
git pull --ff-only                       # to 5f548da
git merge --ff-only feat/accounts-sync-v1
git push origin main                     # Vercel + the Supabase integration deploy main
```

Pushing `main` redeploys the web app. It is safe for Supabase: all six
migrations are already applied, and `config.toml` only differs from production in
`site_url`/redirects (see ACCOUNTS-SETUP step 4 before any `config push`).

## Small follow-ups after the merge

- `git rm --cached design/startup/axom-optical-luster.blend1` (a Blender autosave that `.gitignore` now excludes).
- `web/.github/workflows/deploy.yml` never runs (GitHub reads only the root `.github`); delete it or move it.
- Decide on `lib/application-checker/engine.ts`, `lib/ai/ankiBridge.ts` and `data/application_checker/` (unused after the merge).
