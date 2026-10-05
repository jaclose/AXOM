# AXOM current AI state

Snapshot: 2026-10-05. This describes the local context-protocol migration, not production.
Recheck branch, HEAD and status before applying it in another checkout.

## Current stable state

Current app: React/TypeScript web in `web/`, canonical Tauri shell at root `src-tauri/`.
Workspace schema is 34 (`web/src/lib/seed.ts`). Local Vault and JSON backup are primary;
optional Supabase accounts protect portable workspace revisions. Name/PIN Vercel
account/data endpoints are retired. No runtime or schema change belongs to this migration.

## Active branch and work

Prepared and tested on `codex/repository-context-protocol` in `AXOM-context-protocol`,
based on `9f29327`. Applied to the normal `AXOM` checkout on `feat/media-pipeline-v1` after verifying
every touched original against the base. The context architecture and fresh-session
policy form a separate local checkpoint; locate it with `git log -1 -- AGENTS.md`.
No Git merge, push or deployment has occurred.

The original `AXOM` checkout has unrelated root package edits and untracked private/reference
imports. Dependency changes, the lockfile and all 22 private/reference files were
preserved; only two script entries were added to the existing root package. Other worktrees contain independent work; their
status is not inferred from this handoff. Consult the coordination board before shared edits.

## Recently completed

- Canonical AGENTS protocol; small Claude/Copilot bridges; current-state and task routers.
- Current source maps replace stale readme/schema/name-login/persistence assumptions.
- Exact copies of replaced guidance and one relocated research document are recorded in
  [archive manifest](archive/2026-10-05-context-migration/manifest.json).
- Existing product/governance/ideas/evidence paths retained; broad history preload removed.
- Dependency-free context budgets, active-document links and artifact checks added to
  `npm run repo:check`, local full gate and web CI. No new dependencies.
- Fresh sessions are the default for new independent tasks; same-task follow-ups may
  continue. Small requests and repository handoffs replace large catch-up prompts.

## Important current decisions

Read only this file, AGENTS and the task initially. Use [INDEX](INDEX.md) for additional
context. Repository documentation is durable memory. Preserve historical product reasoning;
archiving does not reject an idea, approve a proposal or authorize deletion.

Root `src-tauri/` and `supabase/migrations/` are active; `web/src-tauri/`, Swift prototype
and `db/` are legacy. Keep Noctyrium storage identifiers. Schema changes require coordination.
Sign-in must preserve local work; cloud snapshots do not imply cloud storage of media bytes.

## Relevant areas

- `AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`, `docs/AI_STATE.md`, `docs/INDEX.md`
- New architecture/feature/product/operations/decision routes and archive snapshots
- `scripts/repository-hygiene*`, package scripts, `.gitignore`, web quality CI hook

## Validation state

Final validation on 2026-10-05 in the normal AXOM checkout, Node 22.23.1:

- `cd web && npm run verify:all`: PASS. Hygiene, typecheck, lint, 231 test files /
  2,178 unit tests, production build, update recovery, offline reopening, 33 browser tests.
  One opt-in live-account test skipped.
- `npm run test:release`: 45 passed, including 26 repository-hygiene regression cases.
- `npm run typecheck:api`, `npm run directions:check`, `git diff --check`: PASS.
- Session-policy follow-up: `npm run repo:check`, all 26 repository tests and staged
  diff checks pass. No runtime changes required another full application run.
- Preservation: all 10 manifest entries verified against hashes and base-commit bytes;
  all 783 tracked runtime files match the isolated validation tree.
- Native execution, live accounts and production deployment were not exercised.

The first isolated browser run had one intermittent settings-tab contrast reading;
focused repeats passed on both checkouts, and the final full gate passed. Existing
large-chunk/mixed-import build warnings remain. [Audit](operations/repository-audit.md)
contains scope, evidence and the checkpoint research.

## Known blockers

None for this migration. Large reference documents, root media and duplicate originals
remain preserved for ownership/licence review before any removal or publication decision.
Other feature branches and live deployment state are not certified by these local checks.

## Next actions

1. Root `package.json` and its lockfile retain pre-existing, uncommitted dependency
   edits outside the context checkpoint. Preserve them for their owning task.
2. Start a fresh session for the next independent task, retrieve one feature route,
   and update this handoff after work. Commit only within the task's authority.
3. Separate improvements: inspect the settings helper import cycle and legacy asset
   ownership only when those tasks are authorized; see the audit for exact paths.

## Context routes

[Architecture](architecture/README.md) · [Features](features/README.md) ·
[Product/design authority](product/README.md) · [Testing](operations/testing.md) ·
[Directions](directions/README.md) · [Archive](archive/README.md).
