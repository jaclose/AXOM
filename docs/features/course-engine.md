---
tags:
  - axom/feature
authority: canonical
---
# Course engine and learning intelligence

**Purpose/user loop:** Give AXOM the course and its question files. It files them by
module and week, records what is answered, and says what the answers show and what to
do next. The learner reports nothing AXOM can observe.

| Responsibility | Important files under `web/src/` |
| --- | --- |
| Where a file belongs, read from its name | `lib/course-engine/sourceMapping.ts`, `vocabulary.ts` |
| Course templates: parse, plan by week, reconcile | `lib/course-engine/templateParse.ts`, `components/tracker/CourseTemplateLoader.tsx` |
| One scope for questions and tracker rows | `lib/course-engine/scope.ts` |
| The course by week: progress, question progress, absences | `lib/course-engine/weekView.ts`, `components/tracker/WeekOverview.tsx` |
| Activity kinds beside `TrackerKind` | `lib/course-engine/activity.ts` |
| Figures in a question PDF: find, cut out, place | `lib/pdfFigures.ts` (`attachPdfFigures`), called from `ImportPanel.tsx` and `MassImport.tsx` in `components/questions/` |
| Questions out of a PDF: running text, or slide by slide | `lib/pdfQuestionImport.ts` (`parsePdfQuestions`), `lib/deckPages.ts` |
| The one save path for reviewed questions | `lib/questionImportSave.ts` (`prepareReviewedImport`, `saveReviewedImport`) |
| Whether a queued file can be accepted without review | `lib/massImportCandidate.ts`, `components/questions/MassImport.tsx` |
| What an earlier import of a file already brought in | `lib/questionImportHistory.ts` |
| Files the learner skipped in the queue (this device) | `lib/importSkips.ts` |
| Answers as events, first and repeat | `lib/learning-intelligence/attempts.ts` |
| What a question asks, read from wording | `lib/learning-intelligence/questionFeatures.ts` |
| Structural and empirical difficulty | `lib/learning-intelligence/difficulty.ts` |
| Findings, each with its footing | `lib/learning-intelligence/patterns.ts`, `components/questions/AnalysisPanel.tsx` |
| How a source writes its questions | `lib/learning-intelligence/style.ts` |
| What to look at again, and when | `lib/learning-intelligence/review.ts` |
| Local source inventory | `web/scripts/source-inventory.ts` (`npm run sources:inventory`) |

## Invariants

- **Nothing is stored twice.** Learning intelligence is derived from `QuestionRecord.attempts`
  at read time. There is no analysis store and no second progress ledger. Scope is read
  through `questionScope`; a reviewed assignment overlay would plug in there.
- **Schema stays 34.** Additions are optional fields: `QuestionAttempt.quizSessionId`,
  `mode`, `certainty`; `QuestionRecord.week`; `QuestionSet.scope`, `kind`, `parentSetId`;
  `TrackerItem.activity`, `templateKey`, `attendance`; `Term.absenceAllowances`.
  `TrackerKind` is unchanged, so an older build still opens the workspace.
- **One attempt per block run per question.** A second write with the same `quizSessionId`
  amends. Backup merge keys such attempts by run, not by content.
- **Mapping proposes, it does not file.** Every candidate carries its evidence. A shared
  prefix, a one-letter mismatch, conflicting evidence or a file that points into a book is
  `needs-confirmation`. No school's module names are in the engine: they come from the
  workspace's courses or the learner's templates.
- **Two meanings of week.** "Week 12" in a file name counts from the term's start. A
  folder's position ("CPR1 3") counts from the module's and is kept as `part`. A template
  takes `firstWeek` to bridge them.
- **Every finding states its footing.** Observed, computed, or inferred from wording, with
  the number of answers behind it. A comparison needs 8 first-time answers on each side;
  otherwise the report lists what it is waiting for.
- **The order of review has one input and can be replaced.** `reviewCandidates` hands a
  ranker `ReviewSignals` (the reasons, correctness, the first answer, exposure, earlier
  misses, certainty, error reason, time against the learner's usual, when) and takes back a
  number. The reasons stay on the candidate, so a ranking can say why. `rankByReasons` is
  today's ranker. Difficulty, place in the course and days to the exam are named in the
  type and not supplied yet. Learning intelligence and Decode do not import each other
  (`lib/decode/boundary.test.ts`).
- **Certainty is only what the learner said before checking.** The older `confidence`
  field is asked after a miss and is never used for calibration.
- **A figure is placed on evidence or not at all.** It shares a page with one question,
  sits under a question's first line, or is on the page a question runs onto. Anything
  else is listed as unplaced with the reason. Images drawn in the same place on most
  pages are treated as a logo and left out. Figures are cut from the rendered page and go
  through the existing named-image path as exhibits.
- **A deck is read by its slides.** `deckPages` classes every page (question,
  continuation, answer, explanation, answer key, title) after dropping header, footer and
  slide-number lines, and rebuilds one block per question for the existing parser. The
  slide reading is kept only when the parser returns exactly one question per question
  slide; otherwise the file is read as running text. A numbered document with one question
  to a page keeps its running-text reading and only gains pages.
- **Answers come from text, never from formatting or images.** A written answer line, an
  answer key and a tick, asterisk or "(correct)" on an answer slide are read. A deck that
  marks the answer only in colour or bold stays unanswered and says so. A key is matched
  by the slides' own numbers, or in slide order only when it lists exactly one answer each.
- **An image never reaches a question from where the answer is.** Not from an answer or
  explanation slide, and not from under an answer or rationale line on a shared page. Such
  an image, and one on a slide with no question, is listed unplaced with the reason. In
  the review the learner can attach it to a question or take a placed one off; an image
  still unplaced at finalize is left out, and the finalize line says so first.
- **One save path.** The review screen and mass import's Accept both go through
  `questionImportSave`. Mass import holds no save logic.
- **Accept needs nothing left to decide.** A queued file can be accepted without review
  only when every question is whole and answered at the parser's highest trust, no
  question's edges were a judgement, no image may show an answer or is unplaced, its
  module and week are settled from its name (once the learner has modules), and none of
  its questions is in the bank. Otherwise the row names what is in the way and offers Edit.
- **Importing again adds nothing by itself.** A file is known by its checksum, another
  version of it by its name. Questions an earlier import brought in are recognised by
  wording (stem and options) alone, so nothing the learner changed since (week, module,
  tags, explanation, the set's name) is compared or touched. They come into the review
  unselected, each saying why. In the queue such a file reads "already imported" or
  "changed since import" and cannot be accepted. A skipped file stays skipped, in view.
- **A learner's week placement stands.** Template rows record `weekSource` (template,
  inferred, learner). A re-import may retitle a row the learner moved, never move it.
- **Sets list ids.** A review or custom set points at the same question records as its
  source set and inherits that set's place in the course.
- **Private material stays local.** The inventory manifest names course files and is
  written under the ignored `artifacts/`. Test fixtures are invented.

## Known limits

Lecture weeks are not stated in the learner's current templates, so the planner spreads
teaching-day groups across the module's weeks and marks them for confirmation; a
`Week N:` line in a template states them.

Slide decks, measured on the learner's own files on 2026-10-07 (counts only): all 77 IMCQ
answer keys are read slide by slide (72 with answer slides, 5 one question to a slide),
giving 1,123 questions, every one on its page, where running text gave 1,756 drafts of
which 475 had no options and 56 had a page. Of 367 other readable PDFs, 322 read exactly
as before, 39 more are decks (426 drafts, 376 with options, become 675 questions) and 6
keep their running-text reading and gain a page where one was missing. 6 PDFs cannot be
opened at all. 1,716 of the 1,798 deck questions have no answer in the text. About one deck question in
six has loose text after its options, and 79 sit on slides drawn options-first: both are
flagged for review, not guessed. Not handled: a question with fewer than three options
on a slide (the slide is reported as left out), an answer slide that repeats less than
80% of its question's wording, an answer-slide option whose mark is on a wrapped line,
and a single stray option above the rest (two or more are put back in order).

Figures on four real files: 5 of 20 attached in a deck (10 held back on answer slides, 5 on
slides with no question), and 4 of 6, 4 of 6 and 6 of 7 in text PDFs, where one image is
now held back for sitting under its rationale. An unplaced image is kept through review
and dropped at finalize unless the learner attaches it; nothing stores it with the source.

Accept without review fits few files today: 12 of 444 (150 questions), because 389 have a
question with no answer in the text. Skips are kept in this device's local storage, not
in the workspace, so they do not follow the learner to another device. A question the
learner deleted comes back selected when its file is imported again. The
week view lists only rows filed as `Term/Module/Week N`; older rows stay in the tracker
tree. A row counts as done at one pass. Question type and difficulty are keyword
readings of wording, not analysis by a model.

Tests: `lib/pdfFigures.test.ts`, `lib/deckPages.test.ts`, `lib/pdfQuestionImport.test.ts`,
`lib/questionImportSave.test.ts`, `lib/questionImportHistory.test.ts`, `lib/massImportCandidate.test.ts`,
`lib/importSkips.test.ts`, `components/questions/MassImport.accept.test.tsx`,
`components/questions/ImportPanel.persistence.test.tsx` ("Importing a file again"),
`lib/course-engine/courseEngine.test.ts`, `lib/course-engine/weekView.test.ts`,
`lib/learning-intelligence/learningIntelligence.test.ts`, `lib/quizRunCommit.test.ts`;
E2E `web/e2e/deck-import.spec.ts`, `mass-import-accept.spec.ts`, `pdf-figure-import.spec.ts`,
`course-engine-slice.spec.ts`, `course-template-load.spec.ts`, `question-block-save.spec.ts`.
