---
tags:
  - axom/feature
authority: canonical
---
# Question content: ordered blocks, the import package, the DOCX template

**Purpose:** A question is more than a string and a picture. A stem, a choice or an
explanation is an ordered list of blocks (text, table, image, equation), so a lab table
sits between the vignette and the prompt, where the source put it. The same content
travels as an import package and can be written by hand in a Word template.

**Status (2026-10-08):** Phases 1 and 2 of five are built on `feat/qbank-multimodal-import-v1`:
the model, the package and its checks, the template, a reader for real `.docx` files, and
an adapter from the existing PDF import. On `feat/goer-pdf-bank-import-v1` a reader for
tagged PDFs, a readiness verdict and an adapter into the canonical import are added, and
the three GOER Week 2 banks are built locally from their PDFs (Phase 5, in part). Nothing
in the app calls any of it yet: wiring is Codex's (decision 4 below). Phases are at the
end of this note.

| Responsibility | Files |
| --- | --- |
| Blocks, rich text rule, plain-text reading | `web/src/lib/question-content/blocks.ts` |
| Which image may be shown when | `web/src/lib/question-content/visibility.ts` |
| Package types, flags, issues, filing | `web/src/lib/question-content/package.ts` |
| Reading, version gate, canonical writing | `web/src/lib/question-content/packageJson.ts` |
| Checks and the preview's counts | `web/src/lib/question-content/validate.ts` |
| The strings older code reads | `web/src/lib/question-content/legacyFields.ts` |
| DOCX markers and the marked-body reader | `docx/markers.ts`, `docx/parseMarkedBody.ts` |
| Reading a `.docx`: ZIP, XML, body walk, equations | `docx/zip.ts`, `docx/xml.ts`, `docx/readDocxBody.ts`, `docx/omml.ts` |
| `.docx` in, questions and picture files out | `docx/docxToQuestions.ts` |
| Bridge from the existing text parser (anchors) | `fromDrafts.ts` |
| The existing PDF import as package questions | `pdf/pdfToQuestions.ts` |
| A tagged PDF: pages from pdf.js, the tagged reader, sets of questions, the converter | `pdf/loadTaggedPdf.ts`, `pdf/taggedPdf.ts`, `pdf/parts.ts`, `pdf/taggedPdfToQuestions.ts` |
| Ready, needs review or unresolved, with reasons | `readiness.ts` |
| A package into the canonical import and save | `toReviewedImport.ts` |
| Building and saving a real bank on this machine, counts only | `pdf/buildBank.local.test.ts`, `pdf/persistBank.local.test.ts` |
| Picture kind, size, checksum | `assets.ts` |
| Counts-only harness for local files | `docx/inspect.local.test.ts` |
| Fixtures and what may be committed | [`fixtures/qbank/`](../../fixtures/qbank/README.md) |
| Template and its builder | `docs/templates/AXOM_QBANK_IMPORT_TEMPLATE.docx`, `scripts/qbank/build-fixtures.mjs` |

Parent contract: [questions](questions.md). Filing by module and week:
[course engine](course-engine.md). Import scope and the image and table rules this
implements: [import engine specification](../UNIVERSAL-QUESTION-IMPORT-ENGINE.md), section 15.
Storage and schema: [data model](../architecture/data-model.md).

## Decisions (JD, 2026-10-08)

1. The Course Engine and `QuestionSet.scope` are the only hierarchy. A package's course,
   term and week are filing hints for it, never a second one.
2. `content?` on `QuestionRecord` is approved as one optional field, schema 34. Codex
   makes the `questions.ts` edit.
3. Wider attachment roles are approved, with old data still reading correctly and no
   answer leak. Not before the owner of the shared file is ready.
4. Codex owns the wiring into `ImportPanel`, `MassImport`, `ExamRunner` and the other
   active question bank files. This module supplies tested functions and no UI.
5. Reading a marked answer in a PDF page (a green tick) is Codex's work in
   `pdfMarkedAnswers.ts`. Nothing here detects it.
6. An answer that is ambiguous stays unresolved and asks for review. It is never
   saved as the key.

**Image visibility** (`visibility.ts`, every role tested in every mode):

| Role | While answering | After answering (tutor) | Review |
| --- | --- | --- | --- |
| `question`, `stem`, `choice` | shown | shown | shown |
| `explanation`, `answer_reveal`, `reference` | hidden | shown | shown |
| `source_page` | hidden | hidden | shown |

A role the table does not name is hidden everywhere. A reference image is hidden while
answering because an imported answer sheet could be filed as one; trusted lab values are
a separate exam tool, not an asset.

## The model

- **Blocks:** `text`, `rich_text`, `image`, `table`, `equation`, `divider`, `callout`.
  Table cells are text, never numbers, so "0.50", "↑↑" and "12 mg/dL" survive as written.
  Rich text keeps `b strong i em u sub sup br` and turns every other angle bracket into
  visible text: nothing is deleted and nothing can run.
- **Choices** hold blocks too. Two forms, both supported: a table inside each choice, or
  one shared `choiceTable` whose `rowKeys` name the choice of each row.
- **Assets** are named by id from a block. Bytes are never in the questions file. Each has
  a role: `question`, `stem`, `choice`, `explanation`, `answer_reveal`, `reference`,
  `source_page`; and a derivation: `embedded`, `region-render`, `page-render`, `authored`.
- **Flags** record a problem beside the question and never change it:
  `source_inconsistency`, `missing_explanation`, `possible_duplicate`,
  `answer_reveal_asset`, `media_association_uncertain`, `table_parse_uncertain`,
  `missing_required_media`.
- **Provenance** says how each question was made and from which file.

## Invariants

1. **Source wording is not repaired.** No trimming, re-casing or correcting. A wrong key,
   a ragged table or a misplaced picture is reported and left as it is.
2. **Order is content.** Blocks keep the order of the source through import, save,
   export and re-import.
3. **Nothing disappears quietly.** A field, block, flag or picture AXOM cannot accept
   produces an issue the import preview shows.
4. **An answer-marked copy is never shown while a question is open.** Nor is an
   explanation figure. The rule is `isAssetVisible` and every player must use it. A
   reveal marking on either the placement or the asset wins.
5. **A picture in a stem or a choice is required.** If it is missing, that question
   cannot be run; the rest of the bank still imports.
6. **Older code keeps working.** `QuestionRecord.stem`, `options[].text` and
   `explanation` stay; they are the plain-text reading of the blocks.
7. **The workspace schema stays 34.** Blocks reach the record as one optional field.

## The package

```
<bank>/
  manifest.json    schemaVersion, course {name, term, week}, bank {id, title, discipline},
                   source {filename, sourceWeekDeclared, axomAssignedWeek, ...}
  questions.json   schemaVersion, bankId, questions[]
  assets/          the picture files the questions name
```

`sourceWeekDeclared: false` means the week is how AXOM files the bank, not something
the source says. A question may state its own filing; otherwise it takes the manifest's.
`schemaVersion` starts at 1. A newer package is refused with a reason; an older one is
lifted through `MIGRATIONS` in `packageJson.ts`. Writing is canonical: fixed key order,
one table row per line, so a re-export of an unchanged bank is the same text.

An error with no question stops the import. An error on a question stops that question.
Warnings and notes are shown and never block.

## The DOCX template

A marker is a paragraph holding only a name in square brackets. Parsing rests on these
words and on the order of the document body, never on fonts or styles.

| Marker | Meaning |
| --- | --- |
| `QUESTION` or `QUESTION 9` | Optional line that opens a question and gives its number |
| `[AXOM META]` | `Name: value` lines: Course, Term, Week, Bank, Discipline, Topic, Subtopic, Source, Id, Number |
| `[STEM]`, `[STEM CONTINUED]` | Stem content. Each starts a new block of text |
| `[TABLE]` | The next thing is a Word table. `[TABLE: no header]`, `[TABLE: row headers]` |
| `[IMAGE]` | The next thing is a picture. `[IMAGE: answer reveal]` keeps it for review and places it nowhere |
| `[CHOICES]` | Typed letters `A.` or `A)`. A table whose first column runs A, B, C is the choices |
| `[ANSWER]` | The letter, or letters. If it cannot be read it is left empty, not guessed |
| `[EXPLANATION]` | Blocks, as in the stem |
| `[SOURCE]` | `File:` and `Page:` or `Pages: 5-6` |
| `[FLAGS]` | `type: what is wrong`, one per line |
| `[END QUESTION]` | Closes the question |

Tables and pictures are placed where the body has them, with or without `[TABLE]` and
`[IMAGE]`; those two markers are promises AXOM checks. Only the next letter in order
starts a choice, so a line beginning "E. coli" inside choice B stays text. Word's
automatic lettering is not in the text, so the template asks for typed letters.

`parseMarkedBody` reads a neutral stream (`DocxBodyElement`: paragraph, table, image,
equation, in document order), which `readDocxBody` produces.

## Reading a Word file

`docxToQuestions(bytes, defaults)` returns questions, picture files, issues and anything
it could not tie to a question. A document with markers is read by its markers. A document
without them goes through AXOM's existing text parser: each table, picture and set-off
equation is swapped for an anchor line before parsing and swapped back wherever the parser
kept that line (`fromDrafts.ts`). One mechanism serves unmarked Word files and PDFs, and
there is no second importer.

What the reader keeps, in document order:

- Paragraphs, with sub and superscripts and a marked word or two as rich text.
- Word's automatic numbering and lettering, which is in no run of text, including
  restarts and styles that number.
- Tables with their cell boundaries: column and row merges, heading rows, rich cells. A
  one-cell table is read as a box round its text.
- Pictures, with alt text, the crop the document applies, and their real pixel size and
  checksum from the bytes. Old-style (VML) pictures too.
- Equations, as LaTeX and as plain text.
- Text boxes, content controls, links, fields (without their codes), tracked changes read
  as accepted, characters typed in the Symbol and Wingdings fonts (so μg does not become mg).

What it reports and does not import: charts, SmartArt and drawn shapes; linked pictures;
EMF, WMF, TIFF and BMP pictures; hidden text; comments; a table inside a cell (read as
lines). It refuses `.doc`, OpenDocument, password-protected and damaged files with a reason.

**Formatting that could give the answer away is never imported.** Formatting on one whole
choice, and a tick beside a choice, are left out of the question and are never used as the
key. Bold, underline, highlight, colour and strike-through on one choice and not the
others are also reported as a possible answer marking (`isPossibleAnswerMark`). Italics
alone are not reported: organism names and terms are set that way for their own sake.

No library is added: the ZIP is inflated with the platform's `DecompressionStream` and the
XML is read by a small parser with no DTD and no entity expansion. `jszip` stays a dev
dependency and is the oracle in the tests.

**How it was checked.** The committed fixtures were written by real producers: the
template as AXOM builds it, the same template opened and saved by Microsoft Word, and two
documents built by pandoc. Locally, the reader was run over 39 Word-authored files from
pandoc's test suite and compared with pandoc's own reader: 99.8% of words agree, and the
one difference is a restarted list that this reader numbers as Word draws it.

## The existing PDF import as package questions

`pdfDraftsToQuestions` takes what the existing pipeline returns (drafts, figures, figure
placements, page lines, deck pages) and writes package questions. A figure goes between
the lines it sits between; when that cannot be worked out it goes after the text with a
flag. A figure the placer held back on an answer page becomes an `answer_reveal` asset
tied to its clean copy; one below an answer goes to the explanation; one with no question
is listed for placing by hand. `pdfToQuestions` runs the existing passes in the browser.
In a PDF with no structure tags, tables still arrive as text: rebuilding them from
positions is not done.

## A tagged PDF as package questions

Word and PowerPoint write a structure tree into the PDFs they export. pdf.js returns it
(`page.getStructTree()`, and `getTextContent({ includeMarkedContent: true })` for the
text of each tagged piece). `loadTaggedPdf` collects both for every page, and
`readTaggedPage` turns a page into the same body elements the Word reader produces:
paragraphs, list items with their printed labels, tables with heading rows and row names,
and figures with their boxes and alternative text. Page furniture outside the tags is
left out. No table is guessed from positions.

- **A document** is read in the order of its tags. A figure large enough to be one is in
  the text where the tags put it, so it lands between the lines it sits between. One
  printed straight after the last choice is moved to the question and flagged for a
  person to check.
- **A slide** is read by position, because text boxes are tagged in the order they were
  made. Text at the same height is one line. A graph drawn as many shapes is one region.
  Its axis numbers, axis titles and curve letters are text of the slide: they are taken
  out of the running text, the region grows to cover them, and they are kept as the
  picture's description. A line shaped like a choice or a numbered question is never
  taken. A bare number at the foot of several pages is removed as a page number.
- **Sets.** A file can hold several sets of questions, each numbered from 1. `splitParts`
  splits the text where the numbering goes back to 1 and each set is parsed on its own.
  Question ids then carry the set (`<bank>-s2-q03`) and `source.set` records it. The set's
  heading becomes the topic only when the tags call that line a heading.
- **Answer sections.** A separate section of numbered answers goes to the one set that has
  exactly those question numbers and no answers of its own. If it fits none, or more than
  one, it is applied to none. A key in any other shape printed after the last set is cut
  out when an earlier set has no answers, because nothing says whose it is. The parser
  reads a section only under a heading it knows; when it cannot read one as printed, the
  heading is reworded to "Answers and Explanations:" and the entries are left untouched.
- **An answer key set out as a table** (question number, then letter) goes to the parser as
  key lines. It never becomes a table of a question.
- **An answer slide** is kept whole as an `answer_reveal` picture of the page. Which choice
  a drawn mark points at is not read here: that is Codex's `pdfMarkedAnswers.ts`. A
  question whose only key is a mark has no key and says why.

`taggedPdfToQuestions` returns the questions, the issues, what has to be drawn from the
PDF for each picture (`renders`: a page, and a box for a region), what could not be tied
to a question (`unplaced`), plain notes and a counts-only report.

## Ready, needs review, unresolved

`questionReadiness(question, issues)` gives one verdict with its reasons.

| Verdict | When |
| --- | --- |
| Ready | A printed key, no flag, no warning or error of its own |
| Needs review | A printed key and a flag or warning. Or no key, and the source shows the answer in a form kept for a person to read (`answer_needs_review`) |
| Unresolved | An error stops it being run. Or no answer could be read and nothing was kept to settle it |

A package-level warning (two logos on a title slide) does not hold any question back.

## Saving a package through the canonical import

There is one way to save reviewed questions: `prepareReviewedImport` and
`saveReviewedImport` in `lib/questionImportSave.ts`. `packageToReviewedImport(pkg, issues,
options)` builds the request they take, so a package is checked, de-duplicated and written
by the same code as any other import. This is the typed contract for the import screens:

```ts
const adapted = packageToReviewedImport(pkg, issues, { acknowledged, sourceBytes, notes });
const prepared = prepareReviewedImport(adapted.request, library);
if (prepared.ok) await saveReviewedImport(prepared, store, imageFiles); // files named in adapted.imageNames
```

- Only a ready question is offered. One that needs review is offered once its id is in
  `acknowledged`, and never without a key. Everything else is in `held` with its reasons.
- The set is filed by the manifest: `scope: { module, week }`. `filing.agrees` says whether
  the curriculum puts that module in the manifest's term.
- Only a picture that may be seen while the question is open is offered, by file name. An
  answer-reveal or explanation picture is listed in `withheldAssets` and stays in the
  package, because the current question record shows every picture with the question.
- The existing save refuses a batch whose question numbers repeat. When they do (two sets
  numbered from 1), the saved questions are numbered in running order and each keeps its
  own place in its source label: "file, set 2, question 3".
- A second import of the same package is recognised and reuses the first. Nothing is
  written twice.

Until `content` is on `QuestionRecord` (Phase 4), a saved question is the plain-text
reading of its blocks: a table is saved as text, and a picture is an exhibit shown with
the stem, not at its place inside it.

## What is private

The repository is public. Faculty questions, answer keys, explanations and pictures from
course files are never committed. `fixtures/qbank/.gitignore` enforces it and a test asks
git that it does. Committed tests run on an invented bank whose eight questions are shape
twins of the hard cases. A real bank is built and checked on the owner's machine, and the
check prints counts only.

## Phases

| Phase | Scope | State |
| --- | --- | --- |
| 1 | Model, package, checks, markers, template, fixtures, tests | Built (`c25718d`) |
| 2 | Read a `.docx` body in document order; convert to the package; adapter from the existing PDF import | Built (`96c5cd9`) |
| 3 | Import preview: counts, issues, rendered questions, media badges, moving a picture to the right place | Open. Codex wires it into `ImportPanel` and `MassImport`; `summarizePackage`, `validatePackage` and `unplaced` are its inputs |
| 4 | `content` on `QuestionRecord`; one block renderer under every exam interface; wider attachment roles; image enlarge, zoom, pan; deletion, backup and restore of the pictures | Open. Edits `questions.ts`, `questionAttachments.ts`, `ExamRunner.tsx`: Codex's files |
| 5 | Build the three Term 5 GOER Week 2 banks locally and run them as the real regression set | In part (`feat/goer-pdf-bank-import-v1`). All three PDFs are tagged and are built locally: 47 questions, 11 tables, 7 figures. 32 are ready (two banks, every key agreed by a second PDF reader) and were saved, reloaded and re-imported without a duplicate through the canonical import, in memory. 15 need review (the slide deck: its answers are drawn marks, 14 of 15 slides). Not done: reading those marks (Codex), a browser renderer for the regions, the import screen |

Known limits to carry forward: a rendered question must apply an asset's `crop`; annotations store positions in the plain stem, so
highlights on block text need a mapping in Phase 4. Picture bytes are stored on the
device; account sync carries the question, its blocks and the asset records, not the
bytes ([data model](../architecture/data-model.md)). Attachments are limited to PNG,
JPEG, WebP and GIF, ten per question, 8 MB each; a Word file may hold EMF or WMF
pictures, which need converting or a clear refusal.

Tests: `web/src/lib/question-content/**/*.test.ts`. Run
`npx vitest run src/lib/question-content` from `web/`. To see what the reader finds in a
folder of your own `.docx` files, counts only:
`AXOM_DOCX=/path npx vitest run src/lib/question-content/docx/inspect.local.test.ts`.
To build the real banks from their PDFs (needs poppler's `pdftocairo` for the pictures),
and then to take them through the canonical import in memory, counts only:
`AXOM_QBANK_SOURCES=/folder/with/the/pdfs npx vitest run src/lib/question-content/pdf/buildBank.local.test.ts`
and `AXOM_QBANK_PERSIST=1 npx vitest run src/lib/question-content/pdf/persistBank.local.test.ts`.
The committed proof of save, reload and no duplicates runs on the invented bank:
`toReviewedImport.persistence.test.ts`.
