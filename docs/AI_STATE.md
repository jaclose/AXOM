---
tags:
  - axom/state
authority: current-state
---
# AXOM current AI state

## Page-load hotfix · 2026-11-24

See [update policy](UPDATE-POLICY.md) and [Journal](JOURNAL-NOTEBOOK-ARCHITECTURE.md).

## Academic source recovery and install diagnostics · 2026-11-22

JD explicitly requested shared access for any account, working HOST approval,
all submitted course trackers, CPR sets and the wider prepared question corpus.
This authorizes scoped code release and content publication. It does not supply
missing source evidence or establish the accuracy of unreviewed questions.

This isolated branch, `fix/library-install-diagnostics-20261122`, starts from
`8d52fc69072ee63bf5c0277fb05a09e8e2261d1b`, tree
`a1dacaf9a2fd714be84b383a001e811f36c6f798`, equivalent to the tested #1014
release. Production `version.json` returned `04ab42a` at 04:05:56 UTC. The
earlier Vercel rate-limit failures are historical, not the current release state.

The live build includes #1008 source-revision reconciliation and compressed
active-state fallback, #1011's separate approval notices and ready counts, and
#1014's exact full-source export and read-only legacy image receipt lookup.
The owner completed the new full-source export. A genuine ordinary-account
learner journey remains unverified; an owner tab is not evidence of it.

## Verified production content

Production readback at 03:02–03:04 UTC showed **25 of 26 current collections
approved and shared**, containing **403 ready questions** in seven question
collections. Every collection has null group/cohort restrictions. The deployed
read policy permits authenticated accounts to read shared, approved, unwithdrawn
current revisions; anonymous access is not granted.

- All **18 tracker-only courses** were approved through the genuine HOST workflow.
  Their 938 activities retain 102 source-stated and 836 unstated week assignments.
- CPR2: **186 ready / 0 held**, 372 images, five original PDFs. All five normal
  PDF downloads were byte-exact. The normal full install was retried on 04ab42a
  at 04:19–04:21 UTC and remains incomplete with 64 questions on device. Empty
  stored failure messages do not establish its cause; do not infer quota.
- FTCM: **35 / 0**, 76 figures, two original PDFs. Both PDFs matched; a normal
  tutor answer verified choices, rationale, key crop, zoom and source PDF. That
  QA answer remains in owner history. Two superseded text-only submissions were
  returned for revision; none remain pending in Question Set Library.
- NCRS: **66 / 11**, revised and approved at 02:29 UTC. Its compiled PDF matched.
- RHPS IEA: **112 / 29**, revised and approved at 02:31 UTC. Browser image
  preflight and compiled PDF download passed.
- ER: **1 / 0**, source wording clarified with original provenance preserved,
  approved at 02:33 UTC; the PDF with unchanged source slides matched.
- NB Block 2: **1 / 0**, source/key/rationale checked and approved.
- BPM502 pre-midterm: **2 / 0**, previously approved.

Approval uses genuine signed-in reviewer membership, exact current revision and
hashes, and matching ready/explained counts. No SQL approval writes or reviewer
bypasses were used. Compiled PDFs are labelled as compilations when original
source files are unavailable. Other authors' questions retain their own credit.

## RHPS515 recovery and controlled revision

The remaining collection is shared/pending: **515 questions, 393 technically
ready and 122 held**. The current source check and actual app assessment agree:
only 19 of the 393 ready questions have explanation prose, leaving 374 missing.
Its community submission is withdrawn; an empty tracker queue does not establish
that this academic collection is approved.

The normal full-source export completed at 04:11 UTC. All **555 current files**
match the stored manifest by path, SHA-256 and size: 24 JSON, 451 JPEG, 57 PNG
and 23 PDF. All 508 images decoded; all 23 PDFs opened without repair warnings.
The 23 banks retain all 515 unique question IDs and order, with no parse drops.
All source bytes are now preserved; the earlier 449-missing-image state is obsolete.

A frozen 56-question patch has 50 ready/six held; independent review and browser
preflight passed. Separate-collection save was rejected by source-identity policy,
creating nothing and preserving the current revision. Do not rename, rehash or
change source checksums to evade that reservation.

The supported release is a complete new revision of the same collection. A
frozen 50-ready/465-held base retains all 515 questions. The original 19 explained
ready questions all lie outside those 56; their additional source/clinical and
64-slide review is complete. A separate guarded proposal preserves their
stems, choices, printed keys and false human-review flags, adds bounded AXOM
qualifications, repairs page spans and removes three cross-question exhibit
attachments. Actual app assessment in memory gives **69 ready / 446 held**, all
69 ready explained and 504 active images. The base draft remains unchanged;
this is not a published or approved revision. The complete candidate and its
teaching-PDF supplement still need final integration and normal preflight.

Preserve the exact final catalog identity; the multi-course planner adds a course
suffix and must not receive an already suffixed ID accidentally.
Retain removed incorrect/duplicate renditions in the old immutable revision and
recovery archive; do not attach them again merely to preserve a file count.
No revised RHPS515 package is publishable until its real binary preflight passes.

The authenticated full-source export preserves limits, account/revision pinning
and byte integrity without installation or learner-store writes. It is recovery
evidence, not clinical approval. [Academic library](features/academic-library.md)
owns the export and installation contracts.

## Workspace protection and narrow read fix

Original backups and the live RAM tab remain protected: no storage clearing,
pruning, sign-out or restore. Before the 04ab42a retry, saved-work exports retained
29 readable images and 230 metadata-only references; no deletion was established.
After retry the verified export has **144 readable images**, recovering 115 exact
payloads with all prior learner data and 64 CPR records unchanged. Required CPR
media remains incomplete; this does not isolate either failure's cause.

An earlier forensic archive preserves 256/259 exact image keys. It is explicitly
NOT_RESTORE and must not be fed to import controls. Real snapshots contain deferred
content, blocking Merge; Replace is not a media-only repair. Further full installs
await useful diagnostics and a controlled retry, never destructive cleanup.

The deployed legacy-receipt fix reads existing owner/null receipts read-only;
absence alone uses atomic readwrite recheck/add. Failed reads/writes grant nothing.
Account/hash/durability gates remain; no blind Blob replacement/fallback was added.
Five suites/77 tests, typecheck and lint passed before release; live causality is
unproved. [Data model](architecture/data-model.md) owns this contract.

The current diagnostic-only patch retains empty-message error names and the source
position/last phase in failed receipts. A figure write identifies its filename and
write position, without changing cache, import, account, integrity or durable-save
behavior. The new regressions reproduce lost diagnostics on the base; the changed
installer suite passes 43/43, including 11 focused cases covering a fake-IndexedDB
put rejection, retry preservation, malformed errors and unknown-cause fallback.
Typecheck, scoped lint and 43 repository tests pass. Broader validation and
independent review remain gates; tests do not diagnose the live failure.

## Wider corpus and release gates

The separate external-drive inventory declares 17,559 records: 782 technically
ready and 16,777 held. MASTER v2 has 2,673 IDs with unresolved overlap; do not sum
them into 20k reviewed unique questions. The source Mac was still offline at 03:39 UTC.
Bounded archive/Drive searches and the current source registry did not supply the
complete prepared folder. Access to the Mac/SSD or an uploaded complete package
is required. Do not retry inaccessible device commands or invent missing files.

The deployed full-source export passed its focused tests, typecheck, lint, build,
ZIP-reader round-trip, independent review and required CI. Its real 555-file export
is now verified. Next: finish the same-collection RHPS candidate and normal preflight,
then use ordinary owner/HOST controls; keep unresolved questions held. Separately,
complete this diagnostics patch's checks, independent review and all required CI
before release. Compare a fresh normal saved-work export after any controlled retry
before claiming restored media or a complete install. Genuine nonowner sign-in is
still necessary for learner acceptance.

Supabase project: `jofkmfwkidubxcutkwzf`. Private question files, PDFs and learner
backups stay outside this public repository. Original Mac and other worktrees
remain untouched. The unavailable Mac BOARD limits ownership visibility; changes
are confined to this explicit assignment. The
[maintenance registry](operations/repository-audit.md#maintenance-registry)
retains all unrelated ownership boundaries.
