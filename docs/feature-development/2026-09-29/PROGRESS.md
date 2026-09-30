# Progress (feat/ideas3-staging)

Updated 2026-09-30 13:10. Every commit passed `npm run quality` (typecheck, lint, full vitest, build) and was checked in a real browser (headless Chrome, dark theme, screenshots read back).

| Commit | Items | What changed |
|---|---|---|
| 0ba69f0 | docs | Ideas 1-3 verbatim, manifest, staged plan, coordination |
| 47609d7 | I1-03, I3-28, Daily Word widget | Failed screens stay inside the shell (RouteErrorBoundary); chunk errors no longer swallowed; service worker precaches every route page; Modal portals to body (study-plan dialog no longer painted over); dead dailyGames flag gate removed |
| ee7590e | I3-37, I3-60, M-04 (visual) | Notices evaporate instead of blinking out; palette-aware graphite surface |
| f4a0b5c | M-01, M-02 | AXOM orb favicon (SVG + PNGs), rounded notification icon, live tab title + progress ring while a Pomodoro runs |
| 5492285 | I1-04, I1-17, I3-34 | 8-stop tour offered after the Promise ("Later" re-offers once after scrolling), gliding spotlight, lighter dim |
| 0ab96bc | I3-01, I3-12, I3-26, I3-27, I3-35, I1-28, I1-29, I1-15, I1-22 (part) | Tracker order frozen while tapping (10 s settle), late-night band, natural import order, one-tap Not now + Undo, pause on headphone removal, Building page no longer shifts, About tabs, quieter luster after first hover, settings CTA on one line |
| f095e48 | I3-39 | Focus-timer minutes count on the Study tracker, so topping up by hand no longer doubles the day (384 -> 736) |
| 5fdd194 | sweep, D1, D9 | Fixes from the light-theme and 390 px sweep; no developer phone number anywhere (D1); blue orb identified (D9) |
| dbf967d | docs | RECONCILIATION.md: strict status per item |
| 224d44b | I3-54, I3-55, I3-56, I3-57 | Daily Word win card, numbered share text, on-board how-to (ENVOY/EBONY), back link, no page scroll |
| 3843a5f | I3-53 | Daily Word hint ladder: key glow, then tile outline, then a confirmed reveal that keeps the streak |
| 6fc14d9 | I1-23, I3-52, I3-58 | Sidebar: daily-use Tools, Misc folder for Tasks/Methods/Prompts/Hub folders, drag or Alt+Arrow reordering, one-time upgrade for saved profiles; Daily Word and Doctordle countdowns + streak; Application Checker opens on Residency for med tracks |
| de69c75 | install | 'Install AXOM' works again: the browser's one-time install prompt is captured at boot, not by the lazy About page |
| 1a6c504 | I3-29 | One item editor: Details (name, type, folder, note) and Study plan tabs; no more browser prompt() |
| a9d8703 | nudges | Optional nudges also wait for Codex's focus check-in and rest overlay |
| be48c3d | tooling | `npm run verify:all`; contrast sweep across all palettes |
| 835f2d1 | tooling | e2e suite green on this branch; fixtures; contrast sweep |
| 1ebb916 | bugs | Nine issues found by e2e + contrast sweep (light-theme unreadable text, tour scroll race, inert leaving toasts, hover shift, App Checker pathway memory) |
| b5eb1fa | updates | The update panel no longer crashes AXOM after a deploy (pre-existing on main); optional games stay out of the precache again |
| f8e62ae | I3-26 | Question library reads in lecture order |
| e86a51c | I3-27 | "Not now" no longer resets an item's review clock; Undo restores the exact order (found while verifying I3-27) |
| 619a747 | I1-22 (part) | No em dashes left in Settings prose |
| f97fafc | I1-17 (part) | Reports gets a Help mini guide (4 stops), like Course Tracker, Question Bank and Productivity |
| 25efa7e | F7 | docs/design/DESIGN.md, the shared design contract |
| ef981c3 | I1-22 (part), I1-32 | Settings: plain language first, a Technical details disclosure for the rest (Account, Data); Integrations copy says what Anki Lab really does |
| 3082fe6 | top bar | Clock and Refresh stay top-right under long subtitles (checked on 10 pages at 5 widths) |
| facfbd0 | I3-59, I3-57 | Doctordle: "Did you get it?" when you're back (inline on its page), a dashboard reminder for regulars (Yes / No / Later / Don't show again), sidebar flame from your own check-ins, a real back link and today's case number |
| 69ae330 | I1-18, I1-19, F4, I3-18 | "Overwhelmed?" once after the guide and Promise (arrow + ripple to Customize); one first-visit hint per page on a reusable CoachMark; Help can bring hints back; signing the Promise -> tour offer verified |
| 9692ebc | I1-21 | Dashboard: Daily Check-In, then the focus timer with a new Soundscape widget beside it, then targets, Question Bank, Course Tracker, Weekly; saved layouts carried forward once (defaultsRevision 2) |
| a7603be | I1-24, I3-13, I3-14a, I3-16, I3-17 (Wave 2) | First-run setup rebuilt: three screens (You, How you study, Make it yours) replace the wizard; SGU curriculum model (Terms 1-5 + Boards), clean tracker for everyone else; tool choices set card rounds and default targets; no data-safety step; Course Tracker first-use card, template loader, teaching-order tree |
| c202cd7 | I3-18 (Wave 2) | Promise rebuilt: three movements you advance, one signing sheet, sealed signature, fade into AXOM; first run goes straight into it; Settings shows the saved sheet |
| (this commit) | e2e, I4 | The e2e suite now really runs with reduced motion (Playwright ignored the old top-level option, so the opening film held the app inert and typed names were dropped); IDEAS-4.md and manifest section F (Tutor mode AI, Clock widget) |

Test count: 1,906 at baseline, 2,022 unit tests now (main's hardening tests included after the rebase), plus the Playwright suite (25 passed, 1 skipped) via `npm run verify:all`, exit 0.

## Next (Wave 1 remainder)

1. Soundscapes mini guide once Codex's page restructure lands (I1-17).
2. Wave 1 is otherwise clean; Wave 2 (onboarding rehaul, journal desk, Wrapped, library) waits for JD's go-ahead per the review.

## Waiting on JD

Decisions D1-D9 in PLAN.md (phone number in a public repo, iPad wallpapers licensing, NCRS hosting, drive links, generated assets, renal labs screenshot, blue orb check).
