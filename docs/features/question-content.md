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
an adapter from the existing PDF import. Nothing in the app calls them yet: wiring is
Codex's (decision 4 below). Phases are at the end of this note.

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

**Formatting that could give the answer away is never imported.** Bold, highlight or
colour on one whole choice, and a tick beside a choice, are left out of the question, are
not used as the key, and are reported as a possible answer marking.

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
Tables in a PDF still arrive as text: rebuilding them from positions is not done.

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
| 2 | Read a `.docx` body in document order; convert to the package; adapter from the existing PDF import | Built. One choice is JD's: `isPossibleAnswerMark` in `docx/parseMarkedBody.ts` |
| 3 | Import preview: counts, issues, rendered questions, media badges, moving a picture to the right place | Open. Codex wires it into `ImportPanel` and `MassImport`; `summarizePackage`, `validatePackage` and `unplaced` are its inputs |
| 4 | `content` on `QuestionRecord`; one block renderer under every exam interface; wider attachment roles; image enlarge, zoom, pan; deletion, backup and restore of the pictures | Open. Edits `questions.ts`, `questionAttachments.ts`, `ExamRunner.tsx`: Codex's files |
| 5 | Build the three Term 5 GOER Week 2 banks locally and run them as the real regression set | Open. The sources are PDFs: tables must be rebuilt from page positions first, or the banks typed into the template |

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
