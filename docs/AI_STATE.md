# AXOM current AI state

Snapshot: 2026-10-06. Local worktree handoff, not production evidence.
Recheck branch, HEAD and status before applying it elsewhere.

## Current stable state

Current app: React/TypeScript web in `web/`, canonical Tauri shell at root `src-tauri/`.
Workspace schema is 34 (`web/src/lib/seed.ts`). Local Vault and JSON backup are primary;
optional Supabase accounts protect portable workspace revisions.

## Active branch and work

Worktree `/Users/jd/Developer/AXOM-course-engine-v1`, branch `feat/course-engine-v1`,
base `42eeacb`. Committed locally in place (JD approved local commits, no push, no merge).
The milestone is course engine + question bank + learning intelligence. Schema stays 34:
every addition is an optional field or derived at read time.

## Recently completed

- Save path and local vault fixes; `lib/course-engine/` and `lib/learning-intelligence/`;
  Analysis panel; import proposes module and week; sets grouped by module and week;
  template loader and Weeks card. Contract: [course engine](features/course-engine.md).
- Template rows record who placed them in their week; a learner's move survives re-import.
- PDF figures: `lib/pdfFigures.ts` cuts figures out of the rendered page and attaches each
  to its question as an exhibit, or lists it as unplaced with the reason.

## Open

- `reviewPriority` in `learning-intelligence/review.ts` holds a `TODO(human)` placeholder:
  JD is writing the ranking.
- Slide-deck answer keys: the parser found 24 of about 39 questions in the one sampled, so
  most of its figures had no question to attach to. Parsing those decks is the next gap.
- Bulk import: `components/questions/MassImport.tsx` now shows each queued file's proposed
  module and week and carries a PDF's figures into the review. Still one file per review:
  saving every valid file in one action needs the finalize logic lifted out of
  `ImportPanel.tsx`.
- Not started: "More like this", settings and data page redesign, graph notes.
- `contrast-sweep` (light) fails intermittently on Settings tab pills at about 1.1:1, a
  different pill each run. It reads as a pill measured mid cross-fade. Cause not confirmed.
- The main checkout sits on `feat/exam-fidelity` with conflict markers committed in 93badf8;
  `stash@{0}` still holds the media-pipeline state. Do not merge exam-fidelity here yet.

## Validation state

Node 22.23.1, 2026-10-07: typecheck and lint clean, 2,274 unit tests and the production
build pass. Full browser suite: 37 passed, 1 skipped, 1 failed (`contrast-sweep` light, as
above). New specs: `question-block-save`, `course-engine-slice`, `course-template-load`,
`pdf-figure-import` under `web/e2e/`.

## Next actions

1. JD: write `reviewPriority`.
2. Parse slide-deck answer keys (question slide then answer slide) so their figures land.
3. Lift import finalization out of `ImportPanel.tsx` so mass import can accept all valid files.
4. Only then: repair `feat/exam-fidelity` and move `ExamRunner` onto its shared engine.

## Context routes

[Architecture](architecture/README.md) · [Features](features/README.md) ·
[Product/design authority](product/README.md) · [Testing](operations/testing.md) ·
[Directions](directions/README.md) · [Archive](archive/README.md).
