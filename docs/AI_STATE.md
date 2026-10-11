---
tags:
  - axom/state
authority: current-state
---
# AXOM current AI state

Snapshot: 2026-10-10. Isolated `feat/shared-academic-catalog`, draft PR 20 against
`integration/axom-next-2026-10-07`, based on `c23e8c26`. Not main or production.
Verify current refs and actual CI before continuing; other worktrees are untouched.

## Active product correction

JD requires a SITE-WIDE CLOUD Course Template Library and QBank, not a personal
folder installer. Shared content is published once for its permitted audience.
Course activation, progress, attempts and notes remain private. The local vault
caches selected content; it is no longer the only proposed distribution mechanism.

Implemented: versioned releases, catalog entries, checksum file manifests, audience
grants, private Storage policies, account-aware discovery, Load Course/Create Quiz
through existing stores, and operator preparation/publication tools. Canonical guide:
[Shared academic catalog](features/shared-academic-catalog.md).

The publisher requires exact release approval, project identity, rights reference and
audience. Uncertain source keys/assets remain held. No private content, user records,
server credentials or personal collection data were added to Git. Preparation refuses
overlapping source/output paths and does not publish unused assets from failed banks.

## Verified checkpoint and next CI

At `92af4e73`, GitHub Actions run 38103986818 passed BOTH web and native jobs:
repository hygiene, 72 root tests, TypeScript, lint, full unit suite, production build,
two catalog browser journeys (1440px and 390px), update-consent/persistence checks,
offline reopening, and native Rust fmt/check/tests. The high-severity production
dependency gate passed; three existing moderate mammoth/argparse/sprintf advisories
remain. No package manifests or lockfiles were changed.

Browser journeys exercised automatic catalog discovery, course loading, signed image
fetch, canonical practice, Decode review and persisted reload using synthetic HTTP
fixtures. Local PGlite tests covered anonymous/two-account access, exact object policies,
immutable publication, and the entire existing migration chain. These are NOT hosted
Supabase Storage or real school-content acceptance.

This follow-up threads account-validity guards through async course activation and adds
two race regressions. The final CI must pass at its exact commit, not inherit 92af4e73's
result. PR checks and comments carry the latest outcome without another roadmap.

## Actual environment and blockers

Desktop Commander on JD's Mac is offline. Its prepared collection is not accessible.
Historical location: Application Support/AXOM/private-library. Previous local report:
28 templates; 362 ready questions in 43 sets; 36 image-bearing questions. The 651-entry
source inventory includes review-held/unsupported/missing content, not all-ready banks.

Read-only inspection confirmed production project `jofkmfwkidubxcutkwzf` healthy and no
academic_catalog tables yet. NO production migration, content publication or deployment
was performed. No staging project/paid branch was created. Obtain an authorized hosted
environment and publication audience before network writes. Apply both catalog migrations
there, publish one reviewed course/image-rich bank, verify independent accounts and denied
access, then use the same resumable publisher for the remaining authorized collection.

Main remains untouched. Dev pushes are authorized; main/production deployment and private
source publication retain explicit approval boundaries. Never force push, erase workspaces,
drop stashes, delete worktrees, expose credentials or publish beyond the authorized audience.

## Remaining scope and protection

Original PDF/source-page and interactive Slide delivery, supplementary generation, complete
Anki remediation, deeper analysis and remaining Ideas still need acceptance. The learner
snapshot limit is unchanged: very large downloaded local libraries may still exceed it.
Catalog distribution is not a claim of full-corpus learner synchronization or offline DRM.

React/TypeScript web, root src-tauri shell, local schema 34 and Noctyrium identifiers
remain. Reuse saveBank/reviewed imports, templates, attachments, attempts, Decode and
course logging; no parallel question engine, AI endpoint, scheduler or learner store.
The small optional guard on course activation protects against identity changes while
waiting for persistence; ordinary local loading retains its existing default behavior.

Before local writes or integration, recheck current BOARD ownership. Its absence is not
permission to overwrite another session. Communications/Pulse, other active worktrees,
drafts, recovery refs and frozen branches remain protected. No incidental cleanup.
Prior private-folder implementation evidence: `5355e5e7:docs/AI_STATE.md`.
