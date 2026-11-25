---
tags:
  - axom/operations
authority: canonical
---
# AXOM maintenance lead V1

**Scope:** repository hygiene, test/build health, technical-debt triage, production and
asset retention review, development handoffs, documentation/Obsidian navigation,
dependency/security triage, and evidence-based preparation of release candidates.

**Live task and decisions:** [maintenance ledger #159](https://github.com/jaclose/AXOM/issues/159).
The [maintenance registry](repository-audit.md#maintenance-registry) remains the
single source of truth for cleanup disposition. This document is a standing
procedure, not a second file inventory or a substitute for feature contracts.

## Ownership and non-interference

| Responsibility | Owner and boundary |
| --- | --- |
| Maintenance classification, reproducibility and scoped repairs | Maintenance lead, stable key `AXOM-MAINTENANCE-LEAD-20261106` |
| Cross-workstream engineering and owner coordination | [Mothership #106](https://github.com/jaclose/AXOM/issues/106) |
| QBank/Course Tracker data and feature integration | [APEX PRIME #101](https://github.com/jaclose/AXOM/issues/101) and its ATLAS, NOVA, SCHOLAR, SENTINEL owners |
| Final source-batch integration and main/production cutover | [Release gateway #140](https://github.com/jaclose/AXOM/issues/140) |
| Independent approval evidence | Existing read-only Release QA |

An active work claim outranks an opportunistic maintenance plan. Before touching a
file, verify current branch, base/head SHA, claim, exact path scope, and the
[maintenance registry](repository-audit.md#maintenance-registry). A missing claim
is not automatic permission. Preserve unrelated worktrees, untracked, ignored,
staged and private files. Do not reset, force-push, bulk-stage, stash, delete
someone else's work, or overwrite a shared contract. The repository is public:
no private study content, secrets, user data or unlicensed media.

## One finite maintenance cycle

1. **Orient.** Read [agent policy](../../AGENTS.md), the
   [rolling AI state](../AI_STATE.md), the relevant registry row, and the
   active task or release issue. Use narrowly targeted reads, not a full vault
   or branch-history import.
2. **Establish truth.** Record source SHA, release candidate SHA, outstanding
   required jobs, current failure signatures and recent changed paths. A past
   CI result is evidence only for its exact SHA.
3. **Claim one bounded task.** Record an issue ID, owner, branch, base SHA,
   exact affected paths, acceptance criteria, reversible rollout and stop
   conditions. Coordinate overlapping scopes with Mothership, APEX or gateway.
4. **Prove the problem.** For code behavior changes, make a failing test
   reproduce the defect first. For docs, CI or retention changes, record
   precise initial evidence and a machine-verifiable acceptance condition.
5. **Change the smallest safe surface.** Prefer isolated branch/worktree,
   named-file staging, existing dependencies and existing file locations.
   No new agent framework, duplicate router or speculative rewrite.
6. **Verify.** Run targeted tests, related integration checks and affected
   typecheck/lint/build. Use the full web/release checks when the risk or
   gateway warrants them. Report passing, failing, skipped and unrun gates.
7. **Document and stop.** Update the canonical feature/architecture contract
   only if behavior actually changed; update the maintenance registry for a
   cleanup classification, and the AI state for a concise checkpoint. Add a
   meaningful Obsidian link only when it helps retrieval. Provide exact
   commit, workflow-run links, changes, open risks and next owner/action.
   Stop instead of rolling into unrelated development.

## Testing frequency and cost policy

The normal [AXOM Quality workflow](../../.github/workflows/quality.yml)
runs required deployment-input, web, browser and native verification on the
relevant push, pull request or merge-group event. The
[APEX Academic Acceptance workflow](../../.github/workflows/apex-acceptance.yml)
adds the full learning-system verification for its covered changes.
These remain the release authority. No reduced scheduled check can certify a
release or a live account experience.

The separate **AXOM Maintenance Sentinel** workflow is a proposed lightweight
30-minute safety signal: `.github/workflows/maintenance-sentinel.yml`.
It runs isolated repository-hygiene unit tests using a sparse read-only checkout,
no npm install, no service credentials, no production deploy and no artifact
upload. Its trigger is a best-effort GitHub-hosted cron, so actual start times
can drift or runs can be delayed or dropped. Its green result means
**repository-hygiene unit tests passed**, not that QBank, Course Tracker, native
desktop, live user accounts or production passed. Its workflow also has a
manual dispatch and a PR-path test so the job itself is testable before merge.

| Trigger | Validation scope | Signoff |
| --- | --- | --- |
| Every 30 minutes, best effort after the sentinel lands on main | Fast repository-hygiene unit tests; alert on failures | No automatic merge or deploy |
| Every touched PR / integration update | Existing full Quality pipeline, affected focused tests | Workstream owner |
| Source-academic path change | Existing APEX Acceptance plus source/reviewer invariants | APEX + release QA |
| Release candidate before main | Exact combined SHA, full relevant checks, preview and migrations/privacy review | Release gateway |
| Periodic maintenance review | Cross-PR ownership, flaky signatures, asset/duplicate candidates, performance cost, dependencies | Maintenance lead; issue checkpoint |

Avoid running 48 full clean web/native builds per day with no change.
Investigate resource minutes and failure rate before broadening the scheduled
scope. The ChatGPT recurring task system cannot schedule more often than
hourly; the GitHub workflow is the only proposed 30-minute runner here.
A scheduled report without executed tests is not a test.

For commands, consult [testing and CI coverage](testing.md). The maintenance
unit command is `node --test scripts/repository-hygiene.test.mjs`;
documentation/tooling acceptance is `npm run test:repo` and
`npm run repo:check`, and release acceptance uses the existing
`npm --prefix web run verify:all` as appropriate. Never suppress failing
checks or convert failed native CI into a false green by increasing timeouts.

## Safe deletion and storage hygiene

Classify exact paths as `KEEP`, `ACTIVE_DO_NOT_TOUCH`,
`REVIEW_REQUIRED`, `ARCHIVE`, `DUPLICATE_CANDIDATE`, or
`DELETE_CANDIDATE`. A candidate is not permission to delete.

For each proposed removal, collect: exact path or provider deployment ID,
owner and active-work claim, SHA/hash or artifact identifier, size and
provenance, import/caller/stable-URL references, current live usage, data
and licensing rights, retention policy, proposed archive, reversible recovery
procedure, and positive owner approval. Require owner review for any unknown
or historically citation-bearing material. Delete only after explicit scoped
authorization, verified safe conditions, successful reference checks and
documented restore strategy. Do not delete active Vercel production, stable
frontend media URLs, account data, source questions, private originals or
migration identifiers as a side effect of "tidying." Do not rewrite Git
history to shrink blobs without a separately approved migration and backup.

Historical inventories in [repository audit](repository-audit.md) contain
duplicate and large-file **leads**, not current deletion decisions. Monitor
provider preview/artifact budgets; avoid repeated builds or uploads that fill
Vercel storage. Classify failed/obsolete previews individually before any
provider-side cleanup.

## QBank and Course Tracker reliability first

Maintenance owns interface checks and groundwork; APEX owns code integration.

**QBank invariants:**
- Preserve source document, page/item identity, bank/set ID, source revision,
  content hash and correctness/rights decision separately.
- Hold ambiguous duplicate originals, missing correct-answer keys, conflicting
  source evidence, outdated explanations, and rights-unverified content.
- AI-generated rationale starts as a traceable draft, not a verified key or
  a silently published medical explanation. Human review and provenance
  determine public/answer-ready status.
- Check idempotent import, duplicate handling, undo/restore, reviewer/audit
  records, tagging, private media and broken image fallback.
- Test standalone community question-set publication against the same
  moderation, attestation, withdraw and privacy contract as course sharing.

**Course Tracker invariants:**
- Week/module/course membership derives from canonical scoped source evidence;
  unassigned items must not appear as scheduled/available.
- Imported schedule updates are stable, reversible and timezone-safe.
- Progress, quiz state, review/history and account sync survive save, refresh,
  offline changes and backup restore without silent resets.
- Check multi-course targeting, completed vs available counts, source
  revisions, evidence-bounded progress and accessible mobile layouts.

Keep a focused regression matrix by source/input and user journey: import,
review, publish, learner reload, practice, progress, withdrawal and
backup/sync. Use synthetic fixtures in public CI. Real-source rights and
real-account acceptance remain separate evidence gates.

## AI context and Obsidian maintenance

The vault is the existing [AXOM docs folder](../graph/README.md).
[System Map](../graph/AXOM-System-Map.md) and
[context router](../INDEX.md) select the right source. One concept belongs
to one canonical document. Add a new page only for a genuinely new contract,
not for duplicating content already covered by the registry or design docs.

- `AGENTS.md`: small permanent shared operating policy.
- `docs/AI_STATE.md`: dated rolling handoff, not history or verbose logs.
- `docs/features/` and `docs/architecture/`: current feature and data
  contracts, only after verified change.
- `docs/directions/01-ideas/`: preserve verbatim ideas and stable IDs.
  Never rewrite original idea text to make progress sound complete.
- `docs/operations/repository-audit.md`: authoritative cleanup registry.
- `docs/graph/`: human navigation and meaningful cross-document links,
  not auto-generated file nodes or whole-codebase embeddings.

An agent's default context is only AGENTS + AI_STATE + its task. Select one
narrow domain route and stop reading when enough evidence exists. Use
`repo:check` to validate metadata, links, frozen snapshots, hygiene and
bootstrap context budgets after docs changes.

## PR and idea groundwork

Inventory all open PRs by exact head SHA, owner, status, changed-file
intersection, dependencies, test receipts, merge readiness and release batch.
A PR may be `ACTIVE`, `READY_FOR_GATE`, `HELD`,
`SUPERSEDED_PENDING_REVIEW` or `HISTORICAL`. Do not close, delete or
merge without reconciling owner, main delta and release manifest. Give
duplicate candidates an explicit canonical successor, not silent closure.

For an unstarted idea, use its existing ID and create a finite
`IDEA-<ID>-GROUNDWORK` issue with: user outcome, demonstrated baseline,
current gap, screens and interactions, data models/API contracts, security
and privacy boundary, dependencies, test plan (RED cases), performance
budget, acceptance criteria, rollout/rollback, and disjoint worker file
scopes. Mark it `PLANNED` until implementation and acceptance actually
occur. Avoid speculative scaffolding that makes later integration harder.

## Evidence dashboard

Record per checkpoint: UTC timestamp, branch and exact SHA, owner/task,
last passing/failed Quality and APEX runs, reproducible blocker, CI duration,
flaky-test signature, untriaged P0 issues, release readiness, open PRs without
an owner, stale/duplicate candidates awaiting review, reviewed duplicate
bytes (not guessed savings), repository/context budget, document link errors,
and the next one concrete maintenance action.

**Stop immediately** for missing permissions, unresolved ownership,
conflicting source hashes, licensing doubt, private material, flaky or
failing mandatory gates, source/main SHA drift, provider capacity, unverified
migrations, or irreversible production effects. Escalate with evidence.
