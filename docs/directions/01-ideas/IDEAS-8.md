# Ideas 8: the interactive academic bookshelf

Received 2026-10-08, 09:25. Written by JD's prompt engine and pasted whole. JD's own words after it: "also continue working on previous prompts - esepcially the GOER one we enacted previous ot this prompt - work on them synonymously". Never edit the quoted text; index entries live in INDEX.md as `I8-nn`.

````text
## AXOM — Interactive Academic Bookshelf

This should become a signature AXOM interface, not another conventional file browser.

**Claude can build the bookshelf now, before Codex returns at 1 PM.** The important boundary is that Claude develops the reusable bookshelf, animation, library logic, and persistence tests on its own branch. Codex will later connect those components to the shared Course Tracker and QBank screens.

### The experience

Imagine opening **Load Course Template** and seeing a dark, premium academic library:

- **Physical books labeled ER, DM, GOER, etc.**, generated from actual available course data.
- **Book thickness reflects the amount of content** in that course or question bank.
- **Hover:** The book subtly lifts, tilts, and catches the light.
- **Click:** The book slides off the shelf, rotates toward you, and opens.
- **Inside:** You see the course's modules, weeks, lectures, or question banks.
- **Load:** Confirming opens that content in Course Tracker or QBank.

There should be two experiences powered by one reusable bookshelf component:

| Course Template Library | Question Bank Library |
|---|---|
| Books represent courses/templates | Books represent course question collections |
| Thickness reflects activity/content volume | Thickness reflects question count |
| Opens modules, weeks, lectures, SGs, IMCQs, etc. | Opens question banks, sets, figures, and review status |
| Action: **Load Course** | Action: **Open Bank / Practice** |

Importantly, these must be real interactive books connected to persistent data, not decorative 3D objects.

## Send this to Claude now

```text
# AXOM — CINEMATIC ACADEMIC BOOKSHELF
# Course Template Library + QBank Library

PRIORITY: WORKING PRODUCT IMPLEMENTATION

Build a premium, animated, interactive academic bookshelf
for AXOM's Course Tracker and Question Bank.

This is not a concept document or static mockup.

I want an actual component, connected to real available
content, with functional selection, preview, loading,
and reliable save/reload behavior.

==================================================
1. EXISTING DEVELOPMENT CONTEXT
==================================================

You already own:

feat/qbank-multimodal-import-v1

Phase 1 was committed at:
c25718d

That branch contains:

- structured question content blocks
- question package format
- asset visibility foundations
- DOCX template
- GOER Week 2 manifests
- import validation
- provenance structures

Continue from the actual current branch state.

Do not recreate existing work or discard ongoing edits.

Codex owns:

feat/course-qbank-intelligence-v2

It is developing the main Course/QBank UI and currently
has uncommitted changes in shared components.

Do NOT edit Codex's worktree.

Do NOT overwrite its UI files.

Build the new bookshelf as reusable, independently
testable components with clean integration interfaces.

Codex will connect them to the shared app surfaces
after its session resumes.

==================================================
2. CORE PRODUCT EXPERIENCE
==================================================

AXOM should have TWO libraries:

A. COURSE TEMPLATE LIBRARY

Opened through:

Course Tracker → Load Course Template

B. QUESTION BANK LIBRARY

Opened through:

Question Bank → Browse / Recover Questions

Both should use ONE reusable bookshelf design system,
with different content adapters and actions.

The experience should feel like opening a private,
futuristic academic library.

NOT a conventional file manager.

NOT a grid of generic cards.

NOT a wall of pills.

==================================================
3. PHYSICAL BOOKSHELF DESIGN
==================================================

Create a convincing physical bookshelf using
modern web rendering and animation.

Visual direction:

- dark graphite / obsidian environment
- restrained warm-gold AXOM accents
- realistic shelf depth and subtle ambient shadows
- softly illuminated book spines
- high-quality cover typography
- elegant academic detailing
- subtle material texture
- restrained glass and metallic elements
- premium lighting and depth
- polished cinematic transitions

Use AXOM's established design language.

Refer to:

docs/design/DESIGN.md

Use existing Motion/React/CSS tooling where appropriate.

Search installed design, animation, 3D-interface,
and accessibility skills by keyword.

Invoke relevant skills when they materially improve
the implementation.

Do not load the full skill library.

Do not introduce a heavy WebGL/Three.js engine unless
there is a demonstrated need.

CSS 3D transforms and Motion animations are preferable
if they provide the required result efficiently.

==================================================
4. BOOKS REPRESENT ACTUAL COURSES
==================================================

Books should be generated from available data.

Examples of course/module labels:

ER
DM
GOER

Discover the actual full course names and hierarchy
from existing metadata. Do not invent expansions.

Each available course becomes a book.

A book spine should show:

- course/module title
- appropriate academic identifier
- term
- subtle AXOM visual identity

Differentiate books using a coherent visual palette,
not random colors.

If a course has multiple modules, allow its opened
book to reveal them.

Books must be connected to actual course/template
or QBank records.

Do not populate the shelf with fictional courses.

==================================================
5. DYNAMIC BOOK THICKNESS
==================================================

This is a required feature.

The physical thickness of every book reflects its
actual available content.

COURSE TEMPLATE LIBRARY:

Thickness reflects the number of real activities
or equivalent available course-content units.

Examples:

lectures
DLAs
SGs
IMCQs
eSofts
PQs
assessments

QUESTION BANK LIBRARY:

Thickness reflects the number of canonical questions
available in that course or bank.

Do not use file size as the sole measure.

A PDF containing large images should not appear
thicker merely because its bytes are larger.

Use a sensible normalized scale.

For example:

thickness = clamp(
  MIN_WIDTH,
  logarithmicScale(contentCount),
  MAX_WIDTH
)

The precise formula may be adjusted for visual quality.

Requirements:

- larger collections visibly have thicker spines
- very large collections do not overwhelm the shelf
- small collections remain legible and clickable
- book thickness updates when content changes
- empty books have an honest empty/unavailable state
- actual counts appear in the book preview

Thickness must be derived from canonical metadata,
not saved as an independent source of truth.

==================================================
6. BOOK INTERACTION AND ANIMATION
==================================================

The animation is central to the experience.

IDLE:

Books rest naturally on the shelf.

Subtle lighting and depth.
No excessive perpetual animation.

HOVER / KEYBOARD FOCUS:

Selected book rises slightly.

Gentle rotation or tilt.

A soft highlight reveals its spine.

Optional contextual label appears.

CLICK:

The book moves smoothly out of the shelf.

It rotates toward the viewer.

The cover opens with a physically convincing
page/cover transition.

The surrounding shelf subtly recedes.

BOOK OPEN:

The inside becomes a usable content preview.

Do not sacrifice legibility for realism.

The open-book presentation must display actual
course/template or QBank information.

CLOSE:

Book reverses naturally into the shelf.

Restore keyboard focus to its original position.

Avoid jarring animation or layout shifts.

==================================================
7. INSIDE THE COURSE BOOK
==================================================

Opening a course book should reveal:

COURSE OVERVIEW

Course name
Term
Modules
Weeks
Available activities
Template version/source if known

Then allow navigating:

MODULE
→ WEEK
→ ACTIVITIES

Activity types:

Lecture
DLA
SG
IMCQ
eSoft
PQ
Assessment
Review

Interactions:

Preview structure
Select entire course
Select individual modules/weeks
Review detected conflicts
Load into Course Tracker

The actual content should populate the existing
Course Engine.

Never create a parallel course data model.

Clicking the book previews its contents.

"Load Course" commits the selected structure.

Do not modify learner progress simply by opening
a book.

==================================================
8. INSIDE THE QBANK BOOK
==================================================

Opening a QBank book should reveal:

COURSE
MODULE
WEEK
QUESTION SOURCES
QUESTION COUNTS

Useful source categories:

School PQ
IMCQ
eSoft
Personal
AXOM Generated
Review

Allow:

Open bank
Preview available sets
Select a week
Choose question sources
Choose question count
Start practice

The book preview should be concise.

Do not display hundreds of questions on opening.

Existing canonical questions and attempts remain
the authority.

==================================================
9. GOER WEEK 2 — REQUIRED COMPATIBILITY
==================================================

Preserve and use the existing GOER Week 2 manifests
from the multimodal import work.

GOER is a real acceptance case.

The shelf must be able to represent:

Term 5
→ GOER
→ Week 2
→ available question packages/sets

Use the existing three GOER Week 2 manifests.

Do not duplicate the questions to create the book.

The QBank book must accurately report which content is:

available
imported
awaiting review
unsupported
missing its original source

Preserve:

tables
images
diagrams
question identity
answer provenance
answer-reveal metadata
course/week mapping

An answer-marked asset must never leak into an
unanswered question.

Uncertain answers must not be silently marked correct.

Do not claim complete GOER import until actual questions,
answers and media have been validated.

==================================================
10. RECOVER / BROWSE / IMPORT
==================================================

The library must clearly distinguish:

BROWSE

View templates and banks already available in AXOM.

RECOVER

Discover previously saved workspace content,
available backups, and user-selected source files.

IMPORT

Add new files or templates.

CREATE

Create a new reusable template, when the existing
Course Engine supports it.

Do not label a file-selection dialog as recovery.

Respect browser permissions.

In the web app, access local files only through
supported user-approved selection or existing
authorized data.

Do not pretend a Vercel deployment can freely scan
folders on the Mac.

Desktop integrations can later provide richer
authorized folder discovery.

==================================================
11. PERSISTENCE / SAVE RELIABILITY
==================================================

This is non-negotiable.

After loading a course template or QBank:

- the imported records remain after reload
- the shelf still displays the correct books
- the content counts remain correct
- the course/week relationships survive
- question identities remain stable
- media associations remain intact
- attempts and existing learner progress survive
- backups preserve supported data
- recovery handles errors explicitly

Use AXOM's existing local-first workspace system.

Do not create a second independent database.

Do not overwrite existing courses or question banks
without a clear review/confirmation step.

Deduplicate by stable identity where supported.

Import operations should be safe to retry.

Distinguish:

SAVED LOCALLY
BACKED UP
SYNCED

Never display a successful save/sync status if the
corresponding operation failed.

The current sync limitation around image bytes must
not be hidden.

Workspace schema remains 34 unless a coordinated
migration is expressly approved.

==================================================
12. REUSABLE COMPONENT CONTRACT
==================================================

Build cleanly separated components, such as:

AcademicBookshelf
AcademicBook
BookOpeningTransition
OpenBookPreview
CourseTemplateBookContent
QuestionBankBookContent

These are suggested names, not mandatory.

Use typed adapters/selectors for:

book identity
book category
content count
cover metadata
preview sections
selection
load action
save status

Reuse canonical data models.

Do not implement an unrelated new state framework.

Keep animations separate from data operations.

The bookshelf must be usable even if advanced
animation is disabled.

==================================================
13. MOBILE / ACCESSIBILITY
==================================================

A bookshelf must work on:

1440px desktop
390px mobile

Desktop:

Visible shelf with multiple books.
Smooth hover/focus and opening animation.

Mobile:

Scrollable, touch-friendly shelf.
Comfortable book selection.
Readable opened-book layout.

No tiny targets or horizontal page overflow.

Support:

keyboard navigation
visible focus
screen-reader book names and content counts
Escape to close
reduced-motion preferences
focus restoration

If reduced motion is enabled, use immediate or
minimal transitions while keeping all functionality.

==================================================
14. COORDINATION WITH CODEX
==================================================

Read the CURRENT BOARD.md.

Post an intent for this implementation.

Do not modify:

ImportPanel.tsx
MassImport.tsx
ExamRunner.tsx
LibraryPanels.tsx
QuestionWorkspacePage.tsx
shared store/types files

without explicit ownership coordination.

Codex currently owns the shared user-facing integration.

Your immediate deliverables should be independently
integrable components, selectors/adapters and tests.

Create an isolated demo/test route or component harness
if needed to prove the animation and book interactions.

Do not add a permanent unused demo route to production.

Post the integration interface clearly for Codex.

==================================================
15. IMPLEMENTATION SEQUENCE
==================================================

SLICE 1 — WORKING BOOKSHELF

Implement:

- realistic books and shelf
- dynamic thickness
- hover/focus
- select/open/close animation
- mobile behavior
- accessible interaction

Use real canonical metadata where available.

Run component/browser tests.

Commit checkpoint.

SLICE 2 — COURSE TEMPLATE BOOKS

Implement:

- template catalog adapter
- course/module/week preview
- selected-content model
- non-destructive load adapter
- save/reload tests

Commit checkpoint.

SLICE 3 — QBANK BOOKS

Implement:

- QBank catalog adapter
- source/week/question counts
- book preview
- practice-block selection adapter
- GOER Week 2 compatibility tests

Commit checkpoint.

SLICE 4 — HANDOFF

Prove an end-to-end experience in the isolated harness:

Open shelf
→ select ER/DM/GOER book where actual data exists
→ inspect real available content
→ load/select content
→ save
→ reload
→ content still present

Then provide Codex with the component/API integration
contract.

Do not independently edit Codex-owned production screens.

==================================================
16. CONTEXT HYGIENE
==================================================

Avoid another large-context development session.

Bootstrap only:

AGENTS.md
current BOARD.md
targeted design contract
relevant question-content files

Use the existing AXOM Obsidian graph as a semantic router.

Do not preload the vault.

Search installed skills by task.
Invoke appropriate animation/design/browser-testing
skills when useful.

Do not enumerate hundreds of skills.

Use:

SEARCH
→ LOCATE
→ TARGETED READ
→ IMPLEMENT
→ TEST

At each coherent slice:

- targeted tests
- visual browser verification
- commit
- brief BOARD checkpoint
- update 1–3 relevant Obsidian nodes
- record SKILLS_USED
- assess remaining context

Continue in the same session while efficient.

Stop and hand off when context is genuinely saturated.

The integration steward owns canonical AI_STATE.

Do not push, deploy, or merge into main.

==================================================
17. ACCEPTANCE CRITERIA
==================================================

This work is complete when:

1. A real animated bookshelf renders.
2. Books are generated from available academic data.
3. ER, DM, GOER appear when corresponding data exists.
4. Thickness reflects real content count.
5. Clicking a book animates it opening.
6. The opened book displays real course/bank information.
7. Course templates can be previewed and selected.
8. QBank content can be previewed and selected.
9. GOER Week 2 manifests remain compatible.
10. Save/reload behavior is verified.
11. Existing progress is not overwritten.
12. Desktop and mobile interactions work.
13. Accessibility and reduced motion are supported.
14. Tests pass.
15. The components are ready for Codex to integrate.

Deliver a working product component, not merely a
design proposal, screenshot, or documentation.

Start implementing now.
```

### One important implementation detail

**Book thickness should represent the number of questions or activities, not the size of the PDF files.** Otherwise, a single pathology image could make a tiny question bank appear enormous.

I would also keep **the physical book animation for discovery and selection**, then make the opened book's interior exceptionally functional. Realistic page turns are useful for the transition, but navigating 50 lectures through elaborate page-turn animations would become frustrating.

**The next milestone for Claude:** an animated, functional shelf containing the actual available ER/DM/GOER collections, with books that open into real previews and preserve their content after loading.

Codex can then connect this to the Course Tracker and Question Bank entry points when its usage becomes available.
````
