---
tags:
  - axom/feature
  - axom/release
authority: canonical
---
# Patch notes

AXOM's public release history comes from the repository-root `CHANGELOG.md`.
`scripts/release-notes.mjs` parses versioned entries as plain text for the web app,
the desktop updater, and packaged release metadata. The Patch Notes page searches
that same record offline. Its build card shows the package version and exact build
revision when one is available; a same-version web deployment is not presented as
a new version.

Before a versioned release, add a concise `## <version> — YYYY-MM-DD (Title)` entry
at the top of `CHANGELOG.md`. Describe only changes verified in the release candidate.
The release assembler requires an entry for the package version and rejects empty or
oversized notes. Historical entries are preserved, including source language that
the web projection neutralizes for learners. Do not use a local commit or branch as
proof that a change is live.

The Settings update panel shows the three most recent dated entries and links to
the full Patch Notes page. The new page has a current-version filter, text search,
an empty search state, complete expandable notes, and an honest missing-entry state.
It uses the authentic AXOM Orb, theme tokens, keyboard-native controls and reduced
motion handling.

Integration requires registering `PatchNotesPage` at `#patch-notes` in the app router
and adding one navigation entry. Keep the route lazy-loaded so the changelog stays
out of the startup bundle. Verify both desktop and mobile in a browser after routing.
