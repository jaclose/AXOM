---
tags:
  - axom/state
authority: current-state
---
# AXOM current AI state

Snapshot: 2026-10-07. Canonical development line:
`integration/axom-convergence-2026-10-07`, worktree `AXOM-integration`. One owner writes
here; every other stream keeps its own worktree. Recheck branch, HEAD and status. Local
integration is not production; `main` remains `5fbe8a4`. No push, deployment, merge to
`main` or branch/worktree removal is authorized.

## Implemented boundaries

React/TypeScript: `web/`; canonical native shell: root `src-tauri/`.
Local Vault and JSON backup are primary, optional Supabase revisions are additive.
Schema stays 34; preserve Noctyrium storage identifiers. Legacy Swift, `web/src-tauri/`
and retired name/PIN account handlers are not current architecture.

This line contains the media foundation, context/graph infrastructure and Codex's
maintenance checkpoint (merged at `8b3a4d2`), Ideas 6/doctrine, journal/study plans,
Wave 2 home, AnkiConnect/push, [Course Engine and learning intelligence](features/course-engine.md),
the shared exam engine with both exam interfaces and the AXOM player on it, and
[Decode](features/decode.md).

Each layer owns one thing. Course Engine owns term/module/week/question scope and attempt
persistence. Decode owns what a source teaches about a question: analyses are an optional
field on the question, and Decode has no scope and no store. Learning intelligence is
derived from attempts; `reviewCandidates` hands a replaceable ranker `ReviewSignals`.
Decode and learning intelligence do not import each other (`lib/decode/boundary.test.ts`).

Reviewed question saves use `prepareReviewedImport` and `saveReviewedImport` in
`lib/questionImportSave.ts`. Tutor answers save when checked; finished exam runs use
`commitQuizRun`; leaving a block retains answered work. Blank answers count as wrong in
exam simulation but stay unscored in the AXOM player. Resume storage shape is unchanged.
Models are reached only through `AIProvider` (the signed-in `ai-proxy`, or a local model).
Calendar files are read by `lib/icsCalendar.ts`. `npm run accounts:doctor` checks the live
account stack read-only; account emails come from `lib/api/emailTemplates.ts`.

## Protected and deferred

[Recovery matrix](operations/branch-recovery-2026-10-07.md) records every meaningful
branch group, dirty worktrees, recovery artifacts and next actions as of `ac67549`. The
[maintenance registry](operations/repository-audit.md#maintenance-registry) owns cleanup
conditions. External coordination remains `/Users/jd/Developer/AXOM-coordination/BOARD.md`
and `state/CONVERGENCE.md` (ledger, Decode and Ideas 2 tables, retirement matrix); read
only relevant current entries.

- The old Decode code at `a33a01e` was ported by intent; the ledger accounts for every
  module. Nothing more is to be taken from it.
- Ideas 2 (`0478959`, plus 12 uncommitted files under a safety ref) is mined by capability,
  never merged. The ledger says what is on this line and what waits for its owner.
- Original checkout remains at mixed commit `93badf8`; do not revert there while
  occupied. Its safe exam parent is integrated. Stash `ccaff8d` and safety refs remain
  intact. The standalone OpenAI endpoint and dependency commit `8dd9391` stay out.
- Context-protocol/question-first dirty drafts and the unfinished release-repair merge
  remain preserved. Never reset, abort, clean or remove these as incidental maintenance.
- Remote AI proxy tasks and the Guide need separate review: the first changes a deployed
  function, the second adds an assistant to the top bar.

## Open product work

`reviewPriority` in `lib/learning-intelligence/review.ts` still has `TODO(human)`.
The AXOM player lacks I5-18's question navigator. Most source decks still need review:
colour-coded answers are not read; unresolved slide cases are in the Course Engine contract.
Decode's concept groups have no screen, and teaching is shown only in the tutor's feedback.
An attempt cannot yet say unanswered, omitted or submitted apart from right or wrong.
Skipped imports stay in device localStorage. Welcome-back restore has unit coverage only.
Feature priority is routed through the [doctrine](product/AXOM-LEARNING-INTELLIGENCE-DOCTRINE.md),
not preloaded.

## Validation and next action

Each step on this line is gated on Node 22.23.1 (typecheck, lint, unit tests, build,
repository tests, hygiene, the browser suite on its own port) and recorded with exact
counts in the ledger. `npm run repo:check` prints current bootstrap size.

Next: finish Ideas 2 by capability with its owner, then the final gate and the promotion
report. New feature work starts from this line in a fresh session, not from a retired
branch, a recovery snapshot or the original mixed checkout.
