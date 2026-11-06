---
tags: [axom/product, axom/strategy, axom/roadmap]
authority: proposed-until-merged
owner: AXOM product
updated: 2026-11-06
review_trigger: product-priority-or-evidence-change
---

# AXOM Product Guide | From studied material to better decisions

**Product thesis.** AXOM is a private, local-first academic operating system that connects **what was taught, what was tested, how the learner responded, what the evidence supports, and what intervention helped**. It should improve understanding, retention, discrimination and retrieval rather than simply increase minutes studied.

This guide is an implementation-facing companion, **not** a new constitutional authority or an announcement of deployed features. The [constitution](../governance/AX-0002-CONSTITUTION.md), [master backlog](../governance/AX-0001-MASTER-PRODUCT-BACKLOG.md), [lexicon](../governance/AX-0009-PRODUCT-LEXICON.md), [Learning Intelligence doctrine](AXOM-LEARNING-INTELLIGENCE-DOCTRINE.md) and original idea files remain the governing sources. The owner's *Product Vision & Stages / Working Edition (30 Oct 2026)* is a staged design proposal, not live-environment acceptance. [Directions](../directions/README.md) tracks raw ideas and execution; neither supersedes governance without a recorded owner decision.

## 01. The decision AXOM must make possible

> What matters here? What does this learner currently know? What explains the gap? What is the smallest useful next intervention, and why?

Five connected intelligence pillars:

| Pillar | Question | Source of evidence | Useful learner action |
| --- | --- | --- | --- |
| Curriculum | Where was this concept taught, and at which level? | Source documents, module/week membership, instructor schedule | Focus the right unit; preserve cumulative context |
| Assessment | How is it tested and which distractor distinguishes it? | Reviewed question/key, attempts and available exam patterns | Practice and understand |
| Learning | What mechanism/rule is missing? | Exact source and reviewed explanation, learner error classification | Repair a misconception |
| Memory | What survives delayed retrieval and transfer? | Repeat, spacing, discrimination and performance over time | Schedule the next retrieval |
| Prioritization | Where is time best spent next? | Combined evidence with explicit uncertainty | Accept/override a reasoned recommendation |

**Execution support** (timer, soundscape, dashboard, Journal, calendar) helps the learner act; it does not define academic mastery. A user can choose a different path. AXOM never frames suggestions as compulsory diagnoses of character or capability.

## 02. The single canonical learning loop

\`\`\`text
Original source
   → curriculum/term/module/week
   → source-linked assessment
   → learner answer, timing and confidence
   → reviewed key and explanation
   → error pattern / concept model
   → targeted repair and retrieval
   → reassessment
   → updated evidence-backed learner view
\`\`\`

Never create parallel versions of quiz events, attempt history, source identity or course membership for a new attractive feature. Decode, Tutor, QBank and Course Tracker are different views of compatible source and attempt contracts. A filtered scope must remain reversible; selected week, through-week cumulative and full-module access do not erase the term-wide learning context.

**Three fingerprints** must remain distinct: curriculum (what was taught), assessment (what sources asked) and learner (what this person demonstrated). A feature may operate on one or two when the third lacks evidence, but must label the gap.

## 03. Product areas and non-negotiable contracts

### A. QBank and question workspace (highest implementation focus)

- Authoring/inbound: keep original stem, choices, source media, key, original rationale, license, version and exact source identity intact.
- Review: a user answers *before* any answer-revealing rationale is exposed by a scored mode. After commitment provide why right, why other options fail, the generative rule, linked source/diagram, error mechanism and useful next retrieval.
- Publication: private staging, moderated community review, source rights, duplicate handling and withdrawal are different states. Unreviewed AI explanations cannot silently become answer-ready.
- Persistence: autosave versus pending versus failed must be truthful, including reload, interrupted network, account switch, duplicate request and backup restoration.
- Accessibility: single primary reading column, source rail available but not dominant, keyboard, mobile image/diagram controls, visual focus and reduced motion.

**Core acceptance:** create or import → review → practice → commit → explain → save → reload → course progress → export/recover, with the same question/source and learner identity.

### B. Course Tracker and academic library

- Model term → module → week → learning unit → concept and source/assessment placement. Preserve source IDs, course revisions, refile conflicts and historical attempt scope.
- Template discovery is not publication: approval, availability, permission, install and revocation need explicit evidence.
- A learner may choose *selected week*, *through this week* or *whole module*; show truthful eligible counts and shortfall explanations.
- Progress comes from recorded attempts and learning events, not from the mere presence of a course or a timer session.
- Current-course schedules may be user-confirmed; old templates need prominent historical context and should not claim to be this week's official institutional schedule.

### C. Tutor, Decode, Pattern Maps and The Page

- Tutor explains through a transparent evidence chain: **question → answer → mechanism → distractor distinction → general rule → source → personal trap → repair**.
- Decode focuses on one scope but retains prerequisite, contrast, cumulative and transfer context; breadcrumbs restore broader views.
- Pattern Maps and exam reviews compress only supported themes. High-yield labels distinguish foundation, assessment, school-specific observation and user-specific errors; repetition is not proof a topic will appear in a future exam.
- “Not represented in the available question set” is a coverage limitation, not “not testable”.
- The Page is a compact pre-exam review of relevant source-linked rules; calendar events require verified date and timezone. Do not silently purchase fresh AI inference to produce it.

### D. Memory, Anki and cards

- A spaced-repetition recommendation is a suggestion tied to observable retrieval, not a universal schedule. Allow settings and reversible user override.
- Protect exact note/card identity, model changes, idempotent retries and interrupted suspension receipts when interfacing with Anki. Device/cloud separation and recovery are first-class UX concerns.
- Keep review stats and FSRS decisions inspectable. Do not infer retention improvements from immediate correctness alone.

### E. Daily systems: Journal, focus, dashboard, community

- Journal is private and never a silent AI-upload or automatic public share. Saving, snapshots, encryption boundaries and user choice take priority over animations.
- Timer and productivity widgets show context, not moralized academic ability. Session duration is not learning outcome; activity must remain correct across pause/refresh/device transitions.
- A dashboard prioritizes **one next useful action**, then progress/evidence, then optional instruments.
- Community sharing, study groups and leaderboards must be opt-in, permission-scoped, respectful of consent and independent of private question bank/source rights.
- Communications should offer concise useful notices and preference controls, not claim access to hidden private content. Identity companion characters remain an opt-in future expression, not an invisible profiling engine.

## 04. Dependency-based stage map

These are **exit-gated stages**, not calendar promises or claims that every feature has shipped.

| Stage | Name | Build | Exit criterion |
| --- | --- | --- | --- |
| **0** | Protect the record | Import/revision, source rights, local persistence, account boundary, recoverability | No unreviewed answer is scored; save/error/restart/export retains identity; hosted acceptance reported separately |
| **1** | Rebuild QBank review | Attempt, reveal, explanation, diagram, source rail, distractor and repair | End-to-end browser attempt/review/save, honest pending states and accessible mobile UX |
| **2** | Connect intelligence | Shared academic scope, Tutor/Decode/Patterns, personal error model, memory suggestions | Recommendations open source/evidence, survive revision, allow override and do not invent mastery |
| **3** | Unify the day | Tracker, dashboard, Up Next, planning, focus, cards and report coherence | A chosen intervention appears consistently across academic and daily surfaces |
| **4** | Expand expression | Cinematic, native, email, Journal, community, diagrams, personality companions | Identity coherence, privacy/consent, stable deployment, independently verifiable value |

A narrow verified slice can ship before its entire stage finishes. Stage 4 surfaces may exist before Stage 2 is complete; the stage number is a **dependency priority**, not a ban on prior shipped functionality. Urgent data security/recovery can supersede stage order.

## 05. Roadmap decisions: a weighted judgment, not a fabricated score

For each proposed feature, write a one-page decision record:

| Attribute | Questions |
| --- | --- |
| Learner problem | What observed friction or learning gap does it solve? |
| Mechanistic hypothesis | Why should this change improve knowledge, retention or decision quality? |
| Evidence | Source/learner observation, baseline measurement, confidence and counterexamples |
| Integration | Existing contracts/owners; risk of duplicate datastore or UX path |
| Value and reach | Who benefits, how often, and what meaningful outcome changes? |
| Effort and reversibility | Engineer hours/complexity, data migration, privacy, failure recovery |
| Design | Primary action, evidence rail, mobile/light/dark/keyboard/reduced-motion states |
| Assessment | Tests, browser, hosted provider, real learner acceptance |
| Owner and approval | Unique issue/idea ID, authority, decision/hold reason |

A candidate is **P0** when data integrity, privacy/authorization, or test correctness is at risk. **P1** closes the QBank/Tracker loop for verified learners. **P2** improves explanation/memory/recommendations with source evidence. **P3** polishes peripheral features without harming core flows. Priority is revisited as new failure evidence arrives; no fixed scoring formula replaces judgment.

Avoid false metrics: “questions displayed”, “AI tokens used”, “hours logged” and “streak length” are secondary. Prefer *valid original-source coverage*, *reviewed-key percentage*, *answer-to-explanation completion*, *durable save/readback*, *delayed retrieval quality*, *error-repair success*, *account isolation correctness*, *time to useful next action*, *user-selected interventions* and *support regressions*. Specify denominators, grain, cohort, exposure and measurement error. Never label a correlation as a causal learning gain.

## 06. Truth and acceptance vocabulary

| Label | What it actually proves | What it does **not** prove |
| --- | --- | --- |
| IDEA / PROPOSAL | A described option or POC exists | Code or product decision approved |
| IMPLEMENTED | Named source revision contains behavior | Test or deploy success |
| LOCALLY VERIFIED | Actual tests passed in named environment | Hosted accounts or external providers work |
| PR READY | Committed/pushed exact head and review packet exists | Ready for main |
| INTEGRATED | Included in a combined branch | Combined acceptance |
| CI VERIFIED | Required checks passed on exact combined SHA | Browser/provider/production live |
| MERGED | Git main contains release source | Production is on that SHA |
| DEPLOYED | Provider confirms artifact SHA/READY route | Real user journey or account state works |
| LIVE ACCEPTED | Authorized verified journey succeeded on deployed version | Perpetual correctness of all users/environments |

When an owner cannot access Vercel/Supabase, the result is **BLOCKED_ACCESS**, never “looks live”. Approved source media/diagram rights, clinical key review and production migration are distinct gates.

## 07. Interface system, trust and learner agency

- The [brand guide](../design/BRAND-GUIDE.md) and [design contract](../design/DESIGN.md) govern visual identity. AXOM Classic navy/gold currently uses runtime tokens; do not copy a PDF POC's invented typography or colors into the product.
- **Decide → Understand → Inspect**: one action, mechanism/source, optional technical detail. Evidence is near enough to use but does not drown the question.
- Design mobile first where a user must actually answer/read. Responsive does not mean desktop shrunk into a floating cluster.
- Notifications require useful, timely relevance and opt-out. No surveillance-like claims about studying or personality and no hidden profiling.
- Use AI only where meaningfully better than deterministic code. Never let a model invent answer keys, course membership, source citations, grading, credentials or save confirmations.

## 08. Workstream integration and release strategy

MOTHERSHIP coordinates engineering domains; APEX PRIME owns the QBank/Tracker source implementation; Journal/Registry and specialized workers own bounded scopes; independent QA challenges evidence. **AXOM FORGE** owns the single final composed release train and publishing gate in [#140](https://github.com/jaclose/AXOM/issues/140).

All source work follows [engineering SOP](../operations/engineering-sop.md), names an exact-head candidate and enters the [release-gateway SOP](../operations/deployment.md#axom-unified-release-gateway). User-facing release titles follow [release nomenclature](../operations/release-nomenclature.md). Big releases are not better by default: coherent, tested benefit determines the batch; urgent safety repairs can take the documented hotfix route.

## 09. Quarterly product-direction review and living documentation

At a documented review, reconcile idea IDs and owner decisions with the latest actually shipped main/production evidence. Answer:

1. What part of the full study loop remains untrusted or incomplete?
2. Which learner action has proven improvement, with what limitations?
3. Which high-risk rights, auth, persistence or academic-key concern is open?
4. Which existing implementation could be simplified rather than duplicated?
5. Which feature is next by dependency and evidence, not aesthetic novelty?
6. What must be verified on a *real authorized learner account* before it can be called delivered?

Record the new decision in the canonical governance/backlog route; do not rewrite original user idea files. Research proposals remain proposals until product owner disposition. Changes to this guide follow [document control](../operations/document-control.md), source-led review and FORGE release gates. This document should remain concise enough to guide planning, while detailed code decisions live in domain contracts.

**Reference routes:** [product authority index](README.md) · [Learning Intelligence doctrine](AXOM-LEARNING-INTELLIGENCE-DOCTRINE.md) · [feature router](../features/README.md) · [idea index](../directions/01-ideas/INDEX.md) · [engineering SOP](../operations/engineering-sop.md).
