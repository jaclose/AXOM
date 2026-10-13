---
tags:
  - axom/feature
authority: canonical
---
# Academic course collection

The Course Library is a full-page collection with inline weekly previews. Course
availability does not enroll the learner. Loading selected weeks uses the existing
tracker reconciliation and preserves completed work, notes, personal labels and IDs.
Quiz navigation passes an exact set of canonical local question IDs to the existing
question workspace. An empty scope cannot expand into all questions.

Templates distinguish academic term, cohort, source revision and calendar dates.
Explicit week policy leaves unresolved activities unassigned. Reviewed complete plans
take precedence over inferred legacy lists; older source versions remain available.

## Backend boundary

The additive `20261011190000_academic_library.sql` migration defines collections,
immutable revisions, file manifests, reviewer/group access and personal enrollments.
Catalog pages contain at most 24 metadata records. Preview retrieves template text;
an explicit download passes hash-verified course files through the canonical private
library installer. File indexes paginate independently of the REST row limit.

`academic-content` is a private bucket. Uploads default to private. Owners may request
group/shared visibility; another account can read only approved revisions. Reviewer
membership and group membership require administrative authorization. Withdrawal
revokes metadata and media access together. Previously approved revisions remain
readable during review of a replacement while the collection remains shared.

Upload identities are stable per account and prepared collection. A retry verifies
existing object bytes before accepting a lost response, and requires server
acknowledgement before reporting success. Late acknowledgements never roll the current
revision backward. Enrollment adds selected weeks within the same revision.

The current upload control accepts one prepared course with one plan, at most 1,500
files / 512 MiB total and **6 MiB per file**. Larger original files require a later
resumable-file transport. Unreferenced ZIP entries and learner backup fields are not
uploaded. Local paths in catalog entries are replaced by source filenames. Sharing
controls now live under the owned course preview. Private, shared and membership-backed
group choices call the existing permissioned RPC. Same-scope refresh preserves the open
plan; account/query changes still discard prior metadata immediately. The administrative
review interface is not yet delivered.

Account requests reuse the recovery owner's `accountOperationClient`: requests retain
the starting token and reject a changed account. Catalog results are scoped by account
and query, including pagination. Installation and enrollment recheck ownership before
canonical store writes; interrupted work retains its local originals and retry intent.

## Acceptance and limits

2026-10-13, Node 22.23.1, macOS, Chrome: the authorized private FTM1 pilot exercises
75 source-reviewed activities across three weeks, two explicitly unresolved activities,
selected Week 2 activation (30 rows), an exact 11-question image-rich quiz, Decode
review, 11 saved attempts and reload. Repeated loading preserves IDs. Desktop/mobile,
short windows, light/dark, reduced motion and 200% CSS zoom were checked. The template
version/export/progress journey passes at 1440px and 390px.

An actual local Supabase native stack (CLI 2.120.0, API `http://127.0.0.1:55321`)
passes a two-synthetic-account Auth/REST/Storage test: private isolation, retry identity,
review-gated sharing, independent enrollments, immutable images and withdrawal. A
separate browser test signs in through the real UI, privately uploads the pilot,
previews the backend plan, downloads Week 2, reloads and launches its exact quiz.
A two-account browser sharing journey also verifies pending review stays private,
reviewed discovery, group membership restrictions, owner-only controls, and return to
private visibility. It covers 1440px/390px/short windows, both themes, keyboard, reduced
motion and 200% CSS zoom with no captured browser errors/warnings. These are local
backend checks, not hosted staging or production acceptance.

Reproduce with `AXOM_LOCAL_SUPABASE_STATUS` pointing to the CLI's private status JSON
and `AXOM_ACADEMIC_PILOT` pointing to the authorized pilot ZIP. The opt-in
`backend.local.test.ts` and `academic-backend.local.spec.ts` refuse hosted URLs.
Credentials and source files remain outside Git; tests never delete existing users.

**Still incomplete:** downloaded academic records remain in the legacy workspace
snapshot. Revision-bound per-answer changes are implemented, but new-device recovery
still hydrates private source objects. Shared-content exclusion, cross-device learner
overlays, migration of existing libraries, bounded offline cache, real leaderboards,
remaining supplied courses and release/package acceptance are not delivered. The
private-recovery handoff is a supporting layer, not a substitute
for this missing account/content separation. Never report this checkpoint as completion
of canonical 1.1 or as a production deployment.
