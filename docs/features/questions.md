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

Batch queue removal is not save cancellation. While single-file or batch acceptance
is pending, all queue removal is locked, including same-render event races. The lock
ends when acceptance settles; failed rows retain their source and review controls.
Removing a completed row affects only the queue, not its saved questions or source.

Missing-record recovery retains the selected collection's identity, original
membership, source references and course scope in a transient request
(`lib/questionRecovery.ts`). Only the original missing IDs appearing uniquely in
the canonical store count as present; answer readiness is reported separately.
Presence is a live workspace observation, not proof of durable save or backup;
pending writes may still roll back.
New imports remain separate and never replace IDs by title, text or position.
Deleted, changed or ambiguous collections require a fresh selection. Recovery
context survives tab navigation, but not a full reload; reopening the collection
recomputes its current gaps. Cancelling recovery does not delete imported work.

Content made of ordered blocks (tables, images and equations in place), the import
package and the DOCX template: [question content](question-content.md).

Canonical scope: [import engine specification](../UNIVERSAL-QUESTION-IMPORT-ENGINE.md).
Known supported formats/limitations must be checked against current import adapters
and [evaluation harness](../QUESTION-IMPORT-EVALUATION-HARNESS.md).

## Community Question Set publishing and explanation assistance

Community Uploads exposes a standalone Question Set publisher beside the existing
course/source package publisher. Any saved nonempty Question Set, including a custom
set with no source document, term or module, can enter the existing permissioned
`question_set_library` submission flow. Approved learner sets are discoverable in
the same Community surface, via a separate optional browse control. Publication is
never an automatic side effect of saving or generating material.

The owner opens **Review and submit set** for an explicitly selected set. A configured
real AI provider can automatically prepare at most 12 missing explanations per
review, from *already confirmed, non-media answer keys*. A user can request another
batch if needed. The model returns an explanation and per-choice rationales as
**provisional private drafts**, never a new answer key. The student must inspect and
save each batch to their private bank, then attest to answer, explanation and
distribution rights before sending the exact current snapshot for academic review.
No model or deterministic hint is proof of correctness, citations or source rights.
Absent/unreachable AI, unresolved answer mappings, inaccessible media and failed
drafts remain explicitly blocked or manual-review work, not fabricated successes.

`lib/diagrams/publicationHints.ts` provides independent **text-only**
`planMedicalVisual(question)` keywords and visual kinds for future AXOM-owned
artwork. It derives only explicit stem/topic vocabulary and does not infer a
diagnosis or attach imagery. Catalog references (NCI IDC, CDC PHIL, OpenStax and
NLM Open-i) are discovery aids, not blanket redistribution grants. Individual
assets require documented license, attribution, permitted modifications and
medical review before publication. Until approved asset integration exists,
`assetId` is always null. The existing separately vetted diagram registry and
exact-revision source/mapping gates remain authoritative.

Implementation: `components/questions/CommunityUploads.tsx`,
`QuestionSetLibrarySubmitDialog.tsx`, `lib/ai/questionTeaching.ts`,
`lib/sharing/questionSetLibrary.ts` (reused), `lib/diagrams/publicationHints.ts`.
Regression tests cover independent publishing without module filing, AI proposal
validation, source changes, held keys and image-rights gates. No migration or
question-backup schema change is introduced.

Tests: `questionImportEvaluation.test.ts`, `questionImportAtomic.test.ts`,
`components/questions/ImportPanel.persistence.test.tsx`; E2E
`web/e2e/question-bank-persistence.spec.ts` and related mapped-import/practice specs.
Exact-ID recovery is covered by `questionRecovery.test.ts`, the collection/page
tests and `web/e2e/question-missing-recovery.spec.ts`.
Start with the relevant stage, not the entire parser or all question tests.
