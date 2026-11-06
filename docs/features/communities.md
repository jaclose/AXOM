---
tags:
  - axom/feature
  - axom/community
authority: canonical
---
# Communities

`CommunitiesPage` brings three study spaces into one sidebar entry: Community
Uploads, the shared daily challenge, and the opt-in social circle. It adds no
publication route, score rule, consent model, or medical content. The older
`#community` route remains available for existing links; new navigation opens
the Study circle space inside `#communities`.

Community Uploads now exposes two independent publication paths. A member can
select an eligible locally saved QBank Question Set, preview its readiness and
submit it directly, without inventing a course, term or module. This reuses
`QuestionSetLibrarySubmitDialog` and the existing moderated Question Set Library:
the contributor explicitly confirms sharing rights and answer review, and only
approved sets become searchable and importable. Snapshot publication excludes
notes, attempts, analytics, source files, attachments and course filing; media
and unresolved answers block submission. Personal missed-review sets and imported
community copies are not offered for republication. The approved-set browser
is opened on demand, independently of the course submission list.

The course exchange also reuses `CommunityUploads`. Members can browse, preview,
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

The Study circle lazily opens `CommunityPage` for account discovery, friendships,
explicitly shared progress, reactions and reporting. Joining and discoverability
are separate choices; private study logs do not enter the social feed by default.
The member's own profile is fetched by account identity, separately from the
bounded directory, so a large member list cannot return an existing member to
the Join screen. Joining creates a profile only once; later edits use explicit
profile controls. A two-character search queries opt-in profiles on the server,
while existing connections remain visible to their members under the database's
access rules. Connection pages load completely up to the stated service limit;
an outage or limit shows an error and pauses friend controls without hiding the
member's own profile or privacy settings.

The page uses the actual AXOM Orb, palette tokens, a short optional entrance,
and a static reduced-motion state. `#help` remains the route for community feedback.
Real account and catalog acceptance must be checked separately from local UI tests.
