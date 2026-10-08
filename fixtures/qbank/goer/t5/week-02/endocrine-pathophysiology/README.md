# GOER, Week 2: Endocrine Pathophysiology

Term 5, GOER, Week 2. The week is how AXOM files this bank; the source does not
state it (`sourceWeekDeclared: false` in the manifest).

- **Source, local only:** `source/PRACTICE+QUE_PATHOPHYS-ENDOCRINOLOGY.pdf`
- **Bank id:** `goer-t5-w2-endocrine-pathophysiology`
- **Committed here:** `manifest.json` and this file. See
  [the fixtures README](../../../../README.md).

## What this bank must prove

The strongest mixed-content set: lab tables, imaging, histology, a diagram the
question depends on, and answer choices set out as a table.

| Source question | Case |
| --- | --- |
| 5 | Thyroid radionuclide image |
| 7 | Lab table in the stem, and the answer choices as a table of hormone patterns |
| 8 | Large lab table |
| 9 | Text, thyroid lab table, text, histology picture, prompt: the order must survive import |
| 10 | Prolactin, LH, FSH and estradiol table |
| 11 | Glucose, insulin and C-peptide table |
| 17 | Visual-field diagram. The question cannot be answered without it, so a missing picture stops that question from running |

## Measured shape of the source (counts only)

Word document saved as PDF, 10 pages, 3 embedded pictures (674 x 340, 500 x 375
and 168 x 203 pixels). The smallest is too small to enlarge well; it is kept at
its own size and never scaled up or cropped. Every table is text laid out in
the page.

## Status

Phase 1: the manifest validates. `questions.json` and `assets/` are built
locally in Phase 5.
