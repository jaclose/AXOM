# Community, source-answer batch review and host console

Status (2026-11-02): The Host, Community and searchable Question Set Library UI shipped on `main` at `c06ae5a6`. AXOM Production (`jofkmfwkidubxcutkwzf`) has all seven ordered feature/reviewer migrations; read-only SQL confirmed 11/11 new tables have RLS. JD's verified account has the sole audited owner role. No private content was published. Real-account Community/Host and academic reviewer journeys remain to be accepted. See [current AI state](../AI_STATE.md).

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

## Searchable learner Question Sets

The separate Question Set Library lets a signed-in learner submit a saved set from its card, search approved learner sets in QBank, preview questions, like a set and import a private copy. It uses the same privacy-stripped snapshot format as unlisted shares. Attempts, notes, source files, media, analytics, original local IDs and course filing are excluded. Submission requires two explicit attestations: distribution rights and source-checked answers. A set with unresolved answer/source review or media that the snapshot cannot carry is held out of public submission.

`20261101192000_question_set_library.sql` stores pending submissions apart from seven-day bearer links. Direct learner table access is denied. Account-bound RPCs project only the owner's submission status, pending reviewer metadata, or approved search results. Preview returns the snapshot only to the owner, an academic reviewer or an approved-set reader. Likes use an idempotent RPC. An academic reviewer must inspect and record a reason before approval or rejection; Host operator permission alone does not grant academic review. A contributor can withdraw a submission, removing it from search and future previews; previously imported private copies remain with their learners.

This is a user-submitted library, not automatic certification of clinical correctness or source rights. Reviewers need independent source and rights evidence. Local PGlite and synthetic browser checks passed; real-account acceptance remains open. Search is for signed-in AXOM accounts, not anonymous visitors.

## Batch answer confirmation

The Source review dialog can group eligible slide-marked answer candidates when the original PDF is available and the page is known. Each row shows its candidate label and opens the source page. The user must select rows and attest to checking those keys against the original before a single batch action records reviewer evidence with a timestamp note.

The batch helper calculates a trial readiness assessment and exposes only candidates that would become completely ready after key verification. It excludes inferred-from-explanation keys, ambiguous or missing original source pages and anything with other unresolved blockers. Media assets are not required because a highlighted answer may be marked with text styling alone. Source inconsistencies and other holds remain in review; the bulk action is not AI auto-approval.

## Operator console

The #host page has server-authorized roles, never front-end-only permissions:

| Role | Capabilities |
| --- | --- |
| Project CEO (`owner` in the database) | Directory, role assignments, AI permission and daily quota policies, moderation, aggregate QBank/AI monitoring, audit history |
| Administrator | Directory and metrics, shared QBank review metadata, report moderation |
| Moderator | Submitted shared QBank metadata and reported post moderation |
| Normal learner | No operator data or permission writes |

Project CEO/administrator access does not bypass private workspace snapshot policies. Operators cannot approve Question Banks by unchecked bulk actions. The Host queue is restricted to the current, ready revision in an explicit pending `academic_community_submissions` record; group visibility alone never puts a collection in this queue. The visible Project CEO badge appears only after the authenticated account's `axom_operator_role` readback reports `owner`. The database permits one owner row, provisioned for JD only after immutable Auth ID verification.

Post reports exclude private posts from the moderation queue. A post changed back to Private drops from the queue immediately; resolving it is denied while private. Every dismissal or removal requires an 8–500 character audit reason. The previous two-argument resolution RPC is removed by the forward migration so old clients fail closed.

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
2. The 2026-11-02 production dry run listed exactly seven pending migrations, no seeds or roles. They applied in order: `20261101190000_community_social.sql`, `20261101191000_operator_console.sql`, `20261101192000_question_set_library.sql`, `20261101193000_journal_experience_feedback.sql`, `20261102160000_operator_privacy_audit_hardening.sql`, `20261102170000_academic_review_queue.sql`, and `20261102171000_reviewer_attestation_identity.sql`. The earlier four-migration postflight was on preview only. Do not replay these versions. The older `20261101120000` and `20261101130000` versions belong to separate academic migrations.
3. Run PGlite/Postgres RLS tests with at least three distinct JWT identities, plus anonymous access. Attempt spoofed sender IDs, reverse friend requests, self-requests, forged role assignment, social post updates to another owner, friendship reassignments, denied AI quota edits and access after unfriend.
4. Verify privileged RPCs return 42501 for users with no role, that the unsubmitted group collection is absent from Host monitoring, and that private posts disappear from report moderation. Verify a second owner is rejected and report decisions store a reason. Inspect function privileges and run the Supabase security advisor.
5. Test Community on two authorized opt-in accounts and a signed-out device: friend discovery, acceptance, friends-only RLS, public feed, report, like/unlike, post delete, hide, withdrawal and account switch. Validate mobile 390 px, desktop 1440 px, dark/light and reduced motion.
6. Verify slide-only PDF import both with and without answer-reveal images. Check source page navigation and correct import counts after reviewing 21 keys in one action; ensure ambiguous, unkeyed and structurally broken questions remain held.
7. Check build, typecheck, lint, unit tests, QBank Playwright, Vercel preview and real-account reload. GitHub CI is not a substitute for live multi-account or migration tests.
8. Approve integration into main and only then verify the production commit and runtime schema. No auto-publication of user material.

Not in this slice: account-wide suspension, persistent user blocking, configurable capability policies beyond the existing three operator roles, billing/token/latency attribution, comment threads, full Question Set content in the feed, independent source-rights verification tools, trusted general QBank/course-event ingestion, realtime push notifications or automatic Anki imports. Unfriend removes friends-only access but is not a block. Persistent blocking needs an auth-bound record that survives leaving and rejoining Community. Self-shared standings must never be described as verified study rankings.

## Historical PR #30 integration boundary

The PR #30 hardening branch was an earlier integration stage. Its parallel Host draft tables/RPCs were excluded. The seven migrations above and their matching clients shipped together. Role and AI policy RPCs require `reason`; account-bound clients discard results after any account switch, including a switch away and back. The Host hardening itself does not change QBank parsing, learner persistence or course contracts.

Validation receipts and integration decisions belong in [PR #30](https://github.com/jaclose/AXOM/pull/30). Merge requires passing CI and database security checks for the exact candidate. Production migration, verified-account provisioning and deployment remain separate approval boundaries. Recovery before application is simply withholding this unreleased migration/client bundle; after application, use a reviewed forward migration and provider recovery procedures, never drop learner tables as a rollback.


## Local hardening receipt, 2026-10-25

Passed: 77 focused unit/SQL tests (including the full migration chain), 43 repository tests/hygiene, typecheck, full lint, build and Daily Games bundle isolation. One SQL-backed two-account Chrome journey passed discovery consent, private visibility, friendship/reload, shared-day standings, Kudos/reload, reports, role grant/revocation, per-account AI cap/disable and immediate access removal after unfriending. Four desktop-dark/mobile-light screenshots were inspected; reduced motion, no overflow and zero browser warnings/errors were verified. Existing build notices for jszip/webUpdates dynamic imports and large chunks remain.

The browser uses real local PostgreSQL policies and synthetic Auth/REST transport. This is not deployed Supabase or real Jafar/Aynaz acceptance. Full verify:all, native and multi-connection checks were not rerun. The exact hardening commit still needs CI before integration; baseline CI does not certify subsequent edits.
