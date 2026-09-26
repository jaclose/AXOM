# AXOM update policy

App packages and user data have independent lifetimes. Updates replace app code;
the native identifier, browser storage keys and SQLite filename stay stable.

| Channel | Update behavior |
| --- | --- |
| Hosted web | Deploy metadata identifies new builds, including same-version deployments. AXOM offers a refresh; it does not force a reload. |
| Downloaded web ZIP | Replace the hosted files with a new ZIP at the same origin; existing open clients receive the same web update flow. A disconnected ZIP cannot fetch newer packages by itself. |
| Signed Tauri desktop | Periodic/manual check, verified download, user-approved install and restart. Requires a real public endpoint and trusted signing key. |
| Local unsigned Tauri build | Updater explicitly disabled; install a signed release to join its update channel. |
| Legacy Swift wrapper | Manual replacement; export/import a portable backup when migrating to Tauri. |

Checks happen on startup, reconnection, return to a visible page and every 15
minutes, with automatic checks throttled. Settings → Advanced and the desktop
Updates menu allow manual checks. Active study sessions suppress notices.
Download, installation and restart always require user actions. Users are asked
to finish unsaved form edits before applying an update.

Before applying, AXOM awaits persisted writes, saves the current workspace,
reads it back and verifies an automatic recovery snapshot. Desktop also writes
a SQLite snapshot. An error leaves the current app open. The downloaded update
must pass the Tauri cryptographic signature check. Failed network checks do not
disable the current app.

The service worker stages a new build without skipWaiting during installation.
Activation occurs after the user approves refresh. Prior hashed assets are
retained for old tabs; API responses and version.json are not cached. Offline
navigation uses the active build's own shell. Failed lazy loads offer recovery
rather than an automatic reload. Startup failures show a retry screen without
clearing storage.

The Local Vault remains the source of truth: IndexedDB with a localStorage
fallback, isolated by browser, device and origin. Native SQLite is an additional
workspace snapshot store, not an automatic cloud sync or image-backup system.
Automatic snapshots cover workspace JSON and settings; portable exports also
carry question-image attachments. Export before changing devices, domains,
browser profiles or wrappers. An old Swift app and Tauri app do not share data
containers. Do not clear browser data to fix an update problem.

Data schema changes require forward migrations and regression tests. Older
builds encountering a newer schema stop before store hydration. Roll back bad
code by publishing a higher-version compatible fix, not by downgrading saved
data. Keep the original signing key securely backed up.

See [DESKTOP-RELEASE.md](DESKTOP-RELEASE.md) for one-time credentials, CI,
cross-platform packaging and the required signed N → N+1 distribution test.
The updater is implemented; public distribution is only verified after those
credentials, hosting and install/restart tests are complete.
