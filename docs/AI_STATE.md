---
tags:
  - axom/state
authority: current-state
---
# AXOM current AI state

## Academic publication completion · 2026-11-21

JD explicitly requested completion of public account access, HOST approvals,
course trackers, CPR question sets and the wider prepared question library.
That instruction authorizes the scoped code release and already requested
content actions. It does not turn unresolved keys, source conflicts or missing
distribution evidence into reviewed content.

The isolated checkout is `feat/academic-publication-completion-20261121`, started
from `origin/main` `9f6b381f9a0a15dbc947a4f65a71f8ad1db002fa`.
A fresh read of the live `www.axom.info/version.json` identifies
`6cb4b1f5238c024373ba66d01e3b781cb96fff31`, built November 13, as production.
That single child of main repairs bundled-image imports and immutable-image
metadata. PR #1005 includes it as the candidate's parent. A successful
historical main deployment is not proof of the current live revision.

Yesterday's temporary release checkout did not survive. Its reconstructed
changes require fresh tests; earlier hashes and test totals are historical.
Original Mac worktrees, source folders, private exports and recovery snapshots
remain untouched. Git history at the base SHA retains the prior full AI_STATE;
[CONVERGENCE manifest](release/2026-11-09-CONVERGENCE.md) owns its dated decisions.

## Current implementation

[Academic library](features/academic-library.md) owns the publication and reviewer
contracts. HOST mounts the ordinary submitted-course queue for the verified owner,
with the queue's separate academic-reviewer check intact. Existing operator totals
and metadata rows are explicitly labelled Community submissions.

Forward migration `20261122002007_academic_tracker_review.sql` adds an exact-revision
tracker-only review. Its closed envelope accepts only an empty-source catalog and
plain-text templates. Stored bytes, manifest, course filing and plan observations
bind the reviewer confirmation to one current revision. Question/explanation and
Community approval gates are not replaced. Source uncertainty and unstated weeks
remain visible.

Ordinary question downloads preserve required images and durable import gates
without automatically caching original PDFs. PDFs are individually available
through the same authenticated, hash-checked revision reader. Genuine uniform
source-declared weeks survive source-metadata filing; conflicting learner filing
blocks a retry repair. Human-reviewed unassigned sources remain unassigned.

[Question content](features/question-content.md) defines supplied byline display,
source-slide visibility, shared zoom/pan behavior and separate-rationale counts.
[Persistence](architecture/data-model.md) defines the compressed backup fallback
and read-only recovery selection that respects a captured newer-fallback marker.
Neither change guarantees unlimited storage or authorizes deleting learner data.

## Live content and limits

Fresh production readback confirms the CPR2 original practice collection remains
shared and approved: 186 ready questions, no held questions, 382 manifest files and
five original PDFs. This is catalog/storage approval, not a completed new-learner
acceptance claim. Eighteen tracker-only courses remain shared and pending while
the new migration and reviewer flow are being validated.

The existing owner's session remains signed in and displays Protected. Yesterday's
question download was partial after a safety-backup quota failure. Preserve the
current workspace and every existing backup; do not clear storage, sign out, adopt
a stale snapshot or prune before a new durable copy succeeds. No real-account
restore has been performed to validate the new fallback.

The larger source archive is readable on the authorized external drive, but its
saved decision ledger remains pending. Technical answer-ready counts are not
clinical review or distribution clearance. Conflicting revisions, ambiguous or
missing keys and unknown filing remain held. This release does not establish a
reviewed 20,000-question public corpus.

## Validation and next action

Fresh focused import, recovery, HOST, PDF and question-view tests have passed, with
scoped lint and shared typecheck. Independent native/recovery and UI audits found
no remaining blockers after the explicit PDF-list correction. Full local quality
passed: 5,523 unit tests, typecheck, lint and production build. Local browser checks
are blocked: the official download failed and installed Chromium cannot create its
required socket. CI supplies browser evidence. The Mac command service timed out
before any isolated checkout or test could run.

Production Supabase is `jofkmfwkidubxcutkwzf`; use its prod connection, not the
older project. The additive tracker migration was applied through the authorized
connection at 00:20 UTC November 22 (November 21 in Grenada). Its filename matches
the service-assigned migration version; its reviewed SQL bytes are unchanged.
Readback confirms RLS, narrow grants and unchanged question-approval functions.
No tracker content has been approved yet. Initial PR CI passed native compilation
and tests, deployment-input privacy checks and one browser shard; preview deployed.
The follow-up rebuilds the canonical communications artifact (89 release tests
passed), declares the live image script's scoped globals, and aligns one old
shared-image test with the preserved oldest-reference behavior. Browser failures
identified premature PDF catalog reads and an omitted genuine SQL RPC in the
synthetic Host fixture; both are corrected without relaxing their assertions.
All three browser shards passed on `7bbe096`. Its only remaining web failure was a
pre-existing Journal fixture using the legacy shifted study day before 04:00.
The fixture now uses the saved workspace's active calendar day; all six hydration
and account-isolation cases pass in UTC and America/Grenada without changing their
assertions or application behavior. Run fresh CI on that correction.
Code push, CI, deployment, migration, content approval
and learner acceptance remain separate facts. No approval or production release
may be claimed from the focused tests alone.

Push the reviewed follow-up through the connected GitHub API and verify its exact
revision. Complete release gates, deploy and perform genuine authenticated reviewer
and learner journeys. New-account credentials, source rights and provider quota
cannot be invented or bypassed. Keep all private PDFs and source records outside
this public repository.

[FORGE #140](https://github.com/jaclose/AXOM/issues/140) remains the current
cross-workstream release record. Do not merge unrelated held branches.
[Maintenance registry](operations/repository-audit.md#maintenance-registry) and the
available coordination board retain ownership boundaries. Preserve independent
dirty worktrees; never reset, stash or clean them to complete this release.
