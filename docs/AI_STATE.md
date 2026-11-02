---
tags:
  - axom/state
authority: current-state
---
# AXOM current AI state

## 2026-11-01 Ideas and Journal integration

The safe Ideas branch `b08d10c1` joins current `main` in this release candidate.
It adds the desk Journal, free writing, setup, return control, support, weather,
notifications, streaks, exam highlights, shared sets, Host and Community.
Radiordle and Pathordle remain held for provider approval. Four feature
migrations use versions `20261101190000`–`20261101193000`; hosted acceptance
is separate from the web push. Private academic content remains unpublished.
Other worktrees were not changed.

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

2026-11-02 settings candidate `2f950172` adds the account save map, typed sync
errors, first-scroll samples, navy AXOM Classic/default, graphite Legacy,
black Midnight Midnight, and refreshed Reports and WIP prep pages. Focused
tests, typecheck, lint, build and browser checks passed; hosted cloud readback
remains unverified. See [account sync](architecture/accounts-sync-v1.md).

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
owners' checkouts. Local `main` has 45 protected staged additions and six
untracked private sources; exclude them and verify staged/working hashes before
and after integration. Never switch, reset, stash or rewrite that checkout.
Staged research, backup, generated ZIP/demo and crawler work needs separate
owner review. Never merge `backup/pre-large-file-cleanup-2026-09-28`; it
contains private assets, a 288 MB audio file and broad replacement/deletion.

## Academic inventory and acceptance

[Academic library](features/academic-library.md) owns the implementation and
acceptance contract. The recorded inventory has 2,733 source identities across
4,213 hashed paths and 2,274 jobs; these are not verified question totals. B4
records 1,402 unavailable, 994 review candidates and 12,140 unresolved; B5
records zero ready/cloud. Earlier 22 templates had 547 T1–T3 activities, with
no authoritative T4/T5 denominator. The October 20 delivery had 28 templates,
655 sources and 23 unreadable retained rows. Those historical scans do not
supersede the newer 20-course dry run above or prove cloud delivery. Disk and
the 1 GiB import cap blocked that older full archive. `academicReleaseComplete`
remains false; see the [library contract](features/academic-library.md) for
source and media requirements.

## Implemented behavior

Course Library separates term/course maps, plans and local/account context.
QBank tracks ready, suggested, unresolved and missing records; image counts
are metadata, never answer-bearing browse thumbnails. Missing-record recovery
keeps original collection IDs, membership and scope; a new import stays
separate, and a live presence check is not durable-save proof. See
[Questions](features/questions.md).

Private installation holds invalid media used only by held questions while
allowing verified ready siblings. Ready-image and bank-wide filename/checksum
checks stay strict. Connected banks need exact collection/course/term/module
receipt membership; a same-named local course is insufficient. Preserve
account locks, source identity, reviewed filing, attachment rollback, revocable
shares and owner-only recovery. Recheck the linked ledger before migrations.

Journal writes preserve drafts on failure; the reflection inbox suppresses
exact dismissed dates per device/account while allowing new missed dates and
retrying Undo. See [reminder lifecycle](DAILY-LOOP-REMINDER-LIFECYCLE.md).

## Current validation

Earlier validation receipts remain at `git show dc055a2:docs/AI_STATE.md`.
Hosted multi-connection SQL is unverified. Existing build chunk/import warnings
and the older 56-advisory snapshot were not rechecked here.

## Cloud and delivery boundary

At the 2026-11-01 linked SQL check, collections and community submissions were
zero. No owner-authenticated production upload, learner reload, media/checksum
readback, share recovery or revocation has been verified. Acceptance needs an
authenticated cleared-content publish and learner check, plus privacy-lock,
multi-tab, Safari/WebKit and packaged-desktop coverage. B4/B5 review queues
and missing T4/T5 denominators remain open. Inspect disk before heavy checks;
local checks do not establish hosted academic acceptance.
