---
tags:
  - axom/state
authority: current-state
---
# AXOM current AI state

Snapshot: 2026-10-07. Canonical development line:
`integration/axom-convergence-2026-10-07`, worktree `AXOM-integration`.
This recovery checkout: `codex/integration-recovery-2026-10-07`, based on `ac67549` plus
maintenance `f5e2ac2`, merged at `78e2bf3`. The active canonical line advanced independently
(last observed `f1fd462`, ten newer commits); this checkout does not contain them. No write to
that owner's checkout was attempted. Recheck branch, HEAD and status. Local integration is not production;
`main` remains `5fbe8a4`. No push, deployment or branch/worktree removal is authorized.

## Implemented boundaries

React/TypeScript: `web/`; canonical native shell: root `src-tauri/`.
Local Vault and JSON backup are primary, optional Supabase revisions are additive.
Schema stays 34; preserve Noctyrium storage identifiers. Legacy Swift, `web/src-tauri/`
and retired name/PIN account handlers are not current architecture.

This line contains the media foundation, context/graph infrastructure, Ideas 6/doctrine
and Decode plans (documents only), journal/study plans, Wave 2 home, AnkiConnect/push,
[Course Engine and learning intelligence](features/course-engine.md), and shared exam
engine with both exam interfaces. Course branch `093bb65` was handed off clean and
merged at `7c069ea`; exam work through `2c1d610` is included, excluding `93badf8`.
The AXOM player uses the shared engine at `1c7536d`.

Course Engine owns term/module/week/question scope and attempt persistence. Reviewed
question saves use `prepareReviewedImport` and `saveReviewedImport` in
`lib/questionImportSave.ts`. Tutor answers save when checked; finished exam runs use
`commitQuizRun`; leaving a block retains answered work. Blank answers count as wrong in
exam simulation but stay unscored in the AXOM player. Resume storage shape is unchanged.

## Protected and deferred

[Recovery matrix](operations/branch-recovery-2026-10-07.md) records every meaningful
branch group, dirty worktrees, recovery artifacts and next actions. The
[maintenance registry](operations/repository-audit.md#maintenance-registry) owns cleanup
conditions. External coordination remains `/Users/jd/Developer/AXOM-coordination/BOARD.md`
and `state/CONVERGENCE.md`; read only relevant current entries.

- The old Decode code at `a33a01e` is preserved but untested. The canonical line now has
  a separate port under `lib/decode/` and a `docs/features/decode.md` contract, absent
  from this recovery checkout. Compare remaining intent before any further port.
  Ideas 2 is dirty and needs intent-by-intent reconciliation. Do not merge either wholesale.
- Original checkout remains dirty at mixed commit `93badf8`; do not revert there while
  occupied. Its safe exam parent is already integrated. Stash `ccaff8d` and safety refs
  remain intact. Caller-unchecked OpenAI endpoints and parked dependency commit
  `8dd9391` remain excluded from this line.
- Context-protocol/question-first dirty drafts and the unfinished release-repair merge
  remain preserved. Never reset, abort, clean or remove these as incidental maintenance.
- Course/Exam branches being integrated does not authorize cleanup in shared contracts.
  Remote Canvas, AI proxy, Guide, accounts doctor and cinematic work require separate review.

## Open product work

`reviewPriority` in `lib/learning-intelligence/review.ts` still has `TODO(human)`.
The AXOM player lacks I5-18's question navigator. Most source decks still need review:
colour-coded answers are not read; unresolved slide cases are in the Course Engine contract.
Skipped imports stay in device localStorage. Welcome-back restore has unit coverage only.
Feature priority is routed through the [doctrine](product/AXOM-LEARNING-INTELLIGENCE-DOCTRINE.md),
not preloaded. This recovery session implements no feature work.

## Validation and next action

Recovery validation/results: [recovery record](operations/branch-recovery-2026-10-07.md).
Runtime is byte-identical to `ac67549`; that owner's recorded gate was 2,473 unit tests,
42 browser tests passed and one skipped. This pass reruns repository/root tests only.
`npm run repo:check` prints current bootstrap size; it excludes client/global context.

First have the integration owner incorporate this maintenance checkpoint and refresh
the handoff against their latest tip. Then start Course Engine/QBank work from that
validated canonical line in a fresh session. Do not branch feature work from this
older recovery snapshot, the retired Course branch or the original mixed checkout.
