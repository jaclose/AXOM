---
tags: [axom/engineering, axom/operations, axom/agents]
authority: proposed-until-merged
owner: AXOM engineering coordination; release authority AXOM FORGE
updated: 2026-11-06
review_trigger: changed-architecture-or-build-contract
---

# AXOM engineering SOP | Build without breaking the learner

**Mission.** Engineer a local-first, source-aware academic operating system whose saved work survives errors, whose study guidance exposes evidence, and whose UI communicates one useful next action. The goal is not maximum code throughput: it is *durable learner benefit per change, with verified reversibility*. This handbook extends [AGENTS](../../AGENTS.md), [development](development.md), [testing](testing.md), [architecture](../architecture/README.md), [design contract](../design/DESIGN.md), and the [maintenance registry](repository-audit.md#maintenance-registry). Those domain documents remain authoritative for specific contracts.

## 01. The programmer's obligations

1. **Truth:** distinguish an idea, implementation, unit test, browser simulation, preview, merge, deployed artifact and live-account acceptance. Each claim names its evidence and revision.
2. **Continuity:** a change may not silently discard learner questions, attempts, journals, media, Anki links, source IDs, local-only settings, export ability or auth boundaries.
3. **Evidence:** source questions, academic answers, AI summaries and inferred mappings are different data classes. Never promote a guess into a reviewed key.
4. **Ownership:** know the active branch/worktree/file owner before editing. A green test does not authorize a main merge.
5. **Observability:** errors must remain detectable and actionable; a toast, retry receipt or log should indicate what actually occurred, not a false success state.
6. **Reversibility:** every risky change has a compatible rollout/rollback or forward-repair plan. Web revert is not a database rollback.
7. **Professional restraint:** no speculative dependency, visual theme, schema, AI provider, telemetry, paid action or architecture rewrite just because tools make it convenient.

## 02. Session protocol: 12 stages

| Stage | Required action | Exit evidence |
| --- | --- | --- |
| 0. Orient | Read scoped AGENTS, AI_STATE, work item, actual HEAD and dirty state | Branch/worktree, exact base SHA |
| 1. Claim | Inspect owners and maintenance registry; choose named paths | Stable task ID, owner, nonoverlap |
| 2. Specify | State observed failure or opportunity, expected user journey, invariants and risks | Falsifiable acceptance criteria |
| 3. Retrieve | Search exact symbols and smallest relevant docs/tests, not the whole tree | Links to source-of-truth |
| 4. Reproduce | Build failing regression or record observed provider/browser evidence | RED test/failure trace, or honest UNRUN |
| 5. Design | Choose minimal compatible change, define data/API/event contracts | Design note for nontrivial choice |
| 6. Implement | Make bounded changes and preserve error/cancellation paths | Reviewed named-file diff |
| 7. Prove | Run affected tests first, then impact-scaled broader checks | Exit codes + SHA + environment |
| 8. Inspect UI | Exercise actual input, keyboard, mobile, theme, reduced motion and failure | Browser proof or UNRUN |
| 9. Audit | Check privacy, auth, rights, assets, migrations, performance, rollback | Threat/risk notes |
| 10. Commit | Stage named paths only; commit semantic change; push only owned branch | Exact new SHA and PR |
| 11. Hand off | Update issue/AI_STATE as appropriate; provide candidate packet to #140 | READY_FOR_GATEWAY or HELD |
| 12. Stop | Do not roam into unrelated cleanup or merge to main | Named next actor/action |

An IDE assistant may automate these steps, but may not skip the evidence to save tokens. Retrieve narrowly and stop when the task is solved. The code is the authority for what currently executes; old narratives are not.

## 03. Workspace and IDE hygiene

**First commands (read-only):**
\`\`\`sh
git status --short --branch
git rev-parse HEAD
git worktree list
git diff --stat
\`\`\`

- Prefer a separate worktree/branch for each active bounded claim. Never switch a dirty worktree, blanket-stash a teammate's changes, force-reset, aggressively clean ignored files, or treat an unfamiliar temporary directory as disposable.
- No \`git add .\`, \`git add -A\`, destructive \`rm -rf\` or \`git clean -fdx\` on an uninspected shared checkout. Stage reviewed explicit paths and inspect \`git diff --cached\`.
- Keep experiments, screenshots, model cache, exported study sets and logs out of tracked source. Use named ignored \`artifacts/\`, \`dist/\`, \`test-results/\` or \`/tmp/axom-<task>.log\` based on existing project rules. Never move private user files without verified ownership and consent.
- Do not silently rewrite lockfiles, installed tools, package managers or \`.nvmrc\`; use the pinned Node/npm in [testing](testing.md) and the checked-in locks. Install new dependencies only when existing primitives genuinely fail and audit legal/security/bundle cost.
- Preserve the separate local/cloud workspace identities and origins. Never “merge” \`axom.info\` and \`www.axom.info\` data or clear IndexedDB/localStorage to fix a loading problem.
- Check file ownership before cleanup. The [maintenance registry](repository-audit.md#maintenance-registry) labels ACTIVE, DEFERRED and READY; only a verified READY condition permits an independent scoped cleanup proposal.
- Treat AI context as finite: load only AGENTS, AI_STATE and assigned task initially; query filenames/symbols, then narrow sections, not thousands of historical files. Preserve a small verifiable state handoff; do not turn docs into append-only conversation transcripts.
- Any failure that destroys the user's saved material is a blocking bug even if the app subsequently renders correctly.

### Folder responsibilities

| Location | Owns | Do not put here |
| --- | --- | --- |
| \`web/src/components\`, \`web/src/pages\` | Scoped React UI and interactions | independent persistence schema or undisclosed provider calls |
| \`web/src/lib\` | Domain contracts, storage, sync, pure logic | duplicate parallel QBank/quiz engines |
| \`web/src/styles\` | token-driven, component-scoped styling | global hard-coded theme overrides |
| \`web/e2e\` | Real browser workflow contracts | production data or credentials |
| \`src-tauri\` | Canonical desktop container and native integration | accidental prototype-only changes |
| \`supabase/migrations\` | Auditable additive DB transitions | destructive unreviewed \`DROP\` or rights bypass |
| \`supabase/functions\` | Explicit secured server capabilities | secrets in source, hidden AI uploads |
| \`scripts\`, \`web/scripts\` | Small reliable verification/build utilities | random one-off scripts at root |
| \`docs\` | A single canonical explanation per concept | duplicate giant manuals or ungrounded “shipped” claims |
| \`docs/directions\` | Original ideas and dated progress | silent alteration of verbatim owner ideas |

Use [docs/INDEX](../INDEX.md) for fine-grained ownership, rather than assuming this table captures every path.

## 04. Implementation rules by risk domain

### React and interface engineering
- Build from existing \`GlassCard\`, \`GButton\`, \`Modal\`, \`Tag\`, \`pushToast\`, \`TechnicalDetails\`, dashboard widget contracts and \`useClockNow\` when appropriate; do not create a second UI kit.
- Use actual \`web/src/styles/theme.css\` tokens and palette definitions. Keep Poppins display, current UI and mono tokens. The editorial Atlas's Baskerville example is **not** an adopted product font change.
- Design full states, not one screenshot: empty, loading, saved, queued, error, offline, unauthorized, conflict, success, light/dark, and reduced motion. Buttons must have semantic actions, focus visibility and keyboard behavior.
- Verify at 1440x900, 390x844 and, where space is constrained, 320px. Avoid horizontally overflowing pills and clipped sticky controls. The page scrolls within \`.surface-scroll\`; preserve shell behavior.
- Avoid dark-only gradients, unbounded animation loops, distracting gold, guilt-based nudges, and unsupported “mastered” or “AI predicted” claims. Let the learner decline a suggestion.

### Data contracts, local-first and accounts
- Before editing persisted state, trace *input → normalization → storage/write acknowledgement → hydration/recovery → export → optional account sync*. Test reloading with old data and account A-to-B switching. Never use account-blind caches of privileged or personalized state.
- Reuse existing schema/versioned migrations. New fields are optional and normalized across the current store and portable backup boundaries. Do not bump workspace schema or rename legacy storage identifiers casually; consult [data model](../architecture/data-model.md).
- Writes that fail must be recoverable or visibly failed. Do not show “saved” until acknowledgement. Preserve pending receipts for retries, duplicate prevention, partial success and interrupted writes.
- A browser context, device, native app and cloud account can diverge; define source-of-truth/merge policy before changing synchronization. Never infer exactly-once behavior from an HTTP response alone.
- For AnkiConnect, protect device/profile identity, idempotence across lost responses, and note/card retirement receipts. No automatic deletion of learner notes to resolve uncertain state.

### Supabase, server and authorization
- Least-privilege RLS must be tested with at least owner, authorized peer/reviewer, unrelated account and anonymous role as applicable. UI-hidden controls are not authorization.
- Every migration needs a backward-compatible deploy order, expected schema state, row-level consequence, repeatability, dry-run or disposable database proof, rollback/forward repair and secret/environment targeting. Separate migration verification from actually applying it to production.
- Do not write service-role keys into \`VITE_\` variables, client bundles, CI logs, commits or comments. Use existing sanctioned secrets and record only names, never values.
- Never claim hosted RLS, SMTP, Resend, payment or operator role acceptance from PGlite/mocks or a passing build. Provider identity and project are verified first; denied access is a blocker, not permission to try a different project.

### Questions, AI and biomedical content
- Preserve exact original question, choices, source document, timestamp/revision and answer provenance. Generated explanations are labeled proposals until qualified academic review; unreviewed answer keys never score correctness-based performance.
- Images, PDFs and QBank sets require explicit license, attribution, redistribution class, privacy and source identity. Private uploading ≠ public sharing permission. No copyrighted or private specimen becomes a public fixture by convenience.
- Clinical diagrams require anatomy/label accuracy, relevant clinical context, confidence/citation, accessible text alternative and explicit leakage boundary before answer commitment. AI-generated figures are never automatic substitute for validated histology/gross pathology images.
- Models can synthesize interpretations but cannot silently mutate canonical learner events or invent source references. Version prompts/outputs when they affect advice; warn on stale source revisions; respect cost/consent.

### Performance, platform and security
- Inspect latency and bundle consequences; lazy-load heavy study/game/visual subsystems when appropriate. Do not add front-end polling or providers that operate while idle without a product reason.
- Use staged immutable assets and proper 404/cache behavior; images/video must render at tested resolutions rather than claiming 8K from an upscaled low-resolution source.
- Threat model external inputs, uploads, redirects, HTML/Markdown rendering, filenames, ZIP paths, links and user-controlled identities. Validate at the trust boundary and preserve structured errors.
- CI and E2E must run without shipping private fixtures, absolute local paths or credentials. Dependency vulnerabilities need reachability/severity review, a minimum compatible update and tests, not indiscriminate package upgrades.

## 05. Testing decision matrix

| Risk | Minimum meaningful evidence | Escalation |
| --- | --- | --- |
| Docs/style tokens | \`npm run test:repo\`, \`npm run repo:check\`, diff review | UI browser review if semantics change |
| Pure logic | RED reproducer or behavior proof, focused Vitest, typecheck | web quality / cross-boundary E2E |
| Component/UI | unit integration, keyboard, 1440/390/320, light/dark, reduced motion | E2E and screenshot/console check |
| Local save/recovery | failure injection, restart, quota/blocked IndexedDB, backups, account switch | real browser persistence and recovery acceptance |
| Cloud/RLS/migration | PGlite, role matrix, negative isolation, migration order, schema diff | hosted disposable/staging + real authorized accounts |
| Source QBank/publication | parser/source revision/rights/key-review regression, reviewer signoff | eligible learner import, withdrawal, resume and audit |
| Native / Anki | Rust or integration tests, reconnect/lost response/profile guard | real owner device/profile acceptance |
| Release | full exact combined commit workflows + security review + preview | production SHA and smoke/readback |

Canonical commands live in [testing](testing.md). For integration use \`npm --prefix web run verify:all\` or the equivalent documented route. Report each check as PASS, FAIL, SKIP, UNRUN or BLOCKED with exact commit, environment, and provider access. An old green SHA is not a test of a changed branch.

## 06. Severity, triage and stop-the-line

- **SEV0**: active corruption/exposure or inability to recover critical learner data. Halt risky changes; incident owner, containment and verified recovery first.
- **SEV1**: broad login/save, academic answer correctness, or permissions regression. Block affected release and prepare a minimal SUTURE if necessary.
- **SEV2**: reproducible feature, layout or accessibility failure with workaround. Fix in scoped PR; join compatible train after tests.
- **SEV3**: cosmetic, copy or low-impact improvement. Batch in INCUS; do not consume emergency release capacity.

Priority is \`actual harm × affected users × probability × reversibility\`, with high uncertainty treated explicitly. Number of commits, line count and agent activity are not outcome metrics.

### Anti-patterns to reject in code review

Silent fallback to fabricated data; “saved” after starting a request; retry that duplicates Anki/Quiz records; undefined auth identity cached across users; unconditional schema reset; private fixture in public deployment; unreviewed generated medical answer; CSS-only concealment of a privileged action; 10 files changed “while here”; green unit test represented as production; force-merge because the release has a deadline.

## 07. PR review and one-train publication

Before asking FORGE to integrate, the author writes a **candidate packet** to [#140](https://github.com/jaclose/AXOM/issues/140) with: owner/task; exact SHA/base; changed files; behavior; RED/GREEN or documented test evidence; failures and skips; current-main conflicts; reviewer status; rights/security/auth/data/migration implications; UI/browser and provider limitations; rollback; readiness. An independent reviewer must be distinct from the author for material risky changes.

FORGE freezes source heads, resolves conflicts in a separate integration branch, runs exact combined validation and enforces the [release naming/program](release-nomenclature.md). Independent QA does not publish. Even after merge, FORGE must confirm the actual production deployment and live acceptance before calling a feature shipped.

**Emergency fixes:** isolate to the confirmed production defect, preserve forensic evidence, do not use “hotfix” to bypass user permissions or CI. Track in an incident issue and reconcile back to the train.

## 08. Standard handoff artifact

\`\`\`text
TASK / OWNER / FILE CLAIM:
BASE SHA / SOURCE HEAD SHA / PR:
OBSERVED DEFECT or approved requirement:
CHANGE + invariants retained:
PASS (test, exit, exact SHA, environment):
FAIL / SKIP / UNRUN / BLOCKED:
UI / account / device / hosted acceptance:
SECURITY / CONTENT RIGHTS / MIGRATION / DATA:
ROLLBACK OR FORWARD REPAIR:
REVIEWER + findings:
DISPOSITION: READY_FOR_GATEWAY | HELD
NEXT ACTOR / SINGLE NEXT ACTION:
\`\`\`

## 09. Improvement discipline

The SOP is living but not casually rewritten. A proposed rule must answer: **Which actual failure will this prevent? What evidence supports the change? What extra operational cost does it impose? How will it be tested? Who approves it?** Maintain a small change log, retain superseded decisions through [document control](document-control.md), and revise the original canonical section rather than appending a second contradictory policy.

This handbook does **not** grant automated access to another worker's chat, real learner accounts, provider dashboards or protected branch settings. Those capabilities require their own supported tools and permissions.
