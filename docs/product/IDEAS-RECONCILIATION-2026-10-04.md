# Ideas 1–6 reconciliation and Decode roadmap

Date: 2026-10-04. Owner: Codex. Documentation and architecture assessment; no runtime completion claim. Base inspected: `9f29327`, isolated branch `codex/axom-decode-v1`. Other worktrees retain their own edits and verification.

Authority: [Learning Intelligence doctrine](AXOM-LEARNING-INTELLIGENCE-DOCTRINE.md), JD's 2026-10-04 doctrine/Tutor follow-up and the 101-page Master Product Blueprint. Read the [index](../directions/01-ideas/INDEX.md) for individual historical statuses, not this domain-level reconciliation as a new production audit. The blueprint's source matrix is design evidence, not redistribution clearance or independently verified page counts.

## What changes

The Question-First Plan becomes an entry point into Learning Intelligence. Decode links curriculum, assessment, learner state and repair. Productivity becomes behavioral evidence; dashboard/report emphasis moves to one useful next action with reasons. Tutor becomes structured review rather than a generic chat overlay. The cumulative source becomes a concept-indexed atlas rather than a default public bank. (Blueprint pp6–17,27–38,98–101.)

The pasted directive requires doctrine and Ideas reconciliation, duplicate/gap assessment, priority update and link validation before a massive implementation wave. The subsequent execution request authorizes a coherent working slice after that assessment. The later checkpoint requires targeted current research/tools/bookmark review before choosing implementation. That research is a workstream input, not permission to replace the existing stack or ship additional unrelated features.

## Preserve and connect the complete idea lineage

| Domain | Existing idea lineage | Reconciliation under the doctrine | Priority |
|---|---|---|---|
| Question import, provenance, practice, exam profiles | I1-05/08/33; I3-25/33; I4-01; I5-03..10/13/16..25; I6-01/03 | Reuse the canonical bank, import review and practice engine. Analysis and Tutor enrich these records. Do not build a second player/provider. Generated questions and additional renderers follow durable source understanding. | P0/P1; depth P2 |
| Course Tracker, templates and weeks | I1-30/31; I3-14b/23/24/26..29; I6-04 | Existing course paths and workflow preferences remain. Add shared scope and durable mappings; derive practice progress from attempts. Historical templates are never current policy. | P1/P1.5; template depth P2 |
| Schedule, cohorts and attendance | I1-34; I4-03..06 | Distinct schedule import feeds the same curriculum; use actual dates and editable allowances. Avoid rebuilding the tracker just to create an ICS export. | P2 |
| Priority, reports and memory | I2-04; I3-07/21/38/63; I4-15; I6-02/03/05 | Reports and Up Next become consumers of the same evidence. Add personal error/latency/repair and explain recommendations. Time is supporting context. | P1, then P2 surfaces |
| Targets, habits, energy and automatic activity | I1-20; I2-03/10/11; I3-01/09..12/36/39/50/61/62; I4-13/14 | Preserve event attribution and interaction stability. Repair confirmed integrity defects before features. Do not add parallel progress counters or infer learning from hours alone. | P0 integrity; P2 evolution |
| Dashboard, widgets, notifications and Locked In | I1-01/15/16/21; I2-01; I3-04/22/37/49/60; I4-02/10..12/16 | One next action and its reasons lead; existing execution widgets remain. One notification system, honest native capability and non-punitive cues. | P2 |
| Soundscapes, media and timer | I1-06/09..13; I2-02/05/08/13/14; I3-02/04/08/35; I4-22/23; I5-01/02/26..28 | Respect ongoing media ownership. Persistence and truthful timer accounting matter before advanced scenes/mixing. Distributed assets require rights. | P0 defects; P2/P3 depth |
| Journal, self-care and Life OS | I1-25/26; I3-40..48 | Preserve the domain, local writing and user choice; cinematic desk/block depth follows the learning foundation. Safety logic belongs on personal writing, not clinical vocabulary everywhere. | P3 after integrity |
| Resources and source packs | I3-24b/30/64/65/66 | Libraries gain course/concept retrieval, provenance and private source packs. Public sharing requires permissions/moderation; cosmetic metaphors remain optional. | P1 source metadata; P2/P3 |
| Cards, Anki/Noji and integrations | I1-07/32; I2-03/12 | Use the current integration/provider boundaries. Cards are a possible repair/consolidation action; native and external review evidence must not double-count. | P2; deep native P3 |
| Accounts, sync, backup and settings | I1-14/22/35; I2-15/16; I3-19/20/31/32; I4-17..21; I5-30 | Reuse local-first storage/recovery. No “safe” or “synced” claim without the corresponding checks. Optional additive fields require all normalization/export paths. | P0; cohesion P2 |
| Daily Games, study methods and community | I1-02/03; I3-51/53..59/61 | Preserve existing games. Sourced facts, opt-in social sharing and moderated contributions remain distinct follow-ups, not hidden prerequisites for Decode. | P3 enhancements |
| Setup, design, guidance, desktop and cinematic | I1-04/17..19/23/24/27..29; I2-07/09; I3-13..18/34/52; I4-07..09/24; I5-29; I6-06 | Reuse setup forms, tokens and guide primitives. Opening sound/video is a bounded brand slice and cannot delay the intelligence engine. | P2/P3; cheap ident completion independently |

Repeated requests above remain related IDs, not separate implementations. Existing `VERIFIED` rows in the index describe their historical evidence; no row is downgraded merely because its domain becomes secondary. The complete verbatim [Ideas 1](../directions/01-ideas/IDEAS-1.md), [2](../directions/01-ideas/IDEAS-2.md), [3](../directions/01-ideas/IDEAS-3.md), [4](../directions/01-ideas/IDEAS-4.md), [5](../directions/01-ideas/IDEAS-5.md) and [6](../directions/01-ideas/IDEAS-6.md) remain unchanged.

## Existing architecture versus actual new work

These are code-presence findings from the base, not a claim of current production behavior.

| Reusable foundation | Inspected location | Gap to address |
|---|---|---|
| Stable question IDs, choices, rationale map, source/set IDs, source page, taxonomy, needs-review flag | `web/src/lib/questions.ts` | Versioned structured Tutor analysis, clue/mechanism/rule/distractor evidence and source classification remain distinct overlays. |
| Per-question attempts already carry answer, confidence, timing, error type and answer-change metadata | `web/src/lib/questions.ts`, `store.ts` | Reuse rather than reintroduce error tracking; establish durable event identity/deduplication where needed before derived multi-surface progress. |
| Source documents have extracted text/pages/checksum; sets freeze question membership | `web/src/lib/library.ts` | Private source packet role/rights/attribution/revision and teaching-versus-handout reconciliation; a file title alone is not provenance completeness. |
| Import diagnostics distinguish question/answer/explanation evidence and preserve warnings | `web/src/lib/questionProvenance.ts`, import modules | Review decks have repeated question/reveal pages. Avoid duplicate questions and incorrect answer inference during packet ingestion. |
| Course paths normalize and numerically sort weeks | `web/src/lib/pathUtils.ts`, `CourseTrackerPage.tsx` | Shared scope and many-to-many set/question-to-curriculum assignment with question overrides; unlinking must retain source and attempts. |
| Existing off/local/cloud/mock provider selection and structured-generation helpers | `web/src/lib/ai/index.ts`, `schemas.ts`, `settings.ts` | Bounded corpus analysis, valid reference checking, partial persistence, reviewed cluster overlay and source-change invalidation. No new provider selector. |
| Workspace mutation, normalization, export/backup and account sync | `web/src/lib/store.ts`, `types.ts`, `backup.ts`, `lib/sync/` | Every persisted addition must survive relevant boundaries. A standalone component-local cache does not meet the product contract. |
| Existing Question Bank, Tutor/exam practice surfaces and source attachments | `QuestionWorkspacePage.tsx`, `ExamRunner.tsx`, `ExamSimulator.tsx` | Rich review composition after commitment; source evidence and mode changes preserve practice state and do not leak answers. |

Durable canonical entities can evolve incrementally. Blueprint pp80–83 adds scope/assignments, analyses, concepts/rules/clusters/findings, error/repair events, derived knowledge, versioned recommendations, resource revisions and slide mappings. Do not manufacture all entities before the first user journey. Store the smallest consistent shape and expand it when its next real use arrives.

## Phase order and dependencies

| Phase | Work | Exit evidence |
|---|---|---|
| P0 | Trust: import persistence, attempt identity, provenance, recovery/sync/media boundaries, confirmed regressions | Relevant integrity and restore paths exercised, no false saved/synced states |
| P1 | 1 corpus; 2 curriculum relationships; 3 shared scope; 4 analysis schema; 5 clustering; 6 Source Trace; 7 personal attempt/error model; 8 Pattern Map; 9 priority v1; 10 The Page v1 | A source-grounded learning loop, not disconnected feature buttons |
| P1.5 | Term/Module/Week/Lecture lenses, Context Envelope, cumulative lens, coverage, fingerprint synthesis | Focus propagates and is reversible without lost context |
| P2 Tutor | FULL/HIGH-YIELD/PRESENTER/HANDOUT/VISUAL, slide links, repair queue, hints, validated transfer/image review | Same reviewed content supports depth changes without answer leakage |
| P2 course | Historical templates, current schedule overlay/diff, source packs, rolling ingestion, reminders, attendance | Current official truth remains distinct from history |
| P2 cohesion | Setup/settings, dashboard/widgets/notices/reports, media/timers, capability layer | Surfaces consume the shared model and meet browser QA |
| P3 | Journal V2, library metaphors, moderated community, social/cosmetics, advanced mixer, simulations/native depth | Each retains its own scoped acceptance gate |

Source: blueprint pp57–58. The first six executable slices are detailed on p99 and in [DECODE-IMPLEMENTATION](../feature-development/2026-10-04/DECODE-IMPLEMENTATION.md). The current direct Tutor request can supply a thin review view over the foundation; it does not justify skipping canonical data/provenance or declaring every P2 mode complete.

## New work records

The index tracks these as extensions of Ideas 6, sourced to the 2026-10-04 doctrine/Tutor follow-up and blueprint. None is runtime-verified by this document. All share owner Codex for the current isolated assessment; implementation owner/commit, tests and verification are recorded in the feature plan and branch report.

| IDs | Domain, thesis and user benefit | Dependencies / priority | Related / supersession |
|---|---|---|---|
| I6-07 | Product doctrine: preserve the learning thesis across future agents | Directions/architecture audit; immediate documentation | Governs I1–I6; does not discard them |
| I6-08 | Shared scope/Decode: focus once across academic surfaces | Stable curriculum links; P1/P1.5 | Extends I6-04 |
| I6-09 | Tutor modes: expand reasoning or compress review from one source chain | Source analysis and answer boundary; P2 with current thin slice | Extends I4-01, I3-33 |
| I6-10 | Private Source Packs: retain lecture/review identity, attribution and rights | Import/provenance; P1 foundation/P2 depth | Extends I5-07/21/25, I3-64 |
| I6-11 | Cumulative Assessment Atlas: concept-first study across selected modules | Scope, normalized corpus and mapping; P1.5 | Extends I3-23, I6-03/04 |
| I6-12 | Patterns/Source Trace: rules with inspectable counts and confidence | Validated analysis and source revisions; P1 | Extends I6-03 |
| I6-13 | Personal error/repair: intervene on the misconception, then reassess | Canonical attempts; P1 | Extends existing error taxonomy, I6-02 |
| I6-14 | Knowledge/priority model: qualify high-yield and recommend diagnose/repair/consolidate/transfer | Findings, attempts, overrides; P1 then longitudinal depth | Extends I6-02/03, I3-21/63 |
| I6-15 | The Page/Exam Eve: readable selected evidence for the confirmed exam | Reviewed findings/date/timezone; P1 | Extends I6-05 |
| I6-16 | Historical template/current schedule separation and moderated contributions | Source revision/rights and curriculum; P2 | Extends I3-24b, I4-03..06 |
| I6-17 | Living ideas records: trace idea, implementation and tests to doctrine | Index and branch reality; continuous | Extends I5-14/15/32/33 |

## Verification status

The documentation pass runs Directions validation, local Markdown path checks, unique new-ID checks and whitespace checks. Runtime tests, real provider execution, browser interaction, source import accuracy, full gate and deployment status are separate evidence in the implementation report. Existing private source content is not copied into public tests or docs.
