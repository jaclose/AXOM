---
tags:
  - axom/operations
authority: canonical
---
# AXOM AI Worker Operating Protocol, V1

**Applies to:** Every AXOM AI coding, design, research, QA, operations and
scheduled worker, including MOTHERSHIP, APEX PRIME, Journal/UX, Communications,
Codex, Claude, Copilot and the release gateway. It expands
[AGENTS.md](../../AGENTS.md), which remains the canonical bootstrap. No worker
may interpret this protocol as permission to disclose secrets, alter user
records, send outbound messages, perform paid actions or publish unchecked work.

**Goal:** Fewer failed commits and duplicated cloud deployments; more
traceable, correct, recoverable releases. Keep these states distinct:
**implemented, locally tested, pushed, CI passed, merged, deployed, hosted accepted**.
Never promote a state without independent evidence for that exact revision.

## 1. Worker roles, authority and ownership

| Worker lane | Responsible for | Must not do |
| --- | --- | --- |
| Domain workers, including APEX, Journal/UX, QBank and Communications | Own isolated changes, regression tests, documentation, commits and draft PRs | Merge directly to main, overwrite someone else's branch, modify production or claim deployed success |
| MOTHERSHIP | Coordinate priorities, dependencies, worker leases and cross-system architecture | Override an owner claim, manufacture QA approval or skip release gates |
| Independent Release QA | Read-only code/security/data/CI/hosted evidence review, issuing PASS/HOLD/FAIL findings | Push, merge, deploy, approve its own work or represent a comment as formal approval |
| Release Gateway | Freeze approved source SHAs, reconcile branches, validate one combined release and coordinate authorized publication | Merge incomplete/failing/draft work, bypass migrations, destroy data or incur costs without necessary authorization |

Live ownership references include MOTHERSHIP [#106](https://github.com/jaclose/AXOM/issues/106),
APEX [#101](https://github.com/jaclose/AXOM/issues/101) and the coordinated
[release manifest #140](https://github.com/jaclose/AXOM/issues/140).
Read [deployment.md](deployment.md) for the final integration procedure.
Role names do not grant access; owner consent and platform permissions still apply.

## 2. Assignment intake: claim before change

1. Read AGENTS.md, the relevant part of docs/AI_STATE.md, the assigned issue and
   the smallest necessary source/tests. Establish current main SHA, actual branch
   HEAD, worktree status and the user-visible acceptance criterion. Identify
   *deployed production state* separately from repository state.
2. Inspect current ownership in the coordination BOARD where accessible, plus
   overlapping PRs/issues. Record **OWNER, ISSUE, CHANGED PATHS/CONTRACTS, BASE_SHA,
   BRANCH, ACCEPTANCE, DEPENDENCIES, RISK, STOP CONDITION** before contested work.
   If ownership or required authority is unknown: **HOLD** and escalate.
3. Use an isolated worker branch/worktree. Never bulk-stage, reset, stash,
   force-push, silently rebase, change another agent's active branch or discard
   untracked/ignored files. Protect personal study data, IndexedDB, image
   attachments, protected revisions, backups and private PDFs.
4. Keep each workstream scoped. Distinct UX, QBank, storage, security,
   migrations, licensing and media changes get separate source PRs with explicit
   dependencies, rather than combining unfinished unrelated fixes.
5. Stop on unresolvable live-account, permissions, resource, source-provenance or
   ownership blockers. Preserve evidence; do not invent proof, bypass a check or
   clear data to make a run green.

## 3. Test-driven pre-push contract

**DEFINE -> RED -> GREEN -> VERIFY -> REVIEW -> CHECKPOINT -> HANDOFF.**
For a bug, first reproduce it with a focused failing regression test; fix and
rerun GREEN. For configuration-only changes, test both allowed and denied
paths. Use [testing.md](testing.md) to discover commands. Push only reviewed
scope after available checks, not after speculative untested edits. Avoid
repeated pushes simply to outsource local tests to GitHub runners.

| Impact | Minimum source tests | Release-specific requirements |
| --- | --- | --- |
| Documentation/context/governance | npm run test:repo, npm run repo:check and targeted policy tests | Recheck post-conflict resolution |
| Web UI, QBank, storage, sync, Community | Regression tests, typecheck, lint and applicable production build | Full web verification, Chromium at 1440/390/320, keyboard/reduced-motion, save-refresh/offline |
| Authentication, RLS, migration or learner records | Negative authorization, data-isolation, recovery and compatibility tests | Correct project/environment, migration ordering, real two-account acceptance |
| Native, CI, deployment | Focused script/toolchain tests, native checks or exact CI | Full native/deploy-input gates and staging browser smoke |
| Visual assets, sound or email | Rights/provenance and render/playback tests | Hosted visual/playback checks; separate outbound-mail authority |

Every test receipt states **pass / fail / skipped / unrun**, exact candidate SHA,
command, environment and evidence URL. A successful earlier SHA never certifies
a newer SHA. Synthetic Chromium does not establish real signed-in account
persistence, actual image bytes or live cloud authorization. No skipped
security or quality checks disguised as passes.

## 4. Pull request lifecycle and release freeze

Open a draft PR with the [AXOM PR template](../../.github/PULL_REQUEST_TEMPLATE.md).
Record owner/issue, affected paths/contracts, base and head SHAs, intended
behavior, RED/GREEN proof, tested commands and CI links, migration order,
data/licensing/security risks, conflicts, rollback and hosted limitations.
An incomplete PR stays draft, even if an earlier test succeeded.

**DRAFT -> SOURCE_READY -> INTAKE -> FROZEN -> COMBINED_VERIFIED -> MERGED ->
DEPLOYED -> ACCEPTED**

- **SOURCE_READY** means scoped source checks passed; this is not merge approval.
- **INTAKE** means the gateway verified owner, dependencies, license and risk.
- **FROZEN** means branch+head SHA is pinned in issue #140. Any source push
  invalidates the freeze and needs a fresh intake.
- **COMBINED_VERIFIED** means current-main reconciliation, semantic conflict
  resolution, all mandatory exact-release-HEAD CI jobs, independent security
  and data review, deployable inputs, actual preview/browser checks, migration
  plan and rollback/forward repair evidence.
- **MERGED** is a confirmed main SHA. **DEPLOYED** is a confirmed deployment ID
  and exact source SHA in the intended environment. **ACCEPTED** requires hosted
  user-journey/device validation; a Vercel green badge alone cannot prove it.
- **HELD** can interrupt any stage. State the blocker, responsible owner and
  unblock criterion; mark old PRs superseded/already-in-main explicitly.
  These are operational stages, not built-in GitHub status labels.

The release gateway batches compatible verified changes into one coherent
release. Feature workers do not auto-merge after source CI turns green. When
main changes, reconcile again and re-run affected combined gates. An urgent
security/data-loss hotfix may use a separately reviewed, documented exception,
then be reconciled into the next train.

## 5. Failure classification and response

| Observation | Classification | Required action |
| --- | --- | --- |
| Test assertion fails | Source/contract defect until disproven | Capture exact test/log/SHA, fix, rerun before push |
| CI run canceled | Superseded, timed out or manually interrupted | Find replacement on exact current SHA; no pass inferred |
| Native apt install stalls, runner runs out of time | Infrastructure/time budget | Identify failing step; optimize downloads or justify timeout; retest |
| Vercel build-rate or storage quota | Deployment-capacity blocker, not a TypeScript failure | Stop repeated previews and hold hosted acceptance |
| Merge conflict, stale base or duplicate PR | Integration/ownership blocker | Resolve on isolated release branch with original worker; retest semantics |
| Missing credentials, real-account proof, migration or source assets | Unverified external dependency | HOLD; simulations do not substitute |

Retries require a documented hypothesis; do not repeatedly restart expensive
jobs or relabel a deterministic bug as flaky. Never disable branch protections,
audits, tests, CI checks or permission rules just to make the dashboard green.
An intentional RED regression during TDD is not an acceptable source handoff.

## 6. Vercel capacity and branch safety

The Git-integrated **Ignored Build Step** uses
[scripts/vercel-branch-gate.mjs](../../scripts/vercel-branch-gate.mjs):
production main builds, dated release/YYYY-MM-DD-slug previews and hotfix/slug
previews are permitted. Ordinary codex/, feat/, fix/, docs/, dependabot/
and integration/ worker previews are skipped. Gateway integration uses the
dated release branch. An unknown preview branch is held; a legitimate
production rebuild with missing Git metadata still proceeds.

**Important Vercel behavior: exit code 0 means SKIP; exit code 1 means BUILD.**
A skipped build may still create a Git status or hit provider limits before the
ignore command executes. GitHub CI remains active on feature branches; only
the gateway consumes a full exact-head release preview. Never buy a paid plan
or silently modify production settings to bypass build quotas.

Native CI minimizes optional Linux library installation, retries apt package
downloads and uses a bounded 50-minute timeout. Record actual installation and
Rust timings after rollout; increasing the limit is not proof of native success.

**Known enforcement gap:** main was unprotected at V1 preparation. These rules
are currently procedural until the repository owner sets GitHub branch
protection/rulesets requiring AXOM Quality contexts (deployment-inputs, web,
native, three Browser acceptance shards), approved reviews, up-to-date
branches and resolved conversations, with force pushes prohibited.
Check exact live context names first. Do not require feature-branch Vercel
statuses when previews are intentionally skipped. Do not claim protection
has been enabled without a verified readback.

## 7. Handoff, incident and measurement

Each worker leaves one durable receipt in its PR/issue:
**OWNER / BRANCH / BASE_SHA / HEAD_SHA / PATHS / TESTS PASS-FAIL-SKIP-UNRUN /
SECURITY-DATA / BLOCKERS / NEXT ACTION / RELEASE STAGE**.
Link specific jobs rather than generic badges. Stop after the coherent
assignment; do not start unrelated features to fill the session.
Scheduled workers re-read the current protocol at each cycle.

For suspected study-data loss, bad save indicators, breached permissions,
missing images, unlicensed uploads or unexpected emails: hold downstream
release; preserve state and safe logs; assign a single incident owner and
review reversible recovery. Never clear IndexedDB, delete attachments,
reset a vault or run migrations on speculation.

At each release train, measure code-vs-infrastructure failures, canceled
runs, native install duration, Vercel quota blocks, conflicting/held PRs
and source-ready-to-production lead time. Evaluate whether V1 reduced
waste without concealing defects. Amend via a reviewed scoped PR, not
silently during unrelated work.
