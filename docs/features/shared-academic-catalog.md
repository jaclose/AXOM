---
tags:
  - axom/feature
authority: canonical
---
# Shared academic catalog

**Compatibility history, 2026-10-13:** this earlier catalog implementation is
preserved for review and existing adapter tests. Active QBank and Course Library
entry points now use the single [academic collection](academic-library.md), including
its review, upload, group access and enrollment contracts. Do not independently
activate this older publisher as a second product library. The implementation and
validation notes below describe its earlier branch checkpoint.

## Product boundary

Published templates and verified question banks are shared content, not JD's workspace.
Course Library and QBank discover permitted releases through the configured account
backend. Selecting a course or quiz downloads its content into the existing
[Course Engine](course-engine.md), [question engine](question-content.md), and
[bookshelf](bookshelf.md). Learner attempts and notes are never published.

Development: PR 20, `feat/shared-academic-catalog`. The production database migration,
actual content publication, hosted multi-user acceptance, and production deployment
have NOT occurred. Deploying code alone does not create a populated catalog.

## Implementation and limits

- `web/src/lib/cloudLibrary/`: metadata, bounded asset reads, canonical cache adapters.
- `web/src/components/bookshelf/CloudAcademicLibrary.tsx`: course/quiz entry points.
- `web/scripts/shared-library/`: operator-only prepare and publish tools.
- Migrations: `20261010233000_shared_academic_catalog.sql` and
  `20261010234000_catalog_storage_policy_boundary.sql` under `supabase/migrations/`.

A release owns immutable entries and a checksum manifest of private Storage objects.
Its audience is explicitly public, authenticated, or individually granted. Public
means anonymously readable through the authorized API, not a public Storage bucket.
Only the server-side publisher can stage content, grant access, and publish after all
expected files exist. Restrictive Storage policies prevent older permissive policies
from opening the new bucket or allowing browser writes.

The app fetches metadata first. Selected content uses short-lived signed URLs with
host, size, SHA-256, course-scope and readiness checks. Limits: 16 MiB per file, 8 MiB
per image, 128 MiB and 50 collections per quiz preparation. Exceeding a limit produces
an explicit error rather than silently dropping material.

Each prepared quiz also carries the exact verified question IDs that were selected. The
runner intersects these IDs with any reused local sets, so unrelated questions from a
larger preexisting set cannot enter a narrow cloud practice block. Choosing different
sources explicitly clears that boundary before building a new block.

Banks reuse canonical import identities and existing private attempt records. Course
loading preserves progress and personal edits. Full source-document bytes are NOT in
this first publication adapter: verified question excerpts and their figures are.
Complete original-page/interactive Slide delivery remains a separate acceptance gate.

## Publication workflow

Prepare from an existing private collection into a separate private directory outside
Git and outside the input directory. Original files are never modified. From `web/`:

```sh
node scripts/shared-library.mjs prepare \
  --source '/absolute/private-library' \
  --out '/absolute/separate-publication-directory' \
  --catalog 'approved-course-library' \
  --version 'reviewed-version' \
  --title 'Academic Library' \
  --audience 'restricted' \
  --grant-users 'AUTHORIZED-USER-UUID' \
  --rights-reference 'Actual publication approval reference'
```

This is offline preparation, not upload. Review `publication-plan.json` and
`publication-coverage.json`. Uncertain keys, missing images, unreadable templates and
unsupported sources remain held. Exact source duplicates do not create extra banks.
This tool does not generate supplementary questions.

Dry run, without backend credentials:

```sh
node scripts/shared-library.mjs publish --plan '/absolute/publication-plan.json'
```

After BOTH migrations are applied to the intended staging project, use its server-side
credential in `AXOM_CATALOG_SERVICE_KEY` and HTTPS URL in `AXOM_CATALOG_PROJECT_URL`.
Never put the credential in VITE variables, command arguments, source files or logs.
An actual publish also requires `--project-ref` and `--approve-release` matching the
reviewed plan. Uploads use immutable names, then are read back and hash-verified.
Retries resume the same staging release. Changed content needs a new reviewed version.
Withdraw published releases rather than editing their records in place.

## Verification boundaries

Contract/UI tests use synthetic data and mocks. SQL tests replay both migrations in
isolated PGlite with anonymous/A/B roles and an intentionally broad legacy policy.
Browser contract tests route synthetic HTTP responses through the real SDK, stores and
screens. They do not establish live Supabase Storage or actual school-content delivery.

The existing learner snapshot limit is unchanged. Downloaded practice uses the current
local store and learner snapshot rules; sufficiently large selected collections can
still exceed that snapshot limit. Shared content distribution and full learner sync
must not be described as the same feature. Revoking access stops future downloads, not
legitimate offline copies; already issued URLs can remain valid for up to 120 seconds.

Next release gate: authorize a hosted staging environment and publish one reviewed
course plus image-rich bank; verify separate accounts, denied access, save/reload,
image failure, and updates. Then publish all remaining authorized prepared collections.
No main promotion or production deployment before those gates and explicit approval.
