---
tags:
  - axom/state
authority: current-state
---
# AXOM current AI state

2026-11-02 02:12 UTC `main` is `4d6a96a9` after the QBank parser, diagram,
course-map, SGU setup, explanation-state and reviewer-gate PRs listed below.
Their branch web/native/deployment checks passed before merge; the combined
main deployment has not been verified in this receipt.

2026-11-01 PR #59 merged as `cb0a456b` at 21:33:30 UTC. The Vercel production
deployment for that commit is ready on axom.info. The signed-in Question Bank
and Community Uploads UI loaded in production. Local browser checks covered
term sorting, week selection, persistence, community states and responsive
layouts; the merged branch passed typecheck, lint, build, repository checks and
focused tests. At the last linked SQL check on 2026-11-01, the hosted production
project had JD's reviewer row and both academic RPCs, with zero library
collections and zero community submissions. That is a dated observation, not
a fresh production count. No course content has been uploaded or shared.

The owner-term and MI→NMI upload-free dry run prepared 20/20 available courses
with zero term or package prompts: 699 answer-ready and 16,252 held. All 17,559
source rows were accounted for; 594 stayed local. A separate, local-only NMI
copy matched 82 answers to a printed key and passed a full upload-free dry run
at 781 technically answer-ready and 16,170 held; its original source and the
earlier candidate were untouched. Those 82 still carry missing-explanation
warnings, so they are not explanation-complete. JD directed this official
USMLE sample to appear as a link to the original NBME/USMLE sample set; the
copied questions remain local unless written NBME website permission is
recorded. Source rationales are preferred; separate, cited AXOM explanations
are drafts for subject review when source rationales are missing or incomplete.
Among the in-course parsed rows, 15,894 lack a parsed answer key across 816
source banks. No missing key is promoted from a parser suggestion or medical
inference. DERS, BSCE3 and DNPR still lack validated current question packages;
four Unfiled decisions remain unresolved. Earlier dated claims remain in
`git show 1b189177:docs/AI_STATE.md` and the feature contract.

## 2026-11-02 UTC QBank code merge receipt

GitHub reports these merge commits and times on `main`: #63 `bdfa6edd`
01:54:35, #68 `05905634` 01:55:40, #60 `62672efd` 01:56:29, #65 `c55a665b`
01:57:10, #64 `c4610a3e` 01:57:51, #67 `63e3a393` 01:58:26, and #69
`e925ebf8` 01:59:04. The stacked #68 and #65 were retargeted to `main` after
their base PRs merged. #68 reconciles exact answer-copy PDFs but does not
silently promote private questions. #65 adds original post-answer diagrams;
#67 completes the SGU map by an explicit, preserving action. The hosted
library content count remains a separate acceptance gate. PR #42 was excluded
from this sweep: its current head has eight commits across 17 files and
conflicts with `main`; its scope needs separate review.

PR #70 merged as `4d6a96a9` at 02:12:12 UTC after green branch
web/native/deployment checks. It requires a current-revision reviewer
attestation of stored explanations before official owner or community approval.
The check confirms text presence and stored ready-figure integrity; a reviewer
remains responsible for source and clinical accuracy.

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

At the 2026-11-02 02:12 UTC linked-ledger check, migration `20261101180000`
appeared on both local and hosted lists. This receipt records ledger parity,
not an authenticated reviewer-flow acceptance run. No course content upload or
sharing change was performed with this migration.

The MI→NMI change from PR #47, integrated through #59, applied JD's hash-bound
decision to 38 sources, 31 banks, two plan sections and 39 activities without
changing originals. The later combined upload-free check reconciled 17,559
rows and all 20 courses. No content was uploaded.

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
packaged-desktop acceptance, and dependency-advisory review. The missing SSD
sources, B4/B5 review queues and absent T4/T5 coverage remain blockers to
complete academic-library acceptance.

Inspect disk before checks; preserve services/sources, no cleanup. Shared beta
checkpoint holds chat receipts, not completed audits. Local checks are not
production academic acceptance.
