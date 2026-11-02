---
tags:
  - axom/state
authority: current-state
---
# AXOM current AI state

## Checkout and release boundary · 2026-11-02 06:30 UTC

This handoff was updated from local frontier commit `dfc9070a` on
`codex/axom-frontier-release-20261101`. Check `git status`, HEAD and the
coordination board before editing. At this snapshot, remote `main` was
`ee1c0c2e`; [PR #74](https://github.com/jaclose/AXOM/pull/74),
[PR #75](https://github.com/jaclose/AXOM/pull/75),
[PR #76](https://github.com/jaclose/AXOM/pull/76),
[PR #77](https://github.com/jaclose/AXOM/pull/77), and
[PR #78](https://github.com/jaclose/AXOM/pull/78) are merged there. The
frontier's `0.0.3-prebeta` version and [release notes](../CHANGELOG.md) are
**local release preparation**, with push and production held for JD's follow-up.
This handoff does not establish deployment or authenticated acceptance of the
frontier-only features.

The last recorded web production check was PR #59 on 2026-11-01: signed-in
Question Bank and Community Uploads loaded. A 2026-11-02 read-only production
metadata check found one private pending academic collection and zero Community
submissions; no official academic content was published. The linked check of
AXOM Production
(`jofkmfwkidubxcutkwzf`) found its ledger ends at `20261101180000`. The four
feature migrations (`20261101190000`–`20261101193000`), forward Host privacy
migration (`20261102160000`) and reviewer queue migration (`20261102170000`)
are **pending in production**. An earlier
postflight of 11 new RLS-enabled tables was on separate preview project
`yfjqsshsaxiggcbvkvnj`; it was not production acceptance. The communications
migration and Edge function are present in production, but provider mode,
delivery and inbox receipt were not verified. Dated receipts: `git show e799ed5b:docs/AI_STATE.md`,
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
- Scoped local ports from draft PRs #33, #36 and #42 add complete-term course
  downloads/practice, an ordinary shared-course reviewer queue with exact
  revision and explanation gates, eligible quiz pool counts/multiple subjects,
  and preservation of unlocks/blueprint lane across backup merges. The
  [academic library](features/academic-library.md) owns the review contract;
  these ports still need the final combined gate and hosted acceptance.
- [Host](features/community-operator-console.md#operator-console) uses
  server-read roles, reasoned/audited moderation and a restricted report
  queue. Its four feature migrations, forward privacy migration `20261102160000`
  and verified owner provisioning are pending production acceptance.
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

The combined frontier gate before the three draft ports passed 4,424 web tests,
typecheck, lint, 88 release tests, repository tests, build and targeted
desktop/mobile browser checks. The #33/#36/#42 ports passed focused tests,
typecheck and scoped lint in isolated worktrees; #33 and #42 passed targeted
browser journeys. A final combined gate, including #36's new browser path,
is still required. Keep the remote release held until JD's
explicit follow-up; production migrations, owner grant, live mail delivery,
and real-account Community/Host acceptance remain separate checks.
