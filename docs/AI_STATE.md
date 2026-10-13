---
tags:
  - axom/state
authority: current-state
---
# AXOM current AI state

Snapshot: 2026-10-13, isolated `feat/academic-library-v1` in
`AXOM-academic-library-v1`. Combined code checkpoint `eca6ac3b` integrates reviewed
consolidation `6aa2126a`: academic/account recovery, daily challenges, Questions/Slides,
Communications/Pulse, Cinematic entry, Ideas2 and audited library/audio/sync safeguards.
The later consolidation merge `e3f0d046` has the same code tree. Preserve all active
other-owner drafts. JD authorized commits, development pushes and tested local-main
convergence. Remote main still deploys production and has not been updated here.

## Working and verified

[Academic library](features/academic-library.md) is the canonical behavior and
acceptance contract. QBank now discovers the same paginated backend catalog as Course
Library and opens the same source-backed weekly plan. Selective loading and exact
image-rich quizzes use the existing tracker/import/question engines. Deep links do
not depend on the first catalog page. Earlier catalog adapters remain compatibility
history, with no competing product entry point.

An isolated native Supabase stack (CLI 2.120.0, API `http://127.0.0.1:55321`) supports
real synthetic-account Auth/REST/Storage acceptance. Private uploads, reviewed sharing,
group restrictions, withdrawal, independent enrollment and clean second-device attempt
recovery pass. The reviewed FTM1 slice contains 75 activities across three weeks, two
explicitly unresolved activities and an exact 11-question image-rich Week 2 quiz.
Daily challenges use a fixed reviewed pool, explicit alias/participation, server scoring,
idempotent events, ties and opt-out. Two learners retain independent attempts.

Integration repairs `04ef62fe` add restrictive private-bucket policies and resolve
migration collisions. `0c6d5861` retains the split workspace bootstrap offline.
The exact recovery-owner handoff remains integrated at `1942a77f`; the original
backup checkout is untouched. No private course sources or test credentials enter Git.

## Validation

Node 22.23.1, macOS, installed Chrome. Combined code: 3,122 unit/SQL checks pass
(five existing skips), full typecheck/lint/build pass, 79 release/repository checks
pass. Real two-build update, recovery checkpoint, unchanged peer tab, offline reopening
and lazy Daily Games checks pass. The full 96-case browser run had 91 passes, four
opt-in skips and one stale singular/plural assertion; that assertion is corrected and
its focused rerun passes. Course, sharing, leaderboard, image rendering, saved review,
Questions/Slides, communications and responsive checks all pass on the combined code.

The actual supplied 516,431,732-byte backup now passes Settings restore and reload in
an isolated persistent browser profile with hosted traffic blocked. Notes/progress,
343 questions, 848 documents and all 2,151 image hashes match. Detailed timings and
local migrations are in the feature contract. Native packaging, hosted staging and
production acceptance remain outstanding. Final clean deployment-input build and
local-main promotion are recorded with exact SHAs on the coordination board/ledger.

## Remaining delivery boundary

Incremental account requests reuse the atomic revision writer. Local service measures:
22,405-byte initial checkpoint / 525-byte answer; real FTM1 66,420-byte initial checkpoint /
10,857-byte completed 11-answer delta. Daily scoring requests are 223 JSON bytes each.
These exclude protocol headers and are local observations. Downloaded academic content
still enters private recovery, and new-device sign-in hydrates the source graph.
Shared-content exclusion, on-demand restore, learner overlays/history pagination and
bounded offline downloads remain unfinished. Preserve original copies and stable IDs;
do not replace the canonical question/progress/recovery engines.

Also pending: remaining source-backed courses, larger/resumable user uploads and review,
automatic daily publication, durable interrupted challenge submission, hosted activation
and native release. Never call this checkpoint full canonical 1.1 delivery.
Normal `www.axom.info` was last reverified read-only as deployment
`dpl_6fg8rJYXk2tSfJWvNALwL7gN38TF`, source `c23e8c26`; AXOM Production is
`jofkmfwkidubxcutkwzf`. No production tests, migrations, publication or deployment here.
