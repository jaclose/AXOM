<!-- Imported planning baseline from ideas3; its reported checks describe that branch only. Current Ideas 2 evidence is appended below. -->
# Ideas 1 + 3 manifest (with Ideas 2 overlaps)

Every item from JD's three idea dumps and the mid-turn notes, with its current status in code, who owns it, and the wave it ships in (see PLAN.md). Verbatim sources: IDEAS-1.md, IDEAS-2.md (Codex's brief), IDEAS-3.md.

Baseline: branch `feat/ideas3-staging` = `main` (c04272d) + soundscape commit 2de3f7a. Codex's Ideas 2 work is uncommitted in `/Users/jd/Developer/AXOM-ideas2` (`feat/ideas2-integration`).

Status words: **DONE**, **PARTIAL**, **MISSING**, **BUG** (root cause known), **CODEX** (Ideas 2 owns it), **VERIFY** (needs a check before work). Owner: C = Claude, X = Codex, JD = decision needed. Waves: 0 foundations, 1 bugs and quick wins, 2 flagship experiences, 3 deep integrations.

Evidence comes from code reading on 2026-09-29 (file:line on `feat/ideas3-staging` unless noted).

## A. Shell, first run, settings, navigation, notifications

| ID | Item | Status and evidence | Owner | Wave |
|---|---|---|---|---|
| I1-04 | Guide/walkthrough is gone | BUG. Commit 997fac8 (2026-07-12) made the tour opt-in: `defaultDraft.launchTour = false`, the only opt-in is a checkbox on the last "Data safety" step; replay lives only in Help (HelpPage.tsx:230). | C | 1 |
| I1-17 | First-run guide, max 8 steps; mini-guide help buttons elsewhere | PARTIAL. GuidedTour + ModuleTour exist (ModuleTours on 3 pages). Step count and copy need a rewrite to 8. | C | 1 |
| I3-34 | Guide jittery, haze too strong | BUG. Haze uses `--blur-veil` over a 0.74 navy scrim (tour.css:15); spotlight moves are not smoothed. | C | 1 |
| I1-18 | "Overwhelmed?" prompt 1-2 min after first use, arrow + ripple to Customize | MISSING. Build on the shared coach primitive (PLAN F4). | C | 2 |
| I1-19 | First-visit page hints (ripples/arrows on scroll-past) | MISSING. Same coach primitive. | C | 2 |
| I1-15 | Widget luster: full intensity on first hover only | MISSING. `lib/useLuster.ts` has no per-widget memory. | C | 1 |
| I1-22 | Settings consumer-friendly; technical behind disclosure | PARTIAL. Many technical labels; "Run setup again" wraps to 3 lines (bugs/16.25.15). | C | 1 (copy + layout), 2 (restructure) |
| I1-23 | Nav defaults: Soundscapes top of Tools, Daily games on, Tasks/Study methods/Prompts hidden, med hides Pre-med + MCAT, App checker residency-first | PARTIAL. Med defaults already hide Pre-med, Prompts, Folders; Tasks + Study methods still visible; Tools order is static (nav.ts). App checker default pathway hard-coded "medical" (ApplicationCheckerPage.tsx:61) and no residency dataset is bundled, so residency-first would show an empty state with developer `npm run` copy. | C | 1 |
| I3-52 | Hide Hub folders into a Misc folder; user can reorder the sidebar | MISSING. Sidebar arrays are static; manage mode only toggles `hiddenNav`. | C | 1 |
| I1-24 / I3-13 / I3-14a / I3-16 / I3-17 | Onboarding rehaul (fewest clicks, no SGU terms for non-SGU, remove skip/don't-show, no scrolling, trackers start at 4, palette orbs, remove Data safety) | PARTIAL. Baseline screenshots captured (scratchpad baseline-onboarding-*). Flagship. | C | 2 |
| I3-18 | Contract signing rehaul; tutorial suggested after signing | PARTIAL. PromisePrompt/PromiseCutscene exist. | C | 2 |
| I3-19 | "Save your progress: make an account" glass banner after the first saved data | MISSING. | C | 2 |
| I1-28 | Building page section shifts when switching systems | VERIFY then fix (BuildingPage.tsx). | C | 1 |
| I1-29 | About: two tabs (About / About the developer) | MISSING. | C | 1 |
| I1-35 | Portable backup still available | VERIFY (lib/backup.ts, localBackup.ts exist; check Settings entry point). | C | 1 |
| I3-37 / I3-60 | Messages fade out elegantly (evaporate); nicer in-app notices | BUG-ish. `dismiss` removes the toast from state instantly (toast.ts:93), so there is no exit animation; toast surface is hard-coded navy/cyan (pages.css:3913). Codex added NotificationActionBridge (browser/native) but not the in-app toast visuals. | C (visual) + X (mechanics) | 0 |
| M-01 | Tab title + favicon (rounded AXOM mark, live state) | MISSING. Favicon is a sharp-cornered full-bleed PNG; no SVG; no `document.title` logic anywhere. Desktop app icon is already a squircle. | C | 0 |
| M-02 | Browser notifications show a rounded AXOM icon | PARTIAL. notify.ts (and Codex's version) uses `icon-192.png` (square tile) and no badge. Chrome on macOS still shows its own app icon as the sender; the page controls the content image. | C (asset) + X (notify.ts) | 0 |
| M-04 | In-app notifications updated | See I3-37. | C + X | 0 |
| I3-03 | "Blue orb" top-right | Not AXOM. No AXOM element renders a top-right check orb (all fixed elements checked). Seen in bugs/16.25.15 next to a pixel robot that also appears on doctordle.org, so it is a desktop/extension overlay (likely Codex/ChatGPT computer-use). | JD confirm | - |

## B. Productivity, trackers, targets, energy, reports

| ID | Item | Status and evidence | Owner | Wave |
|---|---|---|---|---|
| I1-01 | "Are you locked in?" check-in, configurable | DONE on main (focusCheckIn.ts, FocusCheckIn.tsx); Codex made it persistent + fixed goal-vs-timer copy. | X | - |
| I1-20 | Goals: simplified vs technical view, templates, >100% overflow, habits linked | PARTIAL. DailyRequirementsEditor = technical view only; progress clamped to 100% (dailySuccess.ts:484-486 `clampRatio`). Codex is reworking targets. Simplified view builds on Codex's model. | X model, C simplified view | 2 (after Codex) |
| I1-21 | Widget default order: check-in, timer, soundscapes first | PARTIAL. New users land on FOCUSED_ORDER (check-in 3rd, timer 8th); no soundscapes widget exists. | C | 1 |
| I3-01 | Tracker boxes jump when time is added | BUG. TrackerManager sorts by `activeDays30` (TrackerManager.tsx:67), so every log reorders; Codex keeps this sort. Fix: freeze order until 10 s after the last tap. | C patch, X aware | 1 |
| I3-39 | Tracker logged from auto-Pomodoro doubled study time (384 to 736) | CODEX + VERIFY. Codex's new `studyActivity` dedupe (stable event IDs) targets this; needs a regression test for exactly this path. | X | - |
| I3-09 | Questions/timer/Anki auto-fill daily progress, can exceed 100% | CODEX (auto-logging) + clamp removal for display. | X | - |
| I3-05 | Energy quick check-ins with ripple/melt animations, first-time explanation | PARTIAL. EnergyCheckRow is a static 5-level row. | C | 2 |
| I3-06 | Day overview calendar in Productivity (click to create study events) | MISSING. | C | 3 (after Codex) |
| I3-07 | Weekly/monthly/yearly Wrapped as a dashboard header, archived in Reports | MISSING. | C | 2 |
| I3-10 | Goal adaptation survey (raise 7.5/15/30%/custom; compassionate lowering) | MISSING. Pure logic can be built now; UI after Codex's targets. | C | 2 |
| I3-11 | Progress reveal animation (orbs per 30 min, fluid fill, speech bubble) | MISSING. | C | 2 |
| I3-12 | Include 12-5 AM in tracking/reports | BUG. Energy bands cover 5-24 h only (energyInsights.ts:108-110). | C | 1 |
| I3-21 | Recovery plan rehaul; adapts to yesterday; weekly summary | PARTIAL (lib/recovery.ts). | C | 3 |
| I3-22a | Weekly overview widget beautified; less dead space | PARTIAL. Pomodoro widget has large dead area (bugs/19.18.29). | C | 2 |
| I3-36 | Frequency trackers (5x/day, 3-4x/week), slivers by importance, flame animation + green border, non-timed checkbox trackers | PARTIAL/CODEX. Codex added custom units/schedules but removed `StreakEmber` and the 14-day strip from TrackerCard. | X model, C visuals | 3 |
| I3-38 | Monthly overview: hover a day for highlights (green/orange/red/blue + crown) | PARTIAL. `gradeLabel` already uses a crown for blue. | C | 2 |
| I3-50 | Streak recovery / skip day / freeze | PARTIAL. Habits support skip-holds-streak, schedules, exam mode; trackers do not. | X model, C UI | 3 |
| I3-61 | Study methods: "what feels right now", how-to, rate afterwards | PARTIAL. | C | 3 |
| I3-62 | Habit tracker visuals; Tasks need life | PARTIAL. | C | 3 |
| I3-63 | Reports: more, better viz, most important first, weekly reorder by usage | PARTIAL. | C | 2 (with Wrapped) |

## C. Journal, self-care, crisis support, library, economy

| ID | Item | Status and evidence | Owner | Wave |
|---|---|---|---|---|
| I1-25 | Journal desk scene (MacBook, headphones, plant, weather shadows, drink, iPad) | MISSING. Assets needed (see PLAN D2). | C | 2 |
| I1-26 | iPad toggled 3x plays "Again" and unlocks it | PARTIAL. `lib/unlocks.ts` has the unlock, nothing calls `unlock("again")` yet. | C | 2 |
| I3-40..I3-45 | Done-for-today cinematic, unlogged days, first-time journal survey, block editor, sentiment to energy, Stoic/Expressive tone | MISSING (journal exists: JournalPage.tsx, journalNotebook.ts). | C | 2 |
| I3-46 | Self-care tab + weekly check-in cadence | MISSING. | C | 2 |
| I3-47 | Positive phrases green, draining phrases orange/red | MISSING. | C | 2 |
| I3-48 | Crisis support scene | MISSING. Must follow safe-messaging guidance (988, findahelpline.com, local Grenada numbers), scope detection to first-person reflective text so clinical notes ("suicide risk assessment") never trigger it. See PLAN D1 for the personal phone number. | C + JD | 2 |
| I3-30 | More resources/drives, ratings, JD's Anki add-ons | PARTIAL. Ratings already exist on resources. Add-ons found in bookmarks: Advanced Browser 874215009, Review Heatmap 1771074083, Ankimon 1908235722, Anki Leaderboard 175794613, Anki Terminator V2 1468920185, Anki Remote 693153301, AMBOSS add-on. | C | 2 |
| I3-64 | New Q-bank drives + JD's drive (NCRS sheets) | MISSING. NCRS_Master_Deck.html = 1,024 slides; Resource/ is 179 MB. Public repo: see PLAN D3/D4. | C + JD | 2 |
| I3-65 | Library experience (bookcases, quick-sheets cabinet, previews, personal library) | MISSING. | C | 2 |
| I3-66 | Token economy + cosmetic unlocks (<= 6 months to unlock most) | MISSING. Precedent in JD's bookmarks: Ankimon money + item shop. | C | 2 |

## D. Academics: course tracker, questions, exams, AI/Anki

| ID | Item | Status and evidence | Owner | Wave |
|---|---|---|---|---|
| I3-28 | Brain button breaks the study plan | BUG, FIXED in worktree (uncommitted): `ItemStudyPlanEditor` rendered inside the row (CourseTrackerPage.tsx:590-592) and `Modal` was not portaled, so rows painted over it (bugs/19.04.31, 19.04.38). `Modal` now portals to `<body>` for all 30 usages. | C | 0 |
| I3-29 | Study plan vs edit forms formatted differently | PARTIAL. Unify when touching the plan editor. | C | 1 |
| I3-26 | Uploads should sort chronologically | BUG. `addQuestionSet`/`addDocument` prepend (store.ts:1443, 1457-1458); MassImport keeps raw FileList order. | C | 1 |
| I3-27 | Remove "when should this return" after "Not now" | MISSING (find all snooze prompts). | C | 1 |
| I3-23 | SGU structure per JD's list; Boards (CBSE, Step 1 blueprint, Dedicated, Step 2/3) | PARTIAL. Seed has Term 4 = `FTCM (pending)` + `BSCE T4`, Term 5 = `CBSE` only (experience.ts:203-227). Non-destructive migration needed. | C | 2 |
| I1-30 / I3-14b | "How do you study" shapes tracker logic (Anki/Noji/none, PQs per lecture, passes) | PARTIAL. Tracker always renders Anki controls regardless of workflow; plan editor "Lecture passes" may not affect PQ rows. | C | 2 |
| I1-31 | Course tracker star (pin module) | DONE (keep). | - | - |
| I3-15 | Course tracker visual refresh, calmer | PARTIAL. | C | 2 |
| I3-24 | Non-SGU: empty tracker + quick guide; template/soundscape/drive/question submissions to JD | MISSING. Submissions need a Supabase table + RLS + moderation view. | C | 3 |
| I3-33 | QB selector less crowded; timed/tutor choice; don't list all sets once one is chosen | PARTIAL. ExamRunner setup lists every set even when one is preselected (ExamRunner.tsx:712-725). Codex edits ExamRunner. | C after X | 3 |
| I3-25 | QB headings/tabs; bulletproof import | PARTIAL (big import engine exists). | C | 3 |
| I1-08 | Examplify / AMBOSS / Step 1 / native exam UIs (refs in scratchpad ideas1-refs) | PARTIAL (UWorld mode is done and loved). | C | 3 |
| I1-05 / I1-07 / I1-32 | Generative QBank + smart cards (cloze/basic/image occlusion) with card-count range and depth; Anki push; honest Integrations copy | PARTIAL. Cloud AI exists (Supabase ai-proxy); AnkiConnect client exists; Integrations claims "Anki ready today". | C | 3 (copy fix in 1) |
| I1-33 | Simulations tab (WIP) | MISSING. | C | 3 |
| I1-34 | ICS upload builds schedule by cohort A/B/C/D, export | PARTIAL (courseScheduleImport.ts, calendarExport.ts). | C | 3 |
| I1-02 | Daily medical fact (local library) | MISSING. Needs a reviewed, sourced fact set. | C | 3 |

## E1. Audio, timer, native shell, accounts

| ID | Item | Status and evidence | Owner | Wave |
|---|---|---|---|---|
| I1-06 / I3-08 | Upload own soundscapes; YouTube link | PARTIAL. File upload DONE in 2de3f7a (IndexedDB, device only, not synced). YouTube: embed-only via IFrame API (downloading audio breaks YouTube ToS). | C | 3 |
| I1-09 | More soundscapes, better mapping, more backgrounds | PARTIAL. Comfort chain + level calibration DONE in 2de3f7a. Licensing-safe sources: Pixabay videos (in JD's bookmarks), generated beds. | C | 3 |
| I1-12 | Soundscapes in Apple Now Playing | DONE in 2de3f7a (not yet on main/production, so JD has not seen it). | C | ship with W1 |
| I3-35 | Stop soundscapes when headphones are removed | MISSING. AirPods: macOS sends pause to Now Playing, handled by the media-session pause handler; wired: `devicechange`, pause when a known output disappears. | C | 1 |
| I1-13 | Timer pill hover should push soundscapes right | CODEX. FocusDock is heavily edited by Codex. | X | - |
| I1-11 / I3-04 / M-03 | Menu bar timer + soundscape, Raycast finish (tune + green edge), orb personality, custom desktop notification HUD, break pill style | PARTIAL. Native menu-bar pill exists (menu_bar_pill.rs, menu_bar_timer.rs) but JD's installed /Applications/AXOM.app is dated Sep 23, before it landed (Sep 24-26). HUD + tray soundscape controls MISSING. Codex edits src-tauri/src/lib.rs. | C (coordinate) | 3 |
| I1-10 | Locked-in reaches the user outside the app | CODEX (web notifications) + C (native HUD). | X + C | 3 |
| I3-02 | DJ-style mixer (per-ear frequencies, layering, saved presets) | PARTIAL. Per-ear routing exists inside the `tone` layer (ChannelMerger); engine plays one version at a time. Frontier model: mynoise.net sliders + saved mixes. | C | 3 |
| I1-14 | "Is my account and data safe?" | Answer in PLAN D6. Hardening migrations are uncommitted in the main checkout. | JD | - |
| I3-31 | "Action needed" unclear; "Merge both" unclickable | VERIFY. Button is only `disabled={busy}` in code; likely stuck `busy` or an off-screen failure. | C | 3 (after hardening lands) |
| I3-32 | Keep 10 saves (adjustable) | PARTIAL. Server keeps 60 revisions per workspace (migration `offset 60`), conflict copies never pruned. | C | 3 (after hardening) |
| I3-20 | Sign-in after account creation loads the latest backup | VERIFY. | C | 3 |

## E2. Daily games, widgets, social

| ID | Item | Status and evidence | Owner | Wave |
|---|---|---|---|---|
| I1-03 | Daily games black screen | BUG. Reproduced: a failed game chunk replaces the whole app with the root recovery screen. Games are never precached (build-metadata.ts precaches only App.tsx static imports), so after a deploy with a tab open, the stale shell requests deleted chunk hashes. Fix: page-level error boundary, precache route chunks. | C | 0 |
| I1-03b | Dashboard Daily Word widget stuck on "Enable" | BUG. Commit 3ae726e removed the only setter of `experimentalFlags.dailyGames`, but DashboardPage.tsx:911 still reads it. | C | 0 |
| I3-53..I3-58 | Daily Word hints, how-to animation, Doctordle-style win card, share text, better back button, sidebar countdown + streak | MISSING. | C | 1 |
| I3-59 | "Did you get the Doctordle?" on return + dashboard reminder | MISSING (AXOM cannot see Doctordle results, so this is honest self-report). | C | 1 |
| I1-16 / I3-49 / I3-22b | Custom widgets, link widgets, size-specific content, combos, edit previews | PARTIAL. Registry exists (lib/dashboardWidgets.ts); Codex does not touch it. | C | 2 |
| I3-51 | Friends leaderboard, nicknames, widget | PARTIAL (LeaderboardsPage preview). Needs backend + privacy model. | C | 3 |


## Ideas 2 current reconciliation, 2026-09-30

This table supersedes older CODEX/DONE assumptions above for this lane. SHIPPED + VERIFIED means locally committed and checked, never deployed. The current user brief controls scope and sequence.

| ID | Item | Status | Evidence / remaining work |
|---|---|---|---|
| I2-01 | Locked In | IMPLEMENTED, NOT VERIFIED | Portaled prompt; route/reload tests pass; reply exits after action. Visual review pending. |
| I2-02 | Spotify | PARTIAL | One shell player and observed playback adapter pass browser contract; live service check pending. |
| I2-03 | Productivity events | PARTIAL | Normalized activity and retry tests pass; Anki route-independent ingestion still missing; concurrent tracker edits under review. |
| I2-04 | Exam countdown | PARTIAL | Split widget exists; configurable weighting and shared module/calendar date source unfinished. |
| I2-05 | Soundscape lifecycle | PARTIAL | Persistent player exists; daily metadata refresh unfinished. |
| I2-06 | Highlights | IMPLEMENTED, NOT VERIFIED | Baseline same-tone overlap rejection reproduced; real pointer merge/delete/reload passed; commit pending. |
| I2-07 | Quotes | IMPLEMENTED, NOT VERIFIED | Inherited originals and container; held until Wave A complete. |
| I2-08 | Ambient spaces | PARTIAL | Local/owned media host; external WindowSwap route returned 404; never blindly embedded. |
| I2-09 | Light mode | PARTIAL | Inherited tokens improve surfaces; full contrast audit remains. |
| I2-10 | Trackers and targets | PARTIAL | Unified target presentation exists; concurrent units/correction/frequency fixes arriving. |
| I2-11 | Productivity layout | PARTIAL | Timer above activity; responsive and low-data verification remains. |
| I2-12 | Hub folders | PARTIAL | Narrow canonical-directory commands plus main-window ACL; 2 Rust tests pass, isolated native QA pending. |
| I2-13 | Rest alarm | PARTIAL | Preview, custom files, synthesized defaults exist; full lifecycle/audio/native checks remain. |
| I2-14 | Frequency support | PARTIAL | Media-session boundary exists; Claude owns the engine and mixing. |
| I2-15 | Emails | IMPLEMENTED, NOT VERIFIED | Inherited shared HTML/text renderer; generated HTML QA pending. |
| I2-16 | Notifications | PARTIAL | Delivery and deep-link bridge exists; native HUD remains coordinated with Claude. |
| I2-17 | Quality bar | PARTIAL | Current working-tree quality: 1964 tests pass, typecheck/lint/build pass; no lane-wide shipped claim. |
