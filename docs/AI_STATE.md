---
tags:
  - axom/state
authority: current-state
---
# AXOM current AI state

2026-10-23: `codex/rhps-esoft-acceptance-20261023`, base `dc055a2f`;
[intake](../web/src/lib/privateLibrary/INPUT_COMPATIBILITY.md). Unreleased.

Prior snapshot: 2026-10-20 UTC, `feat/academic-library-v1` in
`AXOM-academic-library-v1`, HEAD `78c00e04`. This reflection batch was pushed to
main and deployed (authenticated deployment `7203032971`); six old dates were
dismissed in the live UI and stayed dismissed after reload. Domain contracts remain authoritative.

Batch pushes: `origin/main` triggers Vercel production, local commits do not.
After the reflection release, JD approved one additional tested
batch: participation streaks, compact Activity Log and catalog CI fixture repair.
That approval is unused; the validated follow-up awaits commit and integration.
It does not authorize migrations, private publication or subsequent releases.
Verify deployed SHA and protected index before release claims.

## Ownership and protected work

Read the coordination board and CONVERGENCE before integration. Preserve other
owners' checkouts and files. Local `main` has 45 protected staged additions and
six untracked private sources; exclude all. Recheck overlaps against
the final SHA, then fast-forward only. Compare protected staged entries, cached
patch and working-file hashes before/after. Never switch, reset, stash or rewrite.

The staged AMBOSS research, source-coverage metadata, stale handoffs, backup
patch, generated ZIP/demo copies and simulator crawler are excluded. They need
separate owner review; do not publish private paths or source identities.

Never merge `backup/pre-large-file-cleanup-2026-09-28`: it contains a 288 MB
audio file, private assets and broad historical replacement/deletion.

## Academic inventory and acceptance

[Academic library](features/academic-library.md) owns the implementation and
acceptance contract. The recorded inventory has 2,733 source identities across
4,213 hashed paths and 2,274 processing jobs. These are inventory counts, not
verified question totals.

B4 reconciles 2,090 dispositions: 1,402 unavailable, 675 review-prepared/partial,
ten no-questions and three unsupported. It records 994 review candidates and
12,140 unresolved; ready remains zero. B5 reconciles 41: 25 review, 11
unresolved, six path-only, zero ready/cloud. Counts are not publishing approval.

Twenty-two templates account for 547 activities: T1 250, T2 199, T3 98.
T4/T5 lack authoritative denominators. Local GOER has five banks, 28 ready and
44 review-required questions, plus 64 verified ready-question attachments.
`/Volumes/JDabSSD` is unavailable. Its older 1,280-file scan must not replace
B4's 1,402 unavailable dispositions. `academicReleaseComplete` remains false.

The private October 20 delivery folder reconciles 28 templates and 655 sources;
current parsing assesses 439 ready, 582 review-required, 10,968 unresolved and
23 unreadable retained rows. Source/template/media checksums were checked outside
Git. Prepared files are not proof of installation, browser decoding or cloud delivery.
Supported automated folder selection did not start the live import; manual folder
selection remains pending. No ZIP was created; partial compression suggests the
full archive would exceed the 1 GiB import cap. Hold import while disk is critical.

## Implemented behavior

Course Library separates term/course maps, plans and local/account context.
QBank distinguishes ready, review-suggested, unresolved and missing records.
Image counts describe metadata only; no answer-bearing browsing thumbnails.

Missing-record recovery retains original collection IDs, membership and source
scope. A fresh import stays separate; only exact original records satisfy the
live presence check, which is not proof of durable save. Cancel preserves an
unfinished import. See [Questions](features/questions.md) for the contract.

Reviewer-edited wording retains original source figures through the existing
visibility gate. During private installation, invalid media used exclusively by
already-held questions remains unpersisted and explicitly unresolved; verified
ready siblings can still install. Ready-question image checks and whole-bank
filename/checksum collision rejection remain strict. Review metadata preserves
the declared original asset without storing invalid bytes.

Hosted template receipts cannot project onto a same-named local course.
Connected banks require exact collection/course/term/module and receipt
membership. Vault fallback promotion compares the last observed durable base
inside an IndexedDB transaction for workspace and auxiliary keys. Workspace
conflicts remain latched; unsupported first-ever offline cases fail conservatively.

Preserve account locks, source identity, atomic reviewed filing, attachment rollback,
revocable shares and owner-only recovery. Uncertain removals retain paths;
ambiguous cross-service work requires reconciliation, not inferred success.

The last authenticated production inspection on 2026-10-15 recorded 23
migrations through `20261013230000`. It is not a fresh production check.
Nine later migrations remain locally tested only:

- `20261014120000_workspace_originals.sql`;
- `20261014121000_academic_revision_order.sql`;
- `20261014122000_academic_current_review_gate.sql`;
- `20261015133000_academic_gif_media_support.sql`;
- `20261015225638_bound_question_share_recovery.sql`;
- `20261015230042_enforce_academic_source_identity.sql`;
- `20261016002404_cascade_academic_owner_deletion.sql`;
- `20261016011812_harden_privacy_request_barrier.sql`; and
- `20261017233759_enforce_academic_collection_classification.sql`.

Journal transitions await confirmed writes; failures preserve drafts. Closeout
copy is opt-in. Images export beyond the 14 MB account limit; teardown is best effort.

Reflection inbox now remembers exact dismissed dates per browser/device/account,
including across reload and day rollover. New missed dates remain eligible;
shell reminders share suppression. Undo has a retry path and token-specific
markers preserve concurrent newer dismissals. Journal, plans and logs are untouched.
See [reminder lifecycle](DAILY-LOOP-REMINDER-LIFECYCLE.md).

## Current validation

Follow-up: 65 participation-streak unit tests and two desktop/mobile Chrome journeys
passed; completed losses/misses count, wins remain accurate, reload retains history.
Activity Log: 10 unit tests and two Chrome journeys passed; five-entry preview follows
Pomodoro and preserves full history. Both interfaces' screenshots were reviewed.
Catalog CI fixture repair: three Chrome journeys passed locally. Production Quality
run `39443209953` failed missing mocked communications/settings HTTP responses;
the fixture now handles only that expected route. Remote CI has not rerun.
Initial streak checks hit ENOSPC and exposed two test-fixture assumptions, corrected
before passing reruns. Space recovered from 164 MiB to 7.4 GiB without agent cleanup.
Types/lint/build, Daily Games isolation, 43 repo tests and hygiene passed; no second push yet.

Node 22.23.1 on macOS. Prior receipts remain in Git and the coordination board:
`81e1a5bb` passed 3,791 unit/SQL tests (28 skipped), 14 academic Chrome journeys,
types/lint/build, bundle isolation, repo and communications checks. Follow-ups
passed queue removal (19 tests/three journeys), classification/privacy (166 tests,
isolated PGlite), and exact-ID recovery (51 tests/two journeys). Each passed release
checks; hosted and real multi-connection SQL behavior remain unverified.

Reflection release `78c00e04`: 36 tests, nine Chrome journeys, types/lint/build and
43 repo tests passed, covering Undo/retry, reload/day rollover, cross-tab/data
preservation and question Slides with figures/PDF originals. Initial PDF optimizer
failures cleared after restarting the owned server. Full Playwright and `verify:all`
remain unrun. Use installed Chrome and serial checks; never duplicate suites.

Existing build warnings concern `jszip`/`webUpdates` static/dynamic imports
and chunks over 500 kB. The prior GitHub advisory snapshot (56: 14 high,
39 moderate, three low) was not refreshed. Dependency remediation is separate.

## Cloud and delivery boundary

Read-only production evidence dated 2026-10-15 showed 23 recorded migrations
and zero academic collections, revisions, files, storage objects or question
shares. No owner-authenticated production upload, reload, share recovery,
media/checksum readback or revocation was completed.

Before production acceptance: apply all nine migrations through the approved
path; upload only cleared private material as its authenticated owner; reload it
through the learner UI; verify media/checksums and revocation; and record exact
receipts. Also complete a true multi-connection privacy-lock check, Journal
image-race and broader multi-tab coverage, QBank opener-clone recovery analysis, Safari/WebKit and
packaged-desktop acceptance, and dependency-advisory review. The missing SSD
sources, B4/B5 review queues and absent T4/T5 coverage remain blockers to
complete academic-library acceptance.

Inspect disk before checks; preserve services/sources, no cleanup. Shared beta
checkpoint holds chat receipts, not completed audits. Local checks are not
production academic acceptance.
