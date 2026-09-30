# Major updates

Waves and flagship features, newest first. Smaller improvements are in 2-UPDATES.md, fixes in 3-HOTFIXES.md. Earlier history: CHANGELOG.md at the repository root.

## Wave 1.2 (in progress) · branch wave/1.2

| Update | Ideas | Commit |
|---|---|---|
| **Directions.** docs/directions: the ideas bank (every idea indexed), progress by size, notes, completed, future; `npm run directions:check` keeps it honest. | JD's request | bc3d3a3 |
| **Setup style for every form.** Setup's tiles, segments, chips and summary became shared primitives (setup pixel-identical); Settings > How you study rebuilt on them. | I4-17, I4-04 groundwork | da9fcfd |
| **Timer cues.** A soft start tone, a bell-like finish chime and a green glow around the screen's edges. | I3-04 | 3883daf |

## Wave 1.1 (2026-09-30) · main 83d9fb8 · pushed by JD

Integrated Claude's Ideas 1 + 3 branch and Codex's first Ideas 2 slices. Gate on the merged tree: typecheck, lint, 2,029 unit tests, build, update and offline checks, 27 Playwright journeys.

| Update | Ideas | Commit |
|---|---|---|
| **First-run setup rebuilt.** Three screens (You, How you study, Make it yours) replace the four-step wizard. SGU gets its real Term 1-5 + Boards map from a curriculum data model; everyone else starts clean. Tool choices set card rounds, default targets and the dashboard. Palette orbs, no data-safety step, no scrolling at 1440 x 900. | I1-24, I3-13, I3-14, I3-16, I3-17, I3-23, I1-30 | a7603be |
| **The Promise rebuilt.** Three calm movements you advance yourself, one signing sheet, a sealed signature, a fade into AXOM; the first run flows straight into it. | I3-18 | c202cd7 |
| **Course Tracker first use.** Card rounds named after your card app (or none), a first-use card with a one-click template, teaching order in the tree. | I3-24, I3-15, I1-30 | a7603be |
| **Guide and coach marks.** The 8-stop guide is back, offered after the Promise; "Overwhelmed?" and one first-visit hint per page. | I1-04, I1-17, I1-18, I1-19, I3-34 | 5492285, 69ae330 |
| **Dashboard defaults.** Check-in, focus timer and a new Soundscape widget first; saved layouts upgraded once. | I1-21 | 9692ebc |
| **Sidebar.** Daily-use Tools, a Misc folder, drag or Alt+Arrow reordering, med-track defaults, Application Checker on Residency. | I1-23, I3-52 | 6fc14d9 |
| **Daily games.** Daily Word win card, hints, how-to, share text; Doctordle check-ins; countdowns and streaks in the sidebar. | I3-53..I3-59 | 224d44b, 3843a5f, facfbd0 |
| **Locked In, persistent** (Codex). Stays until answered, then fades; honest goal and timer language. | I1-01, I2-01 | a89819e |
| **Highlights** (Codex). Extending into and across existing highlights. | I2-06 | 691c23a |
| **Regression layer.** `npm run verify:all` (all gates in one command), shared e2e fixtures, a contrast sweep across themes and palettes. | tooling | be48c3d, 835f2d1 |
