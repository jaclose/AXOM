# AXOM CONVERGENCE candidate — 2026-11-09

**State: committed and pushed [candidate #345](https://github.com/jaclose/AXOM/pull/345); not a shipped release.** The release owner
must replace the outstanding-gates section with exact final evidence before
claiming release. Baseline: `382308aba5ececd039285d4b8ccee9a181b40d7c`.

The candidate brings together question-set submission and review, privately
reviewed explanation drafts, course-template discovery and loading, Community
profiles and consent, Journal durability, and account/image protection. Incomplete
navigation is hidden. Native configuration work does not constitute a native
build, download, installer, signing result, or package release.

## Integration provenance

These are selected source deltas, not claims that every ancestor PR was merged.
The final candidate also includes coordinated local corrections described below.

| Disposition | Source | Exact source commit | Selected work / limit |
| --- | --- | --- | --- |
| INCLUDED | QBank cumulative [#342](https://github.com/jaclose/AXOM/pull/342) | `e6c535c88602d9a71a7d6bc665d167755e5618ce` | Final QBank publication/review stack. Its destructive like-reset proposal is replaced by retained publication epochs below. |
| INCLUDED | Import settlement [#216](https://github.com/jaclose/AXOM/pull/216) | `6fe7c6bcfbc5c6a6ddd908c09c62d4ffcd241345` | Prevent repeated local import after its operation settles. |
| INCLUDED | Tracker ownership [#181](https://github.com/jaclose/AXOM/pull/181) | `981e2c828b19da4d0f345d9469a3716359ba5f2a` | Count practice only with proven course ownership. |
| INCLUDED | Course launch guard [#165](https://github.com/jaclose/AXOM/pull/165) | `b8658774f14fbd32ee1fa6abf3afe9435a1e74e6` | Refuse malformed handoffs and unreadable active runs. |
| INCLUDED | Community [#121](https://github.com/jaclose/AXOM/pull/121) | `cac8f4c6c87226cf84680f155452289e63e316be` | Social/profile/signup/privacy stack and migration; optional dashboard widget and seed widget enum excluded. |
| INCLUDED | Media runtime [#321](https://github.com/jaclose/AXOM/pull/321) | `ade4599767fa1f802ef9b67028df559231158175` | Verify immutable private media receipts and repair missing remote objects without changing private scope to academic scope. |
| INCLUDED | Media final QA [#338](https://github.com/jaclose/AXOM/pull/338) | `66e07ffa207449620fa58b333fdb19d4d2264c1a` | Cumulative media test evidence, including outage retry and equal-length corruption. |
| INCLUDED | Journal source [#315](https://github.com/jaclose/AXOM/pull/315) | `14f741a0595765743a55efde8dc3875aa563d25d` | Selected Journal paths; local hydration and locking corrections remain part of this candidate. |
| INCLUDED | Journal regression [#337](https://github.com/jaclose/AXOM/pull/337) | `6b4285c205176b5092952983d1379c462811e754` | Mounted stale-tab overwrite reproduction; test-only upstream evidence, repaired locally. |
| INCLUDED | Journal durability [#344](https://github.com/jaclose/AXOM/pull/344) | `ce6342acba200a65fc636f80969f0d2430cdc9f6` | Durable account-scoped per-editor feedback copies and account-handoff recovery; reconciled with the candidate's authenticated workspace receipt. Supersedes the interim shared-key Web Locks approach and initial `80dc5b0` source. |
| INCLUDED | Exhibit UI [#331](https://github.com/jaclose/AXOM/pull/331) | `bf3c535bdd7e800c4c09ba1cc2df70f9c9206c38` | Final exhibit identity, focus, cancellation and object-URL failure isolation, extended locally to account storage scope. |
| INCLUDED | Actual IndexedDB regression [#340](https://github.com/jaclose/AXOM/pull/340) | `9644a2ca457955795e5aa0ff5d0a40467c788cc7` | Preserved real-byte A-to-B reproduction; local harness binds the same identity bridge as the account store. |
| INCLUDED | Non-destructive maintenance [#341](https://github.com/jaclose/AXOM/pull/341) | `ec7ca0ef2d9997e0004c83ba4cbf5b4293c4bf22` | Stops automatic origin-wide image deletion; extended with scoped reads, writes, exports and URL invalidation. |
| SUPERSEDED | Community predecessor [#115](https://github.com/jaclose/AXOM/pull/115) | `79ca5a2d4997eaa848d944e93afceff67c317bb9` | Superseded by selected #121 work, not a second independent implementation. |
| SUPERSEDED | Media intermediate [#285](https://github.com/jaclose/AXOM/pull/285) | `1117aa71bbe12d70e88473f10822ecb0fb9e11a5` | Incorporated through the later #321/#338 media source. |
| SUPERSEDED | Media intermediate [#308](https://github.com/jaclose/AXOM/pull/308) | `20e6a4b44faa2fe2ef1b55c7c2516de5a8371d24` | Incorporated through the later media source. |
| SUPERSEDED | Media intermediate [#317](https://github.com/jaclose/AXOM/pull/317) | `2a75915c6aa81ef9d6552b75197410020bcd44de` | Incorporated through the later media source. |
| HELD | Frozen gateway candidate [#141](https://github.com/jaclose/AXOM/pull/141) | `25ed28dc05547d8acf893c5e5287880fc374ab86` | Audited routing/SOP reference; not this candidate and not deployment evidence. Its older manifest cannot approve the present combined changes. |
| HELD | Naming proposal [#164](https://github.com/jaclose/AXOM/pull/164) | `6adc612e99fde7709a4e3417c9318a0c2d5f06b1` | Naming reference only. CONVERGENCE denotes a coherent multi-workstream release; this document does not assign a shipped version. |
| ALREADY_IN_MAIN | Baseline main | `382308aba5ececd039285d4b8ccee9a181b40d7c` | Existing code and migration history retained as the integration baseline. No older PR is independently classified as merged without ancestry evidence. |

## Local corrections and preservation

- Explanation save waits for vault persistence and exact readback before clearing
  drafts or showing success. Failure preserves inspected text. Retry may replace
  only this operation's exact optimistic revision; later question edits and account
  transitions invalidate it.
- Endorsements survive safety takedown. Publication epochs separate old and new
  approval counts; a learner's current unlike does not delete previous editions'
  endorsements. Upgrade coverage includes preexisting approved and unavailable rows.
- Image bytes use account/device namespaces while existing metadata IDs remain
  stable. Operations and mounted URLs are bound to account-transition tokens.
  Legacy bytes stay on disk. A preserved device-account link can establish the
  legacy owner; absent evidence remains unassigned, never claimed by the next
  reader. Explicit device adoption copies known device-owned images and leaves
  originals intact. Portable restore remains available offline.
- Physical vault version 5 is an old-client barrier for image ownership. Existing
  stores remain intact. Automatic image garbage collection remains disabled.
- Original-source PDFs receive the same account-transition guards and shared
  durable legacy-owner authority. Their separate cache schema version 2 blocks
  older unscoped clients; source preview canvases clear immediately on account
  transition. Known-device adoption copies originals explicitly and retains the
  old bytes. This is a local client-storage change, not a hosted SQL migration.
- Templates gain discoverable imports, keyboard access, meaningful empty states,
  and a bounded batch size supporting the existing 28-template corpus. Historical
  templates remain templates, not a claim of current school schedules.
- Community sharing remains consent-based. Profile previews and full profile
  dialogs do not imply automatic progress sharing. The older-schema fallback is
  limited to compatible reads and reports unavailable capabilities.
- Root-owned navigation, notifications, operator/native configuration and account
  progress/status corrections are part of the combined diff and require the final
  release owner's source and validation review.
- Explicit device adoption issues the Journal hydration receipt only while its
  initiating account-transition token is current. A refused cloud checkpoint does
  not undo the learner's choice of local workspace; an ordinary sign-in or an
  A-to-B-to-A transition cannot authorize that workspace implicitly.
- Feedback editors retain separate durable writer keys, preserve legacy bytes,
  and expose saved copies for recovery. Failed local saves remain exportable in
  their originating account's tab memory, including after a successful Send.
  The integrated Journal uses the real authenticated workspace receipt by
  default; unverified account transitions keep the editor paused.
- Returning linked accounts activate the Journal only after successful local
  vault hydration, a matching stored account link and an unchanged transition
  token. Owned Journal actions carry the receipt forward from the exact prior
  array so navigating away and back does not strand a valid notebook.
- Central reviewed-import saving pins the initiating account even for plain
  callers. Each original/image operation, metadata commit, rollback and cleanup
  checks that scope; in-flight operations are separated by account generation.
  Reset/start-fresh image cleanup retains the same scope across its asynchronous
  inventory step, preventing a late cleanup from deleting another account's bytes.

## Forward-only SQL plan

These eleven migration files are present in the candidate. Their presence and local
PGlite checks do not establish hosted execution. Preserve previously numbered
migrations byte-for-byte; deploy the additive upgrade sequence and record the
actual database result separately.

| Migration | Purpose |
| --- | --- |
| `20261105000000_workspace_reference_validation_batch.sql` | Independently deployable account-save repair using indexed batch reference checks; depends only on the deployed baseline and can precede the nine held feature migrations. |
| `20261105010000_restore_v2_retention_cleanup_window.sql` | Restore the legacy endpoint's existing 60-second allowance on v2 only; preserves the atomic writer, access rules and existing history retention. Separately awaiting live-setting approval. |
| `20261106020000_community_experience.sql` | Community profiles, consent and conversations/progress support. |
| `20261108182000_question_set_review_revision_guard.sql` | Bind review actions to an exact revision. |
| `20261108200000_question_set_snapshot_type_guard.sql` | Reject malformed snapshot scalar types. |
| `20261109000000_question_set_approved_evidence_guard.sql` | Preserve approval evidence integrity. |
| `20261109020000_question_set_projection_consistency.sql` | Keep public projections consistent with reviewed snapshots. |
| `20261109030000_question_set_import_revision_authorization.sql` | Authorize the exact imported approval revision. |
| `20261109040000_question_set_approval_provenance_gate.sql` | Enforce publication provenance; historical source retained. |
| `20261109060000_question_set_import_tag_projection_upgrade.sql` | Add the forward tag-projection correction without rewriting earlier SQL. |
| `20261109070000_question_set_like_revision_integrity.sql` | Retain endorsement history with publication epochs. |

The independently reviewed sync repair
`20261105000000_workspace_reference_validation_batch.sql` changes one function,
with no row deletion, policy change,
privilege broadening or global timeout increase. Production logs at
2026-11-09 16:35–16:40 UTC locate SQL 57014 inside the old repeated Storage
lookups. Readback still shows checkpoint 71 from September 30 after image
recovery and upload. JD approved and the release owner applied only this repair
to AXOM Production on November 9. Ledger and invoker-security readback passed.
All 33 migration tests passed, including occupied upgrade,
rollback/reapply and a 20,000-distinct-source stress case with 20,000 image
references. On the contended local PGlite runtime, the representative
1,300-source/116-image checkpoint improved from 1,187ms to 421ms; the large
checkpoint took 7,882ms. These are local measurements, not a hosted latency
guarantee. Indexed path probes prevent quadratic rescans when RLS cardinality
estimates are low; unrelated objects are never size-cast before path matching.
The reviewed SQL SHA-256 is
`4b5a38e2f19361aa2c1ee8cdcb0c6ea6c5ee5cf42524ac5d407a68b64691b380`.
Its local rollback restores the function from
`20261013230000_shared_account_content_references.sql`; it does not undo or
delete account checkpoints. Hosted repair success requires a fresh owner's
save and matching revision/hash readback, followed by reload verification.
The production CLI rehearsal used an isolated copy of the 44 applied migration
files plus this repair. All 44 local/remote versions matched; `db push --linked
--dry-run` listed only `20261105000000`, with no seeds or roles. The rehearsal made
no database changes. The isolated boundary preserves the pinned migration version
is retained and the nine other feature migrations remain excluded. The isolated
apply then completed successfully with exactly that migration and no seeds or
roles. A live save passed the repaired file checks but timed out in the unchanged
private writer's history-maintenance DELETE. That transaction did not establish
a new protected version; checkpoint 71 remains the last confirmed version.

Read-only production diagnosis found 60 retained revisions totaling 287,648,283
stored bytes, with 50 currently eligible for the existing 50 MB retention rule.
The candidate-selection query took 6.499ms. The legacy public save endpoint has
`statement_timeout=60s`; v2 lacked that setting and fell back to eight seconds.
The follow-up migration restores the same bounded allowance only to v2 and
reloads PostgREST's schema cache. It does not change function bodies, ownership,
grants, invoker security, global role limits or retention selection. Its own DDL
does not delete rows; a later successful save performs the existing atomic
history cleanup. Separate live-setting approval is pending.
The new migration's three tests and two existing budget/count checks passed;
typecheck and scoped lint passed. Its SHA-256 is
`360e311bc7642352c1306f930f3c7e415945f869f947654eceaafdcd02c4bedd`.
The second isolated production dry run lists only `20261105010000`, with no
seeds or roles. No manual cleanup or timeout change has been applied.

A fresh portable safety export was verified before further recovery: 1,216
questions, 268 tracker rows, 116 images and 30 original files. All 114 previously
archived images remained byte-identical; the two recovered images are included.
Questions, tracker rows, sets, documents, Journal and quiz sessions match the
earlier export. The UI reports 39 unavailable/over-limit original-file references.
The live tab also reports a local-save problem and must remain open until both
cloud and local persistence are verified; exporting is not proof of either.

## Content and production boundaries

Private question text, source documents, image archives and prepared catalogs are
not included in this public repository change. Source-backed answers, reviewed
teaching explanations and distribution rights remain separate checks. AI drafts
are provisional teaching text and never infer missing answer keys. Visual metadata
prepares future diagram use; it is not an approved medical diagram asset library.

The available template corpus was checked separately: 28 templates and 672
activities parsed with hashes verified, then 14 modules/672 activities installed
and reloaded in an isolated test workspace. This is not evidence of installation
in the learner's production account. A private four-template Term 4 supplement
adds 266 parsed activities (FTCM 57, NCRS 67, RHPS 57, DERS 85). All 266 map to
existing saved tracker IDs in a metadata-only review package, with no changes to
labels, paths, IDs or progress and no new rows. DERS retains its source's stated
Weeks 15–20; 12 literal learner week labels remain provisional and 169 other
activities remain unscheduled. Two missing-material placeholders stay separate.
The supplement is prepared, not installed in the learner account; 126 rows lack an exact slide locator,
and the source package's calendar screenshots were not independently recovered.
The combined 32-file browser run loaded 936 of 938 parsed source rows, reloaded,
and reimported with zero additions and unchanged progress. Two identical FTCM
source rows remain visibly held; both original tracker identities are preserved
in the private review artifact. A false NCRS lecture-number collision was fixed
by recognizing only the current module's number prefix or known aliases. Generic
references to other courses retain title-based identity; literal lecture numbers
and existing labels remain intact. Independent upgrade review found that an old
foreign-prefix numeric key could still transfer progress to the corrected lecture.
Those legacy keys now remain held for identity review, in either source order and
after learner week changes. All 68 focused parser/reconciliation tests passed.
The newer external-drive QBank package was
not available for this integration; older internal packages have different counts
and must not be described as the same complete reviewed corpus.

The November 9 private census recovered 13,777 source-question identities and
12,380 distinct content signatures, with 24 conflicting revisions held. These
are not certified clinical uniqueness or publication counts. The supplied eight
slide PDFs contain 29,611 physical pages; the T3 compilation repeats 2,815 pages
from the pre/post-midterm files. A private hash-bound sorting overlay records
12,445 term/module proposals, 1,308 unresolved identities, and the 24 conflicts.
It preserves source and learner week labels separately, assigning no invented
official weeks. Private source text and the overlay are outside this repository.

## Native package groundwork

`npm run release:doctor` passed on this Mac after dependency installation: the
canonical root `src-tauri` project, Node 22.23.4 and Rust are available. Version
remains `0.0.3-prebeta`; the application identifier and local database identity
are unchanged. Updater credentials are not configured, so local desktop updates
remain disabled. Signing/notarization and actual package execution are unverified.
No installer, release ZIP, tag, GitHub release or downloadable app was generated.
The existing [desktop procedure](../DESKTOP-RELEASE.md) is the packaging handoff;
its outdated Node/CI instruction was corrected to the installed pinned toolchain.
Root and web production dependency audits report zero vulnerabilities. Native
distribution remains held for the existing updater's transitive `zip 4.6.1`
[critical advisory](https://github.com/advisories/GHSA-m665-v7pm-7grj); compatibility
must be validated before changing its major version or producing an installer.
Optional crawler and development-tool alerts are separate from the web runtime.

## Verification and outstanding gates

Worker evidence before final integration included targeted QBank publication and
import checks, media recovery tests, tracker/template checks, Community migration
and consent tests, and a real two-tab Journal regression. These are scoped receipts,
not a substitute for the combined candidate gate.

Recorded local checks: repository 43/43, release tooling 89/89, API types, web
types/lint/build, production update consent/recovery and offline checks passed.
The full unit sweep reported 5,301 passing tests, two timeouts and three worker
startup failures; all five affected files passed unchanged on a focused rerun
(19/19). This does not count as a clean full unit sweep. Final migration coverage
passed 33/33; Journal/account coverage passed 123/123 and import account-boundary
coverage passed 69/69. The complete local browser sweep reported 189 passed,
14 skipped and seven failures: three stale assertions for intentionally hidden
pages and four host-stall timeouts. The hidden-page browser expectations were
corrected while retaining sourced-school/filter capability coverage as component
tests. All 16 cases across the five affected browser files then passed, including
the unchanged timeout cases. This is a full sweep plus focused recovery, not a
second clean full sweep. Exact-head hosted checks remain outstanding.
A hosted release-tool failure exposed a stale source
integrity hash after the final attachment diagnostic change; regeneration kept
the communications bundle identical and the 89 release tests passed again.
The bb9ac62b hosted preview was opened in a fresh, signed-out browser workspace:
unfinished navigation was absent, notification overlays stayed above dashboard
cards at 1440×900 and 390×844, close/Escape worked, and the console had no captured
errors or warnings. This verifies that preview's shell, not live account acceptance
or a subsequent commit's complete release gate.

The release owner records final results and exact candidate commit here:

- [ ] Final reviewed diff, source manifest regeneration and repository checks.
- [ ] Combined typecheck, lint, affected/full test suite and web build.
- [ ] Desktop/mobile/reduced-motion browser journeys, offline reload, media and
      template imports, account switching, Journal concurrency and consent revoke.
- [ ] Version-4 to version-5 vault upgrade/blocked-upgrade recovery.
- [ ] Fresh and upgrade PostgreSQL migration evidence, authenticated RLS and
      rollback/recovery rehearsal for the exact selected migration set.
- [ ] Real account checkpoint readback and original/media recovery; synthetic
      IndexedDB/backend tests do not establish production account acceptance.
- [ ] Final integration commit/branch/PR and gateway disposition, then the actual
      deployed commit and live readback if production release is separately enacted.
- [ ] Native groundwork review, with no native build/download/package claim.

Gateway source: [FORGE issue #140](https://github.com/jaclose/AXOM/issues/140).
Its audited 2026-11-09 checkpoint was **HOLD / NO PUBLISH**. This candidate resolves
selected source defects but does not retrospectively convert prior comments,
isolated green checks or prepared content into release approval.
