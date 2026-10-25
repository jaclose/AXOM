# Community, source-answer batch review and host console

Status: **feature branch, integration pending**. These changes are code, not proof of a live or tested deployment. Do not enable production until the gates below pass.

## Community

The #community page extends optional Supabase accounts without moving or auto-publishing any saved learner workspace data.

1. Sign into each AXOM account.
2. Each learner independently selects Create public profile and a handle. Existing accounts are not auto-listed.
3. Find the other opted-in handle, send a friend request, and accept it on the other account.
4. Select a study day to publish an optional aggregate, or choose a local Question Set whose title only can be celebrated. Posts default to Accepted friends. Community visibility is a deliberate alternative.
5. Both people can like eligible posts and compare the last seven days of self-shared progress. Separate Daily Challenge standings remain server-verified.
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

The AI quota function defaults to 60 requests/day and honors a server-maintained per-user enabled flag and daily_limit override. Only the owner can change those overrides through the audited RPC; no upstream model keys or stored prompts are displayed.

**Owner bootstrap is mandatory:** The migration does not trust display_name, email prefixes or raw_user_meta_data to establish ownership. After verifying the intended owner's immutable auth.users.id and an authorized operator setup context, insert exactly one owner row using trusted service/admin privileges:

    -- Replace the placeholder ONLY after independently verifying the account UUID.
    insert into public.axom_operator_roles (user_id, role)
    values ('<verified-auth-user-uuid>'::uuid, 'owner');

Do not paste private emails, JWTs or service keys into the public repository. Role assignment via app UI cannot create an owner, demote an owner or elevate the caller.

## Deployment and verification gates

1. Check the current integration/coordination state and protected local work. The remote Mac was offline during this branch's creation, so no local files or uncommitted material were read, replaced, staged or reset.
2. Confirm all existing pending account/academic migrations on the actual target project, and apply the two new migrations in version order only after isolated tests. Do not duplicate or skip the existing pending migration chain.
3. Run PGlite/Postgres RLS tests with at least three distinct JWT identities, plus anonymous access. Attempt spoofed sender IDs, reverse friend requests, self-requests, forged role assignment, social post updates to another owner, friendship reassignments, denied AI quota edits and access after unfriend.
4. Verify privileged RPCs return 42501 for users with no role, and that one owner can alter only supported operational state. Inspect function privileges and run the Supabase security advisor.
5. Test Community on two authorized opt-in accounts and a signed-out device: friend discovery, acceptance, friends-only RLS, public feed, report, like/unlike, post delete, hide, withdrawal and account switch. Validate mobile 390 px, desktop 1440 px, dark/light and reduced motion.
6. Verify slide-only PDF import both with and without answer-reveal images. Check source page navigation and correct import counts after reviewing 21 keys in one action; ensure ambiguous, unkeyed and structurally broken questions remain held.
7. Check build, typecheck, lint, unit tests, QBank Playwright, Vercel preview and real-account reload. GitHub CI is not a substitute for live multi-account or migration tests.
8. Approve integration into main and only then verify the production commit and runtime schema. No auto-publication of user material.

Not in this initial slice: billing cost attribution per model (the existing database records request counts, not provider prices/tokens), editing private study workspaces, comment threads, full Question Set content in the social feed, a publisher rights-review workflow, realtime push notifications or automatic Anki imports. Do not advertise these as implemented.