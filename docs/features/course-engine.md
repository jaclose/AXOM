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
- **Certainty is only what the learner said before checking.** The older `confidence`
  field is asked after a miss and is never used for calibration.
- **A figure is placed on evidence or not at all.** It shares a page with one question,
  sits under a question's first line, or is on the page a question runs onto. Anything
  else is listed as unplaced with the reason. An image on a page that repeats a question
  (its answer page) is kept out of the question so it cannot give the answer away. Images
  drawn in the same place on most pages are treated as a logo and left out. Figures are
  cut from the rendered page and go through the existing named-image path as exhibits.
- **A learner's week placement stands.** Template rows record `weekSource` (template,
  inferred, learner). A re-import may retitle a row the learner moved, never move it.
- **Sets list ids.** A review or custom set points at the same question records as its
  source set and inherits that set's place in the course.
- **Private material stays local.** The inventory manifest names course files and is
  written under the ignored `artifacts/`. Test fixtures are invented.

## Known limits

Lecture weeks are not stated in the learner's current templates, so the planner spreads
teaching-day groups across the module's weeks and marks them for confirmation; a
`Week N:` line in a template states them. Figure placement depends on the importer
finding each question's page: on four real files it placed 5 of 6, 4 of 6 and 6 of 7
figures in text PDFs, and 2 of 20 in a slide-deck answer key where 15 of about 39
questions were not parsed at all. Mass import shows each file's proposed place and image
count and hands its figures to the review; it does not yet save several files at once. The
week view lists only rows filed as `Term/Module/Week N`; older rows stay in the tracker
tree. A row counts as done at one pass. Question type and difficulty are keyword
readings of wording, not analysis by a model.

Tests: `lib/pdfFigures.test.ts`, `lib/course-engine/courseEngine.test.ts`, `lib/course-engine/weekView.test.ts`,
`lib/learning-intelligence/learningIntelligence.test.ts`, `lib/quizRunCommit.test.ts`;
E2E `web/e2e/pdf-figure-import.spec.ts`, `course-engine-slice.spec.ts`, `course-template-load.spec.ts`,
`question-block-save.spec.ts`.
