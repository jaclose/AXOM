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

QBank discovery uses this same paginated account catalog and opens this same weekly
plan. The permission-checked `academic_course` lookup resolves an exact deep link
independently of the first 24 catalog rows. A refresh failure preserves visible
same-account metadata; failed or unauthorized lookups never replace local content.
The earlier `cloudLibrary` publisher/reader remains preserved compatibility code,
with no active product entry point. Do not activate two competing academic stores.

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

The additive `20261013220000_content_storage_boundaries.sql` migration also uses
restrictive Storage policies. PostgreSQL combines ordinary policies with OR, so an
unrelated broad object policy must not open academic or private recovery files.
Academic reads still require a visible file manifest; uploads require an owned,
registered revision in progress. Academic objects are immutable to learners.
`workspace-content` and `workspace-media` remain restricted to the authenticated
owner's UUID/hash path, with updates forbidden. The regression suite deliberately
adds a permissive all-object policy and verifies that these boundaries still hold,
including anonymous access and another account's reads and writes.

The legacy catalog's Storage policy names are distinct from the academic-content
policies, so both preserved migration histories replay without collisions. Legacy
catalog data is not copied into, or silently adopted by, the active collection.

Upload identities are stable per account and prepared collection. A retry verifies
existing object bytes before accepting a lost response, and requires server
acknowledgement before reporting success. Late acknowledgements never roll the current
revision backward. Enrollment adds selected weeks within the same revision.

The current upload control accepts one prepared course with either one reviewed plan or
an explicitly confirmed term and module for unscheduled content, at most 1,500 files /
512 MiB total and **50 MiB per uploaded file**. Files through 6 MiB use the immutable
Storage uploader; larger files use authenticated tus transport in 6 MiB chunks and can
resume an eligible partial transfer. Every stored object is downloaded and SHA-256
verified before revision activation. Original binaries above 50 MiB remain local-only
with an explicit catalog receipt, while their reviewed question packages may still
upload. Unreferenced ZIP entries and learner backup fields are not uploaded. Local paths
in catalog entries are replaced by source filenames. Sharing controls now live under the
owned course preview. Private, shared and membership-backed group choices call the
existing permissioned RPC. Same-scope refresh preserves the open plan; account/query
changes still discard prior metadata immediately. The administrative review interface
is not yet delivered.

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

The local feature migrations applied for this acceptance are
`20261011173750_private_workspace_media.sql`,
`20261011175017_allow_bounded_snapshot_retention_cleanup.sql`,
`20261011190000_academic_library.sql`,
`20261013180000_incremental_workspace_transport.sql`,
`20261013200000_daily_academic_challenges.sql`,
`20261013210000_academic_course_lookup.sql`,
`20261013220000_content_storage_boundaries.sql`, and
`20261013230000_shared_account_content_references.sql`, on the existing local account
baseline. This is not a claim that hosted migrations or communications activation
have occurred. The preserved migration chain also passes role/grant/RLS replay tests.

The opt-in `backup-restore.local.spec.ts` exercises an authorized existing ZIP through
Settings in a fresh persistent Chrome profile, with hosted requests blocked. On
2026-10-13 the 516,431,732-byte archive restored 343 questions, one existing attempt,
43 tracker activities and 848 documents. Question notes, attempt fields, tracker
progress and source/set identities matched before and after reload. All 2,151 images
(467,866,781 bytes) matched the archive by SHA-256 after reopening. The measured
read/restore/reload/integrity phase took 28,178 ms; the complete browser case including
profile teardown took 47.1 seconds on this Mac with Node 22.23.1. This is a single
local recovery observation, not a cloud latency claim. Reproduce with
`AXOM_RESTORE_BACKUP` pointing to an authorized ZIP; no original file is modified.

Metadata checkpoints now restore personal progress and immutable references without
downloading source files. QBank offers individual saved-set downloads; saved course
previews offer a course download. Sources and figures are verified before the canonical
question records enter practice. Exact existing local content remains available while
remote learner notes and attempts are applied. Shared academic questions and images
reference their revision files directly; personal source edits retain private recovery.
See the [account boundary](../architecture/accounts-sync-v1.md#metadata-checkpoints-and-explicit-content-downloads).

The real local FTM1 browser acceptance measured a 100,780-byte checkpoint and a
10,899-byte completed 11-answer update (request JSON, excluding headers). Clean
second-device sign-in made zero Storage downloads and retained 25 deferred question
references. Explicit set/course downloads restored all 25 canonical IDs and 11 attempts;
offline image-rich study and reconnect preserved those attempts. All 25 question sources
and their figures referenced academic objects, with zero private course-image copies.
These are single-run local observations, not hosted latency or total account-size claims.

**Still incomplete:** paged learner history, persistent offline cache usage/removal
controls, general private-upload original-binary sync, cloud copies for academic
originals above 50 MiB and administrative review, remaining supplied courses, hosted
daily challenges and release/package acceptance. Legacy checkpoints still use the
compatible full-source restore path.
Never report this checkpoint as completion of canonical 1.1 or a production deployment.

## Original files and portable recovery

Academic bindings identify original PDF, DOCX and text files only when the prepared
catalog explicitly declares their paths and their checksums match the installed source.
A course-template JSON is never treated as an original document. Explicit saved-course
and saved-set downloads verify protected original files through the existing backend
file/RLS boundary, then store them in Decode's existing checksum-verified cache.

Intentional portable exports include available original binaries in ZIP format 2,
separate from workspace JSON and question images. The manifest records source ID,
SHA-256, byte count and media type. Import validates every original's identity, bounds,
size and hash before offering workspace adoption; restore reuses the existing source
cache. Repeated restore skips verified copies, merge skips mismatched newer documents,
and older cached editions remain readable. JSON and version-1 ZIP imports still work.

The archive limits remain 2 GiB total, 30,000 entries and 128 MiB workspace JSON;
originals have a 128 MiB per-file limit and images retain their 8 MiB limit. Export
reports unavailable or oversized originals while retaining their saved text and
metadata. It never removes the only local copy. Older clients cannot open format-2
original-file ZIPs; update before restoring them. No database migration is required.
General private-upload original-file cloud sync and cache-removal controls remain open.

Local Chrome acceptance additionally exports the real FTM1 pilot through Settings and
restores it into a third empty profile. The 909,774-byte ZIP restores both original
files with verified hashes after reload, plus all 11 independent saved attempts.
The same run measures a 101,550-byte account checkpoint and 10,892-byte 11-answer delta,
with zero source GETs at clean sign-in and zero private course-image copies. The full
quality gate passes 3,131 unit/SQL tests (six declared skips), typecheck, full lint and
production build. Six affected browser cases pass, including the supplied 516,431,732-
byte legacy backup and all 2,151 image hashes (49,244 ms read/restore/reload/integrity).
These results are local-only; this extension needs no hosted migration.

### Saved-work copies when content is unavailable

Settings → Emergency recovery → Export saved work never downloads source or image
objects. It exports learner records, all deferred references and files already on the
device, using the existing JSON/ZIP recovery formats. `_backupScope: "saved-work"`
and the `axom-saved-work-` filename distinguish it from a full portable export. Counts
identify unfetched sources and missing binaries; it does not advance the full-backup
timestamp. Full export still reports a failed download rather than silently degrading.

Restore warns when the copy needs the original account/content access. Exact immutable
source matches already on the device are retained through the account adapter, while
the imported learner overlay wins. Mismatched editions are never substituted. Deferred
image references participate in restore/retention, and original manifests accept source
metadata without treating it as a study-ready question. Concurrent workspace changes
stop adoption before replacement. No new storage engine, table or migration is needed.

Focused recovery tests exercise JSON and ZIP, unavailable account/content, exact source
retention, missing images, intact originals and note recovery. The local FTM1 browser
flow exports while offline on a reference-only device, restores 11 attempts to a fresh
profile offline, and checks them after reload. No source GET occurs during sign-in or
saved-work export. Full course download and image-rich offline study remain separate
explicit operations.



## Verified daily challenges

The additive `20261013200000_daily_academic_challenges.sql` migration adds a fixed,
reviewed collection revision per UTC day. The administrative `publishDailyChallenge`
adapter reads hash-verified backend files through the existing package parser and
readiness gate. It excludes generated/uncertain questions and incomplete images.
Only the service role can publish; normal clients cannot submit pools or score totals.
No scheduled publisher or production pool has been activated yet.

Learners explicitly choose an alias and opt in for that day's module. The existing
ExamRunner supplies the exact versioned pool. Completed canonical quiz sessions are
saved locally before sending individual answer events. The server checks collection
access, participation, day, pool membership and answer key. One correct unassisted
first challenge answer earns one point; a canonical bank/question identity can earn
points only once across challenges. Assisted or incorrect first answers consume that
opportunity. Equal points share a rank. This is not a claim of first-ever practice or
exam proctoring: ordinary/offline practice is outside the competitive event stream.

Standings expose only aliases and aggregate scores, limited to 100 rows plus the
learner's own rank. Answer tables and answer-key pools have no client grants. Course
withdrawal/private visibility revokes standings access, and opt-out remains available
without deleting personal work. The UI refreshes each minute and after verification.

Starting a daily challenge first saves an account/challenge-bound reference in the
existing Local Vault. It contains the canonical quiz session ID and exact question
mapping, not another copy of answers or a client score. The existing ExamRunner accepts
that stable launch identity and retains its usual resume, mode and reveal rules.
Continue resumes the same saved quiz after reload. Verification reads the durable
canonical quiz session, checks account identity, and sends the same server event IDs.

Unconfirmed or offline answers remain personal. Reload, sign-in, catalog refresh and
reconnect never promote them automatically, including when account recovery adds a
completed session after the board mounts. A run started or explicitly continued in the
current view may submit on completion. Otherwise the learner chooses Retry verification.
A lost acknowledgement replays safely; repeats cannot farm points. The reference is
retired only after every answered event is acknowledged or excluded by the server.
New points still require participation, access and the same UTC challenge day.

Launch and retirement use the browser's [Web Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API)
to prevent concurrent tabs from overwriting or clearing another pending run. A browser
without this secure-context API cannot start a shared daily run; personal practice
remains available. The small pending reference is device-local bookkeeping, outside
account snapshots and portable backups; canonical answers remain in the existing quiz
history. Hosted scheduling and native acceptance are still outstanding.

Local acceptance on 2026-10-13: two synthetic accounts each completed the same real
25-question FTM1 image-rich pool, independently saved 25 canonical attempts, received
four points and rank one, and exercised retries, repeat prevention, opt-out and reload.
Chrome desktop, 390px, short windows, both themes, reduced motion, keyboard and 200%
CSS zoom passed without captured browser errors/warnings. Individual scoring request
JSON bodies were exactly 223 bytes (25 requests, 5,575 bytes for the first learner),
excluding protocol headers. These are local-loopback measurements, not cloud latency.

Reproduce the fixture with `challengeFixture.local.test.ts` using the local backend
and pilot variables above plus `AXOM_CHALLENGE_FIXTURE` pointing outside the repo.
Then run `daily-challenge.local.spec.ts` with that fixture and `AXOM_E2E_BASE_URL`.
The fixture holds test credentials and is written with mode 0600. Never commit it.

Daily resumption acceptance, 2026-10-14 UTC: two synthetic learners use the real local
25-question FTM1 pool. The first reloads after three answers and resumes the same quiz.
The backend then accepts five scoring events before the fifth acknowledgement is
replaced with an intentional 503. Reload and Refresh send no scoring events. Explicit
retry repeats the exact event IDs and finishes all 25 canonical attempts; both learners
still receive four points and rank one. The first learner sends 30 requests of exactly
223 JSON bytes each (6,690 bytes total), including five safe replays. Tests also cover
opt-out, independent progress, keyboard, reduced motion, 390px/1440px/short windows,
both themes and 200% CSS zoom. Pending actions were inspected in actual screenshots.
The injected acknowledgement failure is deliberate; scoring remains the real backend.
