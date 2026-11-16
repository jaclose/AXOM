---
tags:
  - axom/decision
authority: canonical
---
# 003: The visitor catalog reads the academic collection

**Status:** decided 2026-11-14 on branch `claude/public-catalog-20261113`, base
`9f6b381f`. Built and tested locally. Not applied to the hosted database and not
released; see [academic collection](../features/academic-library.md#visitors-without-an-account).

**Context:** Visitors without an account must be able to browse the reviewed course
catalog. Two academic stores exist in the hosted schema. The release catalog
(`academic_catalog_releases`, `_entries`, `_files`, migration `20261010233000`) is
readable without an account, but it has no active entry point, a browser test forbids
the app from calling it, publishing to it needs a service credential in a terminal,
and a signed-out read of production on 2026-11-13 returned zero releases and zero
entries. The academic collection (`academic_collections`, `academic_revisions`) is the
store with upload, review, attestation, sharing and enrollment, and every one of its
reads required an account.

**Decision:** Keep one academic store. A reviewer offers one exact approved, shared
revision of their own upload to visitors; `academic_collections.public_revision_id`
records that revision. Visitors read bounded catalog metadata and the plan text
through `academic_public_catalog` and `academic_public_course`. Questions, images,
source files and every Storage object stay behind the existing account rules. The
release catalog stays dormant. Do not activate it as a second library.

**Reason:** One review path decides what anyone can see, so a visitor can never be
shown material that skipped review, and publishing stays an action in the app instead
of a terminal task. Binding the offer to a revision means a replacement upload is not
public until a reviewer offers it. The alternative, publishing a second copy into the
release catalog, needed no database change but would have created the competing
store the product rules forbid and two places to withdraw content from.

**Consequences:** The hosted database needs migration
`20261113220000_academic_public_catalog.sql` before any course can be offered. Until
then the client treats the missing functions as an empty catalog and shows no offer
control. A course plan without reviewed questions cannot be approved today
(`academic_review` requires an explanation attestation over at least one ready
question), so a plan-only course template cannot reach visitors yet; that is a
separate product decision. Whether to revoke the release catalog's signed-out grants
or remove its tables is also undecided and needs the owner's word.
