---
tags:
  - axom/feature
authority: canonical
---
# The academic bookshelf

**Purpose:** One way to browse what AXOM holds: real books on shelves. A book is a module
of a course (ER, DM, GOER), a shelf is a term. A book is as thick as what it holds. Hover
or focus lifts it; choosing it takes it off the shelf, turns it and opens it onto a preview
of what is really inside. Two libraries use the one shelf: course templates and question
banks.

**Status (2026-10-08):** built as independent components on `feat/qbank-multimodal-import-v1`
and exercised in a browser on a development harness. Not yet in Course Tracker or the
Question Bank: that wiring is Codex's. Nothing in the app imports these files yet.

| Responsibility | Files under `web/src/` |
| --- | --- |
| Books, shelves, thickness | `lib/bookshelf/model.ts` |
| Course books from terms, courses, tracker rows and the course map | `lib/bookshelf/courseBooks.ts` |
| Loading a course book: plan, apply, commit | `lib/bookshelf/loadCourse.ts` |
| Question bank books from sets, questions and known packages | `lib/bookshelf/questionBankBooks.ts` |
| The shelf, the books, the opening, the open-book dialog | `components/bookshelf/AcademicBookshelf.tsx` |
| What is inside a course book and a bank book | `components/bookshelf/BookContents.tsx` |
| Browse, Recover, Import, Create frame | `components/bookshelf/AcademicLibrary.tsx` |
| Styles (imported by the component, not by `main.tsx`) | `styles/bookshelf.css` |
| Development harness, not in the build | `web/harness/bookshelf.html`, `harness/bookshelfHarness.tsx` |

Depends on: [course engine](course-engine.md) (`buildModuleWeeks`, `questionScope`,
`moduleKey`), [question content](question-content.md) (package manifests), the
[design contract](../design/DESIGN.md).

## Invariants

1. **A book is derived, never stored.** Books, counts and thickness are computed from the
   workspace each time the shelf is drawn. There is no bookshelf state to go stale and no
   second course or question model.
2. **Thickness is content.** `spineThickness(count)` grows with the logarithm of the count
   of activities or of questions, between a width that can still be read and tapped and a
   maximum. Never file size.
3. **Nothing is invented.** A spine shows the module's name as the data has it. A module
   with nothing in it is an unbound, outlined book that says so.
4. **Opening a book changes nothing.** Only "Load course" writes, and it only adds: a term,
   a course or a module that is missing. Loading twice adds nothing the second time. A
   book keeps its identity (`courseBookId`) before and after loading, so it stays open
   while the workspace changes under it.
5. **A question the device does not have is not counted.** A known package that is not
   imported is listed with its state (ready to import, not built yet, source file
   missing, cannot be read) and adds nothing to the book's count or thickness.
6. **"Saved" means saved.** The load reports "Saved on this device" only after the write
   has reached the device, and reports a failure as a failure. It makes no claim about a
   backup or about sync.
7. **Motion is separate from function.** With reduced motion, by system setting or by
   AXOM's own, a book opens and closes at once and everything still works.

## Using it

```tsx
<AcademicLibrary title="Course library" onChooseFile={openTemplatePicker} browse={
  <AcademicBookshelf
    label="Course library"
    shelves={buildShelves(buildCourseBooks({ terms, courses, tracker, questions, sets, curricula: CURRICULA }))}
    renderBook={(book) => <CourseBookContent book={book} workspace={{ terms, courses }} onLoad={commitCourseLoad} onOpen={openInTracker} />}
  />
} />
```

The question bank library is the same shelf with `buildQuestionBankBooks({ terms, courses,
sets, questions, packages, curricula, sourceOf })` and `QuestionBankBookContent`
(`onPractice` receives `{ module, week, setIds, count }`, capped at what is ready).
`sourceOf` names a set's source; pass stream 1's `bankSource` there. `AcademicLibrary`
shows a Recover, Import or Create tab only when its host gives it something real to do.

Keyboard: one Tab stop for the shelf; arrows move along and between shelves, Home and End
within one; Enter or Space opens; Escape closes and focus returns to the spine. The open
book is a modal dialog that keeps Tab inside it.

## Checks

- `npx vitest run src/lib/bookshelf` (thickness, course books, loading, bank books, the
  three Term 5 GOER Week 2 manifests).
- `AXOM_E2E_BASE_URL=http://127.0.0.1:5197 npx playwright test e2e/bookshelf-harness.spec.ts`
  against a dev server: the shelf as drawn, thickness order, keyboard and focus, a load
  that survives a reload, bank counts, a phone-sized screen, the opening with motion, the
  light theme.

## Not done

- Not wired into Course Tracker or the Question Bank.
- "Load course" adds the module's place in the course. The lectures and other activities
  of a template file still come in through the existing template loader, which
  `onChooseTemplate` is there to open.
- Recover has a slot and honest copy, and no search behind it yet.
- Selecting single weeks of a course to load is not built.
