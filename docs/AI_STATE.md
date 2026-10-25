---
tags:
  - axom/state
authority: current-state
---
# AXOM current AI state

Snapshot: 2026-10-25, `codex/pr30-host-hardening-20261025`, based on PR #30
at `819e86eb4fdac83957bbd84b148d260f8709d2f8`. This is isolated local hardening,
not a production release. The original [academic handoff](archive/2026-10-25-host-baseline/AI_STATE.md.txt)
is preserved byte-for-byte; its counts and approvals are historical.

## Ownership and integration

JD selected [PR #30](https://github.com/jaclose/AXOM/pull/30) as the shared
Host, Community, authorization and AI quota baseline. Use its `social_*`,
`axom_operator_*`, `axom_ai_entitlements` and `consume_ai_quota` contracts.
The earlier `codex/host-community-20261025` draft remains preserved locally;
its parallel tables and RPCs are superseded and excluded from integration.

Claude owns QBank parsing, readiness, extraction, persistence repairs and course
work. Its observed committed `7218aa5f` already includes PR #30. Recheck that
branch before integration. Do not overwrite active edits, staged/private source
material, unrelated worktrees or the excluded private-media backup branch.
Root alone handles reviewed named-path commits. JD requested one combined release
candidate; no additional Vercel-bound branch is pushed from this session.

## Implemented local changes

Host navigation is capability gated. Account-bound clients reject stale reads and
mutations after account changes. Profiles default undiscoverable; posts default
private. Shared standings exclude private posts and deduplicate learner-days.
Role and AI policy RPCs require audit reasons. Social/operator writes honor the
existing privacy barrier. Account deletion retains anonymized administrative
audit. Malformed AI allowance data fails closed before the provider request.
See [Community and operator contract](features/community-operator-console.md).

No parser, learner workspace schema, course tracker or question content changed.
Community totals are self-shared, not verified study rankings. Existing Daily
Challenges remain the separate server-verified destination. Persistent blocking,
account-wide suspension, full rights-aware publishing, configurable capabilities
and provider cost/token/latency telemetry remain outside this slice.

## Verification and release boundary

PR baseline GitHub Quality passed all three jobs at `819e86eb`. New hardening
requires validation and CI for its own exact commit before integration.
Local validation passed: 77 focused unit/SQL checks, including complete migration
replay, plus 43 repository tests and hygiene. Typecheck, full lint, production
build and Daily Games bundle isolation passed. Existing jszip/webUpdates dynamic
import and large-chunk build notices remain; no new lint or browser warnings.
The SQL-backed Chrome journey passed consent/discovery, private posts, friendship
and Kudos across reloads, shared-day standings, report moderation, operator
grant/revocation, AI cap/disable and access removal after unfriending. All four
1440x900 dark / 390x844 light screenshots were inspected; no overflow, reduced
motion exercised, zero browser errors/warnings. Early fixture failures were
corrected: implicit-label selectors, awaiting save before reload, and PostgreSQL
DATE wire formatting. Final run passed in 17.4 seconds.
Disk briefly fell to 127 MiB; checks stopped without cleanup, then resumed after
space recovered. The owned dev server is on port 5199. Full verify:all, native,
real multi-connection SQL and hosted identity acceptance were not run.
Browser tests use real local PostgreSQL RLS with synthetic Auth/REST transport;
they cannot establish live GoTrue, PostgREST or Jafar/Aynaz acceptance.

The owner's read-only production audit records 30 applied migrations and exactly
four pending, in order: `20261016011812`, `20261017233759`, `20261024150000`,
`20261024153000`. No production migration, account provisioning or deployment
occurred here. The configured-project connector denied access in this session.
Never use a display name to grant executive rights. Production requires refreshed
inventory, exact candidate checks, explicit provisioning/release authorization,
and real two-account readback. Record receipts and integration decisions in PR #30.

Node 22.23.1; existing dependencies reused without installation or upgrade.
Run heavy checks serially and inspect disk; no cleanup is authorized. Preserve
all academic source and review gates described in the archived handoff.
