# AXOM current AI state

Snapshot: 2026-10-07. Local worktree handoff, not production evidence.
Recheck branch, HEAD and status before applying it elsewhere.

## Current stable state

Current app: React/TypeScript web in `web/`, canonical Tauri shell at root `src-tauri/`.
Workspace schema is 34 (`web/src/lib/seed.ts`). Local Vault and JSON backup are primary;
optional Supabase accounts protect portable workspace revisions.

## Active branch and work

Worktree `/Users/jd/Developer/AXOM-course-engine-v1`, branch `feat/course-engine-v1`,
base `42eeacb`. Committed locally in place (JD approved local commits; no agent pushed or
merged). `origin/feat/course-engine-v1` holds the first six commits, up to `8662cbd`: an
editor Sync pushed them on 2026-10-07. Everything after that is local only.
The milestone is course engine + question bank + learning intelligence. Schema stays 34:
every addition is an optional field or derived at read time.

## Recently completed

- Save path and local vault fixes; `lib/course-engine/` and `lib/learning-intelligence/`;
  Analysis panel; import proposes module and week; sets grouped by module and week;
  template loader and Weeks card. Contract: [course engine](features/course-engine.md).
- Template rows record who placed them in their week; a learner's move survives re-import.
- PDF figures: `lib/pdfFigures.ts` cuts figures out of the rendered page and attaches each
  to its question as an exhibit, or lists it as unplaced with the reason.
- Slide decks: `lib/deckPages.ts` and `lib/pdfQuestionImport.ts` read a deck slide by slide.
  All 77 of the learner's IMCQ answer keys now come in as one question per question slide.
- One save path: `lib/questionImportSave.ts`. The review screen finalizes through it and
  mass import's Accept, Skip and Accept all valid sit on top of it
  (`lib/massImportCandidate.ts` decides what may be accepted without review).
- Importing a file again: `lib/questionImportHistory.ts` recognises what an earlier import
  brought in by wording, so a second import adds nothing by itself and touches nothing
  the learner changed. Tests under "Importing a file again" and `mass-import-accept.spec.ts`.

## Open

- `reviewPriority` in `learning-intelligence/review.ts` holds a `TODO(human)` placeholder:
  JD is writing the ranking.
- Most real files cannot be accepted without review: 12 of 444, because 389 hold a
  question with no answer in the text. Decks mark answers in colour, which is never read.
- Unresolved in the slide reader (listed in the course engine contract): questions with
  fewer than three options, answer slides that repeat under 80% of their question, a mark
  on a wrapped option line. An unplaced image is dropped at finalize unless the learner
  attaches it in review: nothing stores it with its source.
- Skipped files are remembered in this device's local storage, not in the workspace.
- Not started: "More like this", settings and data page redesign, graph notes.
- `contrast-sweep` (light) fails intermittently on a Settings tab pill at about 1.1:1.
  Not caused by this branch: no pill style, token, Settings tab or sweep file differs from
  the base. The sweep reads the pills 200 ms after each click and the pill's colour and
  background each cross-fade for 130 ms, so a slow frame is caught half way (dark label
  on a half-dark chip). Probed at seven delays, a pill read unreadable at one instant and
  never once settled. The repair belongs in the sweep: wait for the transition to end.
- The main checkout sits on `feat/exam-fidelity` with conflict markers committed in 93badf8;
  `stash@{0}` still holds the media-pipeline state. Do not merge exam-fidelity here yet.

## Validation state

Node 22.23.1, 2026-10-07: typecheck and lint clean, 2,360 unit tests in 244 files, the
production build and repository hygiene pass. Full browser suite: 40 passed, 1 skipped,
0 failed (`contrast-sweep` light passed this run; see Open). Specs added on this branch:
`question-block-save`, `course-engine-slice`, `course-template-load`, `pdf-figure-import`,
`deck-import`, `mass-import-accept` under `web/e2e/`.

## Next actions

1. JD: write `reviewPriority`.
2. Integration owner: review `feat/course-engine-v1` for a wave. It changes how mass import
   may save (a file with nothing left to decide can be accepted without the editor).
3. A way to set many answers quickly for a deck that marks them only in colour.
4. Only then: repair `feat/exam-fidelity` and move `ExamRunner` onto its shared engine.

## Context routes

[Architecture](architecture/README.md) · [Features](features/README.md) ·
[Product/design authority](product/README.md) · [Testing](operations/testing.md) ·
[Directions](directions/README.md) · [Archive](archive/README.md).
