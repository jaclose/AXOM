# Progress (feat/ideas3-staging)

Updated 2026-09-30 00:30. Every commit passed `npm run quality` (typecheck, lint, full vitest, build) and was checked in a real browser (headless Chrome, dark theme, screenshots read back).

| Commit | Items | What changed |
|---|---|---|
| b96c5b8 | docs | Ideas 1-3 verbatim, manifest, staged plan, coordination |
| 1bce4b4 | I1-03, I3-28, Daily Word widget | Failed screens stay inside the shell (RouteErrorBoundary); chunk errors no longer swallowed; service worker precaches every route page; Modal portals to body (study-plan dialog no longer painted over); dead dailyGames flag gate removed |
| d7c9a93 | I3-37, I3-60, M-04 (visual) | Notices evaporate instead of blinking out; palette-aware graphite surface |
| 4a44d32 | M-01, M-02 | AXOM orb favicon (SVG + PNGs), rounded notification icon, live tab title + progress ring while a Pomodoro runs |
| dd5e5ba | I1-04, I1-17, I3-34 | 8-stop tour offered after the Promise ("Later" re-offers once after scrolling), gliding spotlight, lighter dim |
| 22857db | I3-01, I3-12, I3-26, I3-27, I3-35, I1-28, I1-29, I1-15, I1-22 (part) | Tracker order frozen while tapping (10 s settle), late-night band, natural import order, one-tap Not now + Undo, pause on headphone removal, Building page no longer shifts, About tabs, quieter luster after first hover, settings CTA on one line |
| d626082 | I3-39 | Focus-timer minutes count on the Study tracker, so topping up by hand no longer doubles the day (384 -> 736) |
| d0c502d | sweep, D1, D9 | Fixes from the light-theme and 390 px sweep; no developer phone number anywhere (D1); blue orb identified (D9) |
| 97a0d70 | docs | RECONCILIATION.md: strict status per item |
| 7a85fe0 | I3-54, I3-55, I3-56, I3-57 | Daily Word win card, numbered share text, on-board how-to (ENVOY/EBONY), back link, no page scroll |
| a77a59b | I3-53 | Daily Word hint ladder: key glow, then tile outline, then a confirmed reveal that keeps the streak |
| 937a991 | I1-23, I3-52, I3-58 | Sidebar: daily-use Tools, Misc folder for Tasks/Methods/Prompts/Hub folders, drag or Alt+Arrow reordering, one-time upgrade for saved profiles; Daily Word and Doctordle countdowns + streak; Application Checker opens on Residency for med tracks |
| a030af0 | I1-21 | Dashboard: Daily Check-In, then the focus timer with a new Soundscape widget beside it, then targets, Question Bank, Course Tracker, Weekly; saved layouts carried forward once (defaultsRevision 2) |

Test count: 1,906 at baseline, 1,949 now.

## Next (Wave 1 remainder)

1. F4 coach-mark primitive, then "Overwhelmed?" (I1-18) and first-visit page hints (I1-19) on it; verify the tour offer after signing the Promise (I3-18).
2. "Did you get the Doctordle?" prompt + Doctordle back link (I3-59).
3. Settings consumer-friendly rewrite (I1-22), Integrations copy honesty (I1-32), F7 DESIGN.md.

## Waiting on JD

Decisions D1-D9 in PLAN.md (phone number in a public repo, iPad wallpapers licensing, NCRS hosting, drive links, generated assets, renal labs screenshot, blue orb check).
