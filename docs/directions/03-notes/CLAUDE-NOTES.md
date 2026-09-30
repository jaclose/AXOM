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
