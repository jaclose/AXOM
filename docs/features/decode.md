---
tags:
  - axom/feature
authority: canonical
---
# Decode: what a source teaches about a question

**Purpose/user loop:** After a learner commits to an answer, AXOM shows what the question's
own source teaches about it: the rule to carry forward, why each other option is wrong, and
the page it rests on. A model may propose the same from the source's pages; the learner
reviews a proposal before it counts as teaching.

## The contract

Each layer owns one thing and reads the layer before it by id.

| Layer | Owns | Where |
| --- | --- | --- |
| Course engine | where a question belongs: module, week, course | `lib/course-engine/scope.ts` (`questionScope`) |
| Provenance | which document and page a question came from | `QuestionRecord.sourceDocumentId`, `sourcePage`, `extraction`; `SourceDocument.pageTexts`, `checksum` |
| Source analysis (Decode) | what the source teaches about the question | `QuestionRecord.analyses`, `lib/decode/` |
| Attempts | what the learner did | `QuestionRecord.attempts` |
| Learning intelligence | what the attempts show, and what to look at again | `lib/learning-intelligence/` |

| Responsibility | Important files under `web/src/` |
| --- | --- |
| The analysis record and its bounds | `lib/decode/types.ts` |
| Analyses back from storage, a backup or another device | `lib/decode/normalize.ts` |
| Whether an analysis still fits, and which one is taught from | `lib/decode/analysis.ts` |

## Invariants

- **Decode has no scope and no store.** A question's place is the course engine's answer.
  Analyses are embedded on the question, like its highlights and images, so they travel
  with it through save, backup, merge and deletion. Schema stays 34: `analyses` is optional.
- **Source analysis and learner analysis stay apart.** An analysis says nothing about the
  learner: no attempt, error reason, confidence, timing or priority. Anything about the
  learner is derived from attempts when it is needed.
- **Ids and page numbers, not copies.** An analysis names a document and a page. A page's
  text stays on the document; a citation keeps at most a short verbatim excerpt.
- **A proposal is not teaching.** Only an analysis the learner reviewed is taught from.
  The source's own teaching comes before a model's reading of it.
- **Teaching goes stale with its question.** An analysis carries a fingerprint of the
  question's wording, key, explanation and source pages. A corrected key or a re-imported
  source makes it stale and it stops being shown. An attempt, a tag, a note or a move to
  another week does not.
- **A broken analysis is dropped whole.** A reviewed statement is never kept without the
  citation it rested on.
- **Bounded.** A few analyses per question and capped text (`ANALYSIS_LIMITS`), so
  teaching cannot swell a workspace past what sync carries.

## What the Decode checkpoint had, and what replaced it

`codex/axom-decode-v1` (`a33a01e`) is a set of untested modules that nothing mounts. It is
ported by intent, not merged.

| In the checkpoint | Here |
| --- | --- |
| `LearningScope`, `QuestionAssignment`, week normalizing, scope selection, `LearningScopeBar` | the course engine's scope; a question's own module and week, or its set's |
| a `decode` slice in the workspace with scope, priority, assignments, packs, sheets | none; analyses are on the question |
| `DecodeSourcePack` | derived from `SourceDocument` (page count, sparse pages) |
| question identity and duplicate grouping | `lib/questionDuplicates.ts` (`questionSignature`) |
| `decodeMetrics`, `nextDecodeAction` | `lib/learning-intelligence/` (attempt events, patterns, review) |
| `SourceTrace`, `DecodeDistractor`, `QuestionAnalysis`, the source fingerprint | `lib/decode/` |

Tests: `lib/decode/decode.test.ts`.
