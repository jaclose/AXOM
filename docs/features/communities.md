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

The Study circle lazily opens `CommunityPage` for account discovery, friendships,
explicitly shared progress, reactions and reporting. Joining and discoverability
are separate choices; private study logs do not enter the social feed by default.

The page uses the actual AXOM Orb, palette tokens, a short optional entrance,
and a static reduced-motion state. `#help` remains the route for community feedback.
Real account and catalog acceptance must be checked separately from local UI tests.
