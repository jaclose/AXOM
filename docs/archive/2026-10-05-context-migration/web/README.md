# AXOM — Web

A premium, **local-first** command center for medical-school execution — courses,
mastery tracking, productivity logging, daily standups, journal, prompt library,
modular folders, tasks, reports, and STEP 1 prep — rebuilt as a **deployable web app**.

This is the web port of the original SwiftUI/macOS AXOM. It runs in VS Code
via a dev server, builds to a static bundle you can host or hand out as a download,
and can also be wrapped into a double-clickable macOS app package.

- **Stack:** Vite + React + TypeScript, Zustand, IndexedDB/localStorage Local Vault, Vercel serverless API routes, optional Neon Postgres sync, lucide-react.
- **Data:** local-first by default. Export/import a JSON backup from **Settings & Backup**, or enable optional cloud sync after configuring the backend.
- **Local user ID:** the display name creates a simple local owner key saved with the profile and backups.
- **Modular:** terms, courses, modules, tracker items, resources, tasks, journal, prompts, and folders
  are all add/edit/delete in-app — nothing is hard-coded.

**Highlight features**

- **Lecture, DLA, and PQ tracker** — mastery tree with a split pass/Anki status shard,
  click-to-fill pass blocks, Anki-round blocks, high-yield/low-yield/needs-review flags, scope filtering, and adaptive
  suggested next moves.
- **STEP 1 + STEP 2 CK control surfaces** — USMLE-weighted blueprint logging,
  readiness bars, schedule planning, and AI-assisted board strategy.
- **Anki Lab** — turn lecture/DLA/slide text into cards with a prompt workflow or a browser-local
  draft generator, then export tab-separated Anki import files for Basic, Cloze, or custom note types.
- **Resources** — save and **bulk-import hyperlinks** (STEP 1 prep, references, decks, tools),
  curated by category, source type, personal/public status, usefulness rating, and favicons.
- **Guided setup + tour** — first-launch personalization, spotlight tour, and the
  Promise of Use journal cutscene. Setup can be rerun from Settings without deleting data.
- **Anti-overload by design** — daily "good enough" card/minute targets + a study streak, with a
  nudge to *stop* when you hit target (the #1 cause of Anki burnout is grinding 500 cards/day).
- **Per-course smart suggestions** — the Dashboard and Course Tracker use pass count, yield/review
  flags, scope size, and Anki rounds to suggest the next best move.

## Alpha 1 starter state

Alpha 1 opens with a fresh SGU-oriented scaffold, not a personal workload:

- Terms 1-5 and the core BPM/SPPM/PPM course shells are present.
- Course Tracker includes only a few example Lecture/DLA/PQ rows so the UI is understandable.
- Productivity logs, journal entries, and reports start empty.
- STEP 1 / STEP 2 stay fully usable: the Step page now logs board work by blueprint systems, tasks/competencies, and disciplines instead of lecture-style tracker rows.
- Local Vault autosave is always on; Settings -> Progress Save can optionally sync the JSON snapshot to the backend.

## Run it in VS Code

```sh
cd web
npm install
npm run dev          # opens http://localhost:5173
```

That's the whole dev loop — no Xcode, no native build, nothing installed on the Mac.

## Optional cloud backend

AXOM keeps the Local Vault as the default persistence layer. The backend is
an optional sync layer for name-only accounts, full JSON snapshots, manual cloud
backups, restore, and mock AI endpoints.

Recommended architecture:

- Keep the Vite app in `web/`.
- Use grouped root-level Vercel serverless functions in `api/` with shared backend helpers in `lib/api/`.
- Use Neon Postgres on Vercel for production storage.
- Store the app state as a JSON snapshot first; split into relational tables later
  only after the data model stabilizes.

From the repo root:

```sh
npm install
cp .env.example .env.local
# fill DATABASE_URL with your Neon pooled Postgres connection string
npm run dev          # Vercel dev: serves web + /api together
```

For frontend-only work, `cd web && npm run dev` still works and stays local-only.

Database setup:

```sh
cat db/migrations/001_initial.sql
```

Run that SQL in Neon, Supabase, or another Postgres SQL editor. If
`NOCTYRIUM_AUTO_MIGRATE=true`, the serverless backend also creates the required
tables on first API use.

Required Vercel env vars:

```sh
DATABASE_URL=
AI_PROVIDER=mock
APP_SCHEMA_VERSION=16
NOCTYRIUM_AUTO_MIGRATE=true
```

Optional AI keys are intentionally server-only:

```sh
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
```

Security note: name login is lightweight identity, not secure authentication. For
production multi-user use, migrate to email magic links, OAuth, or passkeys.

## Will my online edits save?

Yes, inside the same browser/profile and same site origin. If you add `Term 3`
online, it persists in that browser's Local Vault after refreshes and app
updates. It appears on another browser/device only if you export/import JSON or
use Settings -> Optional Cloud Sync after configuring the backend.

## Update safety

- **App code and user data are separate.** Builds replace `dist/` files and the PWA cache; user data stays in the Local Vault via IndexedDB with localStorage fallback.
- **Schema migrations protect existing profiles.** When the app adds fields such as STEP prep settings, day plans, or curated shared drives, the store fills the missing pieces without wiping personal edits.
- **Backups are portable.** Export JSON before changing browsers, domains, devices, or app containers.

## Build a static bundle

```sh
npm run build        # → web/dist/   (type-checked, minified)
npm run preview      # serve the build locally to sanity-check
```

`vite.config.ts` sets `base: "./"`, so the same `dist/` works when **served at any
path**, **embedded in an iframe**, or **opened from `file://`** after unzipping.

## Three ways to put it on the AXOM website

### 1. Standalone page / hyperlink
Host the contents of `web/dist/` at e.g. `noctyrium.<yoursite>.com` or
`<yoursite>.com/noctyrium/` and link to it. Deep links work via the URL hash
(`/#productivity`, `/#tracker`, …).

### 2. Embed near the bottom of a page
Drop an iframe in:

```html
<iframe src="/noctyrium/" title="AXOM" loading="lazy" allow="clipboard-write"
        style="width:100%;height:760px;border:0;border-radius:22px;background:#05060d"></iframe>
```

See **[embed-example.html](embed-example.html)** for a ready-to-paste section that
includes the iframe **and** a download card with a download icon.

### 3. Downloadable packages
```sh
npm run package
```
This builds and zips:

- `AXOM-web-v<version>.zip` — portable static web app. Unzip and open `index.html`.
- `AXOM-mac-v<version>.zip` — double-clickable macOS app. Unzip and open `AXOM.app`.

Neither package requires npm, Vite, or localhost. The Mac app is ad-hoc signed for
local use, not notarized; if macOS blocks it after download, right-click the app
and choose **Open** once.

Because a service worker + web manifest ship in the build, visitors who open the
hosted version can also **Install** it from the browser as a PWA.

The downloadable static packages remain local-first. Cloud sync requires the
hosted Vercel deployment because `/api/*` needs serverless functions and a
Postgres connection string.

## Experimental Tauri + SQLite shell

From the repo root:

```sh
npm run tauri:dev
npm run tauri:build
```

This uses `src-tauri/`, wraps the same `web/` frontend, and preloads
`sqlite:noctyrium.db` through the Tauri SQL plugin. It is a real scaffold for
the future native desktop app, but Alpha 1 still treats Local Vault as the
source of truth and ships the static web/Mac-wrapper packages.

## Deploy on Vercel

This repo has a root `vercel.json` so Vercel can deploy the app and the
serverless API even though the actual React/Vite project lives in `web/`.

Use either setup:

- **Repo root as Vercel Root Directory, recommended:** leave Root Directory
  empty/default. Vercel runs `npm ci && npm --prefix web ci`, builds with
  `npm run build`, serves `web/dist`, and exposes `/api/*`.
  Legacy public URLs are rewritten into five grouped functions:
  `/api/user`, `/api/data`, `/api/ai`, `/api/feedback`, and `/api/health`.
- **`web` as Vercel Root Directory:** only use this for a static/local-only
  deployment. The cloud sync API will not deploy from that mode.

If `https://noctyrium.vercel.app/` shows `404: NOT_FOUND`, Vercel is probably
serving the wrong root or an older deployment. Redeploy after committing these
config files.

Hosted Alpha instance:

- https://noctyrium-cktjdhuhw-jacloses-projects.vercel.app/#dashboard

## Test cloud sync and mock AI

1. Open Settings & Backup.
2. Enter a name and click **Link name**.
3. Click **Save progress**.
4. Make a small local change, then click **Create backup**.
5. Click **Load progress** or restore a backup and confirm the conflict prompt.
6. Confirm JSON export/import still works without a backend.
7. With `AI_PROVIDER=mock`, call `/api/ai/next-move` or use the frontend AI
   client from future UI work. Mock mode never exposes provider keys.

## Layout

```
web/
  index.html               # app entry + manifest + theme-color
  vite.config.ts           # base: "./" for portable builds
  public/                  # logo, PWA icons, manifest.webmanifest, sw.js
  native/                  # tiny macOS WebKit wrapper used by npm run package
  scripts/package-web.sh   # build + zip for the download
  embed-example.html       # website drop-in (iframe + download card)
  src/
    main.tsx  App.tsx       # shell, hash router, service-worker registration
    styles/                 # theme tokens + glass design system (ported from Swift)
    lib/                    # types, store (Zustand+persist), seed, scoring, backup, icons
    services/               # sync client, AI client, local storage helpers
    types/                  # sync and AI DTOs
    components/shell|ui/     # Sidebar, TopBar, GlassCard, Ring, Heatmap, Modal, …
    pages/                   # the 11 pages
```

## Notes
- **Backups matter:** browser storage is per-device. Export JSON regularly (Settings & Backup).
- **Local folders:** hosted browsers cannot reveal or open arbitrary Finder paths without user
  permission. Hub Folders can store local paths for packaged/local usage, while normal hosted pages
  should expect browser security limits.
- The design system (dark gradient, ambient orbs, glass shell + luster sweep, day-grade
  color scale) is ported faithfully from the SwiftUI build's `OuterBackground` / `GlassShell`
  / `RingScore` / `Heatmap` / `todayGrade`.
