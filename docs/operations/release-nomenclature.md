---
tags: [axom/operations, axom/release, axom/naming]
authority: proposed-until-merged
owner: AXOM FORGE
updated: 2026-11-06
review_trigger: material-release-policy-change
---

# AXOM FORGE | Release language and operating standard

**Purpose.** One identity for the release authority; distinguish the size, urgency, and provenance of the *release* from the workstreams that authored its changes. This document extends the canonical [deployment and unified release gateway](deployment.md#axom-unified-release-gateway); it does not supersede its safety, owner-authorization, QA, or rollback gates. Until accepted into the protected release branch/main, this is a proposed source document, not evidence that production automation is installed.

## 1. Identity and jurisdiction

**AXOM FORGE** is the named release gatekeeper. Its function is to gather eligible work, preserve authorship, verify the composed candidate, and publish exactly one approved coordinated release. FORGE is not a replacement for MOTHERSHIP engineering coordination, APEX PRIME academic integration, feature owners, or independent QA. FORGE does not edit someone else's active source branch, bypass security, or claim to have access to another ChatGPT conversation. Coordination uses GitHub issue [#140](https://github.com/jaclose/AXOM/issues/140), exact PR heads, and repository instructions. The scheduled release review may run hourly; **the public product is not redeployed hourly**.

**Authority matrix**

| Actor | Can implement feature branch | Can independently review | Can assemble release candidate | Can merge ordinary batch to main | Can attest live deployment |
| --- | --- | --- | --- | --- | --- |
| Feature owner / Journal / Registry / MOTHERSHIP | In owned scope | Not as own independent reviewer | Submit source packet only | No | Report directly observed facts only |
| APEX PRIME / ATLAS / NOVA | Academic source integration | Request independent review | Submit academic packet | No | Report directly observed facts only |
| Independent Release QA | Read/test without mutations | Yes, source/CI scope | Recommend/hold | No | Report directly observed facts only |
| AXOM FORGE | Scoped integration fixes after claim | Request QA; not self-independent | Yes | Only after complete release gate | After verifying deployed SHA and live journeys |
| Product owner | Approves scope and exceptional risk | May request more evidence | Prioritizes | Subject to branch protection | Accepts meaningful release decisions |

The GitHub branch protection/ruleset configuration must enforce the approved path. Prompts and documentation alone are social controls, not a technical access prohibition.

## 2. Release hierarchy

Release *family* communicates impact. Version, source SHA, migration status and date remain the **immutable technical identity**; a poetic title cannot replace them.

| Family | Function | Trigger | Technical version rule | Gate |
| --- | --- | --- | --- | --- |
| **AXOM EPOCH** | Generational platform transition | Breaking contract, major architecture, coordinated data-model generation | Major increment if Semantic Versioning contract is applicable | Full migration/recovery, backwards compatibility, rollout and live acceptance |
| **AXOM CONVERGENCE** | Large, coherent cross-domain feature bundle | Multiple independently reviewed workstreams solve one user problem | Usually a feature/minor increment | Full combined Quality, APEX when affected, security, staging and live acceptance |
| **AXOM INCUS** | Small but meaningful feature/refinement package | Bounded improvements with compatible behavior | Minor for new compatible behavior; patch for compatible fix-only package | Impact-scaled tests plus exact combined checks and preview where needed |
| **AXOM SUTURE** | Urgent restorative hotfix | Confirmed security/privacy/data-integrity/availability incident where delay creates harm | Patch if compatible; otherwise explicit compatibility notice | Narrow emergency exception with incident record, focused regression, rollback and post-release reconciliation |

**AXOM AEGIS** is a *security and resilience designation*, not a separate severity level. Apply it as an additional descriptor to EPOCH, CONVERGENCE or INCUS for reviewed security hardening; urgent security hotfixes remain SUTURE. A label does not relax security verification.

**AXOM FORGE RC** is a private *release candidate state*, not a shipped edition. A build or PR must not bear a published release title until the production artifact is verified.

### Working name roster (reserved candidate names)

- **Generational vocabulary:** EPOCH, ASCENT, HORIZON, ORIGIN.
- **Large multi-system vocabulary:** CONVERGENCE, LATTICE, HELIX, PARALLAX.
- **Refinement vocabulary:** INCUS, PRISM, VECTOR, CURRENT.
- **Restoration vocabulary:** SUTURE, BRIDGE, ANCHOR.
- **Security modifier:** AEGIS.

Only the four primary families are authorized by this proposal. Secondary names are **unassigned creative inventory**, not shipped editions, active product features, trademarks, or permission to proliferate release families. Before assigning a secondary name, confirm no collision with feature/workstream/assistant names in the registry and approve its semantic reason.

**Reserved workstream names, not release families:** APEX PRIME, APEX, NOVA, ATLAS, SCHOLAR, SENTINEL and MOTHERSHIP already refer to live AXOM development/academic ownership. Avoid using those terms for general publication codenames. A project workstream and a shipped release should never be mistaken for the same entity.

## 3. Human-visible names versus machine identifiers

Use all four fields in the release record:

1. **Public edition:** e.g. “AXOM CONVERGENCE 01” (illustrative, not a claim of publication).
2. **Actual package version:** read from the coordinated root/web/native manifests, do not invent or manually bump one file.
3. **Immutable source:** merge SHA and exact deployed artifact/build SHA; record both when different.
4. **Date/channel:** \`2026-11-06\`, \`production\`, \`preview\` or \`internal\`; never label preview as production.

Illustrative *not-current* examples:

- AXOM EPOCH 01 | v2.0.0 | platform transition.
- AXOM CONVERGENCE 02 | v1.12.0 | QBank + Course Tracker + recovery bundle.
- AXOM INCUS 07 | v1.12.1 | narrow compatibility fixes.
- AXOM SUTURE 03 | v1.12.2 | urgent save-regression repair.

The numbers above are illustrative and are **not** AXOM's observed current version. The sequence is monotonically increasing *within each family* and owned by FORGE's release registry. Versions must reflect actual compatibility; if the repo does not yet honor SemVer rigorously, mark version semantics “transitional” and do not imply it does.

### Git conventions

- Source feature branch: \`feat/<workstream>/<scope>\`, \`fix/<workstream>/<defect>\`, \`docs/<scope>\`.
- Integration branch: \`release/YYYY-MM-DD-<scope>\`. Current existing train is \`release/2026-11-06-integrated-gateway\`.
- Emergency branch: \`hotfix/YYYY-MM-DD-<incident-id>\` created from observed production baseline.
- Release tag: \`vX.Y.Z\` once actual manifest version and shipped SHA are verified; optional release title is a GitHub release title, **not** a replacement for the tag.
- Conventional commit prefixes: \`feat:\`, \`fix:\`, \`docs:\`, \`test:\`, \`refactor:\`, \`perf:\`, \`chore:\`, \`security:\` when semantically valid. Commit subjects describe behavior, not marketing edition names.

Do not squash history so aggressively that original source PRs or safety reviews lose traceability. Use one *release merge* into main, not necessarily one giant commit for every feature.

## 4. FORGE states, review and stop conditions

\`PROPOSED → CLAIMED → FROZEN → INTEGRATED → CI_VERIFIED → PREVIEW_ACCEPTED → MERGED → DEPLOYED → LIVE_ACCEPTED\`.

Side states: \`HELD\`, \`SUPERSEDED\`, \`ALREADY_IN_MAIN\`, \`BLOCKED_ACCESS\`, \`ROLLED_BACK\` and \`RECOVERING\`. These require exact evidence and ownership. A state transition needs proof tied to immutable SHA; “CI green” can never be rewritten as “deployed”.

**Every source candidate packet records:** owner, issue, PR URL, base SHA, exact head SHA, changed files, dependency ordering, original tests with environment/exit code, exact-head workflow URLs, open review comments, source/media rights, privacy/security implications, schema/RLS/migrations, data-preservation/rollback, synthetic versus real browser/account acceptance, and readiness disposition.

**Never advance** with failed/pending required checks, unverified customer-data recovery, untested migration, unauthorized external message/provider action, branch-protection failure, incompatible source, security/clinical/rights blocker, or provider quota preventing exact-head preview. Document the blocker and leave the candidate held. Revalidate after any integration head changes.

### Hotfix exception: narrow does not mean reckless

SUTURE must include an incident ID, severity, observed user harm, minimal correction, red/green reproducer when possible, verified production base, compatibility and rollback/forward repair. A documented authorized emergency path may bypass *batching latency*, **not** auth, privacy, tests, provenance, or expected SHA checks. After shipping, reconcile its commit into the active train, invalidate affected prior CI and re-run the impacted checks.

## 5. Release ledger and handoff format

\`\`\`yaml
edition: "AXOM INCUS 01"   # example only
status: HELD
channel: preview
owner: AXOM FORGE
gateway_issue: 140
source_prs: []             # PR, owner, exact head SHA, included/held
base_main_sha: "<observed>"
integration_sha: "<observed>"
checks:                    # named URL, observed conclusion, tested SHA
  quality: PENDING
  academic: NOT_APPLICABLE
  security_review: REVIEW_REQUIRED
  browser: UNRUN
  preview: BLOCKED_ACCESS
migrations: NONE_IN_DIFF
permissions_and_rights: REVIEW_REQUIRED
rollback_plan: "<procedure with evidence>"
production_deploy_sha: null
live_acceptance: UNRUN
next_actor: "<named owner>"
next_action: "<one specific unblock>"
\`\`\`

Every edition ends with one release note: learner-visible benefit, exact included changes, unchanged behaviors, risk/migration warnings, verification boundaries, known limitations, rollback reference, and status. Do not advertise a draft release as a customer upgrade.

## 6. Review and maintenance of this standard

FORGE reviews this nomenclature against incoming candidates during its hourly **inspection** cycle but changes these rules only when a material conflict, new failure mode, accessibility issue, confirmed upstream change, or explicit owner direction justifies a revision. Use [document control](document-control.md), preserve change provenance, propose a reviewable PR, and record decision/effect in #140. A new edition name or agent persona is not a reason to redeploy.

**Related authorities:** [AGENTS](../../AGENTS.md) · [deployment gateway](deployment.md#axom-unified-release-gateway) · [testing](testing.md) · [engineering SOP](engineering-sop.md) · [maintenance registry](repository-audit.md#maintenance-registry).
