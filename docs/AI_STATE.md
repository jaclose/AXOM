---
tags:
  - axom/state
authority: current-state
---
# AXOM current AI state

Snapshot: 2026-10-07. Local checkout handoff, not production evidence.
Recheck branch, HEAD and status before applying it elsewhere.

## Current stable state

Current app: React/TypeScript web in `web/`, canonical Tauri shell at root `src-tauri/`.
Workspace schema is 34 (`web/src/lib/seed.ts`). Local Vault and JSON backup are primary;
optional Supabase accounts protect portable workspace revisions. Name/PIN Vercel
account/data endpoints are retired.

## Active branch and work

This is the integration line: branch `integration/axom-convergence-2026-10-07`, worktree
`AXOM-integration`, cut from `main` at `5fbe8a4`. It converges the open branches into one
tested line that becomes `main` only when JD approves. One owner writes here; every other
stream keeps its own worktree. No merge to `main`, push or deployment belongs to this work.
The ledger and branch matrix live outside the repository, beside the generated state brief:
`/Users/jd/Developer/AXOM-coordination/state/CONVERGENCE.md` and `STATE.md`.

## Recently completed

On this line: the media pipeline foundation and the progressive-context protocol; Ideas 6
with the Learning Intelligence doctrine and the Decode plans (documents only); the journal
and study plans; the Wave 2 home work (save-progress banner, account restore, daily
check-in); the Obsidian graph checkpoint; the AnkiConnect client and Anki push library;
and the course engine, whose contract is [course engine](features/course-engine.md):

- Answers are saved when checked; attempts keep their block run; the vault keeps the newest save.
- `lib/course-engine/` and `lib/learning-intelligence/`; the course shows by week; template
  rows record who placed them, and a learner's move survives re-import.
- Import: PDF figures attach to their questions (`lib/pdfFigures.ts`), slide decks are read
  slide by slide (`lib/deckPages.ts`, `lib/pdfQuestionImport.ts`), a file imported before is
  recognised by wording (`lib/questionImportHistory.ts`), and review and mass import save
  through one path (`lib/questionImportSave.ts`).

Not on this line yet: any Decode code, Ideas 2.

## Important current decisions

Feature priority follows the [Learning Intelligence doctrine](product/AXOM-LEARNING-INTELLIGENCE-DOCTRINE.md);
it is routed, not startup reading. The course engine owns term, module, week and question
scope and attempt persistence; Decode, imports, exams and Anki decks consume that model and
do not define another. Anyone saving reviewed questions calls `prepareReviewedImport` and
`saveReviewedImport`. Graph navigation is optional and question-driven; canonical rules
remain in AGENTS. The bootstrap files and 4,000-token ceiling are unchanged.
Keep Noctyrium storage identifiers and coordinate schema changes. Sign-in must preserve
local work; cloud snapshots do not imply cloud storage of media bytes. Archives retain
historical authority only; graph links never approve a proposal or establish shipment.

## Relevant areas

- `web/src/lib/course-engine/`, `web/src/lib/learning-intelligence/`, `web/src/lib/exam/`,
  `web/src/components/questions/`, `web/src/lib/account/`, `web/src/lib/anki/`, `web/src/lib/media/`
- `docs/graph/`, `docs/.obsidian/{app,graph}.json`, `.gitignore`, `scripts/repository-hygiene*`
- [Protocol decision](decisions/001-progressive-context.md),
  [measurement limits](operations/repository-audit.md#bootstrap-measurement-and-enforcement-limits)

## Open

- `reviewPriority` in `learning-intelligence/review.ts` holds a `TODO(human)` placeholder.
- Most real question files still need review: decks mark answers in colour, which is not read.
  The slide reader's unresolved cases are listed in the course engine contract.
- Skipped import files are remembered in this device's local storage, not in the workspace.
- The Welcome-back card for account restore is covered by unit tests only.

## Validation state

Each step on this line is gated on Node 22.23.1 (typecheck, lint, unit tests, build,
repository hygiene, the browser suite on its own port) and recorded with exact counts in
the ledger named above. Earlier evidence remains in the
[migration audit](operations/repository-audit.md#validation-evidence).

## Known blockers

`feat/exam-fidelity` carries a wrong-branch commit (`93badf8`) that awaits a normal revert
in the main checkout; this line takes the exam work from the commit before it. An OpenAI
endpoint without sign-in or rate limiting exists only in a stash and stays out of every
branch; medical AI goes through the authenticated AI proxy.

## Next actions

1. Decode code once its scope types are replaced by the course engine's, with tests.
2. Ideas 2 and the remaining remote-only work by intent, never by whole-branch merge.
3. The full gate and a real browser at 1440 and 390, then retirement of finished worktrees.

## Context routes

[Architecture](architecture/README.md) · [Features](features/README.md) ·
[Product/design authority](product/README.md) · [Testing](operations/testing.md) ·
[Directions](directions/README.md) · [Archive](archive/README.md).
