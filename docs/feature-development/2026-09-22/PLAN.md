# Implementation plan

## Repository boundary

- Worktree: `/Users/jd/Developer/AXOM-accounts-v1`.
- Branch: `feat/accounts-sync-v1`.
- Starting HEAD: `ba2b66d3da657ae82bc0ab11dcaa46dd7b503349`.
- Thirteen existing modified/untracked personalization paths belong to previous work and must be preserved. Nothing was staged at discovery.
- The original `/Users/jd/Developer/AXOM` worktree remains isolated. No commit, push, governance, Product Memory, dependency installation, or deployment is authorized by this plan.
- Use the continuation worktree in VS Code.

## Ordered work

Steps 1–7 are complete for the first increment. Step 8 records the handoff in PROGRESS.md. Follow-on capabilities below are not implemented by this checkpoint.

1. Recover the relevant chat decisions and inspect actual source data. Completed before implementation; see FEATURES.md.
2. Create feature inventory, plan, deferred list, and initial progress report. Complete before production edits.
3. Application Checker: deterministic source adapter, honest provenance display, real searchable dataset, saved schools and manual review workflow. Exclude speculative estimates and private contacts.
4. Leaderboards: remove mock competitors; implement real, period-specific personal standings and current totals. Explain the boundary to future private cohorts.
5. Onboarding: expand methods, retain how-you-use-it input, persist draft preferences, preserve previously configured timings and item-kind defaults. Use explicit choices; do not infer settings silently.
6. Add focused tests for data mapping, preference preservation, persistence and ranking boundaries, plus component/browser journeys.
7. Validate type checking, lint, unit tests, production build, and relevant desktop/mobile browser journeys. Repair confirmed defects in this scope.
8. Update PROGRESS.md with exact outcomes and remaining limitations; hand off files and running local URL. Leave work uncommitted.

## Verification gates

- Input roster counts reconcile with published records and explicitly excluded duplicate rows.
- Unknown, not reported, not required, conflicting, and unverified evidence remain distinct.
- Source age and original collection status are visible; a URL is not proof of current accuracy.
- Application research state survives normalization, reload, and backup/restore.
- Rankings use only real recorded activity, fixed comparable date windows, deterministic ties, and no future records.
- No leaderboard network publication or implicit opt-in.
- Onboarding rerun and draft reload preserve all methods, custom text, timings and item-kind defaults.
- Existing personalization changes and ordinary Question Bank behavior remain intact.
- Desktop and 390px mobile controls remain usable with no page overflow or uncaught errors in the tested journeys.

## Later milestones

Verified structured school requirements can support explicit profile comparisons after source-cycle and exception handling exist. Authenticated cohort membership, revocable consent and aggregate-only server rules precede shared rankings. Both are separate, testable deliverables rather than implied by this first increment.

Suggested next implementation order:

1. Application profile: save learner-entered qualifications and planned application cycle; keep unknown values explicit. Add manual comparison checklists before automated eligibility rules.
2. School evidence refresh: structured, cycle-specific requirements and exception handling, with reviewed-fact invalidation when evidence changes.
3. Shared standings: private cohort membership and explicit sharing controls, followed by aggregate rankings and cross-account authorization tests. Do not replace this work with mock competitors.
4. Onboarding interpretation: deterministic suggestions shown beside the original text, with explicit confirmation and no automatic application.
