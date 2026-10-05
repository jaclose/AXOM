# AXOM current AI state

Snapshot: 2026-10-05. This describes local progressive-context enforcement, not production.
Recheck branch, HEAD and status before applying it in another checkout.

## Current stable state

Current app: React/TypeScript web in `web/`, canonical Tauri shell at root `src-tauri/`.
Workspace schema is 34 (`web/src/lib/seed.ts`). Local Vault and JSON backup are primary;
optional Supabase accounts protect portable workspace revisions. Name/PIN Vercel
account/data endpoints are retired. No runtime or schema change belongs to this migration.

## Active branch and work

The context architecture is committed as `1540ad2` on `feat/media-pipeline-v1` in
the normal `AXOM` checkout. Its enforcement follow-up adds explicit retrieval levels,
relevance checkpoints and a 4,000 estimated-token aggregate bootstrap budget. Locate
the latest protocol checkpoint with `git log -1 -- AGENTS.md`. No merge, push or
deployment belongs to this work. The earlier isolated `AXOM-context-protocol` worktree
is a migration preparation tree, not the current handoff; do not reset or remove it.

Root `package.json` and `package-lock.json` retain unrelated uncommitted dependency
edits owned by the media task. Preserve them and the 22 ignored private/reference files.
Other worktrees contain independent work; their status is not inferred here. Consult
the coordination board before shared edits.

## Recently completed

- AGENTS owns the conditional levels 0–5 and engineering checkpoints. Expand one logical
  dependency level only to answer an unresolved question; directory proximity is secondary.
- Claude imports only AGENTS + AI_STATE. Copilot links the same policy/state; INDEX is
  retrieved on demand. Fresh sessions are the default for independent tasks.
- `repo:check` reports per-file words/bytes/tokens, aggregate repository bootstrap and
  bridge overhead, budget status, routing failures and archive integrity. Local/CI gates
  reject growth and invalid imports without runtime telemetry or new dependencies.
- Product reasoning and original guidance remain available through the
  [archive manifest](archive/2026-10-05-context-migration/manifest.json) and existing routes.

## Important current decisions

Read only this file, AGENTS and the task initially. Use search and/or [INDEX](INDEX.md)
to locate missing context. Repository documentation is durable memory. Preserve reasoning;
archiving does not reject an idea, approve a proposal or authorize deletion.

Root `src-tauri/` and `supabase/migrations/` are active; `web/src-tauri/`, Swift prototype
and `db/` are legacy. Keep Noctyrium storage identifiers. Schema changes require coordination.
Sign-in must preserve local work; cloud snapshots do not imply cloud storage of media bytes.

## Relevant areas

- `AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`, `docs/AI_STATE.md`, `docs/INDEX.md`
- `scripts/repository-hygiene*`, local full gate and web quality CI hook
- [Protocol decision](decisions/001-progressive-context.md) and
  [measurement limits](operations/repository-audit.md#bootstrap-measurement-and-enforcement-limits)

## Validation state

Enforcement follow-up, Node 22.23.1: `npm run repo:check`, `npm run test:repo` (32),
`npm run test:release` (51, including those 32) and `git diff --check` pass.
Regressions cover aggregate growth, bridge overhead, missing
bootstrap files, Unicode/UTF-8 measurements and exclusion of on-demand documents.
Run `repo:check` for live sizes; the 4,000-token budget includes each bridge separately.

The original migration's full web gate passed (2,178 unit tests, 33 browser tests,
one optional live-account test skipped). Runtime code is unchanged by this follow-up;
web/native/live-account validation was not repeated. Detailed preservation evidence,
prior validation and existing build/contrast observations remain in the
[audit](operations/repository-audit.md#validation-evidence).

## Known blockers

None for this follow-up. Large reference documents, root media and duplicate originals
remain preserved for ownership/licence review before any removal or publication decision.
Other feature branches and live deployment state are not certified by these local checks.
The checker cannot prevent unnecessary agent reads or count client/global instructions,
managed memory, skills, conversation and tool output. Its numbers cover repository files.

## Next actions

1. Start the next independent task in a fresh session with the small bootstrap; retrieve
   relevant context, validate, update this handoff and commit only within task authority.
2. Leave the context system stable unless the next 10–20 tasks show excessive bootstrap
   size, unjustified broad retrieval or failure to resume from state. Observe actual work.
3. Preserve unrelated dependency work. Deferred import-cycle/asset-ownership tasks remain
   in the audit and require their own scope.

## Context routes

[Architecture](architecture/README.md) · [Features](features/README.md) ·
[Product/design authority](product/README.md) · [Testing](operations/testing.md) ·
[Directions](directions/README.md) · [Archive](archive/README.md).
