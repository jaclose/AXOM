---
tags:
  - axom/state
authority: current-state
---
# AXOM current AI state

## 2026-11-01 Ideas and Journal production integration

The isolated `codex/ideas-prod-merge-20261101` candidate combines
`origin/main` through `4d6a96a9` (QBank PR #70) with safe Ideas branch
`b08d10c1`.
The Journal includes first-open setup, a desk-framed free-writing page,
4.4-second idle put-down, working return-to-desk control, side support,
weather in the scene, MacBook study activity, closeout/catch-up reminders,
and feedback. Dashboard notifications, Question Set library, streak freezes,
Examplify highlighting, Host/Community UI and reviewed bulk answer confirmation
are included. Radiordle and Pathordle app content is held for provider approval.
See [journal scene](JOURNAL-NOTEBOOK-ARCHITECTURE.md),
[daily loop](DAILY-LOOP-REMINDER-LIFECYCLE.md), and
[Ideas 11 audit](directions/03-notes/2026-11-01-IDEAS-WORKFLOW-AUDIT.md).

Production Git push, live journal readback and hosted acceptance are distinct.
Community/operator access, owner provisioning and real account tests still
require hosted verification. Four feature migrations have unique versions
`20261101190000`–`20261101193000` after the QBank migration sequence and
must be applied before their cloud flows work. Private study content remains
unpublished.
The original AXOM and local `main` worktrees contain protected unrelated
changes and are untouched. `origin/main` pushes trigger Vercel production.

## 2026-10-28 QBank production receipt

CLI 2.122.0 failed on `LOCK TABLE` (25P01) at 12:35 UTC; history stayed
30/33. CLI 2.114.0 applied versions `20261016011812`, `20261017233759`,
`20261027120000` at 12:47:19–12:47:36 UTC with
`db push --linked --skip-vault`. Postflight 33/33; academic RPCs verified.
Owner reviewer grant under `service_role` verified 12:49:35–12:49:40 UTC.
No content upload or sharing change.

## 2026-11-01 QBank production receipt

CLI 2.118.0 applied `20261101120000` by 20:01 UTC and `20261101130000`
by 20:22 UTC, each the sole pending version, with `db push --linked --skip-vault`.
Hosted ledger, academic reviewer/catalog/community functions, JD's Auth
reviewer row, and the private bucket/file-manifest EMF settings were verified.
The learner still requires a viewable figure. Collections and community
submissions were zero; no content was uploaded or sharing changed. PR 37/44
branch context remains in the [library contract](features/academic-library.md)
and `git show de00e44b:docs/AI_STATE.md`.

Draft PR #47 applies JD's hash-bound MI→NMI decision to 38 sources, 31 banks,
two plan sections and 39 activities without changing originals. Its separate
dry run reconciled 17,559 rows and all 20 courses; the combined EMF/MI candidate
still needs a fresh upload-free check. No content was uploaded.

## Ownership and protected work

Read the coordination board before integration. Preserve other owners' checkouts,
private sources and untracked work. The original checkout's current dirty state
was inspected on 2026-11-01 and left untouched. Historical branch detail is in
Git and the [archived handoff](archive/2026-10-25-host-baseline/AI_STATE.md.txt).

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
T4/T5 lack authoritative denominators. These inventory counts are historical;
`academicReleaseComplete` remains false until current acceptance is verified.

The private October 20 delivery folder reconciles 28 templates and 655 sources;
current parsing assesses 439 ready, 582 review-required, 10,968 unresolved and
23 unreadable retained rows. Source/template/media checksums were checked outside
Git. Prepared files are not proof of installation, browser decoding or cloud delivery.
Supported automated folder selection did not start the live import; manual folder
selection remained pending for the full source archive, whose compression would
exceed the 1 GiB import cap. On 2026-11-01, a separate private template-only ZIP
from the authoritative prepared folder installed locally: 28 templates yielded
633/633 distinct tracker activities in 13/23 modules after reload; MI remains
held for mapping. It contains no questions or source files and is not published.

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

The older 2026-10-15 and PR #30 migration counts are historical; the current
linked receipt is above. Recheck the live list before another migration.

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

2026-11-01 linked SQL showed zero academic collections and zero community
submissions. No owner-authenticated production upload, reload, share recovery,
media/checksum readback or revocation was completed.

Before production acceptance: upload only cleared private material as its authenticated owner; reload it
through the learner UI; verify media/checksums and revocation; and record exact
receipts. Also complete a true multi-connection privacy-lock check, Journal
image-race and broader multi-tab coverage, QBank opener-clone recovery analysis, Safari/WebKit and
packaged-desktop acceptance, and dependency-advisory review. The B4/B5 review
queues and incomplete T4/T5 coverage remain blockers to
complete academic-library acceptance.

Inspect disk before checks; preserve services/sources, no cleanup. Shared beta
checkpoint holds chat receipts, not completed audits. Local checks are not
production academic acceptance.
