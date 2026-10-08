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

1. Put the source PDF in the bank's `source/` folder.
2. Build `questions.json` and `assets/` (Phase 5 of the plan in the feature doc).
3. Run `npx vitest run src/lib/question-content/fixtures.test.ts` from `web/`.

The pictures of the invented bank and the DOCX template are produced by
`node scripts/qbank/build-fixtures.mjs`.
