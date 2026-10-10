---
tags:
  - axom/feature
authority: canonical
---
# The academic bookshelf

**Purpose:** One academic collection, with a book per module and quiet term labels.
Readable covers wrap into responsive rows; filters narrow the collection without empty
term shelves. Choosing a book opens its real contents and primary action.

**Status (2026-10-10):** Course Tracker exposes My Courses and Course Library / Load Course.
Prepared templates are available before activation. Load Course adds their missing activities;
Customize Weeks & Activities uses the existing versioned template loader. QBank opens on
course sets and exposes Create Quiz. Bank selection retains its module/week/set scope.
The private-library transfer path is described in [question content](question-content.md#private-library-delivery).
Implementation and local acceptance are not proof of delivery to axom.info.

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
2. **Readable books first.** Cover widths follow the responsive grid; physical dimensions
   never make titles or hit targets too small. Persistent captions show actual content counts.
3. **Nothing is invented.** A spine shows the module's name as the data has it. A module
   with nothing in it is an unbound, outlined book that says so.
4. **Opening a book changes nothing.** Only "Load course" writes, and it only adds: a term,
   a course, a module or prepared activities that are missing. Existing progress, notes and
   personal titles remain intact. Loading twice adds nothing the second time. A
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

Keyboard: one Tab stop for the shelf; arrows follow the responsive rows and columns, Home and End
reach the ends of the collection; Enter or Space opens; Escape closes and focus returns to the spine. The open
book is a modal dialog that keeps Tab inside it.

## Checks

- `npx vitest run src/lib/bookshelf` (thickness, course books, loading, bank books, the
  three Term 5 GOER Week 2 manifests).
- `AXOM_E2E_BASE_URL=http://127.0.0.1:5197 npx playwright test e2e/bookshelf-harness.spec.ts`
  against a dev server: the collection as drawn, readable covers, keyboard and focus, a load
  that survives a reload, bank counts, a phone-sized screen, the opening with motion, the
  light theme.

## Remaining boundaries

- The updated schedule PDFs still require cohort and authority reconciliation; a saved
  template version does not certify its academic currency.
- Recover stays hidden until it has a real recovery source.
- Available content defaults on; clear it to inspect the underlying course map. An empty
  mapped course never claims prepared activities or ready questions.


Product integration: `components/tracker/CourseLibrary.tsx` and
`components/questions/QuestionBankLibrary.tsx`; `e2e/bookshelf-product.spec.ts` checks
the actual app at desktop and phone sizes. Weekly and selected practice counts use
unique canonical question IDs, so a review set cannot inflate the pool. Course IDs
separate otherwise identical module names. Saves assert the vault outcome before
reporting success. Recover remains hidden until it has a real recovery source.
