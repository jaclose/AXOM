---
tags: [axom/operations, axom/governance, axom/documentation]
authority: proposed-until-merged
owner: AXOM engineering coordination; release audit AXOM FORGE
updated: 2026-11-06
review_trigger: material-policy-or-source-change
---

# AXOM document control | A living system of truth

**Why this exists:** AXOM is being engineered by multiple scoped workers with parallel requests, branches and evolving designs. The documentation must make decisions recoverable without becoming a second, contradictory source of truth. The owner decides product direction; source/tests establish implemented behavior; the deployed artifact plus authorized live testing establishes production state.

## 1. Three different types of authority

| Type | Examples | What it may govern |
| --- | --- | --- |
| Product/governance | `docs/governance/AX-0002-CONSTITUTION.md`, backlog, UX standards, Learning Intelligence doctrine | Approved goals, terminology, enduring requirements |
| Engineering/implementation | `AGENTS.md`, domain data/auth contracts, `DESIGN.md`, testing, deployment and engineering SOP | Working rules and implementation invariants |
| Evidence/state | exact source PR/SHA, GitHub CI, issue ledger, real browser/provider acceptance, `docs/AI_STATE.md` | What is presently built, verified, blocked or live |

An original owner message or verbatim idea is a **source**, not permission to silently rewrite previously agreed governance. A beautiful PDF is a design specimen unless it has a recorded approval. A code change is not automatically a product-policy change. If two authorities conflict, record the contradiction, preserve the older source and request the narrow owner decision; do not invent a hierarchy on the fly.

## 2. Canonical document map

| Need | Canonical source or route | Responsible change process |
| --- | --- | --- |
| Agent bootstrap / safety guardrails | `AGENTS.md` | Small stable router; reviewed PR |
| Engineering practice / IDE hygiene | `docs/operations/engineering-sop.md` | Developer evidence + risk review |
| Release gate and deployment truth | `docs/operations/deployment.md` | FORGE and independent QA |
| Release naming and edition history | `docs/operations/release-nomenclature.md` | FORGE + owner brand approval |
| Brand application | `docs/design/BRAND-GUIDE.md` | Brand/design owner and browser proof |
| UI tokens/components | `docs/design/DESIGN.md` | Source-led review and visual acceptance |
| Product operating direction | `docs/product/PRODUCT-GUIDE.md` | Product owner disposition |
| Product constitution and backlog | `docs/governance/` stable IDs | Formal governance process |
| Source idea and work status | `docs/directions/` | Verbatim preservation, dated status evidence |
| Change evidence, short handoff | `docs/AI_STATE.md`, GitHub work item | Exact SHA and owner, never unbounded transcript |
| Cleanup protections | `docs/operations/repository-audit.md#maintenance-registry` | Safe-condition evidence and owner handoff |
| Architecture/domain contract | `docs/architecture` and `docs/features` routes | Code/tests and domain-owner review |

**Rule: one concept, one canonical explanation.** Other files contain one-paragraph summaries and links, not parallel copies that drift. The [context router](../INDEX.md) guides retrieval, it is not a required reading assignment for every worker.

## 3. Change classes and triggers

| Class | Example | Minimum review |
| --- | --- | --- |
| Factual correction | Wrong file path, outdated command, verified failed check | Check target source and update in same PR |
| Procedure revision | Change onboarding, testing, branch or release steps | Demonstrate defect/failure mode, owner/QA review, reversible update |
| Architectural decision | Change database authority, API, storage schema, app container | Decision record, migration/security/recovery proof, approval |
| Brand/product direction | New release family, mark, typography, feature priority | Explicit owner approval, source/status separation |
| Dated evidence | New PR head, CI result, production check | Append succinct immutable checkpoint to issue; avoid rewriting permanent SOP |

**Do not edit a document merely because an automation ran.** A scheduled inspection checks whether a trigger exists. Only verified meaningful deltas justify a commit. The hourly FORGE review may update the live release manifest, but canonical standard revisions still require reviewable source diffs.

## 4. Editing procedure

1. **Find authority:** use [docs/INDEX](../INDEX.md); verify the current code, file revision and issue/owner.
2. **State change intent:** why prior language is incomplete/unsafe, supporting evidence, expected new behavior, affected users and risk.
3. **Check collisions:** search matching headings and related files; do not create a new manual when an owned section can be revised.
4. **Protect history:** preserve decision IDs, original idea text, issue discussions, source references and rationale. Add a supersession link rather than erasing provenance.
5. **Make narrow change:** one topic per edit; update inbound links, outdated examples and glossary terms consistently.
6. **Validate:** relative links/paths, code snippets, file existence, contradictory directions, spelling, claims of actual deployment, privacy and license. Run `npm run test:repo` and `npm run repo:check` for docs changes, plus relevant content tests.
7. **Review:** product owner for direction, security/data owner for boundary, brand owner for master assets, FORGE for release process. A contributor's self-review does not count as independent review for high-risk policy.
8. **Submit to gateway:** commit to an owned branch, exact SHA and PR, include test status and link impact. Do not independently main-merge the doc branch.
9. **Update reference points:** after accepted merge, refresh the router/AGENTS crosslink, note document revision and inform affected worker prompts or issue templates if their procedures changed.
10. **Audit effect:** on subsequent actual runs, check whether new behavior is followed; update the original section only if evidence shows it fails.

## 5. Changelog discipline

Each canonical change records *date, revision/SHA, why, owner approval or review, specific affected clause, migrations (if any), links, and rollback*. Avoid copying thousands of lines of CI into documentation; link exact runs. Do not over-write recorded failure with a later pass. Retain historic “as of” dates rather than replacing them with undated live claims.

Example (not a historical AXOM event):

| Date | Section | Evidence | Disposition |
| --- | --- | --- | --- |
| YYYY-MM-DD | Release gate/preview | CI #..., SHA ..., staging access evidence | Hold until exact head and owner acceptance |

One update's content should remain useful after the original conversation disappears.

## 6. Weekly and hourly maintenance cadence

**Hourly release inspection (AXOM FORGE):** compare current main/PR heads, candidates, conflict matrix, exact-head CI, staging/prod acceptance, blockers. If no material change, do not rewrite guides, spawn workers, merge, or notify solely for activity. Record an actionable change only when warranted.

**At source handoff (every scoped engineer):** update the workstream issue and small AI_STATE portion with exact SHA and acceptance. Detect changed library/API contracts, broken crosslinks, new migration or failure path; suggest targeted doc revision.

**At product direction decision (event-driven):** update the authoritative governance/backlog document first, then product guide and implementation contracts as a reviewed consequence. Never auto-approve brainstormed ideas.

**At asset/design approval (event-driven):** register master source/hash/rights, update brand guide and DESIGN.md, then validate browser/exports. An AI-generated mockup is not itself an asset approval.

**At release publication:** FORGE writes an immutable release note, edition+version+SHA, included/held PR list, deployment/migration/rollback evidence, known limitations. Merged and deployed are separate.

**Periodic hygiene review:** find orphan docs, stale links, outdated “now/live” language, duplicate policy statements and dead references. Record candidate deletions in the maintenance registry. Removal requires proof of safe condition and source preservation; no sweeping automatic docs cleanup.

## 7. Agent behavior across parallel conversations

Separate ChatGPT chats do not magically share a live task queue or execution lock. The stable cross-worker protocol is a real repository artifact: GitHub issue/PR, versioned manifest, exact commit and reviewer receipt. Every worker reads the current policies from the same repository and receives a scoped assignment. Prompt updates establish intent but are *not* equivalent to GitHub branch protection or an automated deployment gate.

For enforceable publication controls, configure GitHub branch rulesets/required checks to admit only the reviewed release train or a separately approved SUTURE emergency route. Verify the ruleset actually blocks a test direct-to-main PR; document provider permission and the negative test. Until that proof exists, describe routing as **policy enforced by workers/review**, not mathematically guaranteed platform control.

## 8. Review checklist

- [ ] The document has one owner and a real canonical location.
- [ ] All behavior and deployment claims specify a source and as-of revision.
- [ ] Links, commands and paths exist at the target SHA.
- [ ] The new rule does not conflict with older instructions or active source owners.
- [ ] Privacy, medical/source review, accessibility and provider limits remain explicit.
- [ ] Approval versus working proposal is distinguishable.
- [ ] Docs/repo validation passed, or unrun checks are disclosed.
- [ ] Impacted task prompts and navigation are updated when authorized.
- [ ] No secret, private learner content or unlicensed example enters the public repository.
- [ ] The change has a precise rollback and an owner for ongoing maintenance.

## 9. Ownership of the guides

Product decides **what AXOM should do**. Brand/design decides **how it should feel and present**. Engineering decides **how a correct and recoverable implementation works**. Independent QA decides **what evidence is insufficient**. FORGE decides **whether the combined release may go to main and be published** within actual access and owner authority. No worker may use its own document to override a safety gate owned by another.

**Related:** [engineering](engineering-sop.md) · [nomenclature](release-nomenclature.md) · [deployment](deployment.md) · [brand](../design/BRAND-GUIDE.md) · [product](../product/PRODUCT-GUIDE.md).
