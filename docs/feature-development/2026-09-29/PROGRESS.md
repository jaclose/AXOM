# Progress (feat/ideas3-staging)

Updated 2026-09-29 19:50. Every commit passed `npm run quality` (typecheck, lint, full vitest, build) and was checked in a real browser (headless Chrome, dark theme, screenshots read back).

| Commit | Items | What changed |
|---|---|---|
| b96c5b8 | docs | Ideas 1-3 verbatim, manifest, staged plan, coordination |
| 1bce4b4 | I1-03, I3-28, Daily Word widget | Failed screens stay inside the shell (RouteErrorBoundary); chunk errors no longer swallowed; service worker precaches every route page; Modal portals to body (study-plan dialog no longer painted over); dead dailyGames flag gate removed |
| d7c9a93 | I3-37, I3-60, M-04 (visual) | Notices evaporate instead of blinking out; palette-aware graphite surface |
| 4a44d32 | M-01, M-02 | AXOM orb favicon (SVG + PNGs), rounded notification icon, live tab title + progress ring while a Pomodoro runs |
| dd5e5ba | I1-04, I1-17, I3-34 | 8-stop tour offered after the Promise ("Later" re-offers once after scrolling), gliding spotlight, lighter dim |
| 22857db | I3-01, I3-12, I3-26, I3-27, I3-35, I1-28, I1-29, I1-15, I1-22 (part) | Tracker order frozen while tapping (10 s settle), late-night band, natural import order, one-tap Not now + Undo, pause on headphone removal, Building page no longer shifts, About tabs, quieter luster after first hover, settings CTA on one line |

Test count: 1,906 at baseline, 1,920 now.

## Next (Wave 1 remainder)

1. Daily Word: hints ladder, animated how-to (ENVOY), Doctordle-style win card with share text, back button, sidebar countdown + streak, "Did you get the Doctordle?" prompt (I3-53..I3-59).
2. Sidebar defaults per track + drag-to-reorder + Misc folder; Application Checker residency view with an honest empty state (I1-23, I3-52).
3. Dashboard defaults: check-in, timer, soundscapes first; a soundscapes widget (I1-21).
4. F4 coach-mark primitive (feeds "Overwhelmed?", page hints, account banner) and F7 DESIGN.md.

## Waiting on JD

Decisions D1-D9 in PLAN.md (phone number in a public repo, iPad wallpapers licensing, NCRS hosting, drive links, generated assets, renal labs screenshot, blue orb check).
