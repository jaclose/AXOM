# Ideas 7: multimodal question bank import (Term 5, GOER, Week 2)

Received 2026-10-08, 08:10. A master development prompt written by JD's prompt engine and pasted whole, with three practice-question PDFs (kept on JD's machine, never committed). JD's own words with it: "Work with Codex on what has already been done - communicate with each other to make sure this is done properly - good context hygiene and obisidian usage and update". Never edit the quoted text; index entries live in INDEX.md as `I7-nn`.

One redaction, marked in place: the example table under "TABLE HANDLING" carried the cell values of a faculty question. The repository is public, so the numbers are replaced and the headings kept.

````text
Use this as the **master development prompt** for Codex/Claude. It establishes the Term 5 → GOER → Week 2 hierarchy, defines the import contract, and uses these three PDFs as the first real multimodal regression set.

The important distinction is that **Week 2 is AXOM organizational metadata supplied by us**, not something all three PDFs explicitly claim. The pharmacology source itself identifies as *PCM2 GOER Module Pharmacology, Fall Term 2026*. :chatgpt-content-reference{index="0"} The biostats source identifies itself as a Biostatistics & Epidemiology DLA practice set. :chatgpt-content-reference{index="1"} The endocrine source identifies itself as Pathophysiology Practice Questions: Endocrinology. :chatgpt-content-reference{index="2"}

```text
AXOM — BUILD MULTIMODAL QBANK IMPORT V1
Term 5 → GOER → Week 2

OBJECTIVE

Build the first production-quality AXOM QBank import template and importer capable of handling:

- normal question text
- answer choices
- answer keys
- explanations
- native tables
- images
- graphs
- histology
- diagnostic imaging
- visual-field diagrams
- tables inside stems
- tables representing answer choices
- multiple media elements in one question
- duplicate “question” and “answer reveal” slides
- preservation of source provenance
- ordered placement of text / tables / images exactly where they belong

This is NOT RHPS.

Create this as a new Term 5 GOER dataset and do not modify or reinterpret any RHPS-specific content or schemas unless a shared generic QBank primitive is appropriate.

==================================================
COURSE HIERARCHY
==================================================

AXOM Course:
Term 5

Module / Course:
GOER

Week:
Week 2

IMPORTANT:
“Week 2” is AXOM organizational metadata supplied by the user.
Do not claim that every PDF explicitly identifies itself as Week 2.

Create three independent question banks:

1. GOER — Week 2 — Biostatistics & Epidemiology

Source:
Biostats+and+Epidemiology+PQ.pdf

Discipline:
Biostatistics / Epidemiology

2. GOER — Week 2 — Pharmacodynamics, Pharmacokinetics & Clinical Pharmacokinetics

Source:
Pharmacodynamics%2C+Pharmacokinetics+and+Clinical+Pharmacokinetics+PQ.pdf

Discipline:
Pharmacology

Source metadata explicitly includes:
PCM2 GOER Module Pharmacology
Fall Term 2026

3. GOER — Week 2 — Endocrine Pathophysiology

Source:
PRACTICE+QUE_PATHOPHYS-ENDOCRINOLOGY.pdf

Discipline:
Pathophysiology

Topic:
Endocrinology

DO NOT merge the three source banks into one question bank.

They should be separate banks under:

Term 5
└── GOER
    └── Week 2
        ├── Biostatistics & Epidemiology
        ├── Pharmacodynamics / Pharmacokinetics
        └── Endocrine Pathophysiology


==================================================
CORE ARCHITECTURAL RULE
==================================================

DO NOT model a question as:

questionText: string
imageUrl?: string

That model is too weak.

A question must be composed of ORDERED CONTENT BLOCKS.

Images, tables, equations, text, callouts, and other media are part of the question structure.

Recommended architecture:

type QuestionBlock =
  | TextBlock
  | RichTextBlock
  | ImageBlock
  | TableBlock
  | EquationBlock
  | DividerBlock
  | CalloutBlock;

interface Question {
  id: string;

  course: "GOER";
  term: 5;
  week: 2;

  bankId: string;
  discipline: string;
  topic?: string;
  subtopic?: string;

  source: SourceMetadata;

  stem: QuestionBlock[];

  choices: QuestionChoice[];

  correctAnswer?: AnswerKey;

  explanation?: QuestionBlock[];

  assets: QuestionAsset[];

  flags?: QuestionFlag[];

  provenance: ProvenanceMetadata;
}

interface QuestionChoice {
  id: string;
  label: string;

  // IMPORTANT:
  // choices may themselves contain tables/images/rich content
  blocks: QuestionBlock[];
}

==================================================
BLOCK TYPES
==================================================

TextBlock

{
  type: "text",
  text: string
}

RichTextBlock

{
  type: "rich_text",
  html: string
}

ImageBlock

{
  type: "image",
  assetId: string,
  alt?: string,
  caption?: string,
  role?: AssetRole
}

TableBlock

{
  type: "table",
  headers?: string[],
  rows: string[][],
  caption?: string,
  sourceImageAssetId?: string
}

EquationBlock

{
  type: "equation",
  latex?: string,
  plainText?: string
}

==================================================
ASSET ROLES
==================================================

Implement:

type AssetRole =
  | "question"
  | "stem"
  | "choice"
  | "explanation"
  | "answer_reveal"
  | "reference"
  | "source_page";

This distinction is critical.

Example:

The pharmacology source often has:

Page N:
clean question

Page N+1:
same question with answer highlighted

The clean image should be used during question-taking.

The highlighted version must NOT be exposed during question-taking.

It may be stored as:

role: "answer_reveal"

and only displayed during review/explanation mode if desired.


==================================================
SOURCE PRESERVATION RULE
==================================================

Do not silently rewrite faculty questions.

Preserve:

- wording
- units
- capitalization when meaningful
- answer choices
- tables
- graphs
- supplied answers
- supplied explanations

If the source appears inconsistent or incorrect:

DO NOT silently repair it.

Instead attach:

flags: [
  {
    type: "source_inconsistency",
    message: "..."
  }
]

We can add a separate “AXOM note” later.

Source fidelity is more important than normalization.


==================================================
MULTIMODAL IMPORT REQUIREMENTS
==================================================

The importer must preserve block order.

Example source:

clinical vignette text

LAB TABLE

more question text

IMAGE

question prompt

choices

must become:

stem: [
  TextBlock,
  TableBlock,
  TextBlock,
  ImageBlock,
  TextBlock
]

NOT:

stemText
imageAttachments[]
tableAttachments[]

because attachments lose semantic position.


==================================================
TABLE HANDLING
==================================================

Prefer structured tables over screenshots whenever the source is clearly tabular.

Example:

{
  "type": "table",
  "headers": [
    "Estrogen Therapy",
    "Breast Cancer Present",
    "Breast Cancer Absent",
    "Total"
  ],
  "rows": [
    ["YES", "[redacted]", "[redacted]", "[redacted]"],
    ["NO", "[redacted]", "[redacted]", "[redacted]"],
    ["TOTAL", "[redacted]", "[redacted]", "[redacted]"]
  ]
}

However:

retain the original source table image when possible:

sourceImageAssetId

This gives us:

1. accessible structured data
2. responsive rendering
3. searchable values
4. original-source provenance
5. ability to compare parser reconstruction against source


==================================================
CHOICE TABLE SUPPORT
==================================================

Do NOT assume choices are strings.

Some questions encode each answer as a row of laboratory arrows / values.

Example conceptual structure:

choices: [
  {
    label: "A",
    blocks: [
      {
        type: "table",
        ...
      }
    ]
  }
]

or use one shared table with answer rows A-E if that better preserves the source.

Renderer must support both.


==================================================
IMAGE HANDLING
==================================================

Images should be extracted as separate assets where feasible.

Do not unnecessarily store entire PDF pages when only a graph, scan, histology image, or diagram is required.

Each asset should contain metadata:

{
  id,
  filename,
  mimeType,
  width,
  height,
  sourceFile,
  sourcePage,
  role,
  questionId,
  checksum?
}

Images should remain linked to their questions after:

- import
- save
- reload
- account sync
- export
- re-import


==================================================
FIRST THREE TEST BANKS
==================================================

BANK 1
GOER W2 — BIOSTATISTICS & EPIDEMIOLOGY

Must test:

- plain text questions
- 2×2 contingency tables
- epidemiologic data tables
- answer explanations
- formula-oriented questions
- normal distribution questions

Important multimodal/table cases include:

- toxic waste / tumor contingency table
- estrogen therapy / breast cancer table
- specialist nurse / death-readmission table

Convert these to real TableBlocks.


==================================================
BANK 2
GOER W2 — PHARMACODYNAMICS / PHARMACOKINETICS

This bank is a key media-import regression suite.

Important cases include:

Q4
plasma concentration-time curves

Q7
log plasma concentration-time graph

Q10
dose-response curves
potency vs efficacy

Q11
time-after-infusion / plasma-concentration table

Q15
constant-infusion plasma concentration graph

The importer must correctly detect:

clean question slide

versus

duplicate answer-highlighted slide

Do not accidentally expose highlighted answers during question mode.


==================================================
BANK 3
GOER W2 — ENDOCRINE PATHOPHYSIOLOGY

This is the strongest multimodal test bank.

Must support:

- laboratory tables
- radionuclide thyroid imaging
- histology
- visual-field diagrams
- endocrine laboratory patterns
- answer-choice tables

Important cases:

Q5
thyroid radionuclide image

Q7
CAH laboratory table
+
answer-choice hormone-pattern table

Q8
large laboratory table

Q9
thyroid lab table
+
histology image

Q10
prolactin/LH/FSH/estradiol table

Q11
glucose/insulin/C-peptide table

Q17
visual-field diagram

The visual-field diagram is required to answer Q17.
It cannot be treated as optional decoration.


==================================================
IMPORT PACKAGE FORMAT
==================================================

Create three independent development fixtures:

fixtures/qbank/goer/t5/week-02/

  biostats-epidemiology/
    source/
    assets/
    questions.json
    manifest.json
    questions.docx
    README.md

  pharmacodynamics-pk/
    source/
    assets/
    questions.json
    manifest.json
    questions.docx
    README.md

  endocrine-pathophysiology/
    source/
    assets/
    questions.json
    manifest.json
    questions.docx
    README.md


==================================================
MANIFEST FORMAT
==================================================

Example:

{
  "schemaVersion": 1,

  "course": {
    "name": "GOER",
    "term": 5,
    "week": 2
  },

  "bank": {
    "id": "goer-t5-w2-pharmacodynamics-pk",
    "title": "Pharmacodynamics, Pharmacokinetics & Clinical Pharmacokinetics",
    "discipline": "Pharmacology"
  },

  "source": {
    "filename": "...pdf",
    "institution": "St. George's University",
    "sourceWeekDeclared": false,
    "axomAssignedWeek": 2
  },

  "questionsFile": "questions.json",
  "assetsDirectory": "assets/"
}


==================================================
DOCX IMPORT TEMPLATE
==================================================

We also need a human-editable DOCX template.

Create:

docs/templates/AXOM_QBANK_IMPORT_TEMPLATE.docx

The document should demonstrate:

QUESTION

[AXOM META]
Course: GOER
Term: 5
Week: 2
Bank:
Discipline:
Topic:
Source:

[STEM]

plain stem text

[TABLE]

actual Word table

[IMAGE]

actual embedded image

[STEM CONTINUED]

question prompt

[CHOICES]

A.
B.
C.
D.
E.

Choices should support rich content.

[ANSWER]

[EXPLANATION]

[SOURCE]

[FLAGS]

[END QUESTION]


Do not rely only on visual styling.

Use deterministic markers so AXOM can parse the file.


==================================================
DOCX PARSER
==================================================

Implement parsing for:

[AXOM META]
[STEM]
[TABLE]
[IMAGE]
[CHOICES]
[ANSWER]
[EXPLANATION]
[SOURCE]
[FLAGS]
[END QUESTION]

Word tables inside sections should become TableBlocks.

Embedded Word images should become ImageBlocks.

Preserve the order in which paragraphs, tables, and images occur.

This likely requires walking DOCX XML/body elements in document order rather than relying solely on paragraph collections.


==================================================
IMPORT WORKFLOW
==================================================

Target user workflow:

QBank
→ Import
→ AXOM Document / DOCX
→ Select file

AXOM parses file

then shows:

IMPORT PREVIEW

Detected:
17 questions
3 images
7 tables
5 explanations
17 answer keys

Issues:
1 image association uncertain
0 missing answer keys
2 source consistency warnings

Then allow:

Review questions
Edit
Reassign media
Confirm import


==================================================
PREVIEW UI
==================================================

For every imported question show a faithful rendered preview:

Question 09

[stem]

[table]

[histology image]

A...
B...
C...
D...
E...

Media badges:

IMAGE ×1
TABLE ×1

Source:
Endocrine Pathophysiology PDF
Page 5

Warnings should be visible but non-blocking unless parsing is impossible.


==================================================
MEDIA REASSIGNMENT
==================================================

Add a lightweight import correction UI.

If parser is uncertain:

“Where does this image belong?”

Question 8
Question 9
Explanation
Ignore

This is preferable to silently guessing.


==================================================
QUESTION RENDERER
==================================================

Refactor renderer if necessary so the same QuestionBlock[] structure powers:

- AXOM native mode
- NBME-style mode
- UWorld-style mode
- AMBOSS-style mode
- ExamSoft-style mode

The content model should remain identical.

Only presentation changes.


==================================================
RESPONSIVE TABLES
==================================================

On desktop:
render normal table.

On small screens:
allow horizontal scrolling.

Never truncate medically relevant values.

Support:

↑
↓
↔
±
Greek letters
subscripts
superscripts
mg/dL
mEq/L
mOsm/kg
μ
β
etc.


==================================================
IMAGE UX
==================================================

Question images should support:

click/tap → enlarge

zoom

pan when necessary

reset zoom

preserve aspect ratio

No destructive cropping.

Histology and diagnostic images require sufficient resolution.


==================================================
DATABASE / STORAGE
==================================================

Do not store large image binaries directly in question JSON.

Question JSON stores asset references.

Actual files use existing AXOM media/storage infrastructure.

Ensure:

question deletion
bank deletion
account sync
backup/export
restore

properly handle media lifecycle.


==================================================
IMPORT VERSIONING
==================================================

Add:

schemaVersion

to every import package.

Start with:

schemaVersion: 1

Future migrations must remain possible.


==================================================
TESTING
==================================================

Create regression tests using these exact three banks.

Required test classes:

1. plain text question
2. stem + table
3. stem + image
4. stem + table + image
5. graphical question
6. table-based answer choices
7. duplicate answer-reveal slide
8. explanation text
9. missing explanation
10. multiple images
11. media placement order
12. export → reimport fidelity


==================================================
CRITICAL REGRESSION TESTS
==================================================

TEST A

Endocrine Q9

Expected logical structure:

TextBlock
TableBlock
TextBlock
ImageBlock
TextBlock / prompt
choices

Verify ordering survives import.


TEST B

Endocrine Q17

Question must contain visual-field image.

Import should fail/warn if the image is absent.


TEST C

Pharmacology Q10

Use clean dose-response graph in question mode.

Do NOT display answer-highlighted duplicate until review.


TEST D

Pharmacology Q11

Represent infusion values as structured TableBlock.

Do not reduce table to plain unformatted text.


TEST E

Biostats contingency-table question

Correctly construct rows/columns and preserve values.


==================================================
SOURCE QUALITY FLAGS
==================================================

Add non-destructive flags.

Examples:

SOURCE_INCONSISTENCY
MISSING_EXPLANATION
POSSIBLE_DUPLICATE
ANSWER_REVEAL_ASSET
MEDIA_ASSOCIATION_UNCERTAIN
TABLE_PARSE_UNCERTAIN
MISSING_REQUIRED_MEDIA

Never silently modify faculty material.


==================================================
DO NOT DO
==================================================

Do not:

- call this RHPS
- merge all three PDFs into one bank
- convert all tables into screenshots
- convert all images into page screenshots
- flatten question content to HTML if structured blocks are possible
- make imageUrl a single field on Question
- assume choices are plain strings
- silently fix source questions
- expose answer-highlighted media during question mode
- hard-code this importer only for these three PDFs
- preload the entire application/repository unnecessarily


==================================================
DEVELOPMENT PROCESS
==================================================

Use AXOM context-hygiene rules.

Search → locate → targeted read → implement.

Do not preload large repository histories.

First locate:

existing QBank schema
existing import pipeline
existing media asset service
existing course/week model
existing question renderer
existing account sync/storage types

Reuse existing primitives where sound.

Do not create duplicate architectures.

Keep changes focused.

Use a dedicated branch/worktree.

Suggested branch:

feat/qbank-multimodal-import-v1


==================================================
PHASE 1
==================================================

Build only:

- schema/types
- import manifest
- block model
- asset roles
- fixtures directory
- DOCX specification/template
- parser skeleton
- tests for serialization

Do not redesign QBank UI yet.


==================================================
PHASE 2
==================================================

Implement DOCX parsing:

- paragraphs
- headings/markers
- Word tables
- embedded images
- ordering
- choices
- answer
- explanation
- metadata


==================================================
PHASE 3
==================================================

Build import preview and correction interface.


==================================================
PHASE 4
==================================================

Integrate block renderer into AXOM question-taking modes.


==================================================
PHASE 5
==================================================

Import the three GOER Week 2 banks and use them as real regression fixtures.


==================================================
ACCEPTANCE CRITERIA
==================================================

Feature is complete only when:

1. The three source PDFs result in three separate AXOM banks.

2. They appear under:

Term 5
GOER
Week 2

3. Questions preserve source wording.

4. Native tables remain tables.

5. Required images remain attached to the correct question.

6. Images render at sufficient quality.

7. Q17 visual-field question is answerable.

8. Histology renders correctly.

9. Pharmacology graphs render correctly.

10. Answer-highlighted duplicate slides are not exposed during question mode.

11. Choices can contain rich blocks.

12. Import preview identifies detected media.

13. Media can be manually reassigned when ambiguous.

14. Export → re-import produces equivalent question structure.

15. Account sync preserves media associations.

16. Existing text-only QBank questions continue to work.

17. Existing QBank modes do not regress.

18. Tests pass.

19. No RHPS-specific assumptions leak into this feature.

20. Implementation is generic enough that the next SGU PDF/DOCX bank can use the same pipeline without writing a custom parser.


==================================================
FIRST RESPONSE / CHECKPOINT
==================================================

Before implementing broadly:

1. inspect the existing AXOM QBank/import/media architecture
2. report the minimal files that need modification
3. propose final QuestionBlock / Question / Asset types
4. identify anything already present that should be reused
5. identify migration risks
6. create the Phase 1 implementation plan
7. then begin Phase 1

Do not start a broad refactor until this checkpoint is complete.
```

I would start with **Phase 1 only** in the first worker. The three banks deliberately cover different parser stress cases: biostatistics has structured contingency/data tables, pharmacology has graph-heavy questions and duplicated answer-reveal slides, and endocrinology combines lab tables with thyroid imaging, histology, and a required visual-field diagram. :chatgpt-content-reference{index="3"} :chatgpt-content-reference{index="4"} :chatgpt-content-reference{index="5"} :chatgpt-content-reference{index="6"}

Once Phase 1 lands, the next worker should handle **DOCX body-order parsing specifically**. That is the part most likely to fail if AXOM naïvely reads Word paragraphs separately from tables and images.
````
