# Invented multimodal shapes

Eight made-up questions, each a shape twin of a hard case in a real bank. They
test structure, not medicine: nothing here is course material, and none of it
is meant to be studied from.

| Question | Shape | Stands in for |
| --- | --- | --- |
| `syn-q01` | Text only | A plain question |
| `syn-q02` | Text, 2x2 table with row names and totals, prompt; equation in the explanation | A contingency table question |
| `syn-q03` | Text, graph, prompt; a second copy of the graph with the answer marked | A slide and its answer-highlighted duplicate |
| `syn-q04` | Text, lab table, text, picture, prompt | A lab table plus a histology picture |
| `syn-q05` | Choices are rows of one shared table of arrows | A hormone-pattern answer table |
| `syn-q06` | Each choice is a small table; subscripts and superscripts in the stem | Answer choices that are tables |
| `syn-q07` | Two pictures the question cannot be answered without; no explanation | A visual-field diagram question |
| `syn-q08` | Time and level table; a flag about the source | An infusion table question |

`questions.json` is kept in the exact form AXOM writes. After editing it by
hand, rewrite it with:

```
cd web && AXOM_WRITE_FIXTURES=1 npx vitest run src/lib/question-content/fixtures.test.ts
```

The pictures come from `node scripts/qbank/build-fixtures.mjs`, which prints the
checksums to copy into `questions.json`.
