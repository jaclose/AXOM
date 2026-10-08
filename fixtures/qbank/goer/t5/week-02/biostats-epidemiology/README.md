# GOER, Week 2: Biostatistics & Epidemiology

Term 5, GOER, Week 2. The week is how AXOM files this bank; the source does not
state it (`sourceWeekDeclared: false` in the manifest).

- **Source, local only:** `source/Biostats+and+Epidemiology+PQ.pdf`
- **Bank id:** `goer-t5-w2-biostats-epidemiology`
- **Committed here:** `manifest.json` and this file. The questions, the answer
  key and the PDF stay on the machine that builds them. See
  [the fixtures README](../../../../README.md).

## What this bank must prove

- Plain text questions, formula questions, normal distribution questions.
- Answer explanations carried over word for word.
- Tables rebuilt as real tables with their rows, columns and totals:
  the toxic waste and tumour table, the estrogen therapy and breast cancer
  table, the specialist nurse and death or readmission table.

## Measured shape of the source (counts only)

Word document saved as PDF, 8 pages, no embedded pictures. Every table is text
laid out in the page, so the rows and columns are rebuilt from text positions
and each one is checked against the page.

## Status

Phase 1: the manifest validates. `questions.json` is built locally in Phase 5.
