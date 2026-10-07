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

On this line, in order: the media pipeline foundation and the progressive-context protocol;
Ideas 6 with the Learning Intelligence doctrine, the reconciliation and the Decode plans
(documents only); the journal and study plans; the completed Wave 2 home work (save-progress
banner, account restore on sign-in, daily check-in rebuild); the Obsidian graph checkpoint
and private-folder ignore rules; the AnkiConnect client and the Anki push library.

Not on this line yet: the course engine (live in its own worktree), the exam engine and
Examplify renderer, any Decode code, Ideas 2.

## Important current decisions

Feature priority follows the [Learning Intelligence doctrine](product/AXOM-LEARNING-INTELLIGENCE-DOCTRINE.md);
it is routed, not startup reading. The course engine owns term, module, week and question
scope; Decode, imports and Anki decks consume that model and do not define another.
Graph navigation is optional and question-driven; canonical rules remain in AGENTS.
The bootstrap files and 4,000-token ceiling are unchanged. Client/global instructions
and tool output remain outside repository measurement/control.
Keep Noctyrium storage identifiers and coordinate schema changes. Sign-in must preserve
local work; cloud snapshots do not imply cloud storage of media bytes. Archives retain
historical authority only; graph links never approve a proposal or establish shipment.

## Relevant areas

- `web/src/lib/account/`, `web/src/lib/saveProgress.ts`, `web/src/components/dashboard/DailyCheckIn.tsx`,
  `web/src/components/energy/`, `web/src/lib/media/`, `web/src/lib/anki/`
- `docs/graph/`, `docs/.obsidian/{app,graph}.json`, `.gitignore`, `scripts/repository-hygiene*`
- [Protocol decision](decisions/001-progressive-context.md),
  [measurement limits](operations/repository-audit.md#bootstrap-measurement-and-enforcement-limits)

## Validation state

On Node 22.23.1 at the 2026-10-07 tip: typecheck, lint, 2,235 unit tests in 238 files, the
build, repository hygiene, the directions check, 53 repository tests and the update and
offline verifiers pass. Playwright: 33 passed, 1 skipped (it needs a live account). The
daily check-in, the energy check and the save-progress banner were opened in a real browser
at 1440 and 390 wide, dark and light, with no console error and no horizontal overflow.
The Welcome-back card for account restore is covered by unit tests only.
Earlier evidence remains in the [migration audit](operations/repository-audit.md#validation-evidence).

## Known blockers

The course engine merges only after its own session has finished. The exam branch carries a
wrong-branch commit (`93badf8`) that awaits a normal revert in the main checkout. An OpenAI
endpoint without sign-in or rate limiting exists only in a stash and stays out of every
branch until it goes through the AI proxy's checks.

## Next actions

1. The course engine, then the exam work at `2c1d610`, then `ExamRunner.tsx` onto the shared engine.
2. Decode code once its scope types are replaced by the course engine's, with tests.
3. Ideas 2 and the remaining remote-only work by intent, never by whole-branch merge.

## Context routes

[Architecture](architecture/README.md) · [Features](features/README.md) ·
[Product/design authority](product/README.md) · [Testing](operations/testing.md) ·
[Directions](directions/README.md) · [Archive](archive/README.md).
