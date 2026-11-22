---
tags:
  - axom/state
authority: current-state
---
# AXOM current AI state

## Academic publication and approval status · 2026-11-22

JD explicitly requested completion of shared account access, HOST approvals,
all submitted course trackers, CPR question sets and the wider prepared library.
This authorizes the scoped code release and content actions. It does not supply
unresolved answer keys, source evidence or a completed clinical review.

This isolated branch, `fix/publication-review-status-20261122`, starts at
`fd4ca6d1cb4071c6a9f91d8c5ad00261886523df`, the merge of PR #1008.
All six quality CI jobs passed its exact candidate tree. Local integration had
541 passing suites / 5,585 tests and 23 intentionally skipped suites / 37 tests;
the initial PDF-worker dependency-layout failures were resolved and rerun with
unchanged test assertions. Typecheck, lint, build, repository and release-tool
checks passed. PR #1008 adds source revision reconciliation, compressed active
state fallback and explicit stored review-file export.

**Production is still PR #1005, `b9fe78be41b6`.** Vercel rejected the next
production deployment with a 24-hour deployment rate limit. A successful preview
is not proof of a production release; preview promotion requires a production
rebuild. Do not bypass the provider limit, change billing, widen access, or claim
the new persistence/source-update behavior is live. The Vercel connector also
returned not found for the known preview under the correct team.

## Verified live publication

Production readback at approximately 02:56 UTC shows **25 of 26 current
collections approved and shared**, with **403 ready questions** across seven
question collections. All collections have no cohort restriction.

- All **18 tracker-only courses** were checked and approved through the genuine
  signed-in HOST workflow. Their 938 activities preserve 102 source-stated weeks
  and 836 unstated week assignments. No official week/date mapping was invented.
- CPR2: **186 ready / 0 held**, 372 images and five original PDFs. Shared and
  approved. All five normal PDF downloads matched the current manifest exactly,
  but full installation still fails in this browser's local vault.
- FTCM: **35 ready / 0 held**, 76 images and two original PDFs. Both PDFs downloaded
  byte-exact. One normal tutor answer verified choices, explanation, printed key
  crop, zoom and rendered source PDF. That QA answer remains in owner history.
- NCRS: **66 ready / 11 held**, newly approved at 02:29 UTC. The compiled practice
  PDF downloaded byte-exact. Original source identities and visible correction
  notes remain; the compiled PDF is not presented as a recovered original.
- RHPS IEA: **112 ready / 29 held**, newly approved at 02:31 UTC. Live image
  preflight and the compiled PDF download passed. The unavailable original IEA
  PDF remains explicitly marked unavailable.
- ER: **1 ready / 0 held**, newly approved at 02:33 UTC. The clarified endocrine
  pathway question preserves its original broader wording as provenance. Its PDF
  contains practice, explanation and unchanged original credit/question slides;
  the normal download matched the reviewed bytes.
- NB Block 2: **1 ready / 0 held**, source question/key/rationale inspected.
- BPM502 pre-midterm: **2 ready / 0 held**, existing approved collection.

The NCRS, RHPS IEA and ER revisions were published, checked and approved through
normal owner/HOST controls, then independently read back from production. No SQL
approval write was used. Existing downloaded copies still require the source
update release; do not describe those copies as corrected. The two superseded
text-only FTCM Question Set Library submissions were returned for revision, not
deleted. Owner-session verification is not a new-learner acceptance test.

## Remaining content and recovery

The separate RHPS515 collection remains pending with 393 technically ready and
122 held questions. Its live stored-source check found only 19 of the 393 ready questions explained,
with 374 explanations missing; approval stayed disabled. A ready count does not
establish source accuracy.
Recovery matched all 23 original PDFs, 59 images and four current bank JSON files
(56 questions) to its current manifest. The remaining 20 JSON files and 449
images have not been recovered. Historical 514/524-question copies are not the
current publication.

Two independent reviews and the actual import pipeline support a **50-ready /
6-held RHPS candidate** from those four banks. It preserves original identities,
keys and source credit, corrects source spans and figure assignments, and keeps
four clinically reworded variants held with explanation evidence. Browser image
preflight passed at 02:53 UTC. The save then failed atomically because those
original source checksums already belong to the pending RHPS515 collection.
Readback confirmed no new collection and no change to the full pending revision.
Do not rehash originals or relabel their identity to evade that reservation.
The supported route is a full new revision of the same original collection,
retaining all 515 questions and explicitly holding unreviewed items: 50 ready /
465 held if only these 50 have completed review. Its complete current files must
be recovered first; the candidate remains an unpublished reviewed patch set.

The wider external-drive inventory contains 17,559 declared records, with 782
technically ready and 16,777 held. Other saved inventories overlap. They are not
20,000 reviewed public questions. Bounded archive recovery did not locate the
complete payload. The authorized Mac remains offline, confirmed at 02:58 UTC.
Do not invent its contents, delete material, or retry commands against an offline
device. No genuine non-owner/non-reviewer sign-in has been available for live
acceptance; authenticated RLS contracts and tests are separate evidence.

## Workspace protection and UI correction

A normal save retry succeeded at 02:20 UTC, but the full CPR2 download failed
again after additional sources. CRC/SHA-checked Saved Work snapshots preserve
the current records and all older recoverable files. Two small saved-source
downloads then completed with a fresh durable save at 02:42 UTC. The later export
could read their 29 new images but none of the prior 128 readable images, although
all prior references and metadata remain. No deletion was established. The live
exporter collapses missing rows, ownership/IndexedDB errors and unreadable Blob
bytes into one missing-media result. Independent code audits and five synthetic
cases reproduce possible read failures, not the live cause. Both actual snapshots
contain deferred content, so ordinary Merge is blocked; Replace is not a media-only
repair. Pause learner installs, retain all snapshots, and do not reload the live
workspace, clear storage, sign out or prune records to force a save. These exports
are neither complete backups nor successful restore tests.

The current patch replaces misleading “reviewed” count labels with ready counts
and shows revision approval separately in connected previews. Pending or rejected
owner-visible content must never gain an approval claim from a positive ready
count. Controls, practice gates, data and server permissions are unchanged.
[Academic library](features/academic-library.md) owns this distinction;
[persistence](architecture/data-model.md) owns recovery and verified saves.

## Next gates

The 15 focused preview tests, typecheck, scoped lint, production build, repository
checks and repository tests pass. Independent source review of the four UI files
passes. The first CI attempt passed web, native, deployment inputs and two browser
shards; the remaining shard found stale text expectations in three browser tests.
Six exact labels were updated to the intended ready/held wording without changing
the download, quiz, reload, isolation or progress assertions. Complete all required
CI on the corrected head before merge; the new UI is not deployed. Once the
provider allows production deployment, verify the exact live commit, source-copy
updates, protected recovery and full CPR2 download. A fresh ordinary-account
journey still requires genuine sign-in. Preserve these separate outcomes.

Production Supabase is `jofkmfwkidubxcutkwzf`; tracker migration
`20261122002007_academic_tracker_review.sql` is applied. Existing source/key/media
and reviewer gates remain intact. Keep private question files, PDFs and learner
backups outside this public repository. Original Mac and other worktrees are
untouched. [FORGE #140](https://github.com/jaclose/AXOM/issues/140) remains the
cross-workstream record; the [maintenance registry](operations/repository-audit.md#maintenance-registry)
retains ownership boundaries.
