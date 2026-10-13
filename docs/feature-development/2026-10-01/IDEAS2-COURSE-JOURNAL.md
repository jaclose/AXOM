# Ideas 2 course workflow and journal staging

User decisions: generated review/digest tasks archive on completion, retaining history. Checkpoint this Ideas 2 work only; do not merge other AXOM branches or push/deploy. Work began at `0478959`, with six already-verified soundscape files modified. Isolated on `feat/ideas2-course-workflow`; include those repairs in the final reviewed checkpoint.

## Implementation plan

1. Give generated review tasks an explicit lifecycle and an archived view. Reuse the tracker and existing pass counters.
2. Connect timer targets to study, Anki, and practice rounds. Capture the target per run; persist a completion prompt and record a pass only after confirmation, idempotently.
3. Attach question sets to module paths at import. Derive module sections, completion, and score from the canonical question attempts, avoiding duplicate progress records.
4. Discard previous-day lock-in prompts and add a quiet “Just got here” action without counting it as focus or drift.
5. Stage the journal desk animation around the existing autosaved notebook. Add an explicit support preview and conservative personal-reflection detection; support links and exit stay immediately available.

## Reconstruction and research

- Timer already selects tracker targets but truncates the list to 18, and has no completion-to-pass flow.
- Imported question sets and question attempts already have stable IDs and canonical completion/score selectors. Prefer a module link and derived views over a second progress ledger.
- Missed-question review tasks are ordinary persistent Review Loop rows with no lifecycle. Digest suggestions are displayed but have no tracker action.
- Pending lock-in prompts persist without a date, explaining a prompt carried into a new day.
- No support cinematic implementation found in current Ideas 2, Ideas 3, or main. The shared manifest still marks I3-48 missing. Journal foundation docs explicitly reserve the cinematic shell as a later layer.
- Existing bookmark/tool survey found Playwright and Anki resources; use installed Playwright clock control for completion/reload/day-rollover tests, without another dependency: https://playwright.dev/docs/clock
- Support messaging reference: https://988lifeline.org/help-someone-else/ . Never delay contact links behind a survey or animation; no developer phone numbers, no clinical inference from study content.

## Verification gate

Run affected unit/component suites, import/backup regressions, build/typecheck, lint, end-to-end timer→tracker and import→module→score flows. Inspect journal and support stages at desktop/mobile in light/dark and reduced motion. Preserve existing soundscape regression coverage. Record exact commit and remaining limitations before handoff.

## Completed in this branch

- Spotify API loading is singleton-safe across StrictMode, timeouts, network failures, retries, and late callbacks. The persistent host gives the embed a separate readiness window and retains the selected playlist on retry.
- Generated missed-question and digest review work uses one duplicate-safe lifecycle. A completed study or Anki pass archives the review row while retaining its history.
- Natural Pomodoro completion prompts before applying a study, Anki, or question pass to its selected Tracker target. Completion event IDs make repeated actions idempotent.
- Question imports can link a set to an existing course module. Scope renames carry those links forward; question attempt completion and accuracy remain canonical Question Bank data rather than a second ledger.
- Pending lock-in prompts are day-bound. A previous-day prompt is discarded, and “Just got here” defers the check-in without recording focus, drift, or break.

The journal desk and support experience are not part of this stale branch checkpoint. Their newer canonical implementations and safety surfaces live on the later integration line; merging this branch must preserve those versions rather than reintroducing an older parallel shell.

Status: Ideas2 branch-owned Spotify and course-work slices complete; later journal/support work is explicitly superseded at consolidation.

## Validation

- Node 22.23.1: 209 Vitest files / 1,992 tests pass; typecheck, full lint, production build, and Daily Games bundle-isolation check pass.
- Installed Chrome: five Spotify persistence/retry journeys pass. Ideas2 accounting passes dark/light at 1440 and 390. Lock-in, exam persistence, focus-space timer/local-video recovery, desktop/mobile themes, reduced motion, and library-control journeys pass after repairing their stale selectors and focus-space pointer layering.
- This historical branch predates the root `test:repo` and `repo:check` scripts. Run those gates after merging into the current consolidation line.
