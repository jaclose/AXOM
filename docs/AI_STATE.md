---
tags:
  - axom/state
authority: current-state
---
# AXOM current AI state

Snapshot: 2026-10-18 UTC, `feat/academic-library-v1` in
`AXOM-academic-library-v1`. Queue-removal follow-up to local `d8b7f283`:
single/batch acceptance retains rows and retry inputs until saves settle.
Last observed remotes: feature `abb504fe`, main `d5f9c030`. Fresh protected-index
checks are required for integration. Domain contracts remain authoritative.

Batch reviewed local work instead of making intermediate release pushes. Vercel
Git deployments follow pushes, not local commit count. `origin/main` drives the
live release and still requires fresh production-aware approval. No push,
production deployment, migration, academic upload or publication was performed
for this checkpoint.

## Ownership and protected work

Read the coordination board and CONVERGENCE before integration. Preserve other
owners' checkouts and files. Local `main` has 45 protected staged additions;
never include them in an ordinary commit. Recheck exact/prefix overlaps against
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

## Implemented behavior

The Course Library groups plans by term and distinguishes the course map,
available plans and local/account context. QBank collections expose separate
ready, review-suggested, unresolved and missing states with exact recovery
routes, readable week metrics and mobile actions. Image-reference counts
describe metadata only; browsing never exposes answer-bearing thumbnails.

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

Privacy export admission and deletion claims use the same account lock.
Requested exports block deletion claims; processing or reconciliation-required
deletions reject new exports. Cancellation remains successful if only its
notification receipt fails. Ready worker requests are filtered before the batch
limit, and actionable unread notifications cannot hide behind routine history.
Expired-export paths survive uncertain removal; guarded cleanup flags cannot replace
deletion barriers. Revisions compare term/module/academic-term/cohort under the owner
lock before source reservation or hash replay; mismatches cannot reclassify a collection.

Preserve existing upload/source-identity checks, atomic reviewed filing and
attachment rollback. Seven-day unlisted shares remain consent-based and
revocable; recovery is owner-only. Destructive cleanup must revoke links and
withdraw owned academic content before external deletion. Ambiguous
cross-service work requires operator reconciliation.

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

Journal transitions wait for confirmed vault writes; failure preserves the
draft. Closeout-to-Journal is opt-in. Local images remain exportable beyond the
14 MB account-copy limit. Browser teardown is best effort, not a durability
guarantee.

## Current validation

Node 22.23.1 on macOS. Consolidation `81e1a5bb` validation:

- unit/SQL: 3,791 passed, 28 skipped; types/lint/build, Daily Games isolation,
  43 repo tests, hygiene/budgets and communications integrity passed;
- Chrome: 14 course/QBank/template/image journeys at 1440/768/390, themes,
  keyboard/reduced motion, zero console warnings/errors; update consent,
  two-build recovery, other-tab preservation and offline Daily Games passed.

Queue-removal follow-up: 19 focused tests, independent review, types/lint/build,
43 repo tests and three Chrome journeys passed. Delayed failure/retry, settled
removal and reload passed at 1440/390 px, themes/reduced motion/keyboard, with
zero browser errors/warnings. Screenshots inspected. A stale selector was fixed;
disk recovered without cleanup after stopping the initial timed-out run.

Boundary follow-up: 166 targeted tests including migration replay, types/lint/build,
43 repository tests and communications integrity passed. SQL uses isolated PGlite;
real concurrent connections and hosted behavior remain unverified.

Recovery follow-up: 51 tests, two Chrome journeys at 1440/390 px,
typecheck, lint, build and 43 repository tests passed: exact-ID recovery,
separate imports, reload, retained drafts, rollback, themes and reduced motion.
The 23:24 UTC Chrome check passed real IndexedDB text contention, blocked navigation,
unsaved Markdown export and cold-tab recovery, with no console errors/warnings.
Full suites were not repeated. Full Playwright `test:e2e` and `verify:all` remain
unrun for this candidate; targeted acceptance is not the full release gate.
Installed Chrome substitutes for absent bundled Chromium. Keep concurrency low.

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

Inspect disk before large checks; preserve services and sources, with no cleanup.
The ignored shared beta checkpoint owns chat receipts and pending audits.
Accepted prompts are not completed audits. Local implementation is not a
production-verified academic release.
