# AXOM academic content convergence — six-chat contract (2026-10-14)

## Objective and truth condition
Deliver one maintainable, local-first QBank + Course Tracker for SGU T1–T5: ingest all *available and authorized* source materials and 22 supplied course-template files; classify, review, deduplicate and securely persist each acceptable question/activity; expose reliable term → module → week → source browsing/practice; then verify exact coverage against a reproducible source inventory. No fabricated questions/answers, unverified "100% imported" claims, or silent skipped records. A rejected/unsupported source is a visible inventory exception, not an invisible omission. Commercial/school content remains private unless distribution rights are independently established.

## Non-negotiable operating rules
- Use ONLY the already-existing working checkout: `$HOME/Developer/AXOM-academic-library-v1` (currently `feat/academic-library-v1`, HEAD `d5f9c030`). **No new branches, worktrees, detached HEAD, stashes, broad checkout/reset/clean, history rewrites, force pushes, or opportunistic reformatting.**
- Current checkout has pre-existing uncommitted work including import UI, question PDF conversion, library and sync files. Every worker inspects and preserves existing diffs before editing; none may discard or claim someone else's work.
- **Role 0 (integration lead) alone stages and commits, and alone changes `web/package.json`, lockfiles, shared type contracts or cross-role files.** Roles 1–5 NEVER run git add/commit, push, migrations against production, deployment or branch manipulation.
- File ownership is EXCLUSIVE (see below). For changes outside ownership, describe exact interface/required patch in `.coordination/qbank-2026-10-14/role-N.md`; do not edit outside your zone. The untracked coordination directory is ignored intentionally; it is NOT product content.
- Existing code and contracts are the integration point. Prefer simplifying duplicate paths, not installing parallel databases, stores, serializers or pipeline abstractions. Changes must be focused and regression-tested.
- Do not commit original PDFs, slides, answer keys, commercial bank content, user data, tokens, secrets, extracted full-text corpora, or proprietary screenshots; the repository is public. Keep source inventory and prepared banks in ignored `artifacts/` and private storage.
- Supabase writes require account ownership, RLS, idempotence, checkable counts, and dry-run/reconciliation; public/community visibility is strictly opt-in and license-safe.
- No user-facing "completed" badge until installed/ready/review/rejected/pending counters reconcile, and cloud re-read proves successful persistence.

## Role ownership (one shared checkout)
**0 — Integration lead / architecture / QA / sole committer (THIS CHAT)**
Owns `docs/operations/qbank-course-tracker-six-agent-2026-10-14.md`, `scripts/operations/**`, global gates, code-quality reviews, integration conflict resolution, and targeted commits. Owns changes to shared contracts/packages only after coordinating interface requests. Leads no parallel implementation of specialist-owned files.

**1 — Source archivist / provenance / coverage**
Owns `scripts/qbank/**` (source audit utilities), and ignored `artifacts/qbank-6way-20261014/**` inventory reports. Read-only against source roots outside this checkout. Enumerates T1–T5 from template/source folders and Downloads/attached drive; verifies SHA256, duplicate variants, answer keys, rights/provenance, missing source coverage, page and image mapping. Outputs actionable manifest and triage queue, not fake question records. Does not edit app or database code.

**2 — Input formats / parsing / import review**
Owns `web/src/lib/privateLibrary/**`, `web/src/lib/question-content/**`, `web/src/components/questions/ImportPanel*`, `web/src/components/questions/BankImportReview*`, and their own test files. Supports paste, single/multiple files, ZIP, folder, PDF/DOCX/TXT/JSON and honest unsupported formats; native and prepared packages; no forced catalog.json for ordinary raw import. Preserves partial scans, image attachments, source citations and explicit review before finalization. Does not modify persistence or other question-browser components. Pre-existing dirty files in this zone must be preserved.

**3 — Persistence / backend / account sync / security**
Owns `web/src/lib/academicLibrary/**`, `web/src/lib/cloudLibrary/**`, `web/src/lib/sync/**`, `web/src/lib/account/supabase.ts`, `web/src/lib/library.ts`, `web/src/lib/questionImportSave.ts`, relevant `supabase/migrations/**` and security tests. Makes one canonical ingest/save path, replay-safe transactions, source versioning, private/public separation, RLS and upload/rehydration validation. Does not modify the parser/input UI, tracker or question-browser components. Pre-existing dirty changes in this zone must be preserved. **This is the only role permitted to propose backend data writes**, after baseline reconciliation.

**4 — Curriculum / tracker template completion**
Owns `web/src/lib/course-engine/**`, `web/src/lib/courseScheduleImport*`, `web/src/pages/CourseTrackerPage*`, `web/src/styles/course-tracker.css`, `web/src/components/bookshelf/**`. Reads the 22 source template TXT files (11 modules / initial parser reports 547 activities); creates T1–T5 assignments only with evidence and marks inferred week placements as inferred; fixes duplication/idempotency and links content to tracker statuses. Does not edit source files, backend, or question-browser UI.

**5 — QBank UX / practice / navigation**
Owns `web/src/pages/QuestionWorkspacePage*`, `web/src/pages/SharedQuestionSetPage*`, `web/src/components/questions/BankBrowser*`, `web/src/components/questions/CourseBankBrowser*`, `web/src/components/questions/QuestionBankLibrary*`, `web/src/components/questions/LibraryPanels*`, `web/src/components/questions/ExamRunner*`, `web/src/styles/questionbank.css`. Streamlines hierarchy T1–T5 → course/module → week → PQ/IMCQ/eSoft/personal, with first-class mode selection, search, counts, readiness badges and practice. Avoid duplicate question models / progress stores; no changes to import UI or backend-owned files.

## Handoff contract and cadence
Every role first records `git status --short`, own file scope and existing related diffs in `.coordination/qbank-2026-10-14/role-N.md`. Update it after completing a coherent slice with:
- what changed (paths and key behavior);
- what was verified (commands and pass/fail, with outputs);
- how many source files / unique banks / candidate / ready / review / rejected / uploaded records (using explicit denominator);
- specific pending dependencies and requested cross-role interfaces;
- known risks, fallback and idempotent resume instructions.
Workers read other role notes before changing interfaces; do not overwrite their logs. If another editor owns a dirty file, write an interface request instead of racing to save.

## Completion criteria
1. Complete and auditable source inventory: unique SHA-256, original path, original source type, answer variant, provenance, term/module/week/type confidence, page/asset links, duplicate pairing and explicit review reasons; distinguish source files, assets, packages, questions and tracker rows.
2. Tracker: 22 supplied template files parse without dropped lines; all 547 baseline activity entries and later discovered authoritative curriculum activities map to concrete stable IDs; explicit vs inferred weeks visibly distinguished; re-import is idempotent.
3. Import: raw single/multifile/paste/ZIP/folder and prepared packages follow one clear path with actionable failures; safe resource limits, visible input detection, truthful parsing of choices/correct answer/explanations/images and source attribution, user review for ambiguity.
4. Backend: RLS/ownership/security tests; exact checksums and no duplicate inserts on rerun; uploaded objects are re-readable across new sessions; local-first offline behavior remains usable, explicit sync state and per-source remediation.
5. QBank: usable direct T1–T5/week/activity navigation, readily visible modes, no empty misleading counts, answer-aware practice only after review, same data model as courses/tracker.
6. Run focused role tests, then integration lead runs `npm run typecheck`, lint/appropriate tests/build, targeted browser smoke and backend verification. Classify pre-existing failures vs regressions. Never commit a failing/untested integration as complete.
7. Sole lead stages ONLY approved files, audits diff for secrets/private material, commits with exact SHA and records actual inventory/cloud counts and omissions. No automated deployment/push without authorization.

## Baseline evidence (scoped, not comprehensive)
2026-10-14 read-only local inventory used six known folders: 492 files, 281 byte-distinct, 211 byte-duplicates; the 281 include images, catalogs, assets and document originals, not 281 distinct banks. Source mapping unresolved for 248 unique files, frequently because package assets/manifests are not question sources. 22 template TXT files parse into 11 module plans with 547 activities, no template parser errors in this pass. Baseline private manifest is in ignored `artifacts/qbank-6way-20261014/manifest.json`. No verified online/backend import count yet. These are starting measurements only.
