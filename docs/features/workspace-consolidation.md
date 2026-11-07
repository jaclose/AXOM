# AXOM Workspaces | consolidated navigation and trusted operations

**Status:** draft implementation in PR #192. No production release or live migration has been executed.
**Authority:** AXOM Identity Atlas v3 and Product Vision & Stages 2026. Code-defined accounts, QBank, academic provenance and learner state remain authoritative.

## Product decision

The old Misc grouping mixed daily execution, study technique, reusable instructions, changelog and folder shortcuts. The learner should not need to know those code-era categories. AXOM must prioritize the next decision and keep deeper tools one action away.

| New destination | Default surface | Existing feature pages retained | Former deep links |
|---|---|---|---|
| Daily / Productivity | Focus, today’s plan, fast logging, clock | Tasks and Habit Tracker as tabs | `#productivity`, `#tasks`, `#habits` |
| Study Studio | Study Methods | Prompt Library as a second tab | `#studio`, `#methods`, `#prompts` |
| Library | Saved references | Hub Folders as a second tab | `#library`, `#resources`, `#folders` |
| About | Identity and developer | Building AXOM and Patch Notes as tabs | `#about`, `#building`, `#patch-notes` |
| Reports | Evidence-based trends | Existing daily-success and tasks logic, new habit ledger summary | `#reports` |
| Host | Operator console (verified owner only) | Roles, AI quotas, public moderation, submission metadata, audit | `#host` |

**No destructive migration:** old route IDs remain registered, and the underlying task, habit, prompt, resource, folder and academic identities are unchanged. An archived record remains archived. Existing user-scoped writing, source attachments, QBank attempts and account state are never merged into a new storage authority. Saved legacy paths select the appropriate view and highlight the parent navigation destination.

## Presentation contract

- Use existing AXOM product fonts, token colors and canonical assets, not speculative logos, decorative serif substitutions or high-glow styling.
- Measured elevation and hairlines: `var(--surface-1)`, `var(--surface-2)`, `var(--gold)`, `var(--gold-line)`, `var(--hairline)`, standard radii.
- One decision heading, accurate counts from the current store, an explicit reason and the next action. Do not imply elapsed hours, streaks or raw activity quantity is learned mastery.
- Touch targets at least 44 px; text and focus states remain legible at 390 and 320 CSS px; reduced-motion users get no essential animation.
- Each hub is a presentation composition over existing feature components, not a rewritten engine. Do not silently replace working editor or save actions.

## Day and Reports integrity

- Habit Tracker is optional and user-controlled. Its existing link to daily targets remains authoritative.
- Reports counts a check-in only when a stored `habitEntry` exists. Intentional `skipped` differs from `missed` and an unrecorded scheduled day.
- Historical dates prior to habit creation never count as missed. Display source scope and avoid inferred consistency.
- PR #151 already owns high-speed productivity goal entry and self-reporting. Rebase and test its changes as part of the AXOM FORGE batch; do not overwrite a competing implementation.

## Host: completed in this draft

- Owner-only audit investigation supports local filtering and safe CSV export of the **loaded** subset. CSV cells are spreadsheet-formula sanitized.
- New `public.axom_operator_audit_page(max_rows,before_created_at,before_id)` returns immutable audit receipts in stable descending `(created_at,id)` order with a bounded page size; the SQL function refuses everyone except a verified owner.
- Older pages load with an account-scoped client. On account changes or refresh, extra receipts are reset, stale responses are ignored and the UI truthfully describes incomplete history.
- Permissions are still server-owned: owner grants roles and AI quota overrides; admin gets a directory and aggregate statistics; moderator gets public review queues. Account roles do not grant reading of private learner files, journals, notes, answers or progress.
- **Migration is pending**: source and tests do not prove the RPC is installed on a hosted database.

## Proposed Host permissions phase (not implemented in this PR)

Build a capability registry separate from role labels. Possible narrowly scoped capabilities: account directory read, AI quota administration, public-content moderation, reviewer assignment, support-case triage, release-check visibility and outbound communications approval. Apply a least-privilege policy in Postgres RLS and SECURITY DEFINER functions, not merely React controls. Each grant must bind the verified immutable auth user ID, reason, actor, capability, expiry, approval and revocation receipt; require reauthentication/step-up for high-impact changes when supported.

**Academic reviewer appointment is gated.** Existing academic review RPCs check reviewer membership and exact-revision explanation attestation, but self-review isolation must be independently verified and enforced before a Host button can provision academic reviewers. Do not treat an operator role as an academic reviewer or production release approver. Public moderation must never expand into private learner records.

**Do not implement** unfettered database access, bulk profile export, hidden private-answer inspection or production deployment as a generic operator capability.

## Execution sequence and gates

1. Consolidate and test routes and records without deleting source pages (PR #192).
2. Inspect at desktop, tablet, 390 and 320 CSS px with keyboard, screen reader, high contrast and reduced motion. Check true overflow and discernible tab state.
3. Verify TypeScript, lint, Vitest, production build, PGlite SQL permission/cursor tests and Playwright. Confirm legacy deep links, habit opt-in, account swaps and no unintended disclosure.
4. Integrate PR #151 with exact-commit ancestry and resolve conflicting productivity CSS or state changes.
5. Deploy to authenticated staging only through FORGE, apply the forward-only audit RPC migration, check older audit paging with multiple accounts and verify all previous Host queries.
6. Seek independent product/security approval, exact-head full release acceptance, rollback instructions and explicit owner sign-off before any merge or production publish.

**Current FORGE constraint:** main branch protection was previously disabled and preview deployment quota can block staging evidence. Neither a passing source-branch test nor an available preview proves a protected, releasable integration.

## Future experience slices

Daily Workspace can gain user-selected goals, recurring-plan templates and automatic linkage to recorded question sets while retaining explicit source provenance. Study Studio can connect method choice to a concrete retrieval session and prompt version; Library can unify search indices without collapsing resource rights or duplicating file storage. Reports should present changes in tested performance, objectives and interventions before emphasizing study time. Each is a separately tested increment, not implied by the consolidated shell.
