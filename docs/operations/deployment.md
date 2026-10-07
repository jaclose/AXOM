# Deployment and updates

This page routes procedures; it does not establish live deployment state or authorize
production changes. JD pushes releases. Never merge/push/deploy just because checks pass.

| Need | Canonical procedure / implementation |
| --- | --- |
| Native packaging, signing, updater feed | [Desktop release](../DESKTOP-RELEASE.md), `scripts/release.mjs`, `.github/workflows/release.yml`, `.github/workflows/update-feed.yml` |
| Web update consent/recovery/offline behavior | [Update policy](../UPDATE-POLICY.md), `web/src/lib/webUpdates.ts`, `web/public/sw.js` |
| Accounts configuration/migrations | [Account setup](../ACCOUNTS-SETUP.md), `supabase/config.toml`, `supabase/migrations/` |
| Cloud AI function/secrets | [Cloud AI](../CLOUD-AI.md), `supabase/functions/ai-proxy/` |

Vercel uses the repository root: `vercel.json` installs root + web dependencies,
builds the web app and serves `web/dist`. `.vercelignore` intentionally limits uploads;
shared release-note scripts and the AI proxy core are included for builds/tests.
Root `api/` compatibility rewrites still exist; account/data name-login handlers return
410. They are not the account provisioning path.

`npm run release:doctor` checks local release prerequisites. `npm run release:web`
creates the web package; `npm run release` runs the native release path as documented.
Generated packages live under ignored `dist/releases/`. Versions are coordinated by
release scripts; don't hand-edit one manifest to simulate a release.

Older setup/runbook status is dated evidence. Check the live project before assuming
migrations, SMTP, secrets, signing, updater feed or URLs are configured. The [October
account incident](../release/2026-10-01-ACCOUNT-SYNC-INCIDENT.md) documents a database
failure and repair; its existence does not prove the migration is deployed.
