---
tags:
  - axom/state
authority: current-state
---
# AXOM current AI state

Snapshot: 2026-10-13, isolated `feat/academic-library-v1` in
`AXOM-academic-library-v1`. Base includes deployment reliability `71aa2525`.
User-created `f768f5ca` committed tracked course edits but omitted required new files;
this checkpoint completes those files without rewriting history. Integration/main
and production have not been changed by this stream.

## Working slice

[Academic library](features/academic-library.md) records the implemented behavior,
security boundary, reproducible acceptance and unfinished requirements. Full-page
course discovery, source-aware weekly plans, selective activation and exact scoped
quiz navigation reuse the existing tracker/import/question engines. The private FTM1
pilot preserves source provenance and keeps two ambiguous activities unassigned.

The academic catalog/revision/ACL/enrollment migration was exercised on a separate
local native Supabase stack (CLI 2.120.0, API `127.0.0.1:55321`). Real synthetic-account
Auth/REST/Storage isolation, immutable media, reviewer-gated sharing and retries pass.
A real browser signs in, uploads privately, previews the backend plan, downloads
Week 2, reloads and starts its exact 11-question quiz. Source-rich local study also
passes through answering, Decode review and reload with 11 attempts. The real
backend journey now also restores those same attempts in a clean second browser
context, comparing the full canonical attempt records (question/run identity, answers
and timestamps). Private recovery integration `1942a77f` and ZIP fix `a039e872` are pushed.

## Validation and protected work

Node 22.23.1. Affected focused tests, typecheck, targeted lint, production build,
43 repository tests, seven deployment-input tests and repository hygiene pass.
Desktop/mobile template regression and the real FTM1 study journey pass, including
short windows, light/dark, reduced motion and 200% CSS zoom. Full merged-tip gates,
native package, hosted staging and production acceptance are still outstanding.

The active backup/account owner supplied a tested 39-file recovery patch against
`3ebfa15e`, plus an exact manifest. Their `9b828694` checkpoint is incomplete alone.
The complete handoff is integrated here after ZIP repair `a039e872`; the original
owner checkout is unchanged. Integrated recovery checks pass: 100 focused tests,
real local two-account source/image integrity and isolation, four account/exam Chrome
journeys, typecheck, full lint, build and 43 repository tests. The SQL security check
now recognizes both qualified empty paths and the existing safe ordered path.
Private recovery stays with that owner. Academic content exclusion, learner event
sync and leaderboard remain this stream's responsibility. Owner sharing controls now
pass real two-account browser checks for review, groups and return to private access. Other QBank,
communications, cinematic and integration work remains protected by the live board.

## Next boundary

The incremental wire adapter uses exact acknowledged bases and the existing atomic
revision writer; immutable record digests avoid reserializing source text on each
answer. Local service acceptance measured 22,405 bytes for the initial checkpoint
and 525 bytes for one answer. The real FTM1 browser measured 66,420 bytes initially
and 10,857 bytes for its completed 11-answer quiz. SQL boundary and retry tests pass.
Read-only local export measurement: 48,326,029 JSON bytes, 2,841,685-byte compact
reference checkpoint; initial digest 1,201.77 ms, one-note edit 0.573 ms / 88-byte
delta, exact round trip. Single-run Node 22 observations; no private export upload.

Downloaded academic sources still enter private recovery and sign-in recovery still
hydrates that source graph. Complete shared-content exclusion and on-demand restore;
the wire adapter alone does not deliver the lightweight academic architecture.
Preserve learner overlays and stable IDs through the existing importer. No second
question/progress/recovery engine. Preserve
legacy backup compatibility and private edits. Complete two-device/offline acceptance,
remaining source-backed courses, sharing and leaderboard before claiming canonical 1.1.

Normal `www.axom.info` was reverified read-only as deployment
`dpl_6fg8rJYXk2tSfJWvNALwL7gN38TF`, source `c23e8c26`. AXOM Production remains
`jofkmfwkidubxcutkwzf`; no production tests or writes were performed. Any production
migration/deployment still requires exact release approval. Development commits/pushes
and validated local convergence are authorized under current ownership coordination.
