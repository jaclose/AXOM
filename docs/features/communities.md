---
tags:
  - axom/feature
  - axom/community
authority: canonical
---
# Communities

`CommunitiesPage` brings four study spaces into the Community sidebar entry:
Study circle, Course exchange, Daily challenge, and Personal bests. The older
`#community` route remains available for existing links; new navigation opens
the Study circle space inside `#communities`. The former `#leaderboards` route
opens Personal bests inside Community. Navigation defaults revision 3 hides
the redundant sidebar shortcut once; subsequent custom navigation is preserved.

## Account choices and identity

Password and email-code account creation offer independent choices for learner
discovery and automatic daily progress sharing. Both default off. Signup metadata
`axom_community_preferences` seeds the private `social_preferences` row only when
the Auth account is inserted; signing into an existing account never reapplies
signup choices. Malformed or missing metadata produces private defaults.

Account Settings owns later discovery and sharing changes. Community owns the
chosen public handle, display name and biography. Creating a profile atomically
uses the saved discovery choice. A profile is not created just by making an
account. Signing in does not authorize the publication of a retained device's
private workspace: automatic sharing also requires the account's existing
workspace-link decision to have completed.

See [Community data and consent](../architecture/data-model.md#community-data-and-consent)
for server authority, withdrawal and revision rules.

The course exchange reuses `CommunityUploads`. Members can browse, preview,
download, contribute, and withdraw exact course revisions through the existing
academic library boundary. Contributions remain visibly **Unreviewed** until an
academic reviewer approves the stored revision. The [academic library](academic-library.md)
owns eligibility, rights confirmation, reviewer receipts, storage, and source checks.
An installed course opens in the [Question Bank](questions.md), where held questions
remain held and community warnings remain visible.

The daily challenge reuses `SharedDailyLeaderboard` from Leaderboards. It appears
only when the member chooses that space; an unconfigured build offers personal
Question Bank practice, while a signed-out member can open account settings.
Participation uses a chosen alias and server-verified answers. The page does not
create a public profile or expose private answers, notes, or personal study logs.

## Study circle

The Study circle lazily opens `CommunityPage` for learner discovery, incoming and
outgoing friend requests, accepted friends, clickable profiles, shared progress,
posts, replies, Kudos and reporting. Joining and discoverability are separate
choices; private study logs do not enter the social feed by default.
The member's own profile is fetched by account identity, separately from the
bounded directory, so a large member list cannot return an existing member to
the Join screen. Joining creates a profile only once; later edits use explicit
profile controls. A two-character search queries opt-in profiles on the server,
while existing connections remain visible to their members under the database's
access rules. Connection pages load completely up to the stated service limit;
an outage or limit shows an error and pauses friend controls without hiding the
member's own profile. A hidden requester is visible to the intended recipient
while their request is pending, so a request can be identified and answered;
this grants no access to friends-only progress before acceptance.

The composer supports an update, a study invitation, a selected day's aggregate,
or a Question Set title announcement. Each manual post starts at Only me and
requires an explicit audience choice to share. Drafts survive failed requests;
successful publication clears the submitted draft. Authors can edit or delete
posts. Replies are paginated and respect the parent post's current visibility;
authors can edit/delete their replies and the post owner can remove replies.
Concurrent edits use the version captured when editing began. Audience narrowing
and unfriend revoke subsequent database reads immediately. Visible views refresh
on focus, every minute and after local Community changes. This is not a live
presence indicator or push notification service.

The feed identifies its latest 100 visible posts; a profile shows recent activity
and separately loads 30 days of shared progress so discussion volume cannot
truncate totals. Profile streaks count visible positive progress days and are
explicitly shared streaks, not a copy of private learner analytics.

Friends and Community standings live in Study circle, with 7/30-day windows and
minutes, cards or questions. They exclude private posts, deduplicate daily totals,
and label the figures self-shared. Friends standings include the learner and
accepted friends. Community standings require public progress and a discoverable
profile. The paginated query reports a service-limit error rather than silently
ranking a partial population. Daily Challenge standings retain their separate
server-verified answer contract; Personal bests retains local completed-week
records.

## Dashboard widget

The optional Community widget shows accepted friend count, incoming requests,
and recent friend updates with an Open Community link. Signed-out and empty
states offer a real next step; there are no fabricated people, activity or online
indicators. Requests are account-bound and late results cannot follow an account
switch. Dashboard defaults revision 3 makes the widget available in customization
without overriding an existing learner's layout.

The page uses the actual AXOM Orb, palette tokens, a short optional entrance,
and a static reduced-motion state. `#help` remains the route for community feedback.
Real account and catalog acceptance must be checked separately from local UI tests.
The forward migration `20261106020000_community_experience.sql` and regenerated
Communications export function must be deployed before releasing this client.
