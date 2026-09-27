# AXOM feature development

Owner request: resume Application Checker, leaderboards, and personalized onboarding. Recorded September 22, 2026.

## Recovered discussions

- [AXOM Alpha-Candidate Stabilization](https://chatgpt.com/c/6a51931a-9ae4-83ea-8bc3-f70d07b967a3): source-backed school data, explicit unknowns, incremental dataset updates, short optional onboarding, editable study preferences, and preservation of existing work.
- [Simulator and textbook design](https://chatgpt.com/c/6a6f5546-457c-83ea-aac7-40faf8cfe360): accounts and durable work precede leaderboards and shared profiles. The owner's central requirement was not losing learner data.
- At discovery, the Leaderboards page specified opt-in, small study groups, effort rather than extremes, and eventual Anki integration, but mixed real learner totals with fictional cohort members. This increment replaces those fictional standings with personal standings from actual logs.
- Earlier notes deferred leaderboard investment. The current owner request supersedes that priority, but does not authorize publishing private data or inventing participants.

These are recovered design sources, not blanket instructions to implement every idea in those chats.

## Feature inventory and acceptance

| Area | First implementation | Follow-on capability | Acceptance |
| --- | --- | --- | --- |
| School data | Adapt the existing Phase 1 CSV research into the established dataset contract | Incremental official-source refresh | Stable school IDs, dated provenance, explicit missingness, no heuristic estimates promoted to requirements |
| Application Checker | Search real school records; inspect collected requirements and original sources; save schools and review progress | Learner-specific comparisons against verified, cycle-specific structured requirements | Saves survive reload and backup; learner review is separate from official verification; no admissions probability or unsupported eligibility verdict |
| Leaderboards | Real current activity plus personal weekly standings, with clear periods and ties | Private, opt-in friend cohorts backed by authenticated membership and consent | No invented participants, ranks, deltas, or Anki sync; no outgoing learner data |
| Onboarding | All supported study methods, adaptive follow-ups, original free text, resumable selections, preservation of existing defaults | Confirmed deterministic interpretation of free text | Optional setup, edit later, no forced Anki, no silent inferred settings, no rerun loss of course/item-kind defaults |
| Persistence | Use existing learner storage and backup contracts | Authenticated cross-device/shared features | Normalization, old-profile compatibility, reload and backup round-trip tests |

## Gathered data, inspected directly

Source folder: `/Users/jd/Downloads/Scraper - GPT/Med_School_God_File_Phase1/csv_tables`.

Actual CSV counts on September 22 (the introductory coverage report is stale):

| Table | Rows |
| --- | ---: |
| School roster | 294 |
| Admissions requirements | 60 |
| Coursework policy | 50 |
| Application process | 57 |
| Field provenance | 174 |
| Source registry | 36 |
| Conflicts/review queue | 15 |
| Heuristic applicant-profile estimates | 45 |

Admissions rows: 14 `OFFICIAL_VERIFIED`, 46 `SEARCH_DERIVED_OFFICIAL_PENDING_FETCH`. These are historical collection labels, not a fresh verification today. Some individual fields within officially captured rows are explicitly third-party estimates. Preserve that distinction; row-level provenance alone cannot certify every field.

Do not publish personal contact details, heuristic hour targets, inferred school tiers, accreditation/loan eligibility judgments, or estimated competitiveness from this folder. Keep originals unchanged. Suppress explicitly noncanonical duplicate roster rows with a reported count, not silent deletion of source files.

## Product boundaries

The first checker is a research and application-preparation tool, not an admissions adviser. The first leaderboard increment is personal activity, not a live social service. Onboarding choices affect existing preference settings only; this increment does not introduce a new recommendation scoring engine.
