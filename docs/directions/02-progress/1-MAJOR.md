# Major updates

Waves and flagship features, newest first. Smaller improvements are in 2-UPDATES.md, fixes in 3-HOTFIXES.md. Earlier history: CHANGELOG.md at the repository root.

## Wave 1.3.1 (2026-10-01) · tag wave-1.3.1

The production upload failure. Gate on the branch: typecheck, lint, 2,146 unit tests, build, update and offline checks, 30 Playwright tests passed (the live-accounts journey is skipped without real credentials). **Production still needs the migration applied and a deploy; both are JD's.** Record: `docs/release/2026-10-01-ACCOUNT-SYNC-INCIDENT.md`.

| Update | Ideas | Commit |
|---|---|---|
| **A large workspace can be protected again.** The account's storage bound now drops the oldest protected versions instead of refusing the newest one, and measures history without reading it back. | I5-30 | 28c004d |
| **A failed upload waits instead of repeating.** Failures are sorted by what the account said; waits grow from seconds to half an hour and are remembered across reloads and tabs; a refusal is not repeated; "Protect now" always runs. Settings says what happened and when AXOM tries next. | I5-30 | e932a9d |
| **The incident as a browser test.** A stand-in account refuses each upload the way production did; the app must send it once, explain itself and recover. 13 uploads in two minutes before, 1 after. | I5-30 | 1ceea9e |
| **Profile photo stored at display size.** A 2.5 MB photo was a quarter of every save, backup and upload. | I5-30 | 113479f |
| **Ideas 5 work order banked.** JD's instructions of 2026-10-01 saved word for word and indexed (I5-16 to I5-33). | I5-33 | a108722 |

## Wave 1.3 (2026-10-01) · tag wave-1.3

Ideas 5, the same night JD sent them. Gate on the merged tree: typecheck, lint, 2,096 unit tests, build, update and offline checks, 28 Playwright tests passed (the live-accounts journey is skipped without real credentials, as in earlier waves).

| Update | Ideas | Commit |
|---|---|---|
| **Question import reads how questions are really written down.** Labelled records, the mapped-paste layout (Question N, choices, Answer, Explanation, Review, Attachment), labels on their own line; Review becomes tags; several quizzes in one paste keep their own source and numbering; a key the source disputes is never guessed. | I5-03, I5-04, I5-05 | b5594a5, 77b0335, b9a6a99 |
| **Images come in with their questions.** Name the image in the text, add the files in the review step, and each attaches to its question and shows with the stem before you answer. | I5-06 | 1267f2d |
| **Stage orb.** A centred glass sphere and ring in the scene's own colours that move with the sound; the copy keeps to its side so nothing collides; full screen lets it grow. | I5-02 | 932b212, 2a2d4f4 |
| **Your sounds work.** Assigning a file makes it what that preset plays; rename saves however you finish; edits never rewrite the audio. | I5-01 | 255d527 |
| **Exam fixes.** A cross for a wrong answer; time spent is right when you answer and adds up across visits; a changed last answer is kept. | I5-08, I5-09 | f1f309d, 3a5d006 |
| **Locked In.** A quiet rising chime when it appears; "I am locked out". | I5-11, I5-12 | 1fbdcac |

## Wave 1.2 (2026-09-30) · tag wave-1.2 · main 2915b46 · pushed by JD

Gate on the merged tree: typecheck, lint, 2,048 unit tests, build, update and offline checks, 27 Playwright journeys.

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
