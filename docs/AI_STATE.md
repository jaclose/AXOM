---
tags:
  - axom/state
authority: current-state
---
# AXOM current AI state

Snapshot: 2026-10-23. Main QBank/course integration is isolated on
`codex/qbank-course-library-20261023`, based on `dc055a2f`, under the user-designated
QBank working folder. The other AXOM worktrees and their staged/private files are
protected. This is a local implementation checkpoint, not a release certificate.

## Authority and ownership

JD requested the master import, practice, course and academic-library build, then
explicitly requested broader corpus discovery, source-backed week/module filing,
retention of JD reviews, and a commit. The master permits a tested feature-branch
push after checking CI; main push, production migration, private publication and
production acceptance still require applicable explicit authorization.

Use the coordination board. Separate visible chats are required; do not substitute
subagents. The preparation chats are complete. Chat messaging is unavailable, so
exact role prompts and a coordination manifest are retained in the private hub and
execution is sequential. Two RHPS chats own overlapping package/importer and vault
work. Inspect their final handoff before integrating those edits. Do not copy their
uncommitted changes wholesale or alter their checkout.

## Current implementation

- Single and batch intake share the complete-source reader; text previews may be
  bounded, but parsing is not silently truncated. Original bytes are retained.
- Image mapping has previews, source context, zoom and ordering. Unassigned loose
  images remain source evidence. Incomplete image saves keep review open for repair.
- Rich practice text supports canonical annotations across nested content. ExamSoft
  bulk clear is atomic. Note-image success requires a durable metadata receipt.
- Native Save & exit retains picks, strikes, visits, notes, timing and scope. The
  active player no longer shows persistent Questions/Slides mode switches.
- Course preview separates academic session/cohort editions. Mixed editions cannot
  silently merge. Literal W1/W2-3 labels are recognized; module parts and quiz numbers
  do not become weeks. Unknown/ranged weeks stay unassigned during private assembly.
- Selected-set upload preparation excludes learner data and private original files.
  The publication UI/server-validation/moderator path is not complete.

Canonical behavior: [questions](features/questions.md),
[course engine](features/course-engine.md), [academic library](features/academic-library.md).
The source inventory, course register, combined module packages, original hashes,
question/image mappings, browser receipts and screenshots remain outside public Git.
No source corpus is bundled with the app. Candidate counts, ready questions, locally
installed questions and authenticated cloud counts are separate denominators.

## Validation and remaining work

Node 22.23.1, isolated web dependencies. Shared import regression tests, image/annotation
and practice persistence checks, course edition tests, and selected-set preparation
checks pass. A source-bearing pilot completed import, image decoding, weekly quiz,
save/exit and reload. The wider module collection is undergoing real installer/reload
acceptance in a separate persistent local browser profile. Check the latest private
receipts before reporting a final installed count.

The full unit rerun passed 3,896 tests with 28 declared skips and one existing
privacy SQL failure caused by a fixed expiry now in the past. The owner's clean
test repair is integrated as `e4e60fd2`; all 54 affected SQL/page checks then pass.
Typecheck, full lint, build, 43 repository tests and repository hygiene pass.
Corpus acceptance has verified 13 module installations after reload. The continuing
Unfiled import was interrupted by browser navigation and is being resumed without
clearing its saved data. Original backup questions are also being reconciled.
Full integration/release verification remains open. No deployment is claimed.

The configured Supabase project is AXOM Production. Its dashboard is readable, but
connector permission errors prevent management API access. Read-only migration
inspection found the two latest local migrations absent. No production writes or
account-isolation acceptance have been performed in this session.

Next: finish corpus reload/media acceptance and source dispositions; integrate the
RHPS/vault handoff; complete selected-set publication and two-account backend checks;
then finish `verify:all`, named-path commits, permitted feature-branch push and the
concrete production proposal. Preserve original sources and learner work throughout.
