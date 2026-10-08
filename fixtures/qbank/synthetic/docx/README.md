# Word files written by real producers

Invented content only. These exist so the `.docx` reader is tested on what Word, pandoc
and a lossy converter actually write, not only on files AXOM builds itself.

| File | Written by | What it proves |
| --- | --- | --- |
| `word-saved-template.docx` | Microsoft Word: the import template opened and saved | Word's own XML reads to the same questions as the template AXOM builds |
| `pandoc-marked.docx` | pandoc, from `src/marked.md` | Word's automatic lettering, sub and superscripts, merged cells, heading rows, equations, captions, an answer-marked picture, one bold choice |
| `pandoc-unmarked.docx` | pandoc, from `src/unmarked.md` | A document with no markers goes through the text parser with its table and picture in place |
| `flattened-by-converter.docx` | macOS `textutil`, from the template | A converter that flattens tables and drops pictures is caught by the `[TABLE]` and `[IMAGE]` markers |

Rebuild the pandoc files with:

```
pandoc src/marked.md --resource-path=src -o pandoc-marked.docx
pandoc src/unmarked.md --resource-path=src -o pandoc-unmarked.docx
```

A file saved by Word carries the name of whoever saved it in `docProps/core.xml`. Blank
that field before committing one.
