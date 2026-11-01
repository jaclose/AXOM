# Community, source-answer batch review and host console

Status: **PR #30 baseline; local hardening, integration pending**. The shared baseline is `819e86eb4fdac83957bbd84b148d260f8709d2f8` on `feat/community-social-review-20261024`. Its GitHub Quality jobs passed on 2026-10-25. Further changes require new validation; this is not proof of a production release.

## Community

The #community page extends optional Supabase accounts without moving or auto-publishing any saved learner workspace data.

1. Sign into each AXOM account.
2. Each learner independently creates a profile and chooses a handle. Discovery is unchecked by default; existing accounts are not auto-listed.
3. Find the other opted-in handle, send a friend request, and accept it on the other account.
4. Select a study day to publish an optional aggregate, or choose a local Question Set whose title only can be celebrated. Posts default to Private. Accepted friends and Community are deliberate alternatives.
5. Both people can give Kudos to eligible posts and compare the last seven days of self-shared progress. Private posts never enter shared standings; repeated posts for a day cannot multiply totals. Separate Daily Challenge standings remain server-verified.
6. People can hide themselves from discovery, remove friends, delete individual posts or leave Community without touching local QBank materials.

The social tables have restrictive RLS. Non-discoverable people are visible only to themselves and accepted friends. Friends-only posts require an accepted connection for RLS to expose them. Unfriending immediately removes that access. Reports may surface a reported post's metadata to a moderator; the unreported feed is not a host-wide surveillance view.

**Question Set announcement is not source sharing.** No private question text, answers, share tokens, source PDFs or media are copied to social_posts. Link a set only through the existing explicit share/review mechanism and rights controls. A user may post a title from a private set, so the UI warns them before publishing.

## Batch answer confirmation

The Source review dialog can group eligible slide-marked answer candidates when the original PDF is available and the page is known. Each row shows its candidate label and opens the source page. The user must select rows and attest to checking those keys against the original before a single batch action records reviewer evidence with a timestamp note.

The batch helper calculates a trial readiness assessment and exposes only candidates that would become completely ready after key verification. It excludes inferred-from-explanation keys, ambiguous or missing original source pages and anything with other unresolved blockers. Media assets are not required because a highlighted answer may be marked with text styling alone. Source inconsistencies and other holds remain in review; the bulk action is not AI auto-approval.

## Operator console

The #host page has server-authorized roles, never front-end-only permissions:

| Role | Capabilities |
| --- | --- |
| Owner | Directory, role assignments, AI permission and daily quota policies, moderation, aggregate QBank/AI monitoring, audit history |
| Administrator | Directory and metrics, shared QBank review metadata, report moderation |
| Moderator | Submitted shared QBank metadata and reported post moderation |
| Normal learner | No operator data or permission writes |

Owner/administrator access does not bypass private workspace snapshot policies. Operators cannot approve Question Banks by unchecked bulk actions. Only intentionally shared QBank metadata is included in review monitoring.

The AI quota function defaults to 60 requests/day and honors a server-maintained per-user enabled flag and daily_limit override. Only the owner can change those overrides through the audited RPC, with a required reason. No upstream model keys or stored prompts are displayed. The existing gateway rejects missing, malformed, failed and denied quota responses before a provider call. New social writes and operator mutations honor the existing account privacy/deletion barrier.

**Owner bootstrap is mandatory:** The migration does not trust display_name, email prefixes or raw_user_meta_data to establish ownership. After separately approving production provisioning and verifying the intended owner's immutable auth.users.id, use an authorized trusted admin session. Record the approval reference and verified identity in the same transaction as the grant. This example is a preparation template, not permission to execute it:

    begin;
    -- Replace placeholders ONLY after identity verification and provisioning approval.
    insert into public.axom_operator_roles (user_id, role)
    values ('<verified-auth-user-uuid>'::uuid, 'owner');
    insert into public.axom_operator_audit(actor_id,action,target_id,metadata)
    values (null,'owner.bootstrap','<verified-auth-user-uuid>'::uuid,
      jsonb_build_object('reason','<approval reference and trusted operator>'));
    commit;

Do not paste private emails, JWTs or service keys into the public repository. Role assignment via app UI cannot create an owner, demote an owner or elevate the caller.

## Deployment and verification gates

1. Check the current integration/coordination state and protected local work. The remote Mac was offline during this branch's creation, so no local files or uncommitted material were read, replaced, staged or reset.
2. The owner's 2026-10-25 read-only production audit recorded 30 applied migrations and a successful no-write dry run. Exactly four remain pending, in order: `20261016011812_harden_privacy_request_barrier.sql`, `20261017233759_enforce_academic_collection_classification.sql`, `20261024150000_community_social.sql`, and `20261024153000_operator_console.sql`. Refresh that inventory immediately before an approved release. Do not apply, repair or skip migration history based on this document alone.
3. Run PGlite/Postgres RLS tests with at least three distinct JWT identities, plus anonymous access. Attempt spoofed sender IDs, reverse friend requests, self-requests, forged role assignment, social post updates to another owner, friendship reassignments, denied AI quota edits and access after unfriend.
4. Verify privileged RPCs return 42501 for users with no role, and that one owner can alter only supported operational state. Inspect function privileges and run the Supabase security advisor.
5. Test Community on two authorized opt-in accounts and a signed-out device: friend discovery, acceptance, friends-only RLS, public feed, report, like/unlike, post delete, hide, withdrawal and account switch. Validate mobile 390 px, desktop 1440 px, dark/light and reduced motion.
6. Verify slide-only PDF import both with and without answer-reveal images. Check source page navigation and correct import counts after reviewing 21 keys in one action; ensure ambiguous, unkeyed and structurally broken questions remain held.
7. Check build, typecheck, lint, unit tests, QBank Playwright, Vercel preview and real-account reload. GitHub CI is not a substitute for live multi-account or migration tests.
8. Approve integration into main and only then verify the production commit and runtime schema. No auto-publication of user material.

Not in this slice: account-wide suspension, persistent user blocking, configurable capability policies beyond the existing three operator roles, billing/token/latency attribution, comment threads, full Question Set content in the feed, a publisher rights-review workflow, trusted general QBank/course-event ingestion, realtime push notifications or automatic Anki imports. Unfriend removes friends-only access but is not a block. Persistent blocking needs an auth-bound record that survives leaving and rejoining Community. Self-shared standings must never be described as verified study rankings.

## PR #30 integration boundary

`codex/pr30-host-hardening-20261025` is the isolated hardening branch. An earlier `codex/host-community-20261025` draft is preserved locally and superseded; its parallel tables/RPCs are excluded. The existing two pending PR migrations are amended before first deployment, keeping the four-file pending inventory. Role and AI policy RPCs now require `reason`; ship their matching clients together. Account-bound clients discard results after any account switch, including a switch away and back. No QBank parsing, learner persistence or course contract is changed by this hardening.

Validation receipts and integration decisions belong in [PR #30](https://github.com/jaclose/AXOM/pull/30). Merge requires passing CI and database security checks for the exact candidate. Production migration, verified-account provisioning and deployment remain separate approval boundaries. Recovery before application is simply withholding this unreleased migration/client bundle; after application, use a reviewed forward migration and provider recovery procedures, never drop learner tables as a rollback.


## Local hardening receipt, 2026-10-25

Passed: 77 focused unit/SQL tests (including the full migration chain), 43 repository tests/hygiene, typecheck, full lint, build and Daily Games bundle isolation. One SQL-backed two-account Chrome journey passed discovery consent, private visibility, friendship/reload, shared-day standings, Kudos/reload, reports, role grant/revocation, per-account AI cap/disable and immediate access removal after unfriending. Four desktop-dark/mobile-light screenshots were inspected; reduced motion, no overflow and zero browser warnings/errors were verified. Existing build notices for jszip/webUpdates dynamic imports and large chunks remain.

The browser uses real local PostgreSQL policies and synthetic Auth/REST transport. This is not deployed Supabase or real Jafar/Aynaz acceptance. Full verify:all, native and multi-connection checks were not rerun. The exact hardening commit still needs CI before integration; baseline CI does not certify subsequent edits.
