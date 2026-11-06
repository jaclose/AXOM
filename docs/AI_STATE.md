---
tags:
  - axom/state
authority: current-state
---
# AXOM current AI state

## Homepage alpha · 2026-11-06

[PR #123](https://github.com/jaclose/AXOM/pull/123) publishes JD's approved
36-second desktop/portrait films as the full-page homepage. Source assets retain
exact SHA-256 hashes; entry, auth, themes and learner data stay unchanged.
See [cinematic entry](features/cinematic-landing.md). Approval includes commit,
push and publication. Use PR checks and deployment status for release evidence,
not this source handoff. Other owners' worktrees remain untouched.

## Host and Communities repair · 2026-11-04

Branch `claude/host-communities-20261104` from `a96f1491`. Host now shows only
for the verified Project CEO (sidebar, title, Settings, Community shortcut and
the `#host` route); unknown routes no longer borrow the Host title. New forward
migration `20261104120000_operator_accounts_email_text.sql` fixes the owner's
Host dashboard, which failed on every load because `auth.users.email` is
`varchar(255)` on Supabase. See the
[operator console](features/community-operator-console.md#operator-console).
The migration is not on production yet; push, `db push` and deploy need JD.

## Checkout and release boundary · 2026-11-02 14:55 UTC

Remote `main` is `b1d3bea5` after PR #91, which makes missing static assets return
404 instead of the SPA HTML fallback and removes the blanket immutable asset
header. Cache-busted version checks for both `axom.info` and `www.axom.info`
return the same `b1d3bea5` production build. Apex points directly to Production
without redirecting to `www`, preserving the browser origin that owns local
workspace storage.

The isolated hotfix checkout `codex/axom-startup-fresh-update-20261102` is
based on that main commit. It moves web-worker registration ahead of shell
imports, retries missing assets with a cache-busted request, and offers an
explicit verified-save refresh if browser quota blocks only the extra recovery
copy. The focused update, checkpoint and route-boundary tests pass 30/30;
typecheck and lint pass. The first full web test run exposed one mock-export
mismatch; after fixing it, focused coverage passed. Full build and hosted CI
remain pending before merge. No user browser storage was cleared or rewritten.

## What this release contains

- The frontier joins Ideas/Journal with [Communities](features/communities.md),
  [Patch Notes](features/patch-notes.md), the qualitative asthma
  [body simulator](features/body-simulator.md), Dashboard widget improvements,
  and the **Midnight** palette. It includes earned study credits, bounded
  one-day streak protection, and account settings work. Community now loads
  the member's own profile independently, searches opted-in learners on the
  server, and pages friend connections without silently dropping older ties.
  Sync verifies a local save before reporting success and bounds content,
  media and original uploads while preserving the first failure. The simulator is a
  source-linked study illustration awaiting human medical review, not a
  clinical tool. Radiordle and Pathordle remain held for provider approval.
  Course-template file batches now preflight type and size before reads; pasted
  templates have the same 2 MiB UTF-8 limit. The Host snapshot leads with
  review and moderation work and has verified desktop/phone theme layouts.
- [PR #74](https://github.com/jaclose/AXOM/pull/74) adds an explicit route
  from a reviewed saved source to a private revision and **Unreviewed**
  Community submission. Sharing needs rights attestation, exact source/media
  checks and later academic reviewer approval. A synthetic account journey
  does not prove hosted publishing. [PR #75](https://github.com/jaclose/AXOM/pull/75)
  records private PDF answer-mark **proposals for review**; visual marks do
  not change scoring keys or answer-ready status. Current-revision explanation
  attestation remains required before official academic approval. Local ports
  of draft PRs #79/#80 add answer-outline and inline-answer-copy receipts for
  private review only; no bank key or readiness changes.
- Scoped local ports from draft PRs #33, #36 and #42 add complete-term course
  downloads/practice, an ordinary shared-course reviewer queue with exact
  revision and explanation gates, eligible quiz pool counts/multiple subjects,
  and preservation of unlocks/blueprint lane across backup merges. The
  [academic library](features/academic-library.md) owns the review contract;
  these ports passed the combined local gate and still need hosted acceptance. Week
  practice uses downloaded membership and blocks launch when a question or
  set was refiled outside the current course.
- [Host](features/community-operator-console.md#operator-console) uses
  server-read roles, reasoned/audited moderation and a restricted report
  queue. Its migrations and verified owner grant are on production; signed-in
  operator journeys still need real-account acceptance.
  [Communications](features/communications.md) has a canonical renderer,
  local previews, unsent Resend welcome/product-update and Broadcast drafts,
  ten optional opt-out Topics, and a branded preference page. Their exact
  [readiness record](operations/communications-readiness.md) distinguishes
  remote drafts from delivery;
  live Resend send, webhook, SMTP and email-client acceptance remain separate
  gates.

## Protected content and acceptance

[Academic library](features/academic-library.md) and
[Questions](features/questions.md) own source identity, media, filing, import
and reviewer rules. Private RHPS/ESoft/cumulative packages and held questions
remain unpublished. Missing keys are never inferred from parser suggestions,
answer marks or medical reasoning. Source rationales are preferred; separate
AXOM explanations require subject review. The copied NBME/USMLE sample remains
local pending written website permission; link to the original sample instead.
The older 20-course upload-free dry run and unresolved inventory are dated
evidence in `git show e799ed5b:docs/AI_STATE.md`, not hosted delivery.
A newer private v7 scan accounted for 995 sources and 859 banks, with 192
inline-answer and 613 answer-mark **review-only** proposals. No answer keys
were promoted, readiness changed or content uploaded. The duplicate-linked
publisher guard resolved the earlier 14-row mismatch: the 20-course
upload-free dry run reconciles 16,965 in-course rows (782 ready, 16,183 held),
594 Unfiled and zero unaccounted. The private approved-only template holds
17,179 rows pending review; seven unreadable markers, 30 malformed/filtered
rows and 343 source-binding-blocked rows remain separate. The offline
applicator can create a separate private candidate only from exact hash-bound
human decisions on keys, explanations, sources, filing and rights; no approvals,
readiness changes or publication occurred. A separate 17-item technical triage
remains all Hold. Of 17,552 raw v7 rows, 13,239 have no assigned source week;
Week practice cannot imply full scheduling. Medical and rights review remain separate.

Production acceptance still needs a cleared-content owner upload, reviewer
decision, learner reload/media and checksum readback, share withdrawal, privacy
and multi-device checks. Cloud-backed Community and Host need matching hosted
policies plus real-account checks. No private content, clinical accuracy or
source rights are approved by a passing code suite.

## Work protection and next action

The original checkout and other worktrees contain independent owner material;
preserve their staged, untracked and ignored files. Do not reset, stash, clean
or bulk-merge them. In particular, `backup/pre-large-file-cleanup-2026-09-28`
contains private assets and broad replacement/deletion. Check the
`/Users/jd/Developer/AXOM-coordination/BOARD.md` ownership notes and
[maintenance registry](operations/repository-audit.md#maintenance-registry)
before shared edits. Historic receipts remain in Git history; do not reload
them at startup without a specific question.

At `eaad98fa`, the clean combined gate passed typecheck, lint, 4,649 web
tests (35 skipped), build, update safety, offline games and 167 browser
journeys (14 conditional skips). On the `c06ae5a6` release tree, root API typecheck,
88 release tests, 43 repository tests, hygiene, web typecheck/lint/build,
update/offline checks, 200 focused unit tests and 15 relevant Chrome journeys
passed. The broad local Vitest run was stopped under severe host load after
four timing failures; all four files passed serially (88 tests). GitHub
Quality run 41445654894 passed for `c06ae5a6`.
Live mail delivery, private-content rights, and real-account Community/Host
and academic acceptance remain separate gates.
