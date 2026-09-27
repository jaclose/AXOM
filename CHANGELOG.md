# AXOM Changelog

## 0.0.2-prebeta — 2026-09-26 (Accounts, soundscapes, focus dock and safe updates)

- **Focus dock**: a pill at the bottom of every page shows the running Pomodoro or study session with pause, skip, quick log, focus mode and finish. When a soundscape plays, the pill splits in two; hover the sound half to open its live visual and controls.
- **Soundscapes**: 40 Hz, 20 Hz, 10 Hz and 2 Hz binaural tones (matched to the recordings you already use), brown noise and soft rain, all generated on your device with palette-aware visuals. Headphones or speakers mode, a sleep-friendly stop timer, media keys, and "follow my Pomodoro" (10 Hz on breaks). Each preset states its evidence honestly, and "Is it working for you?" compares your question accuracy and Anki "again" rate with and without sound.
- **Opening films**: a short luster film plays on the first open of the day (or week, only after updates, every launch, or never). A dedicated film plays after an update and while one installs. Preview and choose films in Settings → Appearance.
- **Accounts (optional)**: create an account, confirm it, sign in or reset your password with emailed codes that also work in the desktop app; protect your workspace, merge two devices, restore any recent version, and remove everything stored online.
- **Appearance**: eight accent palettes plus a custom color with readable contrast in light and dark, an AXOM-level reduce-motion switch, and a daily quote in the top bar with its own rotation settings.
- **Study tools**: lock-in check-ins, Course Tracker subsections, habit targets that feed productivity, clearer Reports trends, residency programs in the Application Checker, and a refreshed desktop icon.

- **Desktop packaging**: the macOS app and web package share one build and the current AXOM icon. Existing workspace and storage identities remain unchanged.
- **Startup**: wait for the saved workspace before rendering setup or the dashboard. Unfinished setup is preserved during older-data migrations; rendering errors have a recovery screen instead of a blank window.
- **Updates on your terms**: signed distribution builds can check for new releases, show what changed, download a verified update, and install when you choose. Local test builds keep automatic desktop updates disabled until distribution is configured.
- **Save before restart**: applying an update verifies a recovery snapshot first. A failed save stops the update, and a failed restart can be retried without installing twice.
- **Web refresh safety**: new web builds wait for your approval. Previously opened screens and the update-save path remain available while a newer build is staged.
- **Release notes**: review changes before updating, read a one-time notice after upgrading an existing workspace, and reopen release history from App updates.
- **Compatibility**: keep the same app and browser storage identity. Moving from the older Swift wrapper or to a different browser/origin requires a portable backup transfer. Do not downgrade after a data-schema upgrade.

Public automatic updates still require one-time signing and hosting setup. This local pre-beta package is not an Apple-notarized public release.

## 0.0.1-prebeta — 2026-07-08 (AXOM pre-beta: question bank + persistence)

The version line resets to pre-beta under the AXOM identity. Persistence keys stay
frozen (`noctyrium-*`) so every existing install upgrades in place.

- **AXOM rebrand**: new mark (SVG, tintable) + Poppins wordmark, graphite/bone/gold
  identity palette across the shell, icon set regenerated from the brand asset,
  placeholder profile names rebranded by migration (real names untouched), storage
  keys frozen for data safety. Repo/package names intentionally remain internal.
- **Version/schema unification**: one source of truth in `web/src/lib/brand.ts`
  (`0.0.1-prebeta`, channel pre-beta); `version.json`, service-worker cache
  (`axom-v0.0.1-prebeta`), `api/health.ts`, and Tauri metadata now agree. Update
  notice fires on any deployed-version difference (survives version-line resets),
  never during an active session, never destructive.
- **Question bank flagship**: banks/sets, categories, exam styles (IMCQ/ESOP/
  board/MCAT/shelf/lecture), difficulty, marked flag; multi-question paste parsing
  with metadata lines; TXT/Markdown/CSV/JSON file import with a mandatory review
  screen (per-question include + inline editing); PDFs/images attach as provenance
  only — stated honestly, no fake OCR.
- **Tutor & exam modes**: tutor blocks with immediate feedback, error-type capture,
  repair cards, and provider-gated AI actions (explain simply, why was I wrong,
  memory hook); exam blocks with pool filters (unused/incorrect/marked/category/
  style), optional timing, flagging, end-of-block review, retake-missed.
- **Performance tracking**: persisted quiz sessions (schema v29, additive),
  score by session and category, weakest-category surfacing, retry queue.
- **AI layer**: question generation from topic/reference behind the review gate;
  schema-validated outputs; mock/demo provider covers every new action for
  keyless testing; backend `ensureSchema` aligned with SQL migrations (PIN auth
  columns + `user_sessions`).
- **Copy honesty pass**: About page states pre-beta status plainly — alpha cloud
  sync/PIN, provenance-only PDF import, AnkiConnect needs local verification.
- 12 new tests (185 total): block parsing, CSV/JSON import, quiz pools/scoring,
  v29 migration, rebrand-migration safety.

## 0.2.0-alpha.1 — 2026-07-08 (the daily academic loop)

Alpha 2 rehaul: the app's center of gravity moves from a widget dashboard to a daily
operating loop — open → orient → commit → study → capture → review → recover → return.

- **Command Brief** now leads the dashboard: one operating mode (Maintain / Catch-Up /
  Recovery / Sprint / Exam Week) with a plain-language reason, exactly **one Next Best Move**
  with "why this now" + expected outcome + **Begin Session**, a **Minimum Viable Win** fallback
  for low-energy days, and a factual "since yesterday" delta. Transparent rules over your own
  data (`lib/commandBrief.ts`), fully tested.
- **Real study sessions**: Begin Session starts a task-linked session timed by absolute
  timestamp segments — accurate across tab switches, laptop sleep, refresh, and updates
  (never a ticking counter). Persistent bottom bar with pause/resume, quick logs
  (completed / partial / blocked / rescheduled / too difficult / misunderstood / needs review),
  a distraction-free focus mode, and a completion capture (confidence, takeaway, blocker,
  energy). Stale overnight timers are capped, visibly, never silently credited.
- **Daily Closeout** (30–90s): what got done, what remains, blocker, tomorrow's first task,
  energy vs morning, and tomorrow's mode (or auto). Tomorrow's brief honors it.
- **Recovery Protocol** as a core feature: calm trigger detection (missed days, carried tasks,
  overdue work, exam pressure), an honest gap estimate, triage into non-negotiable /
  high-yield / deferrable / safe-to-drop (user-editable), and 24-hour restart + 72-hour
  stabilization plans. Accept / edit / defer / reset. No shame language anywhere.
- **Question Workspace** (new pillar page): paste → extract → review → save intake with honest
  extraction confidence (never invents answers), screenshot/PDF attachment with provenance
  metadata (OCR extension point, no fake OCR), answer/reveal/attempt flow with a 12-type
  error taxonomy, review scheduling for misses, weak-topic + error-pattern insights,
  study modes (incorrects-only, guessed-correctly, changed-answer, repeat-offenders, weakness…),
  one-tap **error-repair cards**, and a hedged **Faculty Style Analyzer**.
- **Anki Lab rebuilt around a persistent Card Vault**: 11 typed card kinds, in-app spaced
  review (SM-2-flavored), a quality-check layer (duplicates, too-long, multi-fact, dangling
  pronouns, absolute claims, weak cloze, missing sources), Anki-compatible TSV export, and
  **AI card generation behind a review gate** — small batches, editable drafts, per-draft
  approve/reject, provenance recorded. The classic prompt studio remains as a tab.
- **AI provider layer** (`lib/ai/`): local-first **Ollama** support with live detection, model
  picker, and in-app setup steps — free, private, no API key. Cloud BYOK is a configuration
  surface only until a secure server proxy exists (no key field ships in the client, by design).
  A clearly-labeled deterministic Demo mode for previewing flows. All model output is
  schema-validated and nothing mutates your plan without review.
- **Study Methods** library: 14 evidence-informed techniques, each with when-to-use,
  when-NOT-to-use, materials, exact steps, and common mistakes; a rules-based recommender
  (energy × time × exam distance × recovery state); add-to-today or begin a session directly.
- **Data safety**: schema v27 (additive only), an automatic **pre-migration snapshot** before
  any upgrade, **merge import** alongside replace-restore, last-backup age tracking, and a
  visible **Local data health** panel (storage driver, record counts, migration state).
- **Update flow**: semver-aware notice with release notes that never fires during an active
  session and never forces a reload; "your local progress will remain intact."
- **Rebrand readiness**: all brand strings/versions centralized in `lib/brand.ts`; storage keys
  frozen as legacy identifiers so a future rename can't strand anyone's data.
- 60+ new focused tests (173 total): migrations, session restoration, brief priority rules,
  recovery triggers and tone, question/card schema validation, parser honesty, AI detection
  and output validation, and update version comparison.

## 0.1.0-alpha.1 — 2026-06-16 (final polish)

Pre-release polish patch: consumer-facing wording, resource corrections, Help, and Anki guide.

- **Vercel Hobby deploy hotfix:** consolidated 13 public route files into five grouped
  functions (`api/user.ts`, `api/data.ts`, `api/ai.ts`, `api/feedback.ts`, `api/health.ts`)
  and moved backend helpers to `lib/api/`, preserving the old public URLs through rewrites.
- **Guided tour + Promise** shipped to production (web auto-deploy) and added **Vercel Analytics**.
- **Resource Hub corrected**: 11 exact curated drives with proper names/URLs/categories/ratings/tooltips
  (fixes the Claudfather↔My Drive mislabel; adds Mehlman + White Coat; My Drive pinned first;
  MADCOW + Claudfather 10/10). Schema-17 migration corrects existing installs without wiping data.
- **Help** is now its own sidebar section (out of Hub Folders): replay tour, master guide, an
  **Anki import guide with real screenshots**, the **optimized no-FSRS Anki settings** (+ linked PDF),
  **recommended add-ons**, and an in-app **feedback form** (posts to `/api/feedback`; clean
  copy-and-email fallback when email isn't configured).
- **Productivity**: fixed the clipped ± buttons; quick-add presets (10/20/25/50/90 min · 10/20/25/50/100
  cards) now sit under a dedicated **Manual Activity Logger**.
- **Dashboard**: removed the stray Term-Map underline; restyled the top-left name with a premium gradient.
- **Settings**: consumer-friendly **Backup & Restore** copy (no IndexedDB/SQLite/Tauri jargon);
  **View / re-sign your Promise** from the Profile tab; build label remains read-only; tagline preserved.
- **Integrations** marked Under Construction (masking-tape treatment), no broken clickable features.
- Local-first persistence preserved across refresh/rebuild/redeploy (schema-versioned migrations only
  add/upgrade; never reset). Admin account visibility documented as a configuration TODO.

## 0.1.0-alpha.1 — 2026-06-15

Public Alpha 1 release candidate: packaging, release flow, and beta-feedback polish.

### Release & packaging

- Verified `npm install`, `npm run build`, and `npm --prefix web run package` from a clean tree.
- `npm --prefix web run package` produces `web/Noctyrium-web-v0.1.0-alpha.1.zip` (static) and, on
  macOS with `swiftc`, `web/Noctyrium-mac-v0.1.0-alpha.1.zip` (double-clickable wrapper). Both are
  gitignored and never committed.
- Added [`docs/ALPHA-RELEASE.md`](docs/ALPHA-RELEASE.md) (Vercel deploy, packaging, GitHub Release flow)
  and [`docs/UPDATE-POLICY.md`](docs/UPDATE-POLICY.md) (web auto-updates via Vercel; Mac wrapper is
  manual for Alpha 1; data is separate from app code; future Tauri v2 updater).
- Added an in-app Alpha notice on the Dashboard: the web version updates automatically; the
  downloadable Mac app requires downloading the latest release. No fake auto-update added.

### Beta-feedback polish

- **Anki Lab generator fixed:** filters slide boilerplate (copyright, objective codes, citations,
  URLs, emails, headings), clozes the *answer* (not the subject/first words), de-dupes, scores cards
  by quality, warns on likely system-tag mismatch, allows local draft edit/delete, and exports
  separated Basic/Cloze `.csv` files plus review `.txt` (TSV). Added a card-style / custom-note-type
  guide that links to the MADCOW/Claudfather Anki build drive.
- **Course Tracker import:** the destination field now autocompletes existing folders (datalist) and
  flags new-vs-existing; path normalization trims/dedupes spacing/case so correct paths stop spawning
  duplicate folders.
- **Course Tracker:** delete an entire group/directory with confirmation, including move-contained-items
  or delete-contained-items choices.
- **Drives:** curated permanent set (My Drive + MADCOW = 10/10, SillyGoose Wiki, SGU shared, MEGA)
  with MADCOW and Claudfather Auto rated 10/10, personal usefulness rating badges + hover reasons,
  URL normalization, source/personal/category filters, and add/remove/re-rate in-app.
- **Guided tour + Promise:** first-launch personalization flows into a spotlight tour and a versioned
  Promise of Use journal cutscene; replay remains available under Hub/Folders.
- **Boards page:** Step/Shelf/MCAT/CBSE work now has a board-style blueprint log (domain, mode,
  minutes, questions, correct, confidence, missed-theme notes) separate from lecture/DLA/PQ pass
  tracking.
- **Help feedback:** Hub/Folders now includes an Alpha mailto feedback form for bugs, features,
  confusion, and praise addressed to `jdabbagh@sgu.edu`.
- **Native shell scaffold:** added experimental Tauri v2 + SQLite wiring in `src-tauri/`, with SQL
  migration, permissions, scripts, and a Settings-only native snapshot action for future desktop work.
- **Logo** added to the sidebar lockup; **±10 steppers** for minutes/cards in the Productivity log.

## Alpha 1 — 2026-06-14

First clean web/backend alpha candidate.

- Added optional Vercel serverless backend routes for name-only users, JSON snapshot sync,
  cloud backups, restore, health checks, and simple progress save/load by account name.
- Added Postgres schema/migration for users, snapshots, sync change logs, and AI usage logs.
- Added mock AI endpoint scaffolding for next move, Anki generation, Step planning, weak-area
  analysis, and daily reports.
- Integrated the frontend Settings sync panel with backend health, progress save/load,
  manual backups, restore, conflict prompts, and optional auto-sync.
- Refreshed Alpha 1 seed data so the app opens with SGU course shells and only a few
  example Lecture/DLA/PQ tracker rows.
- Cleaned the repository so personal study folders, old packages, Docker leftovers,
  build output, caches, and generated zip files are not part of the commit.
- Upgraded the web build to Vite 8 / React plugin 6 and verified build/typecheck/audit.

## web v0.5.0 — 2026-06-13

Feature expansion of the web app (informed by research into how med students actually use Anki).

- **Lecture & DLA tracker:** tracker items now have a first-class `kind` (Lecture / DLA / PQ / Lab /
  Reading) with filtering; per-folder lecture/DLA/mature counts.
- **Bulk import lectures by name:** paste a whole list → one tracker row per line (strips leading
  numbering), choose destination path + kind. The headline tracker feature.
- **Anki Lab** (new page): builds an AI prompt from lecture/DLA/slide text tuned for Anki import
  (cloze/Q&A/image-occlusion), saves to the Prompt Library, and exports a tab-separated file you
  import into Anki. Prompt-based today (no backend); live one-click generation flagged on the roadmap.
- **Resources** (new page): save + bulk-import hyperlinks (STEP 1 prep, references, decks, tools);
  categorized, searchable, favoritable, with favicons. Seeded with AnKing, Boards & Beyond, Sketchy,
  UpToDate, AMBOSS, First Aid.
- **Anti-overload design:** daily card/minute "good enough" targets + study streak on the Dashboard,
  with a nudge to *stop* at target (the #1 cause of Anki burnout is grinding 500 cards/day). Targets
  editable in Settings.
- **Per-course suggestions:** Dashboard surfaces the folder with the most untouched items.
- Data model: added `Resource`, `TrackerKind`, profile targets; schema v2 with a forward-migration so
  existing browser data upgrades losslessly. Backup JSON now includes resources.
- Download/PWA bumped to v0.5.0 (`Noctyrium-web-v0.5.0.zip`).

## Unreleased — 2026-06-13

Added a **deployable web app** in [`web/`](web/) — the first non-macOS build of Noctyrium.

- Vite + React + TypeScript; runs in VS Code via `npm run dev` (no native build).
- Full glass design system ported faithfully from the SwiftUI source (background gradient,
  ambient orbs, glass shell + luster sweep, day-grade Ring + Heatmap, SF-Rounded type).
- All 11 pages rebuilt and **made modular** — terms, courses, modules, tracker items,
  tasks, journal, prompts, and hub folders are add/edit/delete in-app (the Swift build's
  content was fixed/static).
- **Browser storage** (Zustand + persist to localStorage), no backend; JSON export/import
  + reset-to-seed in Settings & Backup. Replaces the macOS `~/Medical School/` file I/O
  and the `dashboard_stats.sh` shell-out (stats now computed client-side in `scoring.ts`).
- **Adaptive/responsive** layout (sidebar collapses to a drawer on narrow widths).
- Deploy paths: standalone page (hash routes), `<iframe>` embed (`embed-example.html`),
  and a downloadable PWA zip via `scripts/package-web.sh` (relative `base` so it runs from
  `file://`). Verified: clean type-checked build, `file://` render, and mobile layout.
- The Swift/macOS app is unchanged; personal content folders + `.vscode` assets left in
  place pending a later cleanup pass.

## Unreleased — 2026-06-09

Development-environment migration + stabilization (no product redesign).

- Moved the app into a version-controlled Swift Package (`~/Developer/Noctyrium`),
  editable in VS Code / Xcode; retired the timestamped-backup workflow.
- **Fixed the build** — restored `openProductivityDayFile(_:)`, referenced by the
  Heatmap `openDay` callback (compilation was broken). Build is now warning-free.
- **Heatmap cells are clickable** — hover shows a pointer; click opens that day's
  `Productivity/Days/<date>.csv` file.
- `build_app.sh` auto-falls back to Command Line Tools when Xcode's license isn't
  accepted, so a build never blocks.
- Brought the runtime stats script under version control (`scripts/dashboard_stats.sh`);
  the build deploys it to the runtime path if missing.
- Added `scripts/package.sh` to produce a distributable `dist/Noctyrium-<version>.zip`.
- Documented the productivity/daily-file architecture + a conservative migration
  plan in `docs/PRODUCTIVITY-ARCHITECTURE.md`.

The fragile daily-file productivity architecture remains the next major task —
left untouched pending a deliberate, verified migration.

---

## v0.03.01.5 — 2026-05-01 15:32:34 AST

Detailed report:

```
/Users/jd/Medical School/09 Admin/App Data/Noctyrium/Diagnostics/noctyrium_update_log.v0.03.01.5.2026-05-01_15-32-34.md
```

### Summary

- Documented failed productivity/day-tracking architecture.
- Marked v0.03.01.5 as the current checkpoint.
- Captured known bugs in daily-file routing, active-day drift, duplicate corrections, archive duplication, and heatmap callback failure.
- Defined desired next architecture using one file per study day.
- Defined expected `x = 0`, `x = -1`, `x = -2` cascade logic.
- Preserved current observed state for later debugging.

### Status

Not functional yet. Continue from the daily-file architecture patch in the next work session.

---


All notable Noctyrium app changes, bugs, removals, regressions, and architecture notes are tracked here.
