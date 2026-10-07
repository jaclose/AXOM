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
| A source's original file on this device, and how much of it gave text | `lib/decode/sources.ts` |
| What a tutor view shows for one question; questions that teach the same rule | `lib/decode/teaching.ts` |
| Teaching read from a deck's own answer and explanation slides | `lib/decode/deckTeaching.ts`, on `lib/deckPages.ts` |
| A model's reading of a question's source, checked before it is kept | `lib/decode/aiAnalysis.ts`, through `lib/ai/` |

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
- **A deck's teaching is read from headed sections only.** "Why it's right", "Why not the
  others", "High-yield" and their like, on the slides the deck reader already ties to a
  question. Unheaded prose is already the question's explanation; no rule is guessed out
  of it. A single common word ("why", "answer") counts as a title only when it stands
  alone, has a colon, or is in capitals. Only another option of the same question can be
  a distractor. The result is a proposal, and it is not offered again for a question whose
  source analysis the learner already has in hand.
- **A model's reading is checked, then reviewed.** It is asked about one question with a
  confirmed answer and the text of that question's own pages. A reply is refused whole
  unless every quotation is in that text on the page it names, it cites something when it
  was given text, it explains only the other options, and it carries no field that was
  not asked for (so it cannot carry a new answer key). What passes is a proposal.
- **One route to a model.** Requests go through `AIProvider`: the signed-in `ai-proxy`
  (account, daily allowance, model chosen on the server) or a local model. Decode adds no
  endpoint. A request is sized to the proxy's limits and a batch is six questions.
- **A group never claims more than the sources show.** Questions are grouped only when
  their reviewed rules match word for word, a question printed in two decks counts once,
  and one question is called an instance, not a pattern. No screen uses the groups yet.
- **The original file stays on the device.** A source in the workspace is its text and a
  checksum. The file itself is kept in its own IndexedDB database, never exported or
  synced, and goes when its source is removed. A file is accepted only when its bytes
  match the source's checksum, so page numbers keep pointing at the same pages.
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
| `reviewPacketImport.ts`: its own page grouping, question and answer reading, and header lines of one learner's decks written into the code | the course engine's deck reader (`lib/deckPages.ts`), which drops running lines by counting them; only the reading of teaching sections was kept |

Tests: `lib/decode/decode.test.ts`, `lib/decode/sources.test.ts`, `lib/decode/teaching.test.ts`,
`lib/decode/deckTeaching.test.ts`, `lib/decode/aiAnalysis.test.ts`.

Measured on the learner's own files on 2026-10-07 (counts only): of 471 readable PDFs, 118
are decks holding 1,860 questions. Two decks lay their teaching out in headed sections, and
the reader offers a source analysis for 65 of their questions: all 65 with a rule, 61 with
reasons against other options (228 reasons), 62 with the slide's own title. The other decks
explain in unheaded prose, which import already keeps as the question's explanation.
