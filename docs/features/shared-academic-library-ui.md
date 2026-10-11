---
tags:
  - axom/features
authority: canonical
---
# Shared academic library interface

The product catalog is cloud-hosted shared content, not a learner's workspace backup.
Course Library and Question Bank both mount `components/bookshelf/CloudAcademicLibrary`.
It discovers permitted published release metadata through `lib/cloudLibrary/client.ts`,
then retrieves selected templates/questions/images through the existing canonical loaders.
Personal imports and saved content remain available under a secondary section.

## Flow and ownership

One responsive collection spans terms; search and term filters narrow it without empty
term shelves. Opening a course exposes Load Course and explicit question-set selection.
Create Quiz resolves selected content before handing off to the existing practice engine.
An empty selection never means the entire catalog. Publication readiness and permissions
come from the backend; UI counts are not invented or derived from local file names.

Loading a course is an explicit learner action. It must preserve progress and not enroll
all catalog courses automatically. The shared catalog never stores learner attempts,
notes, personal edits or Anki credentials. Backend errors and no published content are
separate states. A private folder import is not proof of cloud delivery.

Implementation: `web/src/components/bookshelf/CloudAcademicLibrary.tsx`,
`web/src/styles/cloud-library.css`, `web/src/lib/cloudLibrary/`.
UI tests: adjacent component tests and `web/e2e/cloud-catalog.spec.ts`.
The browser regression uses synthetic HTTP responses and the real frontend import/save
path. It does not certify hosted RLS, account synchronization or real-corpus publication.

## Release gate

Deploy only after the backend migration, authorized publisher content and real multi-user
checks are verified in the intended environment. A second permitted account must discover
courses without source-file import; it must never receive another learner's progress.
Private source data remains outside Git. Missing access is reported rather than worked
around with a public bucket or service credentials in the client.

Related: [Bookshelf](bookshelf.md), [Course Engine](course-engine.md),
[Question content](question-content.md), [Backend](../architecture/backend.md).
