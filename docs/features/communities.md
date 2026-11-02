---
tags:
  - axom/feature
  - axom/community
authority: canonical
---
# Communities

`CommunitiesPage` brings two existing account-based study spaces into one entry:
Community Uploads and the shared daily challenge. It adds no new publication
route, score rule, consent model, or medical content. The route and sidebar entry
are owned by the app shell integration.

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

The page uses the actual AXOM Orb, palette tokens, a short optional entrance,
and a static reduced-motion state. `#help` remains the route for community feedback.
Real account and catalog acceptance must be checked separately from local UI tests.
