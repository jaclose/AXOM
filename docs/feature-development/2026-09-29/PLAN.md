# Ideas 1 + 3 staging plan

> **Superseded for day-to-day use (2026-09-30):** the ideas bank, statuses, progress and future additions now live in [`docs/directions/`](../../directions/README.md). JD's verbatim notes moved to `docs/directions/01-ideas/`. This file stays as history.


Written for JD and Codex. Item IDs refer to MANIFEST.md. Codex owns Ideas 2 (IDEAS-2.md); this plan builds around it, not over it.

## Principles

1. **Fix classes of bugs, not instances.** One portaled Modal fixes every dialog trapped in a list row; one page-level error boundary fixes every lazy screen that can fail after a deploy.
2. **One primitive per recurring pattern.** Guide steps, "Overwhelmed?", first-visit hints, the account banner and empty-tracker guidance all use one coach-mark primitive. All messages use one notice surface with one exit animation.
3. **Build flagships one at a time, with JD review between them.** Onboarding, journal, Wrapped, library and widgets each get a design pass, an implementation, a browser check in dark + light at 1440 and 390 wide, then JD's eyes.
4. **Stay out of Codex's lane.** Targets/trackers model, auto-logging, Locked In, Spotify/media pill, FocusDock, exam countdown, highlights, Hub folders, rest alarm, quotes and notification mechanics are Ideas 2. Where Ideas 1/3 needs those, Claude builds on Codex's model after it lands.
5. **Honest and calm.** No invented baselines, no grind loops, consumer-friendly copy, no em-dashes in UI strings, reduced-motion paths for every animation.

## Wave 0: foundations (now)

| Slice | What | Fixes |
|---|---|---|
| F1 | `Modal` portals to `<body>` (done in worktree) | I3-28 and every future dialog-in-a-row |
| F2 | Page-level error boundary inside the shell (sidebar, dock and soundscapes survive a failed screen) with Retry / Update actions; precache all route-page chunks in the service worker | I1-03 and every lazy route after a deploy |
| F3 | Remove the dead `experimentalFlags.dailyGames` gate from the Daily Word widget | I1-03b |
| F4 | Coach-mark primitive (spotlight, arrow, ripple, one-time memory, reduced motion) | Base for I1-17/18/19, I3-19, I3-24 |
| F5 | Notice surface: palette-aware toast styling + "evaporate" exit (blur, lift, fade) instead of instant removal | I3-37, I3-60, M-04 (visual layer) |
| F6 | Tab identity: rounded SVG favicon (light/dark), PNG fallbacks, apple-touch icon, maskable icons, rounded notification icon asset, live tab title while a session runs | M-01, M-02 |
| F7 | `docs/design/DESIGN.md`: the design contract both agents follow (tokens, surfaces, radii, motion, copy voice, reuse index) | Consistency across parallel work |

## Wave 1: JD's bug list and quick wins

Guide (I1-04, I1-17, I3-34): guide on by default after the contract, max 8 steps, smoothed spotlight, lighter haze, replay from Help and Settings.
Sidebar (I1-23, I3-52): new default visibility per track, Soundscapes first in Tools, Misc folder for Hub folders/Prompts/Tasks/Study methods, drag-to-reorder in Customize; Application checker residency view with an honest empty state (no developer copy).
Trackers (I3-01): order frozen until 10 s after the last tap, then settles.
Course tracker (I3-26, I3-27, I3-29): chronological import order, remove "when should this return", consistent plan/edit forms.
Night owls (I3-12): 00:00-04:59 included in bands and reports.
Small fixes: Building page layout lock (I1-28), About tabs (I1-29), luster first-hover only (I1-15), settings CTA wrap (I1-22 part), Integrations copy honesty (I1-32 part), portable backup entry (I1-35).
Audio (I3-35): pause on headphone removal.
Daily games (I3-53..I3-59): hints ladder, animated how-to, Doctordle-style win card with stats + distribution + share text, back button, sidebar refresh countdown + streak, "Did you get it?" prompt.
Dashboard defaults (I1-21): check-in, timer, soundscapes first for new layouts; a soundscapes widget.

## Wave 2: flagship experiences (one at a time, JD review between)

1. **Onboarding rehaul** (I1-24, I3-13, I3-14a, I3-16, I3-17, I3-18, I3-19): three screens, no scrolling, glass, fades in from the cinematic; study-path cards instead of dropdowns; palette orbs; "how do you study" answers configure the course tracker (I1-30, I3-14b); data safety removed; guide offered after signing; account banner after first saved data.
2. **Course tracker** (I3-23, I3-15, I3-24 part): SGU structure per JD's list with a non-destructive migration, calmer visuals, empty-state guide for other programs.
3. **Journal** (I1-25, I1-26, I3-40..I3-48): desk scene, first-time survey, styles, done-for-today cinematic, unlogged-day flow, block editor, sentiment highlights feeding energy, Stoic default tone, self-care tab with cadence, crisis support scene.
4. **Wrapped + Reports** (I3-07, I3-63, I3-44 part): weekly/monthly/yearly recap as a dashboard header, archived in Reports; Reports reordered by importance and usage.
5. **Widgets** (I1-16, I3-49, I3-22): size-specific content, link widgets (Canvas, ClinicalKey, Sketchy, drives, UWorld), combos, live edit previews, weekly overview refresh, Doctordle/Daily Word split.
6. **Library + economy** (I3-64, I3-65, I3-66, I3-30): bookshelf and quick-sheets cabinet, previews, personal library, earned tokens and cosmetic unlocks.
7. **Energy + goals** (I3-05, I3-10, I3-11, I1-20 simplified view): after Codex's target model lands.

## Wave 3: deep integrations

AI generation (I1-05, I1-07, I1-32, I1-33), exam interfaces and QB flow (I1-08, I3-33, I3-25), leaderboard + community submissions (I3-51, I3-24), DJ mixer + YouTube embeds + new soundscapes/backgrounds (I3-02, I1-06, I1-09), native packaged-app features (M-03, I3-04, I1-10, I1-11), day overview + monthly hover + streak freeze + frequency trackers (I3-06, I3-38, I3-50, I3-36), accounts fixes (I3-31, I3-32, I3-20), ICS cohorts (I1-34), daily medical fact (I1-02), study methods, habits, tasks, recovery (I3-61, I3-62, I3-21).

## Verification for every slice

- Unit tests for new logic; targeted vitest while building; full `npm run quality` before each commit.
- Browser check with the headless driver: dark and light, 1440x900 and 390x844, reduced motion on and off for animated work. Screenshots read back, not assumed.
- One commit per slice on `feat/ideas3-staging`, message names the item IDs and the source of any borrowed idea.
- Never push, merge or deploy without JD.

## Merge order (proposed)

1. Main checkout's uncommitted security hardening (4 Supabase migrations + API/account changes, Codex, Sep 28) lands first on its own branch.
2. Codex `feat/ideas2-integration` rebases on that and lands.
3. `feat/ideas3-staging` rebases last. Known conflicts: `lib/soundscapes/store.ts` (`updateMediaSession` edited on both sides), `SoundscapesPage.tsx`, `FocusDock.tsx`, `App.tsx`, `types.ts`, `store.ts`; two parallel device-video stores (`axom-user-media` from 09d65a1 vs `axom-device-focus-spaces` from Codex) to unify into one.

## Decisions for JD

| # | Decision | Recommendation |
|---|---|---|
| D1 | Crisis scene contact | **Decided (JD, 2026-09-29): no developer phone number anywhere in the app, even behind sign-in.** The scene routes to professional crisis lines (988, local numbers such as Grenada, findahelpline.com) and to a trusted contact the user adds themselves. |
| D2 | iPad wallpapers. The "myWallpaper" files live in iWallpaper's sandbox (licensed to that app), not in the repo. | Use AXOM's own scene art or generated originals; your own photos as an option. |
| D3 | NCRS sheets + Resource/ PDFs (179 MB, one chart has a typo "Epimnphrine") | Host outside git (Supabase storage or Drive links); the library reads them by URL. |
| D4 | The two Q-bank drive links | Link only if you have the right to share their contents publicly. |
| D5 | Generated assets (Higgsfield is connected: images, 3D, audio) for the desk scene and new soundscape beds | Worth it for the desk scene; needs your OK to spend credits. |
| D6 | "Is my account safe?" | Row-level security is on for all account tables and sessions are Supabase-managed. The Sep 28 hardening (server-authoritative AI quota, tighter workspace writes, safer definer functions, bounded snapshot storage) is written but still uncommitted in the main checkout, so it is not live yet. Land it first (merge order step 1). |
| D7 | Menu bar timer not showing | Your installed /Applications/AXOM.app is from Sep 23; the menu bar timer landed Sep 24-26. A fresh desktop build shows it. |
| D8 | Renal labs screenshot (bugs/15.43.52) | Need to know what is wrong in it. |
| D9 | Blue orb (bugs/16.25.15) | **Resolved:** it is the Codex Skysight lens (`Codex Computer Use.app` > Package_ComputerUse.bundle > LensSequence, 45 frames of a 48x48 blue orb), shown while Codex observes the screen for agent context. Not AXOM. |

## Capability map used for this plan

- Bookmarks: Ankimon (economy/item shop), Anki Leaderboard (friends), Review Heatmap, Advanced Browser (resource list); mynoise.net (mixer model); Pixabay motion backgrounds (licensing-safe videos); Raycast (timer finish); Jitter (authored motion); Streamline icons.
- Connected tools: Figma, Canva, Higgsfield (image/3D/audio generation), Google Drive (inspect linked folders), PubMed/bio-research (fact sourcing), Playwright driver for browser checks.

## Ideas 2 execution, 2026-09-30 (Codex, feat/ideas2-integration)

The current user brief overrides the older IDEAS-2 wording and sequence. Wave A: timer/tracker accounting, highlight selection, Spotify persistence, explicit Locked In time semantics, safe Hub actions. Wave B: observed activity, unified targets, audio lifecycle, notifications. Wave C: overlay, weighted exams, layout, light theme, alarms, emails. Wave D only after A passes: quotes, ambient spaces, library. Schema 34; no merge/push; exact-path small commits. Inherited code remains unverified until recorded below in PROGRESS.
