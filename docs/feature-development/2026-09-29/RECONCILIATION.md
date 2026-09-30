# Reconciliation: claims vs. what actually works (2026-09-29, 20:10; updated 2026-09-30 00:30)

Checked against IDEAS-1.md, IDEAS-3.md, MANIFEST.md, PLAN.md, PROGRESS.md and the Codex board. Branch `feat/ideas3-staging` (not merged, not pushed, not deployed).

**Bottom line (updated 2026-09-30):** of ~106 items, 27 are shipped and verified in a browser, 5 are implemented but not yet verified the way a user would meet them, 12 are partial, 3 are blocked, 5 belong to Codex, and ~54 are planned or not started. That is about 25% fully done by item count (about 31% if partial work counts as half), and less by effort, because the unstarted items include the biggest ones (journal, onboarding, Wrapped, library, AI generation, exam interfaces). (It was 11, about 10%, on 2026-09-29.)

Status words: **SHIPPED + VERIFIED** (user-facing behavior exercised in a real browser), **IMPLEMENTED, NOT YET VERIFIED** (code + automated tests only, or cannot be verified headless), **PARTIAL** (only part of the requested behavior), **PLANNED**, **BLOCKED**, **NOT STARTED**. A shared component change never counts as shipping the feature that sits on top of it.

Verification environment: headless Chrome (Playwright, real Chrome channel) against the Vite dev server; 1440x900 and 390x844; dark and light; reduced motion on and off where animation mattered. Not available headless: macOS Now Playing, OS notification rendering, AirPods hardware, a production deploy.

## The 20 areas flagged for over-broad claims

| # | Area | Status | Evidence | Owner | Next action |
|---|---|---|---|---|---|
| 1 | Guide / walkthrough (I1-04, I1-17, I3-34, I3-18, I1-18, I1-19) | I1-04, I3-34, I3-18, I1-18, I1-19 SHIPPED + VERIFIED; I1-17 PARTIAL | dd5e5ba + d0c502d. Tour: 8 stops, offer card, gliding spotlight. Browser: offer shown after the Promise (seeded user), tour run through all 8 stops, per-frame jitter sampled (largest tip jump 321px -> 58px same-page), light theme fixed in d0c502d | Claude | I1-17: mini-guide help buttons exist on only 3 pages. 120a7ba: "Overwhelmed?" + first-visit hints on the new CoachMark primitive (F4); I3-18 run end to end |
| 2 | Timer / menu bar (I1-11, I3-04, M-01, M-03) | M-01 SHIPPED + VERIFIED (web tab only); I1-11 PARTIAL; I3-04, M-03 NOT STARTED | 4a44d32: live tab title + progress ring, browser-verified (title "24:58 · Focus · AXOM", ring at 65%). Native menu-bar pill exists on main (src-tauri menu_bar_pill.rs) but JD's installed app predates it | Claude (native after Codex posts its lib.rs is committed) | Fresh desktop build for JD; tray soundscape controls; finish tune + green edge; break pill |
| 3 | Tracker ordering (I3-01, I3-36) | I3-01 SHIPPED + VERIFIED; I3-36 NOT STARTED | 22857db. Browser: three taps on the last card, order unchanged; 10.6 s later it moved up. Unit: useSettledOrder.test.ts (3 cases) | Claude (hook); Codex (tracker model) | JD's `TODO(human)` in lib/trackerOrder.ts decides the settled order; frequency/non-timed trackers + flame after Codex's model lands |
| 4 | Late-night study (I3-12) | SHIPPED + VERIFIED | 22857db. Unit: energyInsights.test.ts "counts late-night study (00:00-04:59)". The Energy rhythm chart that shows the band was not opened in a browser | Claude | Open Energy insights with a 2 AM log and check the band renders |
| 5 | Soundscapes + headphones (I3-35) | PARTIAL | 22857db: outputGuard.ts (+ test) pauses only when a known output id disappears, which most browsers hide. AirPods rely on the media-session pause handler from 2de3f7a, not tested on hardware | Claude | Native CoreAudio route listener in the packaged app; test AirPods on JD's Mac |
| 6 | Daily Games (I1-03, I3-53..I3-59) | I1-03, I3-53..I3-59 SHIPPED + VERIFIED | 1bce4b4. Browser: game chunk forced to 404 -> in-shell recovery card, sidebar alive, cleared on navigation. Build output: 5 game files now in the service-worker precache. Daily Word upgrades: see row 12. Sidebar countdowns: 937a991. Doctordle check-in + reminder + back link: 3386844 | Claude | "More words" for Daily Word; Doctordle + Daily Word split widget (I3-22) |
| 7 | Course tracker / study plan (I3-28, I3-29, I3-26, I3-27, I3-23, I1-30) | I3-28 SHIPPED + VERIFIED; I3-27 IMPLEMENTED, NOT YET VERIFIED; I3-26 PARTIAL; I3-29, I3-23, I1-30 NOT STARTED | 1bce4b4: dialog now a child of body, bottom edge hit-test inside the dialog (browser). 22857db: Not now + Undo (jsdom test renders page + Toaster). I3-26: mass-import queue only (test in d0c502d); course-tracker imports not checked | Claude | Check which upload JD meant; unify plan/edit forms; SGU structure |
| 8 | Accounts / data safety (I1-14, I3-20, I3-31, I3-32) | I1-14 answered (PLAN D6); I3-20, I3-31, I3-32 BLOCKED | RLS enabled on all 7 account tables (migrations grep). Retention is 60 revisions (migration line 72). Hardening is uncommitted in the main checkout | Claude after merge | Land main-checkout hardening first, then fix Merge both, 10-save cap, restore-latest |
| 9 | Widgets (I1-15, I1-16, I1-21, I3-22, I3-49) | I1-21 SHIPPED + VERIFIED; I1-15 IMPLEMENTED, NOT YET VERIFIED; I1-16, I3-22, I3-49 NOT STARTED | a030af0: new Focused order + Soundscape widget + one-time upgrade of saved layouts. 22857db: luster memory (hover not exercised) | Claude | Verify hover; richer per-size widgets (I3-22) are Wave 2 |
| 10 | Journal (I1-25, I1-26, I3-40..I3-48) | NOT STARTED (I1-26 PARTIAL: unlock mechanism only) | lib/unlocks.ts exists (2de3f7a); nothing calls unlock("again") | Claude | Wave 2, after Wave 1 is clean |
| 11 | Reports (I3-07, I3-63) | NOT STARTED | | Claude | Wave 2 |
| 12 | Daily Word (I3-53..I3-58) | SHIPPED + VERIFIED | 7a85fe0 (win card, share #N, on-board how-to, back link, no scroll), a77a59b (hint ladder + reveal), 937a991 (sidebar countdown + streak) | Claude | "More words" list growth is separate |
| 13 | Question bank / exam UIs (I1-08, I3-33, I3-25) | NOT STARTED | ExamRunner lists every set even when one is preselected (ExamRunner.tsx:712-725), Codex edits that file | Claude after Codex | Wave 3 |
| 14 | Anki / native flashcards (I1-07, I1-32) | I1-32 copy SHIPPED + VERIFIED; I1-07 NOT STARTED | 67eb5c0: Integrations says what Anki Lab really does (local drafts or your own AI chat, then CSV/TSV) | Claude | Wave 3 |
| 15 | Generative questions (I1-05) | NOT STARTED | | Claude | Wave 3 |
| 16 | Onboarding (I1-24, I3-13, I3-14, I3-16, I3-17, I3-19) | NOT STARTED | Baseline screenshots of every current step captured | Claude | Wave 2 flagship |
| 17 | Apple Now Playing (I1-12) | IMPLEMENTED, NOT YET VERIFIED | 2de3f7a removed the MediaStream route that made Chrome treat playback as a one-shot player; media-session metadata + handlers registered. Headless Chrome has no macOS Now Playing | Claude | JD checks Control Center while a soundscape plays |
| 18 | Custom soundscapes (I1-06, I3-08) | PARTIAL | File upload of sounds + backgrounds: 2de3f7a (userMedia.test.ts; browser screenshots in the earlier session). YouTube link: NOT STARTED (embed-only by YouTube's terms) | Claude | YouTube embed source |
| 19 | Community / leaderboards (I3-51, I3-24) | NOT STARTED | | Claude | Wave 3 (needs backend + privacy model) |
| 20 | Resource library (I3-30, I3-64, I3-65, I3-66) | NOT STARTED | Hosting decision pending (PLAN D3/D4) | Claude | Wave 2 |

## Every SHIPPED + VERIFIED item

| Item | Commit | Files | Automated test | Browser verification |
|---|---|---|---|---|
| I1-03 Daily games black screen | 1bce4b4 | RouteErrorBoundary.tsx, App.tsx, webUpdates.ts, build-metadata.ts, shell.css | RouteErrorBoundary.test.tsx (3) | Forced chunk 404 in dev: in-shell card, sidebar present, cleared after navigating; production build precache lists the 5 game files (2.56 MB total precache) |
| I3-28 Study plan dialog | 1bce4b4 | Modal.tsx | Existing Modal/CourseTracker/QuestionWorkspace/FocusDock suites (33) | Opened from a tracker row: dialog is a child of body; hit-test at its bottom edge lands inside it; screenshot |
| I3-37 Notices evaporate | d7c9a93 | Toaster.tsx, useExitingList.ts, pages.css, 3 test files | Toaster.test.tsx, toast.test.ts, DailyLoopReminderWatcher, StandupWatcher | Frame strip at 0/180/340/740 ms with motion on; light and 390 checks in the sweep |
| M-01 Tab identity | 4a44d32 | favicon.svg, favicon-32.png, icon-192.png, icons/*, manifest, index.html, TabPresence.tsx | TabPresence.test.ts (3) | Idle title "Course Tracker · AXOM"; running "24:58 · Focus · AXOM"; favicon data-URL ring rendered and inspected |
| I1-04 Guide restored | dd5e5ba | GuideOffer.tsx, guideOffer.ts, GuidedTour.tsx, Sidebar.tsx, App.tsx, tour.css | GuidedTour.test.tsx, guideOffer.test.ts, App.test.tsx | Offer shown, tour started, all 8 stops traversed |
| I3-34 Guide smoothness + haze | dd5e5ba, d0c502d | GuidedTour.tsx, tour.css | GuidedTour/ModuleTour suites (12) | rAF frame sampling per stop; screenshots dark 1440, light 1440, dark 390 |
| I3-01 Tracker jump | 22857db | useSettledOrder.ts, TrackerManager.tsx, trackerOrder.ts | useSettledOrder.test.ts (3) | Order held through 3 taps; re-sorted 10.6 s after the last tap |
| I3-39 Doubled study time | d626082 | store.ts (matchProductivityTracker) | pomodoroTrackerAttribution.test.ts (3), failed before the fix | Study tracker card reads "1h 30m" after a 90-minute Pomodoro log |
| I1-28 Building page shift | 22857db | ecosystem.css | none (CSS) | Card width 344 px before and after filtering; filter row top unchanged |
| I1-29 About tabs | 22857db, d0c502d | AboutPage.tsx, pages.css | none | Dark 1440 (developer tab embeds jafardabbagh.com), dark 390 cold load |
| I3-03 Blue orb identified | d0c502d (docs) | PLAN.md D9 | n/a | Matched against Codex Computer Use LensSequence frames (48x48 blue orb) |
| I3-53..I3-57 Daily Word | 7a85fe0, a77a59b | DailyWordPage.tsx, DailyWordDemo.tsx, dailyWordDemo.ts, dailyWordHints.ts, dailyWord.ts, dailyWordStats.ts, store.ts + backup.ts normalizers, daily-games.css | dailyWord.test.ts, dailyWordDemo.test.ts, storeDailyGames.test.ts (hint fields survive the store), DailyWordPage.test.tsx | Demo frames, hint ladder (key glow, tile outline, confirm, reveal), win card, share text; 0 px overflow at 1440x900; dark 390 and light 1440 |
| I1-23 / I3-52 Sidebar | 937a991 | navLayout.ts, nav.ts, Sidebar.tsx, DailyGameNavMeta.tsx, ApplicationCheckerPage.tsx | navLayout.test.ts, SidebarAccessibility.test.tsx | Upgrade applied once to a pre-upgrade profile; Alt+Up reorder persisted across reload; Residency view for SGU |
| I3-58 Game countdowns | 937a991 | DailyGameNavMeta.tsx | DailyGameNavMeta.test.ts | "23h" / "52m" at 00:08 AST; Doctordle counts to 05:00 UTC |
| I1-18 "Overwhelmed?" | 120a7ba | CoachLayer.tsx, CoachMark.tsx, coachPlacement.ts, coach.ts, coach.css, Sidebar.tsx (open Customize), App.tsx (mount) | CoachLayer.test.tsx (4), coach.test.ts (6), coachPlacement.test.ts (6) | Appeared at 88.7 s of visible time; word, drawn arrow, ripple + bubble right of Customize; Show me opened Customize. Dark 1440 + light 1440 with motion on; dark 390 (arrow to the menu button, Show me opened the drawer in Customize mode) |
| I1-19 First-visit page hints | 120a7ba | coach.ts (5 hints), CoachLayer.tsx, HelpPage.tsx (Show page hints again), CourseTrackerPage.tsx (intro toast removed) | CoachLayer.test.tsx, coach.test.ts | Dashboard, Course Tracker, Question Bank, Productivity, Soundscapes (waited for the taste picker); No more hints stopped them; Help brought them back |
| I3-18 Tour offered after signing | dd5e5ba (behavior), verified 2026-09-30 | App.tsx, GuideOffer.tsx | GuideOffer tests | Sign now -> signed -> cutscene closed -> "Want a 60-second tour?" shown |
| I3-59 Doctordle "did you get it?" | 3386844 | doctordle.ts, DoctordleCheckIn.tsx, DoctordleReminder.tsx, DoctordlePage.tsx, OptionalDailyGamesPage.tsx, DailyGameNavMeta.tsx, DashboardPage.tsx (1 line + import), App.tsx (mount) | doctordle.test.ts (5), DoctordleCheckIn.test.tsx (6), DoctordlePage.test.tsx | Open -> inline ask on the page; elsewhere the floating check-in 15 s later; Got it -> sidebar flame 1; regular's dashboard card Yes -> Got it -> "Logged. 3 in a row." Dark 1440, light 1440, dark 390 |
| I1-32 Integrations copy | 67eb5c0 | IntegrationsPage.tsx | none (copy) | Read back at 390 dark: Anki card export copy, no em dashes |
| I1-35 Portable backup entry | existing; verified 2026-09-30 | IntegrationsPage.tsx, SettingsModal.tsx | SettingsModal tests | Integrations > Open backups opened Settings on Emergency recovery; Export backup downloaded axom-backup-2026-09-30.json with the workspace (5 tracker items) |
| I3-12 Late-night band | 22857db | energyInsights.ts | energyInsights.test.ts (a 02:00 log lands in Late night) | Reports > Your rhythm shows the "Late night 12 AM-5 AM" row (dark 390, 2026-09-30) |
| I1-21 Dashboard order + Soundscape widget | a030af0 | dashboardWidgets.ts, SoundscapeWidget.tsx, quickPicks.ts, DashboardPage.tsx (4 small hunks), SettingsModal.tsx, types.ts, dashboard-widgets.css | dashboardWidgets.test.ts (+5), quickPicks.test.ts (3), DashboardWidgetEngine.test.tsx | New student grid: Daily Check-In, Pomodoro, Soundscape, targets, Question Bank, Course Tracker, Weekly. Played, switched (Brown) and stopped from the widget; custom layout gained Soundscape right after the timer; dark 1440, light 1440, dark 390 |

## IMPLEMENTED, NOT YET VERIFIED

I3-27 one-tap Not now (jsdom only), I1-15 quieter luster (no hover check), M-02 rounded notification icon (no OS notification rendered), I1-12 Now Playing (macOS only), I1-03b Daily Word widget gate (widget not on the default layout).

## PARTIAL

I1-17 (8-stop tour yes; mini-guides on Course Tracker, Question Bank, Productivity and Reports (c823b2a); Soundscapes waits for Codex's page restructure), I1-11 (native pill exists, JD's build is old), I3-35 (AirPods path untested, wired path mostly inert), I3-26 (mass import only), I1-06/I3-08 (files yes, YouTube no), I1-09 (comfort and levels yes, more content no), I1-26 (unlock mechanism, no trigger), I1-22 (verified: "Run setup again" on one line; 67eb5c0 plain-language Account and Data tabs with a Technical details disclosure, checked dark 1440 and 390; 2c24bf6 removed the remaining em dashes; Advanced stays technical on purpose; the Wave 2 restructure is not started), I3-60/M-04 (toast visuals yes, broader notification surfaces no).

## BLOCKED

I3-20, I3-31, I3-32 (accounts: wait for the main checkout's uncommitted hardening to land). The native half of I1-10 also waits for Codex's src-tauri changes.

## CODEX (not verified by Claude)

I1-01 persistent Locked In, I1-10 web notifications, I1-13 timer pill hover, I1-27 quotes, I3-09 auto-fill progress, I3-60 notification mechanics. Codex's own report says full browser/native verification of its branch is unfinished.

## Known data follow-up for JD

Pomodoro logs written before d626082 carry no tracker, and the day JD topped up still holds the duplicate manual entry. Nothing was rewritten automatically. Options: delete the duplicate in Activity history, and approve (or not) a one-time backfill that attaches old Pomodoro logs to the Study tracker.
