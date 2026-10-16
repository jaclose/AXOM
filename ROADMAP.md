# AXOM — Roadmap, In-Progress & Proposed Ideas

Living backlog. Update this regularly: move items to [FEATURES.md](FEATURES.md) when they
ship, add proposed ideas here as they come up, and be honest about status.

Statuses: **in-progress** (partially built, gaps known) · **next** (agreed, not started) ·
**proposed** (idea, not committed) · **blocked** (needs something first).

Last updated: 2026-07-14

## Wave 6 — Academic Operating System

Wave 6 ("From Tool → Companion") is defined and recorded in
[docs/WAVE-6-PLAN.md](docs/WAVE-6-PLAN.md): Import Engine 2.0 (P0, binding
spec in [docs/UNIVERSAL-QUESTION-IMPORT-ENGINE.md](docs/UNIVERSAL-QUESTION-IMPORT-ENGINE.md)),
Course Tracker 2.0, Dashboard 2.0, Command Brief 2.0, Productivity OS, Journal
OS, Daily Check-In, Reports 2.0, Daily Word, Identity, Help, Backup, and
future-accounts architecture. Course Central (design-only, no live LMS
connectors) is specified in
[docs/COURSE-CENTRAL-ARCHITECTURE.md](docs/COURSE-CENTRAL-ARCHITECTURE.md).
Planning is frozen by the
**[Pre-Alpha Master Implementation Contract](docs/PRE-ALPHA-CONTRACT.md)**
(2026-07-15): every session now implements, tests, or reviews one checkpoint.
The Wave 6A implementation sequence (Steps 0–13, preconditions, acceptance
gate) is binding in
[docs/WAVE-6A-EXECUTION-PLAN.md](docs/WAVE-6A-EXECUTION-PLAN.md); the
corpus review manifest awaiting Jafar's marking is
[docs/CORPUS-CANDIDATES.md](docs/CORPUS-CANDIDATES.md). The final
pre-Alpha planning consolidation — deferred-feature audit, knowledge graph,
mastery engine, Journal Cinematic wireframe, Reports 2.0 wireframes,
readiness boundaries, future accounts, Alpha checklist — is recorded in
[docs/WAVE-6-CONSOLIDATION.md](docs/WAVE-6-CONSOLIDATION.md); the tables
below remain the living status ledger for those items.

## Question Bank

| Item | Status | Notes |
| --- | --- | --- |
| OCR for scanned PDFs / screenshots | in-progress | A private, opt-in operator path now uses local Poppler + Tesseract for image-only PDFs up to 20 pages. Its transcription is always provisional and review-held, never practice-ready. Browser import still has no OCR and truthfully stores scans as provenance only; screenshot OCR and wider activation remain deferred pending benchmark and source-review evidence. |
| Legacy Word `.doc` import | blocked | Mammoth handles modern DOCX only. Binary `.doc` needs a separate, security-reviewed conversion path. |
| Original source-binary retention | blocked (architecture only) | The library stores extracted/page text, metadata, and SHA-256 checksums today, not PDF/DOCX bytes. **Decision recorded 2026-07-14 (Jafar, Wave 6 finalization): do NOT implement retention yet — architecture only.** Approved architecture: user-selectable retention with extracted-text as the default; per-import "keep original file" opt-in; blobs in a **separate IndexedDB object store**, never in the workspace payload; portable JSON backups stay lightweight (originals excluded unless explicitly included); storage-quota warning required. FS-Access handles remain a Chromium-only later enhancement. Implementation waits for an explicit go-ahead; gates Wave 6C. |
| Complex PDF layout recovery | in-progress | Digital text extraction is live and page-aware; columns, tables, unusual positioning, and damaged text layers can still require review. |
| Per-question AI explanation generation for imported sets | next | One call per question is expensive; needs batching UX + progress. Digest-level analysis shipped instead. |
| AI dedup of imported questions | next | Similarity check on import (normalized stem match shipped for cards, not yet questions). |
| Timed-block per-question pacing stats | in-progress | Coarse seconds are recorded; no pacing UI yet. |
| Faculty-style question mode (filter by analyzed style) | proposed | Analyzer exists; the mode filter is labeled "soon" in the bank browser. |
| Exam-simulation mode (full-length, sectioned) | proposed | Exam blocks + timer shipped; full simulation (sections, breaks) not built. |
| Import from Anki decks (.apkg) | proposed | Currently unsupported file type with a clear message. |
| Answer-choice-level analytics (distractor pull) | proposed | Requires per-option pick tracking (recorded, not surfaced). |

## AI layer

| Item | Status | Notes |
| --- | --- | --- |
| Secure cloud AI proxy (BYOK server-side) | blocked | Without a configured local/demo endpoint, optional AI actions are unavailable. Cloud calls stay disabled until a Vercel proxy handles secrets + consent. Never put keys in the client. |
| AI-proposed Command Brief overlay | next | Schema + validator + provider exist (`validateAiBrief`); needs the review-overlay UI. |
| WebLLM / in-browser models | proposed | Ollama covers local today; browser models when mature. |
| AI error-type classification of misses | in-progress | Provider interface + mock exist; not wired into tutor flow. |

## Data & platform

| Item | Status | Notes |
| --- | --- | --- |
| Dedicated IndexedDB records / attachment store | proposed | Journal Foundation safely supports bounded images inside the existing local workspace graph. A separate binary/per-record store for larger or cross-notebook media still needs migration, quota, export, and recovery design. |
| Code-splitting the main bundle | in-progress | xlsx + pdf.js + mammoth are lazy chunks; Daily Word and its versioned word lists now ship as isolated lazy assets. The App shell chunk still exceeds 500 kB, so broader route-level splitting remains proposed. |
| First-navigation offline precache | proposed | The current worker caches hashed assets after a controlled successful fetch. Daily Word reopens offline after that boundary, but a first-ever offline bootstrap before worker control is not supported; improving that requires a build-aware precache design. |
| React hook dependency hygiene | in-progress | The current Wave 5.5D tree reports zero ESLint warnings. Keep the full lint gate in every checkpoint so stale-closure risks do not return. |
| Cloud sync hardening (PIN auth, sessions) | blocked | No cloud/account claim is exposed in primary Settings. Retained experimental code needs real auth, consent, and security review before it can become a product surface. |
| Restore-history audit trail | proposed | Settings accurately shows local snapshots and last portable export, but does not yet persist a separate restore-event history. |
| Exact vault-write timestamp | proposed | Autosave is active, but the vault does not currently retain a user-visible timestamp for every successful write. |
| AnkiConnect verified sync (dry-run preview, deck mapping) | next | Diagnostics exist; not machine-verified. |
| Native/Tauri shell refresh | proposed | Metadata rebranded; end-to-end native vault behavior unverified. |
| Calendar integration (day plans → calendar blocks) | proposed | Standard formats (ICS) first. |
| Premium tier activation | blocked | Scaffold shipped (`lib/tier.ts`), everything free during beta by design. |

## Product surfaces

| Item | Status | Notes |
| --- | --- | --- |
| Dashboard/Reports surfacing quiz sessions | next | Results live in the Question Bank tab today. |
| Pitfall Map as a dedicated surface | in-progress | Digest pitfalls ship on set cards; a cross-set pitfall dashboard is proposed. |
| Application Checker maturation | proposed | Shell exists; no data gathering yet. |
| Leaderboards | proposed | Deliberately deprioritized — conflicts with the calm tone. |
| Doctordle collaboration | blocked | The enabled Daily Games folder contains only a static WIP boundary. No external integration, iframe, launch action, network request, or copied gameplay will be added without explicit collaboration approval. |
| Widget-engine refinement | proposed | The Wave 5.5D engine implements four sizes, field settings, presets, add/remove, mouse and keyboard ordering, responsive spans, backup, and a soft extra-large override. Future work may add richer widget-specific settings and touch-drag convenience; keyboard move controls remain the required mobile path. |
| Journal Cinematic | next | Keep this separate from Journal Foundation: desk scene, notebook pickup, physically animated cover/page behavior, richer spatial image placement, and optional sound/haptics. It must wrap the semantic notebook, honor reduced motion, and never become required for writing or recovery. |
| Optional release/signup email capture | proposed | No live collection ships in Wave 5.5D. Any future form needs explicit consent, a truthful provider/privacy boundary, accessible success/failure states, and no workspace payload. |
| DAT / CASPer lanes | proposed | Light surfaces only. |
| Accessibility pass (focus traps, contrast, reduced motion) | in-progress | Modal focus containment/restoration, quiz selected-state semantics, mobile-drawer inert/focus behavior, Settings/Question Bank roving tabs, sidebar disclosures, onboarding/tour dialogs, missing-target fallback, and reduced-motion tour behavior are covered. A broader contrast/screen-reader audit remains. |
| AXOM-specific reduced-motion override | proposed | Current UI truthfully follows the operating-system setting; a product-level override needs shared runtime and CSS plumbing. |
| Scheduled-hours workload model | proposed | Recovery shows configured daily target, item counts, an estimated outstanding range, and recent completion history. A true calendar-backed planned-hours value does not exist yet. |

## Current review checkpoint

- Wave 5.5D Personal Operating System and Widget Rehaul (implementation complete;
  independent review pending): a sanitized real-layout question-import acceptance command;
  stricter answer/explanation boundary handling; seed-excluding Command Brief evidence
  gates and deterministic ranking; one target contribution ledger with exact aliases,
  corrections, and native units; Daily Check-In, Day at a Glance, closeout, local
  reminder/quiet-hours lifecycle; viewport-portalled tours and the post-global-guide
  Promise contract; a schema-v32 dashboard widget engine with four sizes, settings,
  presets, ordering, compatibility adapters, and a soft extra-large override; and the
  semantic Journal Foundation with bounded local images. Architecture is recorded in
  `docs/QUESTION-IMPORT-EVALUATION-HARNESS.md`,
  `docs/COMMAND-BRIEF-EVIDENCE.md`,
  `docs/TARGET-CONTRIBUTION-LEDGER.md`,
  `docs/DAILY-LOOP-REMINDER-LIFECYCLE.md`,
  `docs/DASHBOARD-WIDGET-ARCHITECTURE.md`, and
  `docs/JOURNAL-NOTEBOOK-ARCHITECTURE.md`.
- Deliberately outside this checkpoint: Journal Cinematic, route-level splitting,
  live email signup, cloud sync, hidden AI/Journal transmission, and Doctordle
  integration.

## Recently shipped (move log)

- 2026-07-13 — Wave 5.5C Core Comprehension and Import Reliability: unresolved-
  by-default answer mapping and mixed-key persistence, separated source provenance,
  source-document-first import, progressive Reports plus eligible trends, clearer
  setup/data-safety/Productivity language, explicit-name welcome and typed local
  quotes, evidence-ranked Command Brief, Course Tracker help, Daily Word clarity,
  deterministic Journal-energy notice, same-route module tours, optional post-guide
  Promise flow, and privacy-bounded email feedback → moved to FEATURES.md.
- 2026-07-12 — Wave 5.5A/B Daily Loop Stabilization: inclusive academic stages,
  configurable daily-success requirements with a neutral-by-default new-profile
  path, simplified Productivity Console with cycling placeholders and a neutral
  progress vessel, recent/frequent activity shortcuts, Pomodoro quick/custom
  saved presets, honest low-data Reports, evidence-gated Command Brief,
  focused Dashboard defaults, quick theme control, and persistent NEW-badge
  dismissal. The checkpoint also keeps the reviewed SCOWLv2 `general-2` Daily
  Word expansion with bundled license/provenance, checksum-pinned lazy lists,
  and non-destructive `general-1` puzzle continuity → moved to FEATURES.md.
- 2026-07-12 — Wave 5 optional daily utilities: disabled-by-default Daily Games
  disclosure and direct-route gate, original deterministic AXOM Daily Word with
  local history/stats/share, static Doctordle WIP boundary, compact digital and
  analog clocks with shared IANA timezone preferences, scoped reset and backup
  merge, lazy word-list isolation, and controlled offline-reopen verification →
  moved to FEATURES.md.
- 2026-07-12 — Wave 4 clarity and recovery: five-section Settings IA, accurate
  local-first/backup language, persistent migration-recovery card, exact-date
  journal reminder actions, deterministic energy/load provenance and overrides,
  safe four-step onboarding, and a keyboard/mobile-safe seven-step guide → moved
  to FEATURES.md.
- 2026-07-11 — Wave 3 Question Bank entry experience: focused first use,
  prioritized returning command center, deterministic recent sets, explicit
  Current mastery vs Attempt accuracy labels, canonical mapping-review counts and
  repair routing, accessible tabs, and responsive/theme browser coverage → moved
  to FEATURES.md.
- 2026-07-11 — Wave 2 identity and shell foundation: real inline AXOM SVG
  wordmark, centralized sidebar module maturity badges, corrected folder
  disclosure semantics, and flash-free Light/Dark/System theming with a
  device-local preference → moved to FEATURES.md.
- 2026-07-11 — Wave 1 behavioral reliability: habit tracking-start floor (no
  first-day "missed yesterday", pre-creation days excluded from adherence and
  heatmaps), root-owned Pomodoro clock with focus/visibility/pageshow
  reconciliation (runs on any route, single completion log), and preset-driven
  short/long break sequencing → moved to FEATURES.md.
- 2026-07-11 — Latest-attempt current-mastery metrics with separately named
  all-attempt historical accuracy, shared vault constants, verbatim stored-explanation
  rendering, and the persisted Question Bank browser journey → moved to FEATURES.md.
- 2026-07-10 — Question Bank Command Center, progress-rich set cards, structured
  quiz feedback, deterministic explanation cleanup, per-stage parser confidence,
  exact answer evidence, source checksums, schema v32 migration, and dev-only
  reusable design preview → moved to FEATURES.md.
- 2026-07-10 — Full-text bank/source/set search, weak-topic next actions, optional
  weakness coach, and AI explanation cleaner → moved to FEATURES.md.
- 2026-07-10 — IndexedDB backup hardening, same-question attempt-safe backup merge,
  mobile/modal keyboard accessibility, bundled production PDF worker, and AXOM package/
  wrapper identity cleanup → moved to FEATURES.md.
- 2026-07-08 — PDF/DOCX extraction, answer-key mapping, Source Library, Question Sets,
  Block Builder, AI set digests → moved to FEATURES.md.
- 2026-07-08 — AXOM rebrand, version unification, exam/tutor modes, quiz sessions.
- 2026-07-08 — Daily loop (Command Brief, sessions, closeout, recovery), Anki card vault,
  local AI provider layer, persistence hardening.
