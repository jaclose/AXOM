# AXOM Decode: first implementation sequence

Date: 2026-10-04. Owner: Codex. Branch: `codex/axom-decode-v1`, based on `9f29327`; isolated worktree `AXOM-decode-v1`. Status: implementation plan and source/architecture assessment. Runtime completion must be recorded separately with actual tests.

Read the [Learning Intelligence doctrine](../../product/AXOM-LEARNING-INTELLIGENCE-DOCTRINE.md), [Ideas reconciliation](../../product/IDEAS-RECONCILIATION-2026-10-04.md), [Directions](../../directions/README.md), [index](../../directions/01-ideas/INDEX.md) and [in-flight ownership](../../directions/02-progress/IN-FLIGHT.md) first. The [Question-First Plan](QUESTION-FIRST-PLAN.md) remains the detailed first workflow, beneath this broader architecture.

## Source and scope

The authoritative brief is JD's Master Product Blueprint, pp1–101, and the 2026-10-04 doctrine/Tutor execution request. Page references below refer to that blueprint. The current source ecosystem includes JD's DM FULL/HIGH-YIELD, FTM teaching/handout and presenter/ER reviews, community PLGs/MADCOW decks and a cumulative compilation. Their role is to establish review structure and private import behavior. No private source bytes, medical question text or extracted corpus is cleared for public distribution by this plan.

The user wants loaded DM banks to support Tutor's question → explanation → distractor → rule → lecture/source chain. The same model must permit all-module cumulative study, then focused module/week/lecture review. A neutral **Cumulative Assessment Atlas** label leaves actual exam names editable. Renaming a bank does not change its rights.

## Before code

1. Establish doctrine, preserve/reconcile Ideas 1–6 and search current implementation/ownership.
2. Identify foundations and real gaps on this branch; preserve other worktrees and the earlier uncommitted question-first plan.
3. Complete the requested targeted current documentation/tool/bookmark research; document choices and re-use the installed stack.
4. Choose one end-to-end sequence, implement it, then inspect it in a real browser and run required gates.

Do not build a new exam engine, provider selector or duplicate progress ledger to host Decode. Do not start an unbounded implementation of every blueprint domain. Those domains remain explicit in the [phase roadmap](../../product/IDEAS-RECONCILIATION-2026-10-04.md).

## Six executable slices

The sequence follows blueprint p99; each slice builds on the previous one.

| Slice | Behavior | Durable exit condition |
|---|---|---|
| 1. Scope and mapping | Safely import a set; map set/questions to term/module/week/lecture; share scope between Question Bank and Course Tracker | Same question IDs, derived attempt progress, reload/backup survival, reversible links and natural week order |
| 2. Question analysis | Analyze a selected corpus for concepts, task, clues, mechanism and distractors | Validated fields/references, original source untouched, source fingerprint and analysis version persisted |
| 3. Patterns | Conservatively group questions by rule; show exact recurrence and source distribution | Reviewable membership, editable rules, Source Trace, duplicate-aware denominators |
| 4. Personal overlay | Show missed/slow/flagged evidence; suggest correctable errors; create a targeted repair block | Existing attempts remain canonical; rule and error connect to actual practice; no false mastery claim |
| 5. Module Lens | Show weeks/lectures, questions, patterns and weakness; propagate focus | Academic surfaces agree on scope; breadcrumb/back preserves context and manual choices |
| 6. The Page | Save a reviewed traceable printable summary of confirmed exam scope | Readable A4/Letter selection, valid evidence, stale marker, calendar-day-before surfacing without automatic AI cost |

A thin Tutor view may accompany these slices to make the DM source chain usable. P2 review depth, every full-term surface, schedule template diffing and validated generative transfer remain separately testable follow-ups. UI or type presence does not count as delivering all six slices.

## Canonical data contract

Reuse `QuestionRecord`, `QuestionAttempt`, `QuestionSet`, `SourceDocument`, the import diagnostics/provenance utilities, path normalization and `resolveActiveProvider()` already present in the base. Existing attempt confidence, time, error type and choice rationales are useful inputs, not features to rebuild. (pp18–20,80–83.)

| Record | Required semantics |
|---|---|
| Academic scope | Institution/program, term/module/week/unit, exam/source/concept/date filters as needed; one shared reversible academic focus |
| Question assignment | Set/question-to-curriculum relationship, primary/secondary, method/confidence/reviewer/revision; no copied question or deleted attempt on reassignment |
| Source packet/revision | Stable file/source identity, roles, author, source class/period, fingerprint, extraction state, rights and private/shared mode |
| Question analysis | Source-revision-bound concepts/task/clues/mechanism/distractors/rule; evidence per field, confidence/review state, provider/model/prompt version |
| Cluster/finding | Rule/membership/reasons, exact count/denominator, source/period distribution, uncertainty, exceptions, review/stale status |
| Personal overlay | Attempt-linked error suggestion/confirmation; repair event; derived knowledge evidence and recommendation reasons/override |
| Review/Page | Selected source-grounded content and references, scope, generation/review date, source fingerprints and stale state |

Keep additions backward compatible and coordinate schema changes before a bump. Add persisted fields to every relevant store/backup/import/export normalizer and test restoration. Media bytes stay outside generic workspace revisions. Current primitive attempts may need a stable event identity before reliable cross-surface deduplication; do not silently migrate by dropping historical attempts.

## Source packet and Tutor contract

Review decks often repeat the same question on a later answer page. Import must preserve one canonical question with linked evidence rather than counting reveal slides as new questions. FULL and HIGH-YIELD can be alternate renderings of the same item; keep their source references and conflicts. Missing/unresolved mappings enter review instead of receiving invented content.

The review chain is question → answer → why right → why others wrong → generative rule → lecture → slide/image → related questions → personal error → repair. (pp27–29.)

| View | Minimum content |
|---|---|
| FULL / Deep | Complete stem, committed result/time/confidence, decisive clues, causal chain, correct rationale, each distractor, changed clue making it correct, rule, source and related cluster |
| HIGH-YIELD / Rapid | One-line rule, decisive clue, distinction, 1–2 traps, source and relevant personal warning |
| Standard | Source-grounded explanation between Rapid and Deep |
| PRESENTER | Question/commit → answer → why → why not → optional hook → source/recap, progressively revealed |
| HANDOUT | Printable question/answer/short derivation/source, readable without interactive controls |
| VISUAL | Image first, orientation/landmarks, discriminating features/look-alikes, source and related images |
| CALCULATION | Known values, governing equation, substitution, result/units/direction and wrong calculation paths |
| Repair | Rule, confusion pair, source, recall prompt and available transfer question; no claim that immediate repeat success proves durable repair |

Modes are one content model, not separate banks. Before commitment/reveal, hide answer-revealing pattern, source-slide and distractor content. A permitted hint ladder progresses clue → concept family → contrast → partial mechanism → requested answer. Maintain keyboard focus, mobile layout and current practice state across depth changes. (pp20,29,78–79.)

Source-slide UI distinguishes inferred from confirmed mappings and supports correction. Imported explanations, AXOM reasoning and learner notes stay labeled. Where the corpus lacks a rationale, show the gap or offer explicit analysis; never fill it with ungrounded medical claims.

## Semantic analysis and recommendation contract

- Preview included sources and distinct-question sample before an explicit analysis action. Cloud discloses provider and source transmission; no hidden paid calls.
- Use the existing local/cloud provider boundary. Off/unavailable still permits import, mapping, practice and saved review. Demo output remains labeled demo.
- Bound batches, persist partial progress and expose cancel/retry/provider/quota/invalid-output states. Do not silently analyze only the first prompt-sized subset.
- Validate returned schema, IDs, source spans and scope membership; uploaded text is evidence, never executable instructions. Unsupported findings remain excluded from accepted recommendations.
- Store source fingerprint, provider/model, prompt/analysis version, time and review state. Changed sources, assignments or mappings invalidate affected results.
- Count frequencies in code after validated membership. Exact duplicates do not multiply evidence; likely paraphrases enter review.
- Let the user accept/edit/split/merge/remove unsupported clusters. Pattern cards show the rule, observed count/source distribution, how asked, clue/trap, learner state, evidence and action.
- Separate assessment/curriculum/foundational/personal/board/cumulative high-yield. A small sample is an early signal. Absent question coverage never establishes safe-to-skip material.
- Priority chooses diagnose, repair, consolidate or transfer with reasons and alternatives. Saved Questions first and user overrides remain available. Retrieval latency requires repeated contextual evidence.

Source: pp19–22,32–38,52–54,76–77,82–84,93–98.

## Acceptance and required verification

**Question journey:** synthetic multi-week import → review parsing → confirm mapping → Questions first → practice/commit → Tutor review → Course Tracker agrees → reload → count once → backup/restore retains state. Include Week 2/10, mixed sets, unassigned questions, repeated assignment, renamed/removed scope, unresolved key and all-completed states. (p60.)

**Decode journey:** course/sources → term/module/week/lecture focus → mapped patterns → Source Trace → targeted block → personal update → Next Best Action changes for an inspectable reason. Cross-module context must not swamp focused scope. (p60.)

**AI:** duplicate/paraphrase sources; wrong/nonexistent references; partial failures; no provider; cancellation/retry; source-change staleness; insufficient sample; offline reopen; explicit cloud boundary. A mock-provider test does not establish real AI behavior. (pp60–61.)

**Tutor:** reveal boundary, all displayed modes/controls, source-versus-generated labels, missing rationales/images, wrong-slide correction where implemented, long stems, option H, key conflicts and preservation of attempts while changing depth.

**The Page:** inspect exported A4 and Letter artifacts, readable one-page selection/no clipping, valid sources, conflict/stale labels, mobile scrolling, timezone boundary/date change, no billable call from reminder. (pp36,61.)

**Web:** `cd web && npm run verify:all`; browser at 1440 × 900 and 390 × 844; full-page scroll, actual controls, dark/light, keyboard/touch, 200% zoom/reflow, reduced motion, zero introduced console errors/warnings. Run any relevant script tests. Private sources remain in local validation paths; public fixtures are synthetic. Native behavior is only claimed after packaged-app verification.

## Runtime status and handoff

This document defines scope and acceptance. The implementation owner records exact changed paths, tests, browser evidence, known gaps, provider limitations and uncommitted/unpushed state here or in a linked branch report before handoff. Doctrine adoption and a green documentation check are not evidence that Decode or Tutor is complete. Production deployment and pushing main remain JD's responsibility.
