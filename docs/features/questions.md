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

Single-file and batch intake use `lib/readQuestionImportFile.ts`: canonical PDF/DOCX
adapters take precedence, and loose text is parsed in full within explicit limits.
Only the stored text preview is shortened. An over-limit source fails before staging
partial questions. The original file remains available for exact recovery.

PDF answer keys printed only as typography are read by `lib/pdfEmphasisAnswers.ts`:
the single bold choice, or the single choice in a highlight colour, of each lettered
set (fonts and fill colours come from pdf.js drawing operators, not the text layer).
A document's marks count only when its whole convention holds: at least three sets
mark one choice, at most 5% mark several, a colour convention uses one highlight, and
explicitly printed keys agree. Keys inferred from explanation prose cannot veto it;
any disagreement is flagged `conflict.pdf-emphasis` for review, never overwritten.
`web/scripts/corpus-reparse.mjs` measures the same pass over a private corpus.

Loose image mapping retains unassigned files as verified Source Library originals.
Missing images or failed metadata writes leave review open; retry repairs the existing
set. Structured banks keep their separate held-media review contract. Thumbnails and
zoom show source context without changing reveal roles. Personal note-image updates
use an account/workspace guard and confirm the vault receipt before acknowledging
success or deleting superseded local bytes.

`QuestionContentAnnotations` maps selection offsets into the same canonical text
while preserving rich markup and tables. Changed text does not silently relocate
old marks. The native player's Save & exit stores the active block's picks, strikes,
visits, notes and elapsed time before closing; time spent suspended is excluded.
Mode/presentation selection belongs in setup, with source slides available in review.

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

Tests: `questionImportEvaluation.test.ts`, `questionImportAtomic.test.ts`,
`components/questions/ImportPanel.persistence.test.tsx`; E2E
`web/e2e/question-bank-persistence.spec.ts` and related mapped-import/practice specs.
Exact-ID recovery is covered by `questionRecovery.test.ts`, the collection/page
tests and `web/e2e/question-missing-recovery.spec.ts`.
Start with the relevant stage, not the entire parser or all question tests.
