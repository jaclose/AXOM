---
tags:
  - axom/state
authority: current-state
---
# AXOM current AI state

Snapshot: 2026-10-17 UTC, `feat/academic-library-v1` in
`AXOM-academic-library-v1`, based on pushed checkpoint `abb504fe`.
This checkpoint consolidates course/QBank presentation, faithful image handling,
exact course ownership, vault recovery and privacy admission. Local main
integration is authorized after protected-index checks; `origin/main` was last
verified at `d5f9c030`. Prior integrated work includes bounded PDF/OCR,
durable exam finalization, transactional restore, owner-bound sharing, Journal
image/conflict barriers and responsive Communications. The existing domain
contracts remain authoritative; this checkpoint does not replace them.

Batch reviewed local work instead of making intermediate release pushes. Vercel
Git deployments follow pushes, not local commit count. `origin/main` drives the
live release and still requires fresh production-aware approval. No push,
production deployment, migration, academic upload or publication was performed
for this checkpoint.

## Ownership and protected work

Read the current coordination board and its single CONVERGENCE ledger before
another integration. Preserve other owners' original checkouts and untracked or
staged files. The local `main` checkout contains 45 protected staged user
additions. Never include them in an ordinary commit. Preflight found no
path/prefix overlap with the incoming feature; repeat that check against the
exact final SHA, then use a fast-forward only. Compare the protected staged
entries, cached patch and working-file hashes before and after. Do not switch,
reset, stash or rewrite either checkout.

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

Preserve existing upload/source-identity checks, atomic reviewed filing and
attachment rollback. Seven-day unlisted shares remain consent-based and
revocable; recovery is owner-only. Destructive cleanup must revoke links and
withdraw owned academic content before external deletion. Ambiguous
cross-service work requires operator reconciliation.

The last authenticated production inspection on 2026-10-15 recorded 23
migrations through `20261013230000`. It is not a fresh production check.
Eight later migrations remain locally replayed only:

- `20261014120000_workspace_originals.sql`;
- `20261014121000_academic_revision_order.sql`;
- `20261014122000_academic_current_review_gate.sql`;
- `20261015133000_academic_gif_media_support.sql`;
- `20261015225638_bound_question_share_recovery.sql`;
- `20261015230042_enforce_academic_source_identity.sql`;
- `20261016002404_cascade_academic_owner_deletion.sql`; and
- `20261016011812_harden_privacy_request_barrier.sql`.

Journal transitions wait for confirmed vault writes; failure preserves the
draft. Closeout-to-Journal is opt-in. Local images remain exportable beyond the
14 MB account-copy limit. Browser teardown is best effort, not a durability
guarantee.

## Current validation

Node 22.23.1 on macOS. Current local validation:

- full unit/SQL suite: 389 files passed, 19 skipped; 3,791 tests passed,
  28 skipped, zero failures, with two workers;
- full web TypeScript, ESLint and production build passed, including Daily Games
  bundle isolation;
- Chrome: 14 targeted journeys passed across course/QBank interface, template
  version/load/export/progress, course practice/save, image import/enlargement
  and edited-stem Questions/Slides tutor/exam persistence;
- interface matrix covers 1440/768/390 px, both themes, keyboard and reduced
  motion with no browser console warnings/errors;
- update consent, two-build workspace recovery, other-tab preservation and
  offline Daily Games reopening passed using installed Chrome;
- repository tests: 43 passed; hygiene and bootstrap budgets passed;
- communications artifact integrity passed for 28 inputs, 7 auth/security
  files, 20 email types and 160 preview variants;
- scoped ESLint and `git diff --check` passed.

The first full run was interrupted below 250 MiB free; stopping high-concurrency
workers restored headroom without deletion. Bounded reruns passed after fixing
a stale recovery-button label.
The initial image-test extension assumed randomized question order; both
distinct synthetic fixtures now receive reviewer edits before launch, and all
four desktop/mobile tutor/exam cases pass. Full Playwright `test:e2e` and the
single `verify:all` command were not run; do not call targeted acceptance a full
browser release gate. Bundled Chromium is absent; installed Chrome was used.

Existing build warnings concern `jszip`/`webUpdates` static/dynamic imports
and chunks over 500 kB. The prior GitHub advisory snapshot (56: 14 high,
39 moderate, three low) was not refreshed. Dependency remediation is separate.

## Cloud and delivery boundary

Read-only production evidence dated 2026-10-15 showed 23 recorded migrations
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

Disk headroom fluctuates sharply with concurrent checks; inspect it before any
large operation and keep test concurrency bounded. Preserve services/source
files; no cleanup is authorized. Normal ChatGPT dispatches were rate-limited
after four accepted follow-ups; the ignored shared beta checkpoint records the
remaining assignments. Do not claim all chats are running. This is a local
implementation checkpoint, not a production-verified academic release.
