---
tags:
  - axom/state
authority: current-state
---
# AXOM current AI state

Snapshot: 2026-10-14 UTC, `feat/academic-library-v1` in `AXOM-academic-library-v1`.
JD authorized commits, development pushes and tested local-main convergence.
Original-file recovery `2d083ebd` and daily resumption `4bf2b3fe` are committed, pushed
and on local main. This checkout adds offline saved-work export and safe partial restore.
Remote main remains `5355e5e7`; it deploys production and has not been advanced here.

## Ownership and protected work

Read the current coordination board and its single CONVERGENCE ledger before another
integration. Preserve other owners' original checkouts and untracked files. Recovery
handoff `1942a77f` is integrated. On 2026-10-14 UTC the recovery owner confirmed no
renewed conflict or pending schema work; further original-file sync and shared-schema
work belong to the academic owner. Its original `9b828694` checkout remains untouched.

All fetched local/remote feature tips are represented in integration history except
`backup/pre-large-file-cleanup-2026-09-28`. Its 288 MB audio file and another private
asset have no publication clearance. Do not merge or publish that branch. Superseded
Ideas3, recovery, Decode, exam-bootstrap, updater, shared-catalog and dependency tips
are ancestry-only where newer canonical implementations replaced them. No old lockfile
or major dependency upgrade was adopted. Pathways is a separate local research service
with review-gated exports; it has no production publisher and passes 62 regressions.

## Working behavior

[Academic library](features/academic-library.md) owns the implementation and acceptance
contract. Course Library and QBank share a paginated backend catalog and source-backed
weekly plan. Explicit selection loads through the existing tracker/import/question
engines; empty quiz scope never expands. The FTM1 slice contains 75 reviewed activities,
three weeks, two unresolved activities and an exact 11-question image-rich Week 2 quiz.
Private uploads, reviewed shared/group visibility, withdrawal and independent learner
state pass real local Auth/REST/Storage checks. No competing content or attempt engine.

[Account/content separation](architecture/accounts-sync-v1.md) uses the existing atomic
revision writer, compact metadata checkpoints and explicit content downloads. Source
text and images reference canonical shared objects when exact; private edits retain
private recovery. Typed deferred records stay outside scoring. Original source files
now download through protected manifests into Decode's checksum-specific cache.
Portable ZIP format 2 includes verified originals; JSON/v1 ZIP imports remain supported.
No private source files or test credentials enter Git or application release assets.

Daily challenges use a fixed reviewed source revision, alias/participation, server
scoring, stable event IDs, ties and opt-out. The new device-local launch reference holds
only canonical quiz identity/mapping. Continue resumes the same ExamRunner session;
Retry verification reads the durable saved quiz. Refresh/sign-in never silently promote
unverified answers. Web Locks protect pending references across tabs. New points still
require the same UTC day and participation. No scheduling or hosted activation yet.

## Current validation

Node 22.23.1, macOS, installed Chrome, local native Supabase API
`http://127.0.0.1:55321` (CLI 2.120.0). Feature migrations through
`20261013230000_shared_account_content_references.sql` are applied only locally.
Original-file and daily-resume extensions need no additional backend migration.

The saved-work quality gate passes 3,136 unit/SQL tests with seven declared opt-in skips,
typecheck, full lint and production build. Seventy-four focused recovery checks pass.
Real FTM1 Chrome acceptance exports while offline from a device with no source bodies,
restores 11 attempts to a fresh profile, and retains 25 downloaded questions and two
originals when applying the same reference-only copy to a complete device. Reload and
offline image-rich study pass. Desktop/mobile/short windows, light/dark, keyboard,
reduced motion and 200% CSS zoom are exercised; screenshots inspected. Final run 46.5 s,
22.5 s test body. Account JSON remains 101,550 / 10,892 bytes with zero bootstrap GETs.

The preceding daily-resume quality gate passes 3,134 unit/SQL tests with seven declared
opt-in skips, typecheck, full lint, production build and bundle isolation. Forty-six
focused fixture/adapter/exam checks pass. Real two-account FTM1 acceptance reloads after
three answers, loses the fifth actual server acknowledgement, then explicitly retries
the same event IDs. Each learner retains 25 attempts, four points and rank one. Thirty
first-user requests total 6,690 JSON bytes. Desktop/mobile/short windows, both themes,
keyboard, reduced motion and 200% CSS zoom pass; final screenshots were inspected.

At `2d083ebd`, seven affected browser cases and the two-build update/consent/recovery/
peer-tab/offline gate pass. A 909,774-byte FTM1 portable backup restores two verified
originals plus 11 attempts in a third profile. Local account JSON is 101,550 bytes for
initial checkpoint / 10,892 bytes for the 11-answer delta; clean sign-in performs zero
source GETs and creates no private course-image copies. The supplied 516,431,732-byte
backup restores 343 questions, 848 documents, 43 activities and all 2,151 image hashes.
The full 97-case browser matrix last passed on predecessor `07cd665d` runtime (93 passes,
four opt-in skips). Do not describe that full matrix as a run of this new source tree.
Repository hygiene/43 repository tests and 79 release checks passed at the recovery
boundary; rerun affected repository gates before this next commit.

## Remaining delivery boundary

Pending: general private-upload original-binary cloud sync, larger/resumable uploads,
paged attempt history, persistent offline cache usage/removal, administrative review,
remaining supplied courses, daily scheduling, configured release and hosted acceptance.
Full export still requires downloadable sources. The explicit saved-work fallback
keeps references, progress and available files without fetching; it never claims a
complete offline library or advances the full-backup timestamp.

The exact `2d083ebd` web ZIP is 46,867,506 bytes with a verified manifest hash, but
accountsConfigured=false. It is an unconfigured local package, not the connected
release. Native compilation/signing remain unverified. Disk headroom recently fell to
7.4 GiB on the latest check; preserve all services/files and do not prune. External
build storage needs explicit path verification before using it for large native output.

Normal `www.axom.info` was last reverified read-only as deployment
`dpl_6fg8rJYXk2tSfJWvNALwL7gN38TF`, source `c23e8c26`; AXOM Production is
`jofkmfwkidubxcutkwzf`. No production tests, migrations, source publication or deployment.
Prepare the exact connected release/migration result before requesting production
approval. This is not complete canonical 1.1 delivery.
