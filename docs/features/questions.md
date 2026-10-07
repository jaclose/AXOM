---
tags:
  - axom/feature
authority: canonical
---
# Questions: import, practice, retain

**Purpose/user loop:** Import source material, review uncertain mappings, save a set,
build a tutor/exam block, answer and retain results/source evidence.

| Responsibility | Important files under `web/src/` |
| --- | --- |
| Workspace and import UI | `pages/QuestionWorkspacePage.tsx`, `components/questions/ImportPanel.tsx` |
| Extraction/parse/review staging | `lib/questionImport.ts`, `lib/questionParse.ts` |
| Reviewed atomic finalization | `lib/questionImportFinalization.ts` (`persistReviewedImportOnce`), `lib/store.ts` (`commitReviewedImport`) |
| Practice UI | `components/questions/ExamRunner.tsx`, `ExamSimulator.tsx`, `components/exam/` |
| Exam block engine (one for every player) | `lib/exam/engine.ts`, `lib/exam/questionTime.ts`, `lib/exam/profiles.ts`; the AXOM player's own rules in `lib/exam/playerBlock.ts` |
| State | Question/document/set/session types in `lib/types.ts`; persistence/backup boundary in [data model](../architecture/data-model.md) |

Invariants: uncertainty remains visible; do not invent answer keys or silently bypass
review; source provenance and attachment references must survive save/reload/export.
A tutor answer is saved when it is checked, and leaving a block keeps what was answered;
a block's attempts and its session are one store change (`commitQuizRun`). Filing by
module and week, findings and review reasons are in
[course engine and learning intelligence](course-engine.md).
Optional AI uses the [provider boundary](../architecture/backend.md), with validated,
reviewed outputs. A specification is not proof all source formats are implemented.

Canonical scope: [import engine specification](../UNIVERSAL-QUESTION-IMPORT-ENGINE.md).
Known supported formats/limitations must be checked against current import adapters
and [evaluation harness](../QUESTION-IMPORT-EVALUATION-HARNESS.md).

Tests: `questionImportEvaluation.test.ts`, `questionImportAtomic.test.ts`,
`components/questions/ImportPanel.persistence.test.tsx`; E2E
`web/e2e/question-bank-persistence.spec.ts` and related mapped-import/practice specs.
Start with the relevant stage, not the entire parser or all question tests.
