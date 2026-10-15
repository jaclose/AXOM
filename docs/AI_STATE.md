---
tags:
  - axom/state
authority: current-state
---
# AXOM current AI state

Snapshot: 2026-10-15 UTC, `feat/academic-library-v1` in
`AXOM-academic-library-v1`. The verified code baseline is `f4c14aff`; subsequent
commits only refresh this state record. `main` / `origin/main` remain at
`d5f9c030`, are ancestors of the feature, and can be integrated by exact
fast-forward. The latest implementation commits are:

- `5141af72` — exact B4/B5 reconciliation and release-accounting tests;
- `d27ef811` — durable academic/shared imports, ownership, media integrity,
  bounded sharing and source-identity enforcement;
- `f4c14aff` — Journal durability gates and truthful local/account protection.

Commits and development pushes are authorized. `origin/main` drives the live
Vercel release, so production-aware approval remains required at the action
boundary. No production deployment, migration, academic upload or publication
was performed in this integration.

## Ownership and protected work

Read the current coordination board and its single CONVERGENCE ledger before
another integration. Preserve other owners' original checkouts and untracked or
staged files. The local `main` checkout contains 45 staged user additions whose
index changed during the integration. It was inspected read-only and not
switched, reset, stashed, committed or merged.

Do not publish the staged AMBOSS research directory or
`AVAILABLE_SOURCE_COVERAGE.json`; they contain authenticated/private research
metadata, local paths, file identities or incomplete evidence. Several staged
handoffs/status reports are stale, the backup patch is redundant, and generated
ZIP/demo copies need separate review. The readable `axom-simulator-crawler/`
v0.1 source and fixtures passed 40 offline tests but are not part of this release.

All other meaningful feature refs are already ancestors of `main` except this
academic feature and `backup/pre-large-file-cleanup-2026-09-28`. Never merge the
backup ref: it contains a 288 MB audio file, private assets and broad historical
replacement/deletion. No clearance exists to publish it.

## Academic inventory and acceptance

[Academic library](features/academic-library.md) owns the implementation and
acceptance contract. The source inventory contains 2,733 distinct SHA-256 file
identities across 4,213 hashed paths, including 1,480 duplicate paths and 48
explicit oversized exceptions. There are 2,274 processing jobs: B0 5, B1 18,
B3 120, B4 2,090 and B5 41; B2's 11 jobs overlap that accounting.

B4 reconciles 2,090 of 2,090 dispositions with no orphan receipt: 1,402 are
unavailable, 672 review-prepared, three review-partial, ten no-questions and
three unsupported. It reports 13,141 detected candidates, 13,134 readable,
994 review candidates, 12,140 unresolved, seven rejected, 38 image assets and
675 verified packages. Ready count remains zero. B5 reconciles 41 of 41: 25
review, 11 unresolved, six path-only, zero ready and zero cloud. These are
review/evidence counts, not publishable question totals.

Twenty-two course templates account for 547 activities: T1 250, T2 199 and T3
98. There is no authoritative T4/T5 denominator. GOER is local only: five banks,
72 records, 28 answer-ready questions, 44 review-required questions and 64
verified attachments associated with the ready questions. `/Volumes/JDabSSD`
is not mounted; a prior bounded PDF scan identified 1,280 unavailable SSD
sources. Do not substitute that older scan for B4's current 1,402 unavailable
dispositions. `academicReleaseComplete` remains false.

## Implemented behavior

Academic upload replay is owner-scoped and integrity checked. Immutable
snapshots retain checksums and original metadata; duplicate logical IDs and
duplicate source SHA identities are rejected. Import counters distinguish
ready, review-required, unresolved and rejected records. Browser installation
decodes and validates declared media, including GIF handling, dimensions and
checksums. B4/B5 filing is partitioned and reconciled; reviewed-file moves are
atomic and recoverable.

Course ownership ambiguity is resolved without hiding local courses. Prepared
Library rows and partial imports use truthful counts and rollback behavior.
Shared media and question-set imports deduplicate by source identity and commit
atomically. Attachment replacement captures prior metadata, durably restores it
before deleting new ordinary blobs, and retains bytes whenever rollback cannot
be confirmed.

Unlisted question-set shares are consent-based, owner-manageable, bounded to
seven days and revocable. Recovery uses owner-only row-level `SELECT`; it does
not expose a public security-definer listing function. Two migrations are
committed but have only been replayed locally:

- `20261015225638_bound_question_share_recovery.sql`;
- `20261015230042_enforce_academic_source_identity.sql`.

The Journal saves locally first. App routes, day changes, page turns, Library
exit, setup, cancel, completion and Daily Closeout wait for a flushed/asserted
vault write. A failed durability check cancels the transition and preserves the
open draft with retry/export guidance. Closeout-to-Journal is explicit opt-in.
Inline images remain locally readable/exportable even when the exact prepared
workspace exceeds the 14 MB account-copy limit. Browser teardown is best effort,
not represented as a durable IndexedDB guarantee.

## Current validation

Node 22.23.1 on macOS. On the combined tree:

- full web suite: 380 files passed, 19 skipped; 3,644 tests passed, 28 skipped;
- reconciliation: 49 of 49 passed;
- focused Journal regression after the integration-only mock repair: 77 of 77;
- final owned academic/shared suite: 109 of 109;
- TypeScript checks: web and API passed;
- full lint and production build passed;
- release checks: 79 of 79; repository checks: 43 of 43;
- deployment tests: 7 of 7; clean filtered deployment verification passed;
- Chrome acceptance: Bookshelf desktop/mobile, PDF bank desktop/mobile plus
  answer reveal, and Journal save/reload desktop/mobile — seven relevant
  journeys passed;
- Journal desktop 1440x900 and mobile 390x844 screenshots were inspected with
  reduced motion, dark/light themes, no horizontal overflow and no captured
  console/page errors;
- migration tests: 19 of 19; sharing/upload tests: 80 of 80; academic schema
  tests: 6 of 6; receipt UI: 47 of 47; reconciliation gate: 32 of 32;
- `git diff --check` passed.

The build retains existing warnings for ineffective dynamic imports of `jszip`
and `webUpdates`, plus chunks larger than 500 kB. Dependency audit output reports
20 high findings in the root install and four findings in the web install (three
moderate, one high). No broad audit fix was attempted because it would change
dependencies outside this release.

## Cloud and delivery boundary

The latest authenticated production evidence remains the 2026-10-14 snapshot:
26 recorded migrations, six private buckets and 65 revisions, with zero verified
academic collections, revisions, files or storage objects. That is historical
evidence, not current production proof. No owner-authenticated production upload,
reload, share recovery or media readback was completed on 2026-10-15.

Before production acceptance: apply the two migrations through the approved
path, upload only cleared private material as its authenticated owner, reload it
through the learner UI, verify media/checksums and revocation, and record exact
receipts. The missing SSD sources, B4/B5 review queues and absent T4/T5 coverage
remain blockers to complete academic-library acceptance.

Disk headroom is approximately 12 GiB. Preserve services and source files; do
not perform cleanup or generate large native/build artifacts without a new exact
space check. This checkout is a locally verified release candidate, not a
production-verified canonical release.
