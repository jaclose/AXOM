---
tags:
  - axom/state
authority: current-state
---
# AXOM current AI state

Snapshot: 2026-10-13, `feat/academic-library-v1` in `AXOM-academic-library-v1`.
Account/content checkpoint `07cd665d` is merged with local consolidation `bb8e31fc`.
The merged runtime exactly matches the fully verified checkpoint. JD authorized
commits, development pushes and tested local-main convergence. Preserve other-owner
drafts. Remote main still deploys production and has not been updated here.

Superseded Ideas3, backup recovery, owner-feedback, untested Decode, exam bootstrap
and parked dependency checkpoints are preserved as ancestry without replacing their
newer implementations. The private-media branch
`backup/pre-large-file-cleanup-2026-09-28` remains excluded: its 288 MB audio file and
another local audio asset have no publication clearance. Do not merge or publish it.

The reviewed Pathways crawler is now integrated as a separate, local research service.
It has durable SQLite queues, bounded collection, explicit source/reuse policy, review-
gated exports and no production publisher. Older remote 3D-ident, Guide/AI/Anki,
updater, shared-catalog and catalog-replay tips are preserved as superseded ancestry;
their newer canonical replacements remain in the tree. Stale analytics and dependency
bot tips are also ancestry-only: analytics already mounts centrally, while the old
lockfile proposals include unreviewed React, TypeScript, Vitest and CI-action majors.
No dependency versions changed; regenerate future upgrades from current lockfiles.

## Working and verified

[Academic library](features/academic-library.md) is the canonical behavior and
acceptance contract. QBank now discovers the same paginated backend catalog as Course
Library and opens the same source-backed weekly plan. Selective loading and exact
image-rich quizzes use the existing tracker/import/question engines. Deep links do
not depend on the first catalog page. Earlier catalog adapters remain compatibility
history, with no competing product entry point.

An isolated native Supabase stack (CLI 2.120.0, API `http://127.0.0.1:55321`) supports
real synthetic-account Auth/REST/Storage acceptance. Private uploads, reviewed sharing,
group restrictions, withdrawal, independent enrollment and clean second-device attempt
recovery pass. The reviewed FTM1 slice contains 75 activities across three weeks, two
explicitly unresolved activities and an exact 11-question image-rich Week 2 quiz.
Daily challenges use a fixed reviewed pool, explicit alias/participation, server scoring,
idempotent events, ties and opt-out. Two learners retain independent attempts.

Integration repairs `04ef62fe` add restrictive private-bucket policies and resolve
migration collisions. `0c6d5861` retains the split workspace bootstrap offline.
The exact recovery-owner handoff remains integrated at `1942a77f`; the original
backup checkout is untouched. No private course sources or test credentials enter Git.

## Validation

Node 22.23.1, macOS, installed Chrome: `npm --prefix web run verify:all` passes on
`07cd665d` runtime. 3,128 unit/SQL checks pass, five declared skips; typecheck/full lint
and production build pass. Two-build update, protected recovery checkpoint, unchanged
peer tab, offline reopening and lazy Daily Games gates pass. The full Chrome matrix
passes 93 cases, with four declared source/live opt-in skips. This run includes actual
local Supabase, private FTM1, two-account sharing/daily scoring and original ZIP restore.
All 79 repository/release checks pass. Mobile saved-set buttons now grow with long titles;
desktop, 390px dark and short-window screenshots were inspected and keyboard download passes.

The Pathways crawler compiles and passes all 62 synthetic Python regressions without
network access. Repository tests and hygiene pass after the remote-tip consolidation.

The actual supplied 516,431,732-byte backup now passes Settings restore and reload in
an isolated persistent browser profile with hosted traffic blocked. Notes/progress,
343 questions, 848 documents and all 2,151 image hashes match. Detailed timings and
local migrations are in the feature contract. Native packaging, hosted staging and
production acceptance remain outstanding. The original ZIP restore recheck took
74,052 ms for read/restore/reload/integrity under current host load; all 2,151 images
match. The current release doctor confirms Rust is available and updater credentials
are absent. Exact package/deployment-input results belong to their source commit;
previous build measurements do not describe this new checkpoint.

## Remaining delivery boundary

Incremental account requests reuse the atomic revision writer. Hash-format 2 verifies
compact metadata and immutable references without source downloads. Typed deferred
records stay outside scored practice. QBank saved-set downloads and saved course
downloads preserve IDs, notes and attempts and include question figures and study code.
Verified sources/images reference canonical academic objects; private edits retain
private recovery. Legacy snapshots remain readable. Migration 20261013230000 was applied
only to the real local stack at http://127.0.0.1:55321.

Actual local FTM1 JSON: 100,780-byte checkpoint / 10,899-byte completed 11-answer delta;
clean second-device sign-in makes zero source Storage GETs. All 25 question references
are shared and no private course-image copies are uploaded. Offline image-rich study
and reconnect retain saved attempts. These are request sizes, excluding headers, not
hosted latency or live account-size measurements. Paged attempt history, persistent
cache usage/removal controls and complete original-binary recovery remain unfinished.

Also pending: remaining source-backed courses, larger/resumable user uploads and review,
automatic daily publication, durable interrupted challenge submission, hosted activation
and native release. Never call this checkpoint full canonical 1.1 delivery.
Every fetched local and remote feature tip is now represented in the integration history;
only the publication-blocked private-media backup remains deliberately outside `main`.
Normal `www.axom.info` was last reverified read-only as deployment
`dpl_6fg8rJYXk2tSfJWvNALwL7gN38TF`, source `c23e8c26`; AXOM Production is
`jofkmfwkidubxcutkwzf`. No production tests, migrations, publication or deployment here.
