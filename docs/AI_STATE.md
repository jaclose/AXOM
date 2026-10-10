---
tags:
  - axom/state
authority: current-state
---
# AXOM current AI state

Snapshot: 2026-10-10. Rolling development line `integration/axom-next-2026-10-07`
in `/Users/jd/Developer/AXOM-next-integration`, product tip `f40a8ebc`.
Source branch: `feat/course-qbank-intelligence-v2` in the matching course-qbank worktree.
JD confirmed this Codex session owns integration; no competing integration owner.
The current on-demand contract is `AXOM_QBank_First_Main_Execution_Brief_v2.md`
in the source worktree. QBank/Decode/Tutor and private content delivery take priority.

JD authorizes normal development pushes and validated local main convergence. Remote main
requires inspecting actual production/publication triggers and approval if it deploys.
Main is still `5fbe8a4f`; the frozen candidate remains `3d981f7c`. Neither was changed.
No production deployment, private-content publication, destructive cleanup or force push.

## Working product slices

- PDF import, ordered text/tables/images, review gates, hierarchical banks, practice and
  saved results are integrated. Prior private GOER evidence: 32 ready questions across
  three sets; 15 uncertain keys excluded. This is not complete corpus delivery.
- `16fd072f`: compact source-grounded Tutor feedback, optional deeper reasoning and source
  trace; persisted block review with all/missed/flagged filters and explicit repeat practice.
  Reviewing history neither adds attempts nor rescores the historical answer.
- `f40a8ebc`: persistent course-template versions in the existing document vault. Browse,
  choose weeks/activity types, preview additions/updates, load, reload and export/restore.
  Same-content imports deduplicate. Term-prefixed headers keep their module; reconciliation
  cannot move another term's activity/progress. Real browser acceptance loaded and reloaded
  all 28 supplied TXT templates: 14 modules, 672 activities, no unreadable lines.
  This was a test workspace, not delivery into the user's normal library.
- The private inventory accounts for 13 source roots: 651 files, 628 unique, 23 exact
  duplicates. Manifest remains ignored under `artifacts/source-inventory/`. Dependency and
  build trees are excluded. Corpus readiness, accepted generation quotas and portable
  private-bundle delivery are not complete. Updated FTM1-MSK PDFs still need reconciliation.

Durable behavior: [Course Engine](features/course-engine.md), [Decode](features/decode.md),
[question content](features/question-content.md), [bookshelf](features/bookshelf.md).
The one requirements/delivery ledger is external `AXOM-coordination/state/CONVERGENCE.md`.

## Contracts and protected work

Canonical app: React/TypeScript `web/`, native shell root `src-tauri/`.
Local Vault and portable backups are primary; optional Supabase revisions are additive.
Schema stays 34. Preserve Noctyrium storage identifiers. Legacy Swift and `web/src-tauri/`
are not the current shell. Models go through `AIProvider`; no additional AI endpoint.

Course Engine owns course scope and attempt persistence. Decode owns source teaching;
analyses stay on canonical questions. Learning intelligence derives from attempts. Decode
and learning intelligence do not import each other. Reviewed question saves use
`prepareReviewedImport` / `saveReviewedImport`; checked Tutor answers save immediately,
finished blocks use the shared commit path, and unfinished blocks resume.

Read current ownership in `/Users/jd/Developer/AXOM-coordination/BOARD.md` before writing.
Other dirty worktrees, recovery refs/stashes and the frozen integration line stay protected.
The [recovery matrix](operations/branch-recovery-2026-10-07.md) and external ledger retain
historical branch decisions; they are not proof of current ownership or completion.
The [maintenance registry](operations/repository-audit.md#maintenance-registry) keeps affected
areas ACTIVE: authorized feature work only, no incidental cleanup.

## Remaining acceptance work

- Deliver every supplied source through resumable, duplicate-safe, image-aware imports and
  account for ready/review/duplicate/reference/unsupported/missing/failed states. Inventory
  alone is not ingestion. Structured PDF/DOCX batch wiring and durable queue resume remain.
- Interactive Slide regions, shared visibility/attempt/annotation behavior, full exam-tool
  fidelity, ten accepted generated questions per eligible document and the actual secure
  Anki runtime remediation workflow still need acceptance. No generation batch ran here.
- Keep school/generated evidence and assisted/repeated/variant attempts distinct in analysis.
  `reviewPriority` still has the user's `TODO(human)`; do not silently replace its owner logic.
- Templates still need updated schedule authority, title-edit conflicts and cohort contexts
  within the same term. Selecting a version does not certify its academic currency.
- Original source PDFs for drawn-page previews remain device-local and excluded from workspace
  backups; imported question media has its separate portable attachment path.
- Main convergence, native/package validation, hosting-trigger inspection and release candidate
  assembly are pending. Do not claim the entire Ideas roadmap or corpus is complete.

## Validation and next action

Node 22.23.1, installed Chrome, reduced-motion desktop/mobile journeys. Saved-review slice:
113 affected unit tests, 8 browser journeys plus 2 console-strict checks. Integrated baseline:
2,843 unit tests passed, 5 skipped; typecheck/lint/build and update/offline checks passed.
Full Chrome run: 59 passed, 2 skipped, 3 failed. Stale mass-import assertions were repaired
in `df50465a`; that journey and both intermittent source-page attachment failures passed
on the actual integrated recheck. Keep that initial failure evidence, not an all-green claim.
Live-account and private-path suites are opt-in; mocks do not establish live integration.

Templates: 42 affected unit tests, 4 Chrome journeys including all real TXT templates,
typecheck/lint/build, 43 repository tests and hygiene passed on the feature tip. Existing
large-chunk and ineffective dynamic-import build warnings remain. Exact logs and final
integrated checks are recorded in the external ledger. No native or production validation.

Next: continue the smallest QBank-first private corpus workflow using the existing import
and storage contracts. Reuse these completed slices; do not rebuild the importer or library.
Complete release-critical acceptance before main/package promotion. Preserve all private
sources and existing worktrees; no cleanup project.
