# AXOM QBank held-question curation and filing | execution checklist
**Checkpoint:** 2026-11-12 · **Release authority:** AXOM FORGE #140 · **Delivery tracker:** #22

## Scope and evidence boundary
This is the executable checklist for a **private-user QBank review/filing exercise**, not authorization to publish school-originated material. Count scopes are different and must not be added:
- Earlier authenticated browser audit: 79 held in the installed prepared collections (18 DERS, 61 RHPS); 91 saved sets; 1,088 questions under *Unfiled & mixed*. These are prior-time observations, not a refreshed backend snapshot.
- Locally audited RHPS ZIP catalogs: five learner banks with 81 package-ready and 24 held, plus one non-learner answer-key companion. The 24 pharmacology questions were held because answer evidence came from highlighted reveal slides.
- Prior DERS Week 2 ZIP audit: 73 questions. Package completeness is not independent answer or redistribution approval.
- The user-private CSV is `AXOM_QBANK_CURATION_2026-11-12.csv`, stored locally outside this repository; do not commit source PDFs, user identifiers, full question text or images here.

At the 2026-11-12 11:26 AST audit, the Mac had ~109 MiB available and the JDabSSD source volume was not mounted. Desktop Commander then went offline. Do not bulk-import or create large duplicate worktrees under this disk pressure. Do not delete user data, Git worktrees, browser stores, or active worker output to free space.

## Safety first: prerequisites
- [ ] Restore several GiB of dependable free space using user-approved *regenerable* caches only; identify the consuming process and recheck after growth.
- [ ] Reconnect the authenticated browser and the authorized Mac; confirm exact profile and existing live QBank state.
- [ ] Verify an independent, readable, restorable workspace snapshot before any bulk rename, refiling, reimport, or source review mutation.
- [ ] Compare active content worker ownership against the current issue #22 / FORGE #140 ledger. Work on isolated branches, do not touch another worker's dirty worktree.

## Per-source and per-set curation
- [ ] Enumerate each of the 91 *currently existing* saved sets (after fresh readback), keeping original set ID, members, revision, source checksum, term/module/week and learner attempts.
- [ ] For each source, join by canonical original checksum and exact original filename; distinguish source **document** labels from saved learner **set** titles.
- [ ] Propose `Term · Module · Medical domain · Assessment type` as a human-readable title. Include a week only when confirmed by the source/curriculum, otherwise show *Week unconfirmed* or an explicit provisional tag.
- [ ] Review held questions individually against the source: stem, answer-key evidence, option ordering, diagrams and role (question vs post-answer), explanation accuracy, duplicate identities and rights/audience permissions.
- [ ] Preserve held/review-required state when an answer key, figure, rationale, rights basis or scope lacks support. No inferred key or automatic ready promotion.
- [ ] For the 1,088-item *Unfiled & mixed* display group, classify each question by provenance rather than assuming all entries are misfiled or belong to DERS/RHPS. An evidence-free record remains reachable and unfiled.
- [ ] Make the smallest reversible batch of actual private set-title/filing changes; preserve original source bytes and user overrides.
- [ ] After each batch, confirm commit receipt, reload readback, exact question memberships, course/week totals and retained historical attempts. If cloud sync is pending/failed, report it as pending/failed.

## Engineering and regression gates
- [x] Reproduce source-review display weakness: original PDF filenames are shown instead of the bank-specific title.
- [x] Implement a source-title presentation adapter (never edits identity or readiness) and add targeted source/mismatched-provenance tests on an isolated branch.
- [ ] Pass the repository's own Vitest, TypeScript, lint, build and relevant browser tests at the exact commit SHA.
- [ ] Validate source title, original filename, provisional week and held counts on the authenticated AXOM page after refresh.
- [ ] Prove save → reload → account A/B isolation → account A restore with unchanged attempts and scope, including failure/rollback paths.
- [ ] Independently review a frozen release candidate; link exact head, CI evidence, owner approval, backup and rollback procedures to FORGE.
- [ ] Only after verified source rights, answer review and moderator authorization, publish eligible immutable releases; verify access on an eligible second account and denial on an ineligible account.

## Non-goals and stop conditions
Never equate local ZIP `ready` with human clinical approval or backend publication. Never publish an entire held batch, infer missing lecture weeks, silently discard unsupported questions, bypass independent FORGE approval, or move unrelated learner records. No migration, main merge, production deploy, or live-source publication is implied by this checklist.
