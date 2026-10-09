# Question bank fixtures

Import packages used to build and test AXOM's block question content. The format
is described in [question content](../../docs/features/question-content.md).

## What is committed and what is not

This repository is public. A faculty question, its answer key, its explanation
and any picture taken from a course file are private course material.

| Folder | Committed | Stays on your machine |
| --- | --- | --- |
| `synthetic/` | Everything. Every question and picture is invented. | Nothing. |
| `goer/` and any other real course | `manifest.json`, `README.md`, the empty `source/` and `assets/` folders | `source/*` (the PDF), `assets/*` (pictures from it), `questions.json`, `questions.docx` |

The `.gitignore` in this folder enforces the table. Do not weaken it, and do
not force-add an ignored file. A test in `web/src/lib/question-content/` fails
if the rules are removed.

## How the tests use them

- The committed tests run on `synthetic/multimodal-shapes/`. Its eight
  questions are shape twins of the hard cases in the real banks: text only, a
  2x2 table, a graph with an answer-marked copy, text + table + text + picture +
  text, answer choices as one shared table, answer choices as a table each,
  two pictures with no explanation, and a time and level table.
- The three `goer/t5/week-02/` manifests are checked on every run.
- When a real `questions.json` has been built locally, the same test file
  validates it and prints counts only. On a machine without it, that part is
  skipped.

## Building a real bank locally

From `web/`. Each step prints counts only: no stem, no choice, no answer letter.

1. Put the source PDF in the bank's `source/` folder, or keep the PDFs together in a
   folder of your own outside the repository. The file name must be the one the
   manifest gives. The PDF must be a tagged export (Word or PowerPoint: "Save as PDF").
2. Build `questions.json` and `assets/` beside each manifest. The pictures are cut from
   the pages with poppler's `pdftocairo`:
   `AXOM_QBANK_SOURCES=/folder/with/the/pdfs npx vitest run src/lib/question-content/pdf/buildBank.local.test.ts`
3. Check the built packages: `npx vitest run src/lib/question-content/fixtures.test.ts`
4. Take each bank through the app's own import and save, in memory, then reload and
   import it again: `AXOM_QBANK_PERSIST=1 npx vitest run src/lib/question-content/pdf/persistBank.local.test.ts`
5. Do the same in a real browser, from the PDF itself, on the harness page. Start the dev
   server on a port of its own (`npm run dev -- --host 127.0.0.1 --port 5197 --strictPort`), then:
   `AXOM_QBANK_SOURCES=/folder/with/the/pdfs AXOM_E2E_BASE_URL=http://127.0.0.1:5197 npx playwright test e2e/goer-pdf-import.local.spec.ts --output=/a/folder/outside/the/repository`
   Delete that output folder afterwards. The test runs in a browser profile of its own, so
   it never touches a real workspace.

The pictures of the invented bank and the DOCX template are produced by
`node scripts/qbank/build-fixtures.mjs`.
