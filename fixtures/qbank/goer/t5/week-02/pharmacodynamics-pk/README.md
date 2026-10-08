# GOER, Week 2: Pharmacodynamics, Pharmacokinetics & Clinical Pharmacokinetics

Term 5, GOER, Week 2. The source calls itself "PCM2 GOER Module Pharmacology",
"Fall Term 2026". It does not state a week; AXOM assigns Week 2
(`sourceWeekDeclared: false` in the manifest).

- **Source, local only:** `source/Pharmacodynamics%2C+Pharmacokinetics+and+Clinical+Pharmacokinetics+PQ.pdf`
- **Bank id:** `goer-t5-w2-pharmacodynamics-pk`
- **Committed here:** `manifest.json` and this file. See
  [the fixtures README](../../../../README.md).

## What this bank must prove

This is the picture and answer-reveal regression set.

| Source question | Case |
| --- | --- |
| 4 | Plasma concentration against time curves |
| 7 | Log plasma concentration against time graph |
| 10 | Dose-response curves, potency against efficacy. The clean graph in question mode; the answer-marked copy only in review |
| 11 | Time after infusion and plasma concentration as a real table, not flattened text |
| 15 | Constant infusion plasma concentration graph |

Every question slide is followed by a copy with the answer marked. The copy is
stored with the role `answer_reveal` and is never shown while a question is open.

## Measured shape of the source (counts only)

Slide deck saved as PDF, 41 pages. Fifteen pairs of consecutive pages carry
identical text (same character and line counts), so **the answer mark is not
in the text**: a clean slide and its marked copy can only be told apart by how
they look. Three graphs are embedded pictures, each present on both pages of
its pair at the same size. The other graphs are drawn as shapes in the slide,
so there is no picture to lift out: they are rendered from a region of the page
(`derivation: "region-render"` with `bounds`).

## Status

Phase 1: the manifest validates. `questions.json` and `assets/` are built
locally in Phase 5.
