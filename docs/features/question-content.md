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

**Status (2026-10-08):** Phase 1 of five is built on `feat/qbank-multimodal-import-v1`:
the model, the package, its checks, the marker grammar, the template and an invented
regression bank. Nothing in the app uses it yet. Phases are at the end of this note.

| Responsibility | Files |
| --- | --- |
| Blocks, rich text rule, plain-text reading | `web/src/lib/question-content/blocks.ts` |
| Which image may be shown when | `web/src/lib/question-content/visibility.ts` |
| Package types, flags, issues, filing | `web/src/lib/question-content/package.ts` |
| Reading, version gate, canonical writing | `web/src/lib/question-content/packageJson.ts` |
| Checks and the preview's counts | `web/src/lib/question-content/validate.ts` |
| The strings older code reads | `web/src/lib/question-content/legacyFields.ts` |
| DOCX markers and the marked-body reader | `web/src/lib/question-content/docx/` |
| Fixtures and what may be committed | [`fixtures/qbank/`](../../fixtures/qbank/README.md) |
| Template and its builder | `docs/templates/AXOM_QBANK_IMPORT_TEMPLATE.docx`, `scripts/qbank/build-fixtures.mjs` |

Parent contract: [questions](questions.md). Filing by module and week:
[course engine](course-engine.md). Import scope and the image and table rules this
implements: [import engine specification](../UNIVERSAL-QUESTION-IMPORT-ENGINE.md), section 15.
Storage and schema: [data model](../architecture/data-model.md).

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

`parseMarkedBody` reads a neutral stream (`DocxBodyElement`: paragraph, table, image, in
document order). Producing that stream from `word/document.xml` is Phase 2.

## What is private

The repository is public. Faculty questions, answer keys, explanations and pictures from
course files are never committed. `fixtures/qbank/.gitignore` enforces it and a test asks
git that it does. Committed tests run on an invented bank whose eight questions are shape
twins of the hard cases. A real bank is built and checked on the owner's machine, and the
check prints counts only.

## Phases

| Phase | Scope | State |
| --- | --- | --- |
| 1 | Model, package, checks, markers, template, fixtures, tests | Built. One decision is JD's: `supportingAssetVisible` in `visibility.ts` |
| 2 | Read a `.docx` body in document order: paragraphs, tables, pictures, sub and superscripts, merged cells, lettered lists | Open. `jszip` is a dev dependency today; a runtime reader needs a `package.json` intent |
| 3 | Import preview: counts, issues, rendered questions, media badges, moving a picture to the right place | Open. Lands in `ImportPanel` and `MassImport` |
| 4 | `content` on `QuestionRecord`; one block renderer under every exam interface; wider attachment roles; image enlarge, zoom, pan; deletion, backup and restore of the pictures | Open. Edits `questions.ts`, `questionAttachments.ts`, `ExamRunner.tsx`: intent posts first |
| 5 | Build the three Term 5 GOER Week 2 banks locally and run them as the real regression set | Open |

Known limits to carry forward: annotations store positions in the plain stem, so
highlights on block text need a mapping in Phase 4. Picture bytes are stored on the
device; account sync carries the question, its blocks and the asset records, not the
bytes ([data model](../architecture/data-model.md)). Attachments are limited to PNG,
JPEG, WebP and GIF, ten per question, 8 MB each; a Word file may hold EMF or WMF
pictures, which need converting or a clear refusal.

Tests: `web/src/lib/question-content/*.test.ts` and `docx/parseMarkedBody.test.ts`. Run
`npx vitest run src/lib/question-content` from `web/`.
