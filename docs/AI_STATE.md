---
tags:
  - axom/state
authority: current-state
---
# AXOM current AI state

## Academic source recovery and publication · 2026-11-22

JD explicitly requested shared access for any account, working HOST approval,
all submitted course trackers, CPR sets and the wider prepared question corpus.
This authorizes scoped code release and content publication. It does not supply
missing source evidence or establish the accuracy of unreviewed questions.

This isolated branch, `fix/academic-source-recovery-20261122`, starts from
`f5b6a061ba19f2897b966cde04843898725d1adb`. PR #1011 passed all six quality jobs
on exact candidate `8e44c458b5adb85746750c90bc5e82c46f4ee75b`; its merge tree
matched the tested tree. Vercel's normal main deployment then succeeded.
Production `version.json` returned `f5b6a061ba19-20261122031757094` at 03:19 UTC.
The earlier rate-limit failures are historical, not the current release state.

The live build includes PR #1008 source-revision reconciliation, bounded compressed
active-state fallback and stored review-file export, plus #1011's separate
approval notices and ready-question counts. A fresh owner tab verified those
notices and downloaded the exact current RHPS515 catalog and all 23 bank JSONs.
Existing-copy updates and a genuine ordinary-account learner journey remain
unverified. An owner tab is not evidence of another account's acceptance.

## Verified production content

Production readback at 03:02–03:04 UTC showed **25 of 26 current collections
approved and shared**, containing **403 ready questions** in seven question
collections. Every collection has null group/cohort restrictions. The deployed
read policy permits authenticated accounts to read shared, approved, unwithdrawn
current revisions; anonymous access is not granted.

- All **18 tracker-only courses** were approved through the genuine HOST workflow.
  Their 938 activities retain 102 source-stated and 836 unstated week assignments.
- CPR2: **186 ready / 0 held**, 372 images, five original PDFs. All five normal
  PDF downloads were byte-exact. Full installation failed on b9 with quota errors;
  only 64 questions materialized. It has not been retried on f5b.
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

The live review export recovered all 24 current JSON files exactly by path,
SHA-256 and size: 23 banks, 515 unique question IDs with order preserved, no parse
drops. Together with previously recovered 23 PDFs and 59 images, 106 of 555
current files are local. The remaining 449 images still need exact recovery.

A frozen 56-question review patch preserves the current IDs and source keys,
with 50 ready and six held. Independent assembly, source/image/PDF checks and
normal browser preflight passed. A separate-collection save was correctly
rejected because the original source identities belong to RHPS515. It created
no collection and changed no current revision. Do not rename/rehash originals
or change source checksums to evade that reservation.

The supported release is a complete new revision of the same collection. If
only the frozen 50 have completed review, retain all 515 and explicitly hold the
other 465. Preserve the exact final catalog identity; the multi-course planner
adds a course suffix and must not receive an already suffixed ID accidentally.
Retain removed incorrect/duplicate renditions in the old immutable revision and
recovery archive; do not attach them again merely to preserve a file count.
No revised RHPS515 package is publishable until its real binary preflight passes.

The current code task adds a separate exact full-source package export using the
existing authenticated reader. It must include the stored catalog, banks, images
and PDFs without installation or learner-store writes, with existing limits,
revision/account pinning and byte integrity intact. The light review export stays
available. A full export is recovery evidence, not a clinical approval.

## Workspace protection and narrow read fix

All original backups and the original live RAM tab remain protected. No storage
was cleared, records pruned, account signed out or backup restored. After two
normal small source downloads, a saved-work export had 344 questions, 52 documents,
29 readable images and 230 metadata-only image references. The old 128 readable
keys remained referenced with identical metadata. No deletion was established.

A fresh f5b saved-work export at 03:30 UTC was identical to that snapshot except
its export timestamp, including all question/document/history/deferred content
and all 29 readable image bytes. The fresh runtime did not restore earlier reads.
Forensic preservation recovered 256 of 259 referenced image keys with exact hashes
and decoding. Its explicitly NOT_RESTORE archive contains no workspace or importer
marker; it must not be fed to the normal restore controls. Three image payloads remain
unrecovered. Both real snapshots contain deferred content, so Merge is blocked;
Replace is not a media-only repair. Full learner installs remain paused.

A proven synthetic availability defect used a readwrite transaction merely to
read an existing permanent legacy ownership receipt. The scoped fix now reads
that receipt read-only; only absence uses an atomic readwrite recheck/add. Existing
owner/null receipts win, failed reads/writes grant nothing, and account/hash/durable
save gates stay intact. Five suites/77 focused image/export/original-file tests,
typecheck and scoped lint passed. This is not a diagnosis or claimed repair of
the live 230 missing reads. No blind unreadable-Blob cloud fallback or replacement
was added. [Data model](architecture/data-model.md) owns this contract.

## Wider corpus and release gates

The separate external-drive inventory declares 17,559 records: 782 technically
ready and 16,777 held. MASTER v2 has 2,673 IDs with unresolved overlap; do not sum
them into 20k reviewed unique questions. The source Mac was still offline at 03:39 UTC.
Bounded archive/Drive searches and the current source registry did not supply the
complete prepared folder. Access to the Mac/SSD or an uploaded complete package
is required. Do not retry inaccessible device commands or invent missing files.

The full-source export passes 42 focused tests, typecheck, scoped lint, production
build and actual ZIP-reader round-trip; independent frozen-code review passed.
Combined integration and all required CI remain gates before the authorized merge
and exact normal production build readback. Once deployed, recover and validate all RHPS files, assemble the complete
same-collection revision and use normal owner/HOST controls. Keep any unresolved
question held. Compare a fresh normal saved-work export before claiming restored
media reads; successful CI or code deployment is not live recovery. Genuine
nonowner sign-in remains necessary for learner acceptance.

Supabase project: `jofkmfwkidubxcutkwzf`. Private question files, PDFs and learner
backups stay outside this public repository. Original Mac and other worktrees
remain untouched. The unavailable Mac BOARD limits ownership visibility; changes
are confined to this explicit assignment. The
[maintenance registry](operations/repository-audit.md#maintenance-registry)
retains all unrelated ownership boundaries.
