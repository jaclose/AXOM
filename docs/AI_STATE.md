---
tags:
  - axom/state
authority: current-state
---
# AXOM current AI state

Snapshot: 2026-10-20 UTC, `feat/academic-library-v1` in
`AXOM-academic-library-v1`, HEAD `78c00e04`. This reflection batch was pushed to
main and deployed (authenticated deployment `7203032971`); six old dates were
dismissed in the live UI and stayed dismissed after reload. Domain contracts remain authoritative.

Batch pushes: `origin/main` triggers Vercel production, local commits do not.
After the reflection release, JD approved one additional tested
batch: participation streaks, compact Activity Log and catalog CI fixture repair.
That batch is `dc055a2` on `origin/main`; its deployment was not verified on 2026-10-27.
It does not authorize migrations, private publication or subsequent releases.
Verify deployed SHA and protected index before release claims.

## QBank term downloads (2026-10-28, local)

PR #31 is merged at `ee30ee43`. Its publishing contract and prior local receipts are in
[Academic library](features/academic-library.md); hosted migration/publication remain
separate owner work. `codex/qbank-term-download` in `AXOM-qbank-term` starts from that SHA.
Adds sequential complete-term download, Stop/resume, failure retry and exact downloaded
term practice. Publisher files and existing migrations are protected and unchanged.
Passed: installation, types/lint/build, 40 affected tests, 43 repository tests, hygiene
and five Chrome journeys (1440/390, both themes, reduced motion, no console errors).
Full local Vitest was interrupted (exit 130) when disk fell to 255 MiB; its result is
incomplete. Existing build warnings remain. Draft review and full CI are pending.
Next: obtain green PR checks before starting the reviewer queue from origin/main.

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

Draft [PR #30](https://github.com/jaclose/AXOM/pull/30) reports a 2026-10-25 audit with
30 applied and only the last two pending; recheck the live list before any release.

Journal transitions await confirmed writes; failures preserve drafts. Closeout
copy is opt-in. Images export beyond the 14 MB account limit; teardown is best effort.

Reflection inbox now remembers exact dismissed dates per browser/device/account,
including across reload and day rollover. New missed dates remain eligible;
shell reminders share suppression. Undo has a retry path and token-specific
markers preserve concurrent newer dismissals. Journal, plans and logs are untouched.
See [reminder lifecycle](DAILY-LOOP-REMINDER-LIFECYCLE.md).

## Current validation

Receipts through `dc055a2` (streaks, Activity Log, catalog fixture, reflection
`78c00e04`, `81e1a5bb` and its follow-ups) are preserved verbatim at
`git show dc055a2:docs/AI_STATE.md`. Hosted and real multi-connection SQL behavior
remain unverified. Existing build warnings concern `jszip`/`webUpdates`
static/dynamic imports and chunks over 500 kB. The GitHub advisory snapshot (56: 14
high, 39 moderate, three low) was not refreshed; dependency remediation is separate.

## Cloud and delivery boundary

Read-only production evidence dated 2026-10-15 showed 23 recorded migrations
and zero academic collections, revisions, files, storage objects or question
shares. No owner-authenticated production upload, reload, share recovery,
media/checksum readback or revocation was completed.

Before production acceptance: apply every pending migration (including
`20261027120000` from the branch above) through the approved path; upload only cleared private material as its authenticated owner; reload it
through the learner UI; verify media/checksums and revocation; and record exact
receipts. Also complete a true multi-connection privacy-lock check, Journal
image-race and broader multi-tab coverage, QBank opener-clone recovery analysis, Safari/WebKit and
packaged-desktop acceptance, and dependency-advisory review. The missing SSD
sources, B4/B5 review queues and absent T4/T5 coverage remain blockers to
complete academic-library acceptance.

Inspect disk before checks; preserve services/sources, no cleanup. Shared beta
checkpoint holds chat receipts, not completed audits. Local checks are not
production academic acceptance.
