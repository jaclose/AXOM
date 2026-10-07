---
tags:
  - axom/state
authority: current-state
---
# AXOM current AI state

Snapshot: 2026-10-06. Local checkout handoff, not production evidence.
Recheck branch, HEAD and status before applying it elsewhere.

## Current stable state

Current app: React/TypeScript web in `web/`, canonical Tauri shell at root `src-tauri/`.
Workspace schema is 34 (`web/src/lib/seed.ts`). Local Vault and JSON backup are primary;
optional Supabase accounts protect portable workspace revisions. Name/PIN Vercel
account/data endpoints are retired. No runtime or schema change belongs to this task.

## Active branch and work

Working in normal `AXOM`, branch `feat/media-pipeline-v1`, from `42eeacb`.
The progressive-context architecture is established. Current extension makes `docs/`
an Obsidian vault over the same canonical files, with one system map and selected
metadata/semantic links. No copy, sync process or agent preload is added.
Locate the latest graph checkpoint with `git log -1 -- docs/graph/README.md`.
No merge, push or deployment belongs to this work.

Root `package.json` and `package-lock.json` retain unrelated uncommitted dependency
edits owned by the media task. Preserve them and the 22 ignored private/reference files.
Other worktrees are independent; the earlier `AXOM-context-protocol` tree is migration
preparation, not this handoff. Preserve it and consult coordination before shared edits.

## Recently completed

- [Graph guide](graph/README.md) defines the minimal category/authority metadata and
  setup; the map routes to existing domain docs and their source/test pointers.
- Two shared vault defaults keep links portable and the human graph focused. Workspace,
  plugin, theme and trash state are ignored; accidentally staged state fails hygiene.
- Existing repository checks now cover graph Markdown links. No application dependency,
  graph service, generated node collection or personal medical content was introduced.

## Important current decisions

Graph navigation is optional and question-driven; canonical rules remain in AGENTS.
The bootstrap files and 4,000-token ceiling are unchanged. Client/global instructions
and tool output remain outside repository measurement/control.
Keep Noctyrium storage identifiers and coordinate schema changes. Sign-in must preserve
local work; cloud snapshots do not imply cloud storage of media bytes. Archives retain
historical authority only; graph links never approve a proposal or establish shipment.

## Relevant areas

- `docs/graph/`, selected feature/architecture/decision/operations/product documents
- `docs/.obsidian/{app,graph}.json`, `.gitignore`, `scripts/repository-hygiene*`
- [Protocol decision](decisions/001-progressive-context.md),
  [measurement limits](operations/repository-audit.md#bootstrap-measurement-and-enforcement-limits)

## Validation state

Graph extension: 34 repository tests, 53 root tests, repository/link checks and archive
integrity pass on Node 22.23.1. Native Obsidian 1.6.7 parsed 13 tagged notes, resolved all 16 map links,
opened Soundscapes and its semantic routes, and rendered the filtered 13-node graph.
Verification used a temporary isolated profile; the global vault registry was unchanged.
Run `repo:check` for live sizes; the bootstrap remains below its pre-graph size.
Application runtime code is unchanged; application-wide validation is not required here.
Prior full-gate evidence and existing build/contrast observations remain in the
[migration audit](operations/repository-audit.md#validation-evidence).

## Known blockers

No implementation blocker. Uncertain assets remain preserved for ownership/licence
review; these local checks do not certify other branches, live accounts or deployment.

## Next actions

1. Preserve the unrelated dependency work; graph changes form a separate local checkpoint.
2. Open `docs/` as a vault; start future independent tasks in fresh agent sessions.
3. Observe 10–20 real tasks before adding retrieval infrastructure. Import/test edge
   extraction and deeper graph services are deferred unless actual retrieval gaps justify them.

## Context routes

[Architecture](architecture/README.md) · [Features](features/README.md) ·
[Product/design authority](product/README.md) · [Testing](operations/testing.md) ·
[Directions](directions/README.md) · [Archive](archive/README.md).
