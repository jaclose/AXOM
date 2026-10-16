---
tags:
  - axom/state
authority: current-state
---
# AXOM current AI state

Snapshot: 2026-10-15 UTC, `feat/academic-library-v1` in
`AXOM-academic-library-v1`. The verified code baseline is `737f785d`; the next
commit only refreshes this state record. `main` / `origin/main` remain at
`d5f9c030`, are ancestors of the feature, and can be integrated by exact
fast-forward. Since the earlier `7c34f7dc` checkpoint, the pushed implementation
sequence includes:

- bounded PDF import/OCR and reviewed-image byte validation;
- QBank identity quarantine, durable exam finalization and recovery;
- truthful Settings backup/privacy state and transactional portable restore;
- calm reflection/notification inboxes and actionable notification history;
- owner-bound share recovery and exact Course Library/template ownership;
- Journal image-flush and stale-tab conflict barriers;
- responsive Communications with dirty-navigation protection;
- Chrome tablet acceptance for Course Library, Journal and QBank; and
- `737f785d`, the serialized privacy export/deletion/share boundary.

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
not expose a public security-definer listing function. Privacy export, deletion
and share publication now use the same account-scoped transaction lock. Stale
or ambiguous cross-service work remains behind an operator-reconciliation
barrier; destructive cleanup revokes bearer links and withdraws owned academic
collections before external deletion.

Production has 23 recorded migrations through `20261013230000`. Eight later
migrations are committed and locally replayed only:

- `20261014120000_workspace_originals.sql`;
- `20261014121000_academic_revision_order.sql`;
- `20261014122000_academic_current_review_gate.sql`;
- `20261015133000_academic_gif_media_support.sql`;
- `20261015225638_bound_question_share_recovery.sql`;
- `20261015230042_enforce_academic_source_identity.sql`;
- `20261016002404_cascade_academic_owner_deletion.sql`; and
- `20261016011812_harden_privacy_request_barrier.sql`.

The Journal saves locally first. App routes, day changes, page turns, Library
exit, setup, cancel, completion and Daily Closeout wait for a flushed/asserted
vault write. A failed durability check cancels the transition and preserves the
open draft with retry/export guidance. Closeout-to-Journal is explicit opt-in.
Inline images remain locally readable/exportable even when the exact prepared
workspace exceeds the 14 MB account-copy limit. Browser teardown is best effort,
not represented as a durable IndexedDB guarantee.

## Current validation

Node 22.23.1 on macOS. Current focused evidence after the earlier full-suite
checkpoint is:

- Course Library and Journal Chrome acceptance: 6 of 6 at 1440, 768 and 390 px;
- QBank Chrome acceptance: 3 of 3 at 1440, 768 and 390 px;
- QBank durability: 98 integrator tests, with specialist runs of 104 and 53;
- Journal conflict/durability: 39 integrator tests, with specialist runs of 46
  and 33;
- exact Course ownership: 19 focused tests;
- Communications: 21 component/App tests and 10 Chrome journeys;
- dashboard inboxes: 8 component tests and 3 Chrome journeys;
- import/media: 55 integrator tests and 123 specialist tests;
- privacy server, migration-replay and UI: 72 of 72;
- privacy scoped ESLint and full web TypeScript checks passed;
- the production web build and Daily Games isolation verification passed;
- communications artifact integrity passed for 28 inputs, 7 auth/security
  files, 20 email types and 160 preview variants;
- repository hygiene and `git diff --check` passed; and
- an independent final privacy red-team returned GO for feature-branch commit.

The prior 3,644-test full-suite result predates the current implementation
sequence and was not rerun across this complete delta. Do not represent the
focused evidence above as a fresh full-suite result.

The build retains existing warnings for ineffective dynamic imports of `jszip`
and `webUpdates`, plus chunks larger than 500 kB. GitHub currently reports 56
default-branch dependency advisories: 14 high, 39 moderate and three low. This
is distinct from older local `npm audit` output. No broad dependency rewrite was
attempted inside this feature integration.

## Cloud and delivery boundary

Fresh read-only production evidence on 2026-10-15 shows 23 recorded migrations
and zero academic collections, revisions, files, storage objects or question
shares. No owner-authenticated production upload, reload, share recovery,
media/checksum readback or revocation was completed.

Before production acceptance: apply all eight migrations through the approved
path; upload only cleared private material as its authenticated owner; reload it
through the learner UI; verify media/checksums and revocation; and record exact
receipts. Also complete a true multi-connection privacy-lock check, a real
Journal multi-tab check, QBank opener-clone recovery analysis, Safari/WebKit and
packaged-desktop acceptance, and dependency-advisory review. The missing SSD
sources, B4/B5 review queues and absent T4/T5 coverage remain blockers to
complete academic-library acceptance.

Disk headroom was approximately 7.4 GiB at this checkpoint. Preserve services
and source files; do not perform cleanup or generate large native/build artifacts
without a new exact space check. This checkout is a locally verified feature
candidate, not a production-verified canonical release.
