# Ideas bank: index (read this first)

Every idea JD has given, as one tracked item. The verbatim notes sit beside this file (IDEAS-1.md to IDEAS-4.md) and are never edited; this index is where status changes. When JD sends new notes: save them verbatim as the next IDEAS-N.md, then add each actionable idea below with the next ID.

**Status:** `NEW` not yet planned · `PLANNED` in a branch plan · `IN PROGRESS` being built · `PARTIAL` part shipped · `SHIPPED` on main · `VERIFIED` on main and exercised in a real browser · `CODEX` Codex's lane (status as Codex reports it) · `NEEDS JD` waiting on a decision, licence or credential · `FUTURE` parked, see ../05-FUTURE.md · `ANSWERED` a question, not a feature.

**Where:** a commit or wave on main, or the branch that owns the work: `wave/1.2` (polish + directions), `feat/wave2-home` (dashboard, widgets, Up Next, Wrapped, check-in, accounts nudge), `feat/wave2-journal-library`, `feat/wave2-study-ai` (schedule, Q-bank AI, tutor, exam UIs), Codex's `feat/ideas2-integration`.

Last full review: 2026-09-30, after Wave 1.1 (main 83d9fb8, pushed by JD).

## 1. First run: intro, setup, Promise, guide

| ID | Idea | Status | Where |
|---|---|---|---|
| I1-24, I3-13, I3-14a, I3-16, I3-17 | Setup rebuilt after the intro: name, path, focus as chips, no SGU terms for non-SGU, no scrolling, palette orbs, no data-safety step, "what makes today count" automatic | VERIFIED | Wave 1.1 (a7603be) |
| I3-13b | Remove the intro's "Skip intro" and "Don't show again" buttons | IN PROGRESS | wave/1.2 (9eda971) |
| I3-17b | Tracker boxes start at 4 (Study, Practice questions, Lecture, plus the card app chosen) | NEEDS JD / CODEX | Codex owns the tracker model; asked on the board |
| I3-18 | Promise signing rebuilt: slower, cleaner, fades into AXOM; guide suggested after | VERIFIED | Wave 1.1 (c202cd7) |
| I3-18b | After the Promise, the page's containers slot in slowly from top to bottom | IN PROGRESS | wave/1.2 (69a5613) |
| I1-04 | The guide is back (optional, offered after the Promise) | VERIFIED | 5492285 |
| I1-17 | 8-stop guide; mini guides behind Help buttons elsewhere | PARTIAL | Soundscapes mini guide waits for Codex's page restructure |
| I3-34 | Guide smoother, lighter haze | VERIFIED | 5492285, 5fdd194 |
| I1-18 | "Overwhelmed?" once, arrow + ripple to Customize | VERIFIED | 69ae330 |
| I4-07 | "Overwhelmed?" timing: after logging data, or ~1 min of active scrolling/clicking through 3-4 sidebar tabs or widget links | PLANNED | feat/wave2-home |
| I4-08 | Second arrow at Edit dashboard; a how-to for moving sidebar items (like the Daily Word demo), then the dashboard edit how-to | PLANNED | feat/wave2-home |
| I1-19 | First-visit hints per page (not hand-holding) | VERIFIED | 69ae330 |
| I3-19 | "Save your progress" banner after the first saved data, no account | PLANNED | feat/wave2-home |

## 2. Dashboard, widgets, check-in, energy, notifications

| ID | Idea | Status | Where |
|---|---|---|---|
| I1-21 | Widget order: check-in, timer, soundscapes first; Soundscape widget | VERIFIED | 9692ebc |
| I1-15 | Widget luster strong on first hover, subtle after | VERIFIED | 0ab96bc |
| I1-16, I3-49, I3-22b | Custom widgets, link widgets, size-specific content, combos, edit previews | PLANNED | feat/wave2-home (widget primitive) |
| I4-02 | Clock widget, first widget on the upgraded primitive | PLANNED | feat/wave2-home |
| I4-10 | Widgets say what is recommended and why you would enable one | PLANNED | feat/wave2-home |
| I3-22a | Weekly overview widget more alive; less dead space in widgets | PLANNED | feat/wave2-home |
| I3-22c | Journal widget as a keyframe of the journal desk | PLANNED | feat/wave2-journal-library |
| I3-22d | Doctordle and Daily Word split widget | PLANNED | feat/wave2-home |
| I4-11 | Daily check-in always open, large by default, rehauled | PLANNED | feat/wave2-home |
| I4-12 | Check-in submit: "intention logged" animation, then the intention stays on the page | PLANNED | feat/wave2-home |
| I3-05, I4-13 | Energy check: elegant animated orbs (ripple for high, melt for low), "Energy logged" from the orb row, first-time "AXOM finds your best times" | PLANNED | feat/wave2-home |
| I4-14 | Optional mini writing in the check-in ("What's eating you up?", "What's got you feeling so good?") feeding energy | PLANNED | feat/wave2-home |
| I4-15 | "AXOM has some insights to show you" once enough energy data exists; guided reading with glowing highs and red dips | PLANNED | feat/wave2-home |
| I4-16 | Notifications button at the top, only when something is unread; dashboard holds Wrapped and insights | PLANNED | feat/wave2-home |
| I3-21 | Recovery plan and Up Next adapt to yesterday and to a hard start; weekly summary | PLANNED | feat/wave2-home |
| I3-07 | Weekly, monthly, yearly Wrapped as a full-width dashboard header, kept in Reports | PLANNED | feat/wave2-home |
| I3-63 | Reports: more and better, most important first | PLANNED | feat/wave2-home (with Wrapped) |
| I3-38 | Monthly overview: hover a day for highlights, crown for great days | PLANNED | feat/wave2-home |

## 3. Productivity, trackers, targets, timer

| ID | Idea | Status | Where |
|---|---|---|---|
| I1-01, I2-01 | "Are you locked in?" check-in, persistent, on whatever screen | CODEX (VERIFIED by Codex) | a89819e (Wave 1.1) |
| I3-01 | Tracker boxes stay still while you tap | VERIFIED | 0ab96bc |
| I3-01b | Once settled, trackers move up by how much is completed | IN PROGRESS | wave/1.2 (693bfde) |
| I3-39 | Pomodoro logging no longer doubles study time | VERIFIED | f095e48 |
| I3-04 | Timer start tone; soft completion chime with a fading green screen-edge glow (JD, 2026-09-30) | IN PROGRESS | wave/1.2 (3883daf): in-app; packaged-app screen overlay needs native work |
| I3-04b | Menu bar timer + soundscape, orb personality, break pill style | PARTIAL | native pill exists; rest with Codex's native slice |
| I1-20 | Goals: simplified view with templates, technical view, over-100% shown | PARTIAL | Codex's targets model, then simplified view |
| I3-09, I2-03 | Questions, timer and cards fill the day automatically, past 100% | CODEX (PARTIAL) | Codex |
| I3-10 | Goal adaptation survey (raise 7.5/15/30%/custom; kind lowering) | PLANNED | feat/wave2-home, after Codex's targets |
| I3-11 | Progress reveal animation (orbs per 30 min, fluid fill, speech bubble) | FUTURE | |
| I3-36 | Frequency trackers (5x a day, 3-4x a week), non-timed trackers, flame + green border on completion | CODEX model + C visuals | |
| I3-50 | Streak freeze / skip day for trackers | CODEX | |
| I3-12 | Include 12-5 AM in tracking and reports | VERIFIED | 0ab96bc |
| I3-06 | Day overview calendar in Productivity; click to create study time | FUTURE | after Codex's event model |
| I3-61, I3-62 | Study methods and habit tracker visuals | FUTURE | |
| I2-04 | Exam countdown: Step 1 + module exams, split view, weighted colours | CODEX (PARTIAL) | |
| I2-10, I2-11 | Trackers as the simple view of targets; Pomodoro above activity, Tetris-style layout | CODEX (PARTIAL) | |
| I2-13 | "Put my head down" alarm with chosen sounds | CODEX (PARTIAL) | |

## 4. Course tracker and course schedule

| ID | Idea | Status | Where |
|---|---|---|---|
| I3-23 | SGU structure: Terms 1-5 by module, Boards (CBSE, Step 1) | VERIFIED | Wave 1.1 (a7603be) |
| I3-23b | Boards: Dedicated, Step 2, Step 3 structure research | FUTURE | |
| I1-30, I3-14b | "How do you study" drives the tracker (Anki, Noji, none; passes; PQ timing) | VERIFIED | Wave 1.1 (a7603be) |
| I3-24 | Non-SGU: empty tracker with a guide to building it | VERIFIED | Wave 1.1 (first-use card + page hint) |
| I3-24b | Submit templates, soundscapes, drives, question sets to JD for the library | FUTURE | needs a moderated backend |
| I3-15 | Course tracker visual refresh, calmer, easier module loading | PARTIAL | first-use card shipped; more in wave/1.2 |
| I1-31 | Star to pin a module | VERIFIED | kept |
| I3-26, I3-27, I3-28, I3-29 | Chronological uploads; one-tap Not now; brain button fixed; one item editor | VERIFIED | 0ab96bc, f8e62ae, e86a51c, 47609d7, 1a6c504 |
| I1-34, I4-03 | Course schedule import asks cohort (A-D) and college, reads SGU schedule PDFs | PLANNED | feat/wave2-study-ai |
| I4-04 | Schedule import in the setup style (the standard for every fill-in box) | PLANNED | feat/wave2-study-ai, on shared setup primitives |
| I4-05 | Download your cohort's schedule as .ics; AXOM knows exams, small groups, iMCQs, eSOFTs, OSCE/OSPE | PLANNED | feat/wave2-study-ai |
| I4-06 | Skip tracker: allowances for lectures, small groups, eSOFTs, iMCQs | PLANNED | feat/wave2-study-ai |

## 5. Questions, exams, flashcards, AI

| ID | Idea | Status | Where |
|---|---|---|---|
| I4-01 | Tutor mode AI for questions (hint ladder, grounded, answer only on request) | PLANNED | feat/wave2-study-ai (Codex mounts in ExamRunner) |
| I1-05 | Generative question bank in the style of your questions | PLANNED | feat/wave2-study-ai |
| I1-07 | Smart cards (basic, cloze, image occlusion) with card-count range and depth; Anki push; native deck | PLANNED | feat/wave2-study-ai |
| I1-32 | Honest Integrations copy about Anki | VERIFIED | ef981c3 |
| I1-08 | Examplify, AMBOSS, Step 1 and native exam UIs (UWorld mode is loved) | PLANNED | feat/wave2-study-ai + Codex |
| I3-33 | Q-bank selector less crowded; timed/tutor choice; hide other sets once one is chosen | PLANNED | feat/wave2-study-ai + Codex |
| I3-25 | Q-bank headings; import takes any file exactly | PLANNED | feat/wave2-study-ai |
| I2-06 | Extending a highlight over a highlight | CODEX (VERIFIED by Codex) | 691c23a (Wave 1.1) |
| I1-33 | Simulations tab (WIP) | FUTURE | |
| I1-02 | Daily medical fact from a local, sourced library | FUTURE | |

## 6. Journal, self-care, library, resources

| ID | Idea | Status | Where |
|---|---|---|---|
| I1-25 | Journal desk: overhead desk, notebook centred, MacBook, headphones, plant, drink, iPad, weather shadows | PLANNED | feat/wave2-journal-library |
| I1-26 | iPad toggled three times plays "Again" and unlocks it | PARTIAL | unlock exists; desk trigger with the journal |
| I3-40..I3-45 | Done-for-today close, unlogged-day catch-up, first-time survey, block editor, sentiment to energy, Stoic/Expressive tone | PLANNED | feat/wave2-journal-library |
| I3-46 | Self-care tab and weekly check-in cadence | PLANNED | feat/wave2-journal-library |
| I3-47 | Positive phrases green, draining phrases orange/red | PLANNED | feat/wave2-journal-library |
| I3-48 | Crisis support: professional resources and the user's own trusted contact; never a developer number | PLANNED | feat/wave2-journal-library |
| I3-65 | Library experience: bookcases, quick-sheets cabinet, previews | PLANNED | feat/wave2-journal-library |
| I3-30 | More resources and drives, ratings, JD's Anki add-ons | PARTIAL | feat/wave2-journal-library |
| I3-64 | Q-bank drives and JD's NCRS sheets | NEEDS JD | hosting and licensing |
| I3-66 | Token economy and cosmetic unlocks | FUTURE | |
| I1-25b | iPad wallpapers from the myWallpaper app | NEEDS JD | licence required before shipping |

## 7. Soundscapes and audio

| ID | Idea | Status | Where |
|---|---|---|---|
| I1-06, I3-08 | Your own soundscapes (files; YouTube by embed only) | PARTIAL | files shipped (09d65a1); YouTube embed-only by design |
| I4-22 | JD's alpha-waves track as the default pinned intro soundscape | NEEDS JD | licence for a YouTube-sourced track in a public app; works today on JD's device via Your sounds |
| I4-23 | Fullscreen / larger soundscape experience | PLANNED | coordinate with Codex's page restructure |
| I4-24 | Opening films: keep only the finished renders (JD: "remove these, terrible quality") | IN PROGRESS | wave/1.2 (9eda971) |
| I1-09 | More soundscapes, better mapping, more backgrounds | PARTIAL | |
| I1-12 | Soundscapes in Apple Now Playing | SHIPPED | 09d65a1 (macOS check pending) |
| I3-35 | Pause when headphones come out | PARTIAL | web signal limited; native listener later |
| I3-02 | DJ-style mixer: per-ear frequencies, layering, saved presets | FUTURE | |
| I2-02, I2-05, I2-08, I2-14 | Spotify in the pill and tracked; permanent player; ambient app/site spaces; media session | CODEX (PARTIAL) | |

## 8. Accounts, data, settings

| ID | Idea | Status | Where |
|---|---|---|---|
| I4-21 | Bug: Profile says signed in while Account says sign in | IN PROGRESS | wave/1.2 (f20f81e) |
| I4-19 | Sign-in and loading account details faster | IN PROGRESS | wave/1.2 (f20f81e): saved session shows at once |
| I4-18 | Email and password only (no code); welcome email with a beautiful, reactive graphic | PLANNED | coordinate with Codex's email templates (I2-15) |
| I4-20 | Fully local account in the desktop app | PLANNED | feat/wave2-home |
| I3-20 | Signing in loads the most recent backup (conflict-safe) | PLANNED | feat/wave2-home |
| I3-31 | "Action needed" says what; "Merge both" clickable | PLANNED | wave/1.2 |
| I3-32 | Keep 10 saves (adjustable) | PLANNED | feat/wave2-home |
| I1-14 | "Is my account and data safe?" | ANSWERED | PLAN D6 |
| I1-35 | Portable backup still available | VERIFIED | |
| I1-22 | Settings in plain language; technical details behind a disclosure | PARTIAL | ef981c3, 619a747 |
| I4-17 | "How do you study" and all of Settings rebuilt in the setup style | PARTIAL | wave/1.2 (da9fcfd): How you study done on shared setup primitives; rest of Settings next |
| I1-23, I3-52 | Sidebar defaults, Misc folder, drag to reorder | VERIFIED | 6fc14d9 |
| I4-09 | Sidebar: make your own sections, move items between them | PLANNED | feat/wave2-home |

## 9. Look, feel, notices, identity

| ID | Idea | Status | Where |
|---|---|---|---|
| I3-37, I3-60, M-04 | Notices fade and evaporate; nicer in-app notices | VERIFIED | ee7590e (Codex: mechanics) |
| M-01 | Tab title and favicon, live timer in the tab | VERIFIED | f4a0b5c |
| M-02 | Rounded AXOM icon on notifications | SHIPPED | f4a0b5c (OS rendering not verifiable headless) |
| M-03 | Custom AXOM notification HUD in the packaged app | FUTURE | native, with Codex |
| I1-27, I2-07 | Stronger quotes container, more AXOM originals | CODEX (IMPLEMENTED) | |
| I2-09 | Light mode more elegant, no dark leftovers | CODEX (PARTIAL) | |
| I2-15, I2-16 | Resend emails and desktop notifications in AXOM's design | CODEX | |
| I1-28 | Building page stays fixed when filtering | VERIFIED | 0ab96bc |
| I1-29 | About: About + About the developer | VERIFIED | 0ab96bc |
| I3-03 | "Blue orb" top right | ANSWERED | not AXOM (Codex computer-use overlay) |

## 10. Games and social

| ID | Idea | Status | Where |
|---|---|---|---|
| I1-03 | Daily games black screen | VERIFIED | 47609d7 |
| I3-53..I3-58 | Daily Word hints, how-to, win card, share, back link, countdowns + streak | VERIFIED | 224d44b, 3843a5f, 6fc14d9 |
| I3-59 | "Did you get the Doctordle?" | VERIFIED | facfbd0 |
| I3-51 | Friends leaderboard, nicknames, widget | FUTURE | needs backend + privacy model |
