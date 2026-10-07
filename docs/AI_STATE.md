# AXOM current AI state

Snapshot: 2026-10-06. Local worktree handoff, not production evidence.
Recheck branch, HEAD and status before applying it elsewhere.

## Current stable state

Current app: React/TypeScript web in `web/`, canonical Tauri shell at root `src-tauri/`.
Workspace schema is 34 (`web/src/lib/seed.ts`). Local Vault and JSON backup are primary;
optional Supabase accounts protect portable workspace revisions.

## Active branch and work

Worktree `/Users/jd/Developer/AXOM-course-engine-v1`, branch `feat/course-engine-v1`,
base `42eeacb`. Everything below is uncommitted. Nothing is merged, pushed or deployed.
The milestone is course engine + question bank + learning intelligence. Schema stays 34:
every addition is an optional field or derived at read time.

## Recently completed

- Save path: a tutor answer is saved at "Check answer" (it was only saved by "Next
  question"); leaving a block keeps answered work; a block's attempts and session are
  one store change (`commitQuizRun`); attempts carry `quizSessionId`, `mode`, `certainty`
  and a second write for the same run amends instead of appending.
- Local vault: a marked newer localStorage copy is read before a stale IndexedDB copy;
  saves no longer hang behind a blocked upgrade; a save that reaches no store is reported
  (`VaultSaveWatcher`, Settings line).
- `web/src/lib/course-engine/`: source mapping from file and folder names, course template
  parsing and planning, one scope for questions and tracker rows.
- `web/src/lib/learning-intelligence/`: attempt events, question features, structural and
  empirical difficulty, pattern findings, source style, review reasons. All derived.
- UI: Analysis panel on Question Bank > Insights; import proposes module and week; sets
  grouped by module and week; review reasons on block results; optional "How sure are you?";
  Course Tracker > "Load course template" lays a module out by week and is safe to repeat;
  the Weeks card shows each week's progress, question progress read from attempts, and
  absences against a term allowance (`setTermAbsenceAllowance`).
- Contract: [course engine and learning intelligence](features/course-engine.md).
- `web/scripts/source-inventory.ts` (`npm run sources:inventory`); its manifest stays under
  the ignored `artifacts/`.

## Open

- `reviewPriority` in `learning-intelligence/review.ts` holds a `TODO(human)` placeholder:
  JD is writing the ranking.
- Not started: PDF image extraction at import, bulk import review, "More like this",
  settings and data page redesign, graph notes (the graph files are not on this branch).
- Lecture weeks in the current templates are worked out, not stated: adding `Week N:` lines
  to a template states them.
- The main checkout sits on `feat/exam-fidelity` with conflict markers committed in 93badf8;
  `stash@{0}` still holds the media-pipeline state including the staged graph checkpoint.

## Validation state

Node 22.23.1: typecheck and lint clean, 2,262 unit tests and the production build pass,
`repo:check` passes. Full browser suite after the week view: 36 passed, 1 skipped, 1 failed.
The failure is `contrast-sweep` (light): it flags Settings tab pills at about 1.1:1, a
different pill each run, and passes when repeated alone. That reads as a pill measured
mid-transition; no code here touches those pills, but the cause is not confirmed. A first
run under machine load 38 timed out in unrelated specs; each passed when rerun. New specs:
`question-block-save`, `course-engine-slice`, `course-template-load` under `web/e2e/`.

## Next actions

1. JD: write `reviewPriority`, then review and commit this worktree in place on its branch.
2. PDF image extraction at import: sampled IMCQ and ESoft files carry images on most pages.
3. Bulk import: run `inferSourceMapping` over a dropped folder and confirm mappings in one pass.

## Context routes

[Architecture](architecture/README.md) · [Features](features/README.md) ·
[Product/design authority](product/README.md) · [Testing](operations/testing.md) ·
[Directions](directions/README.md) · [Archive](archive/README.md).
