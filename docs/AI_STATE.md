---
tags:
  - axom/state
authority: current-state
---
# AXOM current AI state

Snapshot: 2026-10-10. This is the isolated `feat/shared-academic-catalog` development
branch, PR 20 against `integration/axom-next-2026-10-07`, based on `c23e8c26`.
It is not main or production. Verify live refs before continuing.

## Active delivery correction

JD requires a SITE-WIDE CLOUD Course Template Library and QBank, not a personal
folder installer. Shared content is published once for its permitted audience;
learner course activation, attempts, notes and review remain private. Local-first
storage is the selected-content cache, not the only distribution mechanism.

Implemented on this branch: versioned cloud releases, catalog entries, exact asset
manifests, audience grants, private Storage policy boundaries, automatic account-aware
metadata discovery, Load Course/Create Quiz through canonical stores, and operator
preparation/publication tools. Details and source routes:
[Shared academic catalog](features/shared-academic-catalog.md).

The client never contains a publisher credential. The publisher requires the exact
reviewed release ID, project identity, rights reference and audience. It filters held
answers/assets, preserves source originals and uploads only approved prepared content.
No source bytes or personal data are added to public Git.

## Verification and release boundaries

GitHub Actions is the execution environment because JD's Desktop Commander is offline.
Remote production inspection confirmed AXOM project `jofkmfwkidubxcutkwzf` is healthy;
no academic_catalog tables existed at inspection. No production migration was applied.

At `4f06d9e7` native CI passed web compilation/build, Rust formatting/check/tests.
Web CI stopped at a singular/plural graph-tag error, now corrected. Expanded contract,
filesystem, canonical-load, policy and browser tests are awaiting the next full run.
Do not inherit old all-green counts as evidence for this new catalog.

Unit/UI tests use synthetic/mocked inputs. SQL tests execute both migrations in isolated
PGlite with anonymous and separate account roles. Browser contract tests route synthetic
HTTP through the real SDK, UI, question engine and persistence. None proves live hosted
publication, two-account Storage behavior, or availability of JD's actual corpus.

Main and production remain unchanged. Development pushes are authorized. Do not merge
or deploy this draft until checks pass and the required hosted verification/approval
is complete. Vercel main updates trigger production. No force push, data reset, stash
or worktree removal, or publication beyond the approved content audience.

## Prepared material and remaining work

The last locally prepared collection is outside Git at Application Support/AXOM/private-library
on JD's Mac. Historical count: 28 templates, 362 ready questions/43 sets,36 image-bearing
questions. The 651-entry inventory is not all-ready content. Original source access is
blocked by the offline Mac connector; do not claim upload or corpus delivery.

Next: finish CI/browser validation, then obtain access to the existing prepared files
and approval for an appropriate hosted environment/migration and content audience.
Publish one authorized course and image-rich bank, verify actual separate accounts,
then continue the remaining prepared collection through the same publisher.

Full original source-page/Slide assets, supplementary question generation, complete
Anki remediation, deeper analysis, full-corpus learner sync and remaining Ideas still
need acceptance. The existing learner snapshot limit is unchanged. The new shared
catalog must not be described as fixing every account-sync or offline-revocation case.

## Existing contracts and protection

React/TypeScript web, root src-tauri shell, local schema 34, Noctyrium storage IDs
unchanged. Reuse reviewed import/saveBank, templates, media, attempts, Decode and
course logging. No parallel question engine, AI provider, scheduler or learner store.

Read current coordination BOARD ownership before any local writes or integration.
Its absence is not a clean ownership handoff. Other active worktrees and the separate
Communications/Pulse owner remain protected. This branch changes only catalog entry
points and its new modules; no incidental source cleanup or dependency upgrades.
Prior private-library delivery evidence remains at `5355e5e7:docs/AI_STATE.md`.
