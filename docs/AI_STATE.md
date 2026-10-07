---
tags:
  - axom/state
authority: current-state
---
# AXOM current AI state

Snapshot: 2026-10-07. Maintenance branch `codex/ai-maintenance-2026-10-07`, isolated
worktree `AXOM-ai-maintenance`, based on intact infrastructure checkpoint `42eeacb`.
Recheck Git before applying this handoff elsewhere. This is local, not shipped.

## Stable boundaries

React/TypeScript app: `web/`. Canonical native shell: root `src-tauri/`.
Local Vault and JSON backup remain primary; optional Supabase revision sync is additive.
Schema stays 34; preserve Noctyrium storage keys. Legacy Swift, `web/src-tauri/` and
retired name/PIN account endpoints are not current architecture routes.

## Protected work and blockers

Main checkout was `feat/exam-fidelity` at `93badf8`, with committed conflict markers
in AGENTS/.gitignore, incomplete infrastructure, three untracked Obsidian `.base`
files and untracked native permissions. The coordination board records a branch-switch
incident and an unresolved media stash. **Do not pop/apply/drop stashes or repair
that branch as incidental cleanup.** This maintenance branch does not resolve it.

Course Engine/QBank, tracker/import, exam fidelity, Decode, media/audio, shared workspace
contracts and all package/lockfiles are protected. Course worktree `feat/course-engine-v1`
was at `d42386f` with new edits; Decode and context-protocol trees retain independent
dirty work. Do not infer ownership or completion from older board stream rows.
Detailed paths, owners and release conditions are in the
[maintenance registry](operations/repository-audit.md#maintenance-registry).
External board/state remain ownership evidence, not bootstrap reading lists.

## This checkpoint

Repository-only maintenance: concise agent policy, explicit ACTIVE/DEFERRED/READY
tracking in the existing audit, focused test routes, and stronger repository guards.
Existing Obsidian graph additions were carried from `93badf8` onto this intact base;
the vault remains `docs/`, with no second knowledge base or automatic graph preload.
No runtime, dependencies, private inputs, existing archives or other worktrees changed.
No files moved or deleted. No subagents or design skills invoked.

## Validation and next action

Validation is recorded in the [maintenance audit](operations/repository-audit.md#maintenance-pass-2026-10-07).
Run `npm run repo:check` for current bootstrap sizes. Repository estimates exclude
the task, global instructions, installed skill/tool metadata and conversation output.
Application-wide tests are unnecessary for this documentation/tooling-only diff.

Integrate this scoped checkpoint only after the owner settles the branch recovery.
Do not merge a maintenance branch wholesale merely to pick up its docs; preserve the
feature owners' runtime and dependency work. Then start Course Engine/QBank in a
genuinely fresh session. This session stops at maintenance.

## Routes

[Task router](INDEX.md) · [Testing](operations/testing.md) ·
[System map](graph/AXOM-System-Map.md) · [Archive/legacy](archive/README.md).
