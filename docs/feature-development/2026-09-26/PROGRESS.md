# Personalization, accounts, and product-wide polish — progress

Date: 2026-09-26 · Worktree `AXOM-accounts-v1` · Branch `feat/accounts-sync-v1` · Base HEAD `6a37af6`.
Uncommitted; no push or deployment.

## Owner requests → outcome

| Request | Outcome |
| --- | --- |
| Color themes beyond light/dark (gold & white, purple & black, blue & silver…) | **Done.** Appearance tab + quick popover + onboarding: 8 curated palettes × light/dark (Classic, Ivory, Amethyst, Sapphire, Midnight, Emerald, Rosé, Platinum) and any custom color. Custom colors are derived in OKLCH so contrast fixes keep the hue. 302 hard-coded gold literals migrated to palette channels. Pre-paint script prevents a flash on reload (allow-listed; tampered storage rejected). |
| “Are you locked in?” pop-up on a chosen interval | **Done.** 10 min–2 h, during focus sprints or whenever AXOM is open, gentle/coach/intense voice, optional ±30% varied timing, quiet hours, background notifications, preview, daily stats. Replies know what’s left (“Just 42 min to go on Study time”). |
| Quote at the top, rotating, more AXOM Originals | **Done.** Top bar on every page; rotation daily / 6 h / 2 h / hourly / every section; categories, favorites, hide; library 100 → 180 (80 new AXOM Originals). |
| Account system | **Much further.** App-wide account store; background protection on every page (previously stopped when Settings closed); password, one-time email code (works in the desktop app), reset; name editing; device list; restore; conflict resolution incl. **Merge both**; delete cloud copies; sidebar status dot; migration 004; setup doc. Activation needs a Supabase project (the bookmarked one no longer resolves). |
| Course Tracker subsections | **Done.** Breadcrumb, subsection dropdown, collapsible per-section groups with progress, “Show only this”, remembered location. |
| Application Checker: residency / undergrad | **Residency built** (ACGME-keyed importer `npm run residency:import`, validator, explorer with search/filters/save); needs the official ACGME listing download. Undergrad: honest not-collected state + contract. |
| Settings: profile ugly, personalization cluttered, backup status ugly | **Done.** New Profile header, Appearance tab, Personalization sub-sections (Study style · Daily rhythm · Dashboard · Program & lanes), readable backup status, restore history, exact last-saved time. |
| Clock minute hand floating | **Fixed** (double pivot: SVG rotate attribute + CSS transform-origin). |
| Reports hard to read; weekly/monthly/effort trends | **Done.** Explanations open on click (no hover reflow); weekly/monthly/effort charts follow real calendar days and Productivity’s day grades; activity-based consistency/streak when no targets exist (previously “Building” forever). |
| Habit Tracker ↔ Productivity targets | **Done.** Habits count toward Today’s targets by default; chip per habit; one source of truth. |
| Dashboard luster + unique widget icons | **Done.** Pointer-follow glare, one-shot sheen, subtle lift (off for touch/reduced motion); 25 distinct widget glyphs. |
| Daily games attributions | **Done.** Doctordle thanks + future-collaboration note; SCOWL and Wordle-format credits. |
| Integrations confusing | **Rebuilt** by readiness (works today / experimental / planned) with “what leaves your device”; new **.ics calendar export**. |
| Leaderboards | **Rebuilt:** race your past self (this week vs typical and best at the same point), records, projected rank, private study-groups plan. |
| Hub Folders | **Rebuilt:** search, groups, pinned, recently used, copy path, grid/list, color swatches. |
| Building page header moving | **Fixed** (stable scrollbar gutter, sticky tabs); status filters and connection highlighting. |
| About / Help | **Updated** to the current state. |
| Deferred items | Shipped: AXOM-level reduce motion, restore-history ledger, exact vault-write time, quiz pacing on block results, calendar export, broader route-level code splitting. |

## Verification (fresh, this session)

- `tsc -b` clean · `eslint .` clean · **1,707 / 1,707** unit tests (165 files).
- Production build OK. Always-loaded shell: **459 kB / 129 kB gzip** vs **610 kB / 179 kB** at base HEAD (rare routes and the Supabase SDK now load on demand).
- Browser (installed Chrome): full suite **17 / 17**, plus a new pre-paint palette test (blocks the app bundle) passing — 18 journeys total.
- Visual review via `npm run snapshots` (routes × themes × palettes, synthetic data) — no page errors.

## New tooling

- `npm run snapshots [-- --routes … --palettes … --themes … --seed]` → `web/.snapshots/` contact sheet.
- `npm run test:e2e:chrome` — e2e on installed Chrome when Playwright’s Chromium isn’t downloaded.
- Dev-only `window.__AXOM_DEV__` live-store handle: e2e specs no longer import `/src/lib/store.ts`, which could hit a stale HMR module instance on a long-running dev server (root cause of a false “6 failures” during this session).
- `npm run residency:import` / `residency:validate` (repository root).

## Still open

- Supabase project + env values; live two-account test; Tauri CSP allowing the Supabase origin.
- ACGME listing download for Residency; requirement enrichment from program sites.
- Native desktop notifications for lock-in check-ins (needs `tauri-plugin-notification`).
- Anki note types / “my files” (owner deferred).
