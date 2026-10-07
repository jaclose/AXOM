---
tags:
  - axom/operations
authority: canonical
---
# Branch recovery and consolidation, 2026-10-07

This is a dated recovery record, not a new feature plan. Recheck Git before acting.
The existing integration ledger remains
`/Users/jd/Developer/AXOM-coordination/state/CONVERGENCE.md`; this record reconciles its
older matrix with current Git evidence and records this pass. No branches/worktrees,
stashes, private/reference files or safety refs were removed. No product code changed.

## Chosen line and integration

Canonical line: `integration/axom-convergence-2026-10-07`, inventoried at `ac67549`.
It contains the intact infrastructure base `42eeacb`, Course Engine `093bb65`, exam
parent `2c1d610`, the shared player, Anki, media foundation, plans and recovered ideas.
It deliberately excludes mixed commit `93badf8`, dependency WIP `8dd9391` and Decode code.
The integration owner recorded a full gate at ac67549: 2,473 unit tests, 42 browser
passes and one optional skip. Those are owner-reported prior results, not this pass's run.

Maintenance `f5e2ac2` was previewed with two-argument `git merge-tree --write-tree`
and merged in isolated `codex/integration-recovery-2026-10-07` at
`AXOM-integration-recovery`. Six conflicts were entirely documentation/configuration:

| Conflict | Semantic resolution |
| --- | --- |
| AGENTS | Maintenance policy; its optional one-hop graph rule already preserves the integration addition |
| AI_STATE | Current integrated contracts/open items in a concise handoff; stale maintenance branch state removed |
| Obsidian app.json | Existing portable Markdown-link settings, preserving the trailing newline |
| Obsidian graph.json | Existing minimal tag/unresolved filter; omit machine/layout/zoom defaults |
| System map and graph guide | Maintenance routes plus the now-integrated Course Engine contract |

Auto-merged feature routes were corrected where they still said Course Engine was absent.
Protected registry records were refreshed from evidence; no area automatically became READY.
The ignore-rule test caught an inherited final `.env*` overriding the earlier template
exception. The final `!.env.example` now keeps templates visible, and the merged
duplicate Obsidian block was removed. No dependency or source asset rule was broadened.
Runtime, package/lockfiles and CI in recovery staging remain byte-identical to ac67549.
The recovery branch is a maintenance checkpoint, not a competing product line.

### Concurrent work changed the stopping point

On recheck, the canonical line had advanced to `c8f6ceb` with nine commits after
ac67549: source-grounded Decode under `web/src/lib/decode/`, tutor teaching, typed
review ranking and iCalendar parsing. Those 39 changed paths belong to another
active session. They were neither overwritten nor imported into this recovery
checkout. Its current Decode contract is `docs/features/decode.md` on that line.
The old a33a01e prototype now needs a remaining-intent comparison, not a fresh wholesale port.

The planned fast-forward was withheld: a clean status alone does not establish that
the owner has released the checkout. Maintenance is integrated in recovery staging
only, ready for the canonical owner to merge after refreshing their state. A read-only
merge preview against c8f6ceb with ac67549 as the explicit common base completed cleanly
(exit 0). This proves mechanical compatibility, not that the older handoff describes
the newer product work. No write to AXOM-integration occurred.

Research checked installed Git 2.54.0 against the official
[merge-tree](https://git-scm.com/docs/git-merge-tree) and
[merge](https://git-scm.com/docs/git-merge) contracts: preview with both explicit refs
without changing an index/worktree; fast-forward-only refuses divergent history.
This reinforced isolated integration and the live-target recheck. A focused search
of available Chrome bookmarks found no Git recovery tool to add. Existing Git and
the repository checks supply the needed capabilities; no new dependency, MCP, skill
or subagent was justified.

## Local branch matrix

Inventory: 33 local branches, 37 remote-tracking branches (excluding symbolic origin/HEAD),
25 registered worktrees, one stash and 20 safety refs before adding recovery staging.
Remote refs were fetched without pruning. Unique counts below are commit-hash counts
against ac67549, before the maintenance merge; zero means ancestor containment, not a
claim that a dirty worktree is safe to remove. Previously integrated work targets the canonical line; this pass adds maintenance
to recovery staging only. `SUPERSEDED` means represented or replaced there, not deletion approval.

| Branch | HEAD | Unique | Status | What / unique value | Merged? / risk / next action |
| --- | --- | --- | --- | --- | --- |
| `agents/vercel-deployment-fix-serverless-limit` | `4facc9e` | 0 | SUPERSEDED | Old serverless compatibility fix | Yes (ancestry); Contained; its worktree registration is unavailable, so preserve it |
| `backup/accounts-before-main-integration-20260927` | `c73730c` | 0 | RECOVERY_ONLY | Pre-integration account snapshot | Yes (ancestry); Contained; retain backup |
| `backup/accounts-sync-before-main-merge-20260927` | `1a80ded` | 0 | RECOVERY_ONLY | Account merge backup | Yes (ancestry); Contained; retain backup |
| `backup/pre-large-file-cleanup-2026-09-28` | `5be3118` | 1 | RECOVERY_ONLY | Large audio backup | See evidence; Do not merge large reference media |
| `codex/ai-maintenance-2026-10-07` | `f5e2ac2` | 1 | READY_TO_MERGE | Validated agent/context/graph maintenance | Merged into recovery staging only; canonical owner must merge the reconciled checkpoint |
| `codex/axom-decode-v1` | `a33a01e` | 2 | NEEDS_REBASE_OR_RECONCILIATION | Untested Decode source + already preserved ideas | See evidence; Compare remaining intent against the new canonical Decode port; do not re-port completed layers |
| `codex/axom-release-repair` | `9316fff` | 0 | RECOVERY_ONLY | Old tip plus unfinished cinematic merge | Yes (ancestry); Keep MERGE_HEAD, index and dirty files; no abort or commit here |
| `codex/question-first-plan-2026-10-04` | `9f29327` | 0 | ACTIVE_HOLD | Dirty idea-only draft; newer ideas already canonical | Yes (ancestry); Keep draft and safety snapshot; no source merge needed |
| `codex/repository-context-protocol` | `9f29327` | 0 | ACTIVE_HOLD | Dirty earlier infrastructure draft | Yes (ancestry); Superseded in intent; preserve all 50 local changes until owner releases |
| `debug/update-regression` | `402e365` | 0 | SUPERSEDED | Older cinematic/update checkpoint | Yes (ancestry); Contained; no integration needed |
| `feat/accounts-sync-v1` | `71c6e07` | 0 | SUPERSEDED | Account/sync and media history | Yes (ancestry); Contained; ignored assets prohibit casual worktree removal |
| `feat/course-engine-v1` | `093bb65` | 0 | SUPERSEDED | Course, tracker, import and question intelligence | Yes (ancestry); Already merged at 7c069ea; future work starts from integration |
| `feat/ecosystem-launch-convergence-v1` | `3ae726e` | 0 | SUPERSEDED | Daily games and ecosystem shell | Yes (ancestry); Contained |
| `feat/exam-fidelity` | `93badf8` | 1 | ACTIVE_HOLD | Exam work plus mixed commit 93badf8 | See evidence; Safe exam parent already integrated; dirty original checkout blocks revert |
| `feat/ideas2-course-workflow` | `0478959` | 6 | ACTIVE_HOLD | Six unique commits plus dirty media/course work | See evidence; Reconcile by intent; shared store, media and exam overlaps prohibit wholesale merge |
| `feat/ideas2-integration` | `0478959` | 6 | SUPERSEDED | Same commit as ideas2-course-workflow | See evidence; Alias only; unique work remains held on the other branch |
| `feat/ideas3-staging` | `933419f` | 1 | SUPERSEDED | Only a stale tracker-order TODO comment | See evidence; Current settled ordering already implemented; no runtime value to merge |
| `feat/media-pipeline-v1` | `8dd9391` | 1 | ACTIVE_HOLD | Foundation/graph integrated; dependency-only WIP remains | See evidence; 8dd9391 changes four package/lockfiles; owner decision required |
| `feat/owner-feedback-2026-09-27` | `2387113` | 2 | SUPERSEDED | Owner feedback and analytics | See evidence; Both unique commit hashes are patch-equivalent via git cherry |
| `feat/question-bank-completion-v1` | `2fd0c8e` | 0 | SUPERSEDED | Question bank and tutor launch work | Yes (ancestry); Contained |
| `feat/question-import-reliability-v1` | `4e5e81d` | 0 | SUPERSEDED | Review-first structured import | Yes (ancestry); Contained |
| `feat/tutor-tracker-personalization-v1` | `a8564e6` | 0 | SUPERSEDED | Focused tutor tools | Yes (ancestry); Contained |
| `feat/wave2-home` | `b065218` | 0 | SUPERSEDED | Save-progress banner, restore and check-in | Yes (ancestry); Already merged at 871b889 |
| `feat/wave2-journal-library` | `5e1f5aa` | 0 | IDEA_ONLY | Journal/library plan | Yes (ancestry); Already merged at 6af115a; preserve canonical plan |
| `feat/wave2-study-ai` | `e4358ab` | 0 | IDEA_ONLY | Study/import/AI plan | Yes (ancestry); Already merged at 883269b; preserve canonical plan |
| `fix/wave1.3` | `2fa1792` | 0 | SUPERSEDED | Import, sounds and exam fixes | Yes (ancestry); Contained through main |
| `fix/wave1.3.1-sync` | `922ef7a` | 0 | SUPERSEDED | Upload/sync repair | Yes (ancestry); Contained through main |
| `fix/wave1.3.2-audit` | `c67b12d` | 0 | SUPERSEDED | Browser audit repairs | Yes (ancestry); Contained through main |
| `integration/axom-convergence-2026-10-07` | `ac67549` → `c8f6ceb` | 0 at inventory; +9 later | ACTIVE_HOLD | Canonical development line, advancing in another session | No write by this pass; owner to merge maintenance checkpoint; main promotion excluded |
| `main` | `5fbe8a4` | 0 | REVIEW_REQUIRED | Release baseline 5fbe8a4 | See evidence; No main merge, push or deployment in this pass |
| `release/alpha-1-prep` | `b14626e` | 0 | SUPERSEDED | Pre-alpha onboarding checkpoint | Yes (ancestry); Contained |
| `wave/1.1` | `f221dc3` | 0 | SUPERSEDED | Wave 1.1 integration | Yes (ancestry); Contained through main |
| `wave/1.2` | `4254766` | 0 | SUPERSEDED | Wave 1.2 integration | Yes (ancestry); Contained through main |

Added by this pass: `codex/integration-recovery-2026-10-07`, **READY_TO_MERGE** into
the canonical line after its owner releases the shared handoff. It contains the
maintenance merge and this recovery record; it is not a feature starting point.

## Remote-only work and recovery refs

| Branch / artifact | Status | Unique value / existing integration | Next action |
| --- | --- | --- | --- |
| `origin/claude/loving-cray-ftf0tr` at 6e43820 | NEEDS_REBASE_OR_RECONCILIATION | 14 unique hashes incl. merge commits; Anki ports already integrated at 2333d4e/c9657b2. Remaining Canvas/calendar scope, accounts doctor, AI tasks/screenshots and Guide overlap current contracts; new canonical iCalendar parsing is not proof that Canvas/feed support is done | Preserve branch and commit-by-commit ledger; no wholesale merge or new feature implementation |
| `origin/claude/wonderful-cannon-y5vjsp` at ed8a812 | SUPERSEDED | Vite root allowance, deferred Promise prompt, reduced-motion update verification and release-notes precache all present on canonical line | No duplicate port; original commits remain locators |
| `origin/claude/axom-3d-brand-ident-fl9arq` at bf25b5d | NEEDS_REBASE_OR_RECONCILIATION | Cinematic sources/renders and codec selection; tied to unfinished release-repair merge and design decision | Preserve; owner decides media direction/licensing before selective port |
| `origin/vercel/install-vercel-web-analytics-dl9aqq` at eac8df8 | SUPERSEDED | Analytics and SpeedInsights already mounted in current main.tsx | No duplicate dependency/UI changes |
| Eleven `origin/dependabot/*` branches | REVIEW_REQUIRED | Dependency and action upgrades, not recovered product work | Separate upgrade review and validation; package files protected |
| Matching `origin/<local-branch>` refs | Same content status as corresponding local row | Remote may lag local; local committed work is preserved independently | No pushes or deletions; compare tips before later publishing |
| Three `backup/*` branches | RECOVERY_ONLY | Two account backups are contained; pre-large-file-cleanup holds excluded large audio | Retain every branch |
| Six `refs/safety/2026-10-06/*` | RECOVERY_ONLY | Stash plus context, Decode, Ideas 2, question-first and release-repair snapshots | Retain; they do not authorize restoring over live files |
| Fourteen `refs/safety/2026-10-07/reflog/*` | RECOVERY_ONLY | Recovered earlier dependency, plan, update-panel and ident tips | Retain; no broad recovery import is justified |

All 11 dependency refs remain visible with `git for-each-ref refs/remotes/origin/dependabot/`;
all 20 safety refs with `git for-each-ref refs/safety/`. This avoids copying a generated
Git dump into the permanent task router. No remote-only branch was merged wholesale.

## Worktree protection

Initial state: 18 clean, five dirty, two unavailable/stale registrations. The canonical
worktree later advanced while clean and remains ACTIVE_HOLD. Recovery staging
adds one clean worktree after commit. Clean does not imply ignored data is disposable.

| Worktree | State | Protection / next action |
| --- | --- | --- |
| `AXOM` (feat/exam-fidelity) | DIRTY (5 paths) | ACTIVE_HOLD; unchanged status/content required |
| `vercel-main` (detached) | UNAVAILABLE | Preserve registration and files; no prune/remove |
| `AXOM-accounts-v1` (feat/accounts-sync-v1) | CLEAN | Keep; no branch/worktree deletion authorized |
| `AXOM-ai-maintenance` (codex/ai-maintenance-2026-10-07) | CLEAN | Keep; no branch/worktree deletion authorized |
| `axom-audit` (detached) | CLEAN | Keep; no branch/worktree deletion authorized |
| `AXOM-context-protocol` (codex/repository-context-protocol) | DIRTY (50 paths) | ACTIVE_HOLD; unchanged status/content required |
| `AXOM-course-engine-v1` (feat/course-engine-v1) | CLEAN | Keep; no branch/worktree deletion authorized |
| `AXOM-decode-v1` (codex/axom-decode-v1) | CLEAN | Keep; no branch/worktree deletion authorized |
| `AXOM-ecosystem-v1` (feat/ecosystem-launch-convergence-v1) | CLEAN | Keep; no branch/worktree deletion authorized |
| `AXOM-exam` (fix/wave1.3.1-sync) | CLEAN | Keep; no branch/worktree deletion authorized |
| `AXOM-ideas2` (feat/ideas2-course-workflow) | DIRTY (12 paths) | ACTIVE_HOLD; unchanged status/content required |
| `AXOM-ideas3` (feat/ideas3-staging) | CLEAN | Keep; no branch/worktree deletion authorized |
| `AXOM-integration` (integration/axom-convergence-2026-10-07) | CLEAN | Keep; no branch/worktree deletion authorized |
| `AXOM-question-first-plan` (codex/question-first-plan-2026-10-04) | DIRTY (5 paths) | ACTIVE_HOLD; unchanged status/content required |
| `AXOM-question-import-v1` (feat/question-import-reliability-v1) | CLEAN | Keep; no branch/worktree deletion authorized |
| `AXOM-tutor-tracker-v1` (feat/question-bank-completion-v1) | CLEAN | Keep; no branch/worktree deletion authorized |
| `AXOM-wave-1.1` (wave/1.1) | CLEAN | Keep; no branch/worktree deletion authorized |
| `AXOM-wave-1.2` (wave/1.2) | CLEAN | Keep; no branch/worktree deletion authorized |
| `AXOM-wave-1.3` (fix/wave1.3) | CLEAN | Keep; no branch/worktree deletion authorized |
| `AXOM-wave-1.3.1` (fix/wave1.3.2-audit) | CLEAN | Keep; no branch/worktree deletion authorized |
| `AXOM-wave2-home` (feat/wave2-home) | CLEAN | Keep; no branch/worktree deletion authorized |
| `AXOM-wave2-journal` (feat/wave2-journal-library) | CLEAN | Keep; no branch/worktree deletion authorized |
| `AXOM-wave2-study` (feat/wave2-study-ai) | CLEAN | Keep; no branch/worktree deletion authorized |
| `agents-vercel-deployment-fix-serverless-limit` (agents/vercel-deployment-fix-serverless-limit) | UNAVAILABLE | Preserve registration and files; no prune/remove |
| `axom-release-repair` (codex/axom-release-repair) | DIRTY (19 paths) | Preserve unfinished merge, staged and unstaged contents |

The five dirty worktrees were fingerprinted before edits (status plus regular dirty/untracked
file hashes), without modifying their indexes or reading ignored private folders. Local
comparison evidence is `/tmp/axom-recovery-protection.json`; durable history remains in the
existing safety refs. Original AXOM has three user-authored Bases and two native permission
files. The old Vercel worktree and prunable scratch registration were unavailable as Git
checkouts, not assumed empty. Account worktree ignored media must remain protected.

## Ideas, stash, Claude and guard

Four key idea files are byte-identical between Decode document checkpoint `328444c`
and ac67549: Ideas 6, the Learning Intelligence doctrine, QUESTION-FIRST-PLAN and
DECODE-IMPLEMENTATION. Ideas 6 I6-01 through I6-17 and canonical routes remain preserved.
Earlier question-first/context drafts stay in their dirty worktrees and safety snapshots.
The journal/study plans are already in canonical ancestry. No idea text was rewritten.

Stash `ccaff8d` remains `stash@{0}` and has a safety ref. Its graph/ignore work was already
recovered into cd80bba/50cb6b1; dependencies were parked at 8dd9391. OpenAI endpoint/smoke
files remain excluded from canonical code, preserved in the stash and mixed branch. Do
not pop/drop the stash. The original mixed checkout remains ACTIVE_HOLD; no revert was
attempted over its untracked files or while other sessions could use it.

Course Engine's 12 committed changes through 093bb65 are in canonical ancestry, and
its worktree is clean. No missing implementation was found requiring transcript recovery.
The supplied Desktop JSONL backup path was absent when checked; no alternate conversation
history was ingested. This is not evidence that any backup was deleted by this pass.

AXOM-coordination is not a separate Git repository. Its ledger already records the minimal
guard repair under JD's authority: keep JD's decide(), remove the duplicate placeholder.
This pass found one exported decide() and ran `node --test` in `tools/guard`: **12/12 pass**,
including Git-level blocking behavior. No coordination guard file or hook was edited.

## Validation and stopping point

Maintenance merge commit: `78e2bf3`, parents ac67549 and f5e2ac2. Post-commit recheck
confirmed all protected files and non-target refs unchanged. The canonical owner then
advanced again to `f1fd462` (accounts doctor, build configuration notice). That new port
is another reason to compare remaining intent from the remote Claude branch before
any future reconciliation. The matrix above is a dated inventory, not a lock on live
branch tips; this pass did not write to the canonical checkout or validate its new code.

Executed on Node 22.23.1:

- `npm run repo:check`: pass, 32 active documents, zero routing/registry/graph/conflict
  problems, all 10 archived snapshots intact. Both portable Obsidian JSON files parse.
- `npm run test:release`: all 62 root tests pass, including all 43 hygiene tests.
  The earlier focused run found the `.env.example` issue above; it is repaired.
- The signature fixture reused installed Tauri CLI 2.11.5 via an ignored local symlink,
  matching the lockfile; no package install or manifest/lockfile edit.
- Coordination guard: 12 tests pass, including real Git blocking behavior; no guard edit.
- Runtime/dependency/CI equality to ac67549 and `git diff --check`: pass. All changes
  are docs/policy, ignore rules or the hygiene checker and its tests.
- Five dirty worktrees: exact status and all 88 regular-file hashes unchanged; the
  three pre-existing absent paths remain absent. All other 69 inventoried branch refs,
  the stash and 20 safety refs are unchanged. The canonical branch alone advanced
  independently, from ac67549 to c8f6ceb.
- Read-only merge preview against c8f6ceb: clean. Canonical checkout was clean when
  rechecked but remains protected because another session is advancing it.

Bootstrap AGENTS + AI_STATE: about **3,744 → 2,741 estimated tokens** relative to
the integration base (27% smaller). The standalone maintenance snapshot was 2,351;
the extra handoff context carries the integrated contracts and recovery/concurrency state.
These are repository character estimates, not measured total model context.

No application build/typecheck/lint/browser rerun: this recovery checkpoint has no
runtime changes. Newer c8f6ceb runtime work was not validated by this pass. Native
Obsidian rendering was not rerun; graph verification is structural only.
After commit there are 26 worktree registrations: 19 clean, five dirty, two unavailable;
all are retained. Physical branch/worktree cleanup remains a separately authorized task.
No push, deployment, main merge, stash operation, branch deletion or worktree removal.
The canonical owner should merge this checkpoint and refresh its handoff first. New
Course Engine/QBank work then starts from that validated canonical tip in a fresh
session, not this older recovery snapshot, feat/course-engine-v1 or the mixed checkout.
