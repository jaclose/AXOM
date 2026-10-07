# Claude's working notes

Things learned the hard way, conventions that keep work fast, and decisions that should not be re-litigated. Newest at the top of each section.

## How work flows

- Branches per big step; integrate finished branches as a numbered wave (`wave/x.y`), merge into main with `--no-ff` and a tag; never push (JD pushes). Integrate in a fresh worktree so no one's working tree is disturbed.
- Commit each verified slice as soon as its gate is green, and tell JD which worktree holds work: he watches the main checkout.
- Read `/Users/jd/Developer/AXOM-coordination/BOARD.md` before touching shared files (App.tsx, store.ts, types.ts, DashboardPage.tsx, ProductivityPage.tsx, TrackerManager.tsx, src-tauri/src/lib.rs). Codex owns targets/trackers, study activity, notify.ts, FocusDock, Locked In, rest, Spotify, exam runner/simulator. Claude owns onboarding, guide/coach, sidebar, settings, course tracker, journal, library, reports/Wrapped, widgets registry, daily games, soundscape engine.

## Verification

- `npm run verify:all` is the gate. Capture the exit code (`echo exit=$?`), never trust piped output.
- Kill whatever serves port 5187 before running e2e from another worktree: Playwright reuses an existing server and would test the wrong code.
- Playwright 1.61: `reducedMotion` belongs in `contextOptions`; at the top of `use` it is silently ignored.
- Reload after a change with `reloadAfterSave` from `e2e/fixtures.ts`: vault writes to IndexedDB are async and a raw reload can drop the last one.
- Open the app in specs through `completeSetup` / `deferPromisePrompt` (shared helpers), import `test`/`expect` from `./fixtures` (quiet nudges).
- Browser checks: the harness in the session scratchpad drives real Chrome at 1440 x 900 and 390 x 844, dark and light, motion on and off; read screenshots back before claiming a UI is done.

## Architecture decisions

- Setup = pure plan functions (`lib/setupPlan.ts`) plus one `applySetup` that writes through existing store actions. Drafts are per mode, so a first-run draft never leaks into a rerun.
- School structures are data (`lib/curricula.ts`); SGU is one template. The mastery tree keeps teaching order from the structure, not alphabetical order.
- Card rounds follow the student's card app (`lib/cardSystem.ts`); unconfigured legacy profiles keep Anki.
- The Promise text lives once in `lib/promiseText.ts`; changing a word means a new `PROMISE_TEXT_VERSION`.
- Setup visuals are the standard for every fill-in form (JD, Ideas 4): extract its tiles, chips, segments and summary into shared primitives rather than restyling each form by hand.

## Traps

- JD's personal files live untracked in the main checkout (schedule PDFs, audio, data). Never `git add -A` there.
- YouTube-sourced audio is not bundled into the public app; users add their own tracks through Your sounds (device only).
- Coalesced vault writes: tests and features that reload must flush first.
- The contrast sweep fails below 2:1; light-theme accent text uses `--accent-ink-rgb`.

## 2026-09-30 (late): check-in rebuild, widget options

- **Widget options.** A dashboard widget can now offer behaviours as well as shown details: `options` on its catalog entry (`lib/dashboardWidgets.ts`), saved in the widget's own `preferences` bag (so it travels with the layout, no schema change), read with `dashboardWidgetOptions(id, preferences)`. The frame's Customize panel lists them under "Options". First use: the Daily Check-In's "A short note after an energy check".
- **One energy check.** `components/energy/EnergyOrbs.tsx` replaced the old pill row everywhere (check-in, capacity widget, Reports). `EnergyCheck.note` is optional and additive.
- **Trap: a percentage height on a grid item with an auto row is ignored.** The check-in's intention underline also taught one: `vector-effect: non-scaling-stroke` breaks `pathLength`-based dash drawing in Chrome (the line stops short). Draw without it.
- **Trap: `.win-task span { flex: 1 }` matched the Tag inside the row too** and stretched it; scope such rules to the element they mean.
- JD commits from his editor as well ("Wave1.2A" captured this branch's working tree). Check `git log` before assuming a file is uncommitted.

## 2026-10-01: Wave 1.3 (Ideas 5 fixes)

- **A normalizer in front of a mature parser beats a new parsing branch.** The labelled-record layouts are rewritten into the wording `questionParse.ts` already reads (`lib/questionLabelledRecords.ts`), and only when the text holds an unmistakable record label. All 371 existing question tests passed untouched, which is the point: new input shapes should not be able to change how old ones parse.
- **The source's word on its own key outranks inference.** "Status: SOURCE-KEY CONFLICT", "Source marks: A and D" and "Correct Answer: UNRESOLVED" never set an answer; a flag keeps it but forces review.
- **Assigning a file to a preset must also make it the pick.** `play()` saves `versions[preset]` every time, so "first in the list" only wins for presets never played. `assignUserSound` updates details, catalog and player in one tick; an `await` between them let React render a half-moved file (an empty "Your sounds" still selected) and crash.
- **Keep what a user can edit apart from the bytes.** Renaming a 111 MB track used to rewrite the track in IndexedDB. Name and "plays for" are now a small device preference (`axom.soundscapes.userMediaDetails.v1`); the audio record is written once.
- **Trap: a percentage height on a grid item in an auto row is ignored.** The stage ring was sized from the stage's width and hung below the middle (481 px in a 380 px stage). Pin with `top/left: 50%` and `translate`, or draw on a canvas that owns its geometry.
- **Trap: reading a clock inside a state updater.** `setItems((c) => commitTime(c))` read and reset a ref inside the updater; React may run updaters twice. Read once per event (`takeSpent()`), pass the number in.
- **Trap: tests that share a module singleton.** `lib/timerCues.ts` keeps one audio engine; a second `installAudio()` in the same file gets a new recorder the engine never sees. Assert within one test, or reset the module.
- **I could not view screenshots for part of this session** (the image limit was reached). Layout was verified by measuring the rendered DOM and canvas pixels, and a separate reviewer agent read the screenshots. Numbers are in the hotfix and completed logs.
- Private course material never goes in this public repository, including inside a "verbatim" ideas file: redact the content, keep the structure, and say so at the top of the file.

## 2026-10-01: Wave 1.3.1 (the production upload failure)

- **A limit that refuses the newest write is a broken limit.** The storage bound refused every new protected version once history was full. Bounds on history are enforced by dropping the oldest history.
- **Know what status your SQLSTATE becomes.** PostgREST turns class 54 and 57 into HTTP 500, P0001 into 400, PTxyz into xyz. A deliberate refusal raised as 54000 looks exactly like a crash to the client and to monitoring. Use PT4xx for refusals.
- **Measure stored values where they are stored.** `pg_column_size(column)` reads the TOAST pointer; `octet_length(column::text)` reads the value back and converts it. Summed over a history of multi-megabyte snapshots on every call, that was the hidden cost of the old bound.
- **Retry policy needs three answers, not one:** did it reach the server, did the server say no, and how long since the last try. One file (`lib/sync/syncPolicy.ts`) now holds every number, the wait is stored where reloads and other tabs can see it, and only the learner's own click skips it.
- **A new answer shape is a breaking change for clients already in the field.** The old client read any status other than "conflict" as accepted. The function keeps two answers; refusals are exceptions. The new client treats an unreadable answer as a failure.
- **Reproduce with the real engine.** PGlite replays every migration in about a second, so the refusal was reproduced, and the fix proven, without touching production.
- **Prove a regression test can fail.** The new database tests were run against the old function (3 failed) and the browser replay against the old client (13 uploads against 1).
- **A browser test can own the backend.** `window.__AXOM_E2E_ACCOUNT__` (dev servers only) points the account client at a host that Playwright answers; a stored session with a far expiry signs in without any auth call. See `e2e/accounts-sync-failure.spec.ts`.
- Investigation rule kept: nothing was sent to production on the affected account's behalf. Evidence came from device bookkeeping, the deployed code, and a local replay.

## 2026-10-01: Wave 1.3.2 (browser audit of Wave 1.3)

- **Screenshots can be read again in this session.** Looking found two things that measurements and unit tests had passed: a label wrapping onto two lines, and a "glass sphere" that was only a ring on pale scenes. Measure for geometry, look for quality.
- **A glass ball is recognised by what it does to the scene, not by shading.** Shading vanishes on a pale background. Drawing the scene inside the ball small, soft and upside down (a 24 px copy of the frame, rotated half a turn) reads as glass everywhere and costs 0.3 ms a frame.
- **A browser test can listen.** `e2e/locked-in-cue.spec.ts` wraps `createOscillator` and the gain ramps in an init script and asserts the notes and their level. Headless Chromium keeps the context suspended, so this checks what is asked for, not what is heard.
- **Three equal columns break when one label grows.** `minmax(0, 1fr) max-content minmax(0, 1fr)` lets the long one take what it needs.

