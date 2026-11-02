---
tags:
  - axom/state
authority: current-state
---
# AXOM current AI state

## Checkout and release boundary · 2026-11-02 04:52 UTC

This handoff was updated from local frontier baseline `77dd3533` on
`codex/axom-frontier-release-20261101`. Check `git status`, HEAD and the
coordination board before editing. At this snapshot, remote `main` was
`be2f40e6`; [PR #74](https://github.com/jaclose/AXOM/pull/74) and
[PR #75](https://github.com/jaclose/AXOM/pull/75) are merged there. The
frontier's `0.0.3-prebeta` version and [release notes](../CHANGELOG.md) are
**local release preparation**, with push and production held for JD's follow-up.
No later production deployment or authenticated acceptance is established here.

The last recorded web production check was PR #59 on 2026-11-01: signed-in
Question Bank and Community Uploads loaded. The last recorded linked SQL check
then found zero academic collections and community submissions; do not treat
that as a fresh count. The 2026-11-02 postflight recorded four feature
migrations (`20261101190000`–`20261101193000`) and RLS on all 11 new tables,
without real-account acceptance. The communications migration and Edge function
were observed active separately, but provider mode, delivery and inbox receipt
were not verified. Dated receipts: `git show e799ed5b:docs/AI_STATE.md`,
[Host rollout gate](features/community-operator-console.md#deployment-and-verification-gates),
and [email readiness](operations/communications-readiness.md).

## What is integrated locally

- The frontier joins Ideas/Journal with [Communities](features/communities.md),
  [Patch Notes](features/patch-notes.md), the qualitative asthma
  [body simulator](features/body-simulator.md), Dashboard widget improvements,
  and the **Midnight** palette. It includes earned study credits, bounded
  one-day streak protection, and account settings work. The simulator is a
  source-linked study illustration awaiting human medical review, not a
  clinical tool. Radiordle and Pathordle remain held for provider approval.
- [PR #74](https://github.com/jaclose/AXOM/pull/74) adds an explicit route
  from a reviewed saved source to a private revision and **Unreviewed**
  Community submission. Sharing needs rights attestation, exact source/media
  checks and later academic reviewer approval. A synthetic account journey
  does not prove hosted publishing. [PR #75](https://github.com/jaclose/AXOM/pull/75)
  records private PDF answer-mark **proposals for review**; visual marks do
  not change scoring keys or answer-ready status. Current-revision explanation
  attestation remains required before official academic approval.
- [Host](features/community-operator-console.md#operator-console) uses
  server-read roles, reasoned/audited moderation and a restricted report
  queue. Its forward privacy migration `20261102160000` and verified owner
  provisioning must be checked against the hosted ledger before the matching
  UI can be accepted. [Communications](features/communications.md) has a
  canonical renderer plus a branded local welcome draft and safe diagnostics;
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

The combined frontier gate through `bc685acc` passed typecheck, lint,
repository tests, build and targeted desktop/mobile browser checks; a stale
Dashboard selector was fixed and retested at `e7f9f867`. Later QBank merges
and release edits need an integrated release gate before any push or deployment.
This docs-only update passed 43 repository tests and `repo:check`.
Next: integrate this small docs commit, verify the current tree and deployment
preconditions, then keep the remote release held until JD's explicit follow-up.
