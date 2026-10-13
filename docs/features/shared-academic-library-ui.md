---
tags:
  - axom/feature
authority: canonical
---
# Shared academic library interface

**Compatibility history, 2026-10-13:** this earlier catalog implementation is
preserved for review and existing adapter tests. Active QBank and Course Library
entry points now use the single [academic collection](academic-library.md), including
its review, upload, group access and enrollment contracts. Do not independently
activate this older publisher as a second product library. The implementation and
validation notes below describe its earlier branch checkpoint.

The product catalog is shared cloud content, not a learner's workspace backup.
Course Library and Question Bank both mount `components/bookshelf/CloudAcademicLibrary`.
The account-aware hook discovers permitted published release metadata; selected
course/question content passes through the existing canonical loaders. Personal
imports and saved content remain available separately.

## Flow and ownership

One responsive collection spans terms; search and term filters narrow the bookshelf
without empty term shelves. Opening a course exposes Load Course. Question-bank books
expose set selection and Create Quiz. An empty selection must never mean the entire
catalog. The loader resolves selected content before handing off to the existing player.
Counts and permissions come from the backend, not guesses from local filenames.

Loading a course is an explicit learner action. Preserve progress and never enroll
all catalog courses automatically. The shared catalog never stores learner attempts,
notes, personal edits or Anki credentials. Backend failure and no published content
are separate states. A private folder import is not proof of cloud delivery.

Implementation: `web/src/components/bookshelf/CloudAcademicLibrary.tsx`, its adjacent
CSS, and `web/src/lib/cloudLibrary/`. UI tests are adjacent; the browser journey is
`web/e2e/cloud-catalog.spec.ts`. The browser test uses synthetic HTTP responses and
real frontend import/save/reload paths, not injected workspace content. It does not
certify hosted RLS, cross-device account sync or publication of JD's real collection.

## Release gate

The backend migration, authorized content publication and real multi-user checks
must pass in the intended environment before production release. A second permitted
account must discover courses without importing a folder and must not receive another
learner's progress. Private source data stays outside Git. Do not work around missing
access with a public bucket or elevated credentials in the browser.

Related: [Bookshelf](bookshelf.md), [Course Engine](course-engine.md),
[Question content](question-content.md), [Backend](../architecture/backend.md).
