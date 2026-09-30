# Hotfixes

Bug fixes, newest first. Root cause stated so the same class of bug is easy to spot again.

| Date | Fix | Root cause | Commit |
|---|---|---|---|
| 2026-09-30 | Profile and Account could disagree about sign-in; sign-in details loaded slowly | a second session read raced the SDK's auth events, and a failed token refresh read as signed out; nothing showed until the SDK downloaded | f20f81e |
| 2026-09-30 | Three e2e races (highlight delete, study-plan reload, keyboard pass) | reloads raced the IndexedDB write; a lazy remount swallowed a key | f221dc3 |
| 2026-09-30 | e2e suite now really runs with reduced motion; a name typed into setup was being dropped | Playwright 1.61 ignores `reducedMotion` at the top of `use`; the opening film held the app inert | edaa823 |
| 2026-09-30 | "Not now" no longer resets an item's review clock; Undo restores the order | the snooze patch stamped `updated` | e86a51c |
| 2026-09-30 | Installing AXOM works again | the install prompt was captured by a lazy page, too late | de69c75 |
| 2026-09-30 | The update panel no longer crashes AXOM after a deploy (was on main too) | lazy release notes 404ed against the old build's hashes | b5eb1fa |
| 2026-09-30 | Nine issues the first full e2e run found: unreadable light-theme text, tour scroll race, focusable leaving toasts, hover shift, App Checker pathway memory | - | 1ebb916 |
| 2026-09-29 | Pomodoro logging no longer doubles study time (384 to 736) | timer minutes did not count toward the Study tracker, so a top-up added them twice | f095e48 |
| 2026-09-29 | Daily games black screen | a failed game chunk replaced the whole app; routes were not precached | 47609d7 |
| 2026-09-29 | Study plan (brain) dialog painted under rows | Modal rendered inside the row | 47609d7 |
| 2026-09-29 | Light-theme and 390 px sweep fixes; no developer phone number anywhere | - | 5fdd194 |
