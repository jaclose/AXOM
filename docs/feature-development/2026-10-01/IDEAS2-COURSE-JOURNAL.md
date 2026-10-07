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

Status: architecture reconstruction complete; implementation in progress.
