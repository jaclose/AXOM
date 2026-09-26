# AXOM Accounts — setup and integration

Accounts are optional. Without configuration AXOM is fully local, and every
account surface says so. With configuration, a learner can sign in, protect
their workspace as immutable server revisions, restore any recent version,
move between devices, and delete every cloud copy.

## What ships in the app

| Piece | File |
| --- | --- |
| Supabase client (PKCE; no hash-route collisions) | `web/src/lib/account/supabase.ts` |
| App-wide account state (sign-in, codes, reset, link, restore, conflicts, devices, deletion) | `web/src/lib/account/accountStore.ts` |
| Background protection on every page (debounced, idempotent retries, offline resume) | `web/src/components/shell/AccountSyncWatcher.tsx` |
| Settings → Account UI | `web/src/components/shell/AccountSyncPanel.tsx` |
| Sidebar status dot on the cloud button | `web/src/components/shell/Sidebar.tsx` |
| Revision push/conflict protocol | `web/src/lib/sync/*` |
| Database schema, RLS, functions | `supabase/migrations/` (Supabase CLI layout; config in `supabase/config.toml`) |

## Status (2026-09-26)

The bookmarked project `skksijapfqmfczjsvfiw` does **not resolve** (DNS
NXDOMAIN) while `supabase.com` itself responds, so it appears deleted. Create a
new project and follow the steps below; nothing in the app depends on the old
reference. The Supabase SDK is lazy-loaded, so local-only installs never
download it.

## Turning it on (about 15 minutes)

1. Create a Supabase project.
2. Apply the schema in `supabase/migrations/` — either connect GitHub in the
   Supabase dashboard (**Working directory: `.`**, the repository root that
   contains `supabase/`) or run `npx supabase link --project-ref <ref>` then
   `npx supabase db push`. Never apply `db/migrations/001–002` (legacy PIN
   backend without row-level security).
3. Authentication → Providers → Email: enable email + password and email OTP.
4. Authentication → Email templates → **Magic Link**: paste
   `supabase/templates/magic_link.html` (it includes `{{ .Token }}` so
   passwordless sign-in works in the desktop app). The CLI/local stack already
   uses it via `supabase/config.toml`.
5. Authentication → URL configuration: add your hosted origin (e.g.
   `https://axom.info`) and `http://localhost:5187` to the redirect allow-list.
6. Copy `web/.env.example` to `web/.env.local` and paste the project URL and
   anon key. On Vercel, add the same two variables to the project settings.
7. Rebuild. Settings → Account now shows Sign in / Create account / Email me a code.

## Desktop (Tauri) packaging

- The desktop build bakes the same two `VITE_` values at build time; no other
  secret is needed.
- Email **codes** are the primary passwordless path in the desktop app: a
  magic-link click opens the system browser, which cannot hand a PKCE session
  back to the app window. Password sign-in works everywhere.
- `src-tauri/tauri.conf.json` currently sets `"csp": null`. Before shipping a
  signed desktop build, set a CSP that allows `connect-src` to your Supabase
  URL (`https://<ref>.supabase.co` and `wss://<ref>.supabase.co`).
- OAuth providers (Google/Apple) need a registered deep-link scheme for the
  desktop app; they are intentionally not wired yet.

## Guarantees (tested)

- Signing in never uploads or replaces local work; protection starts only
  when the learner chooses "Protect this workspace".
- A new device links against base revision 0, so an account that already has
  work produces a **conflict** that keeps both versions; the learner chooses
  **Merge both** (recommended — records combine by id, newer copies win,
  nothing is deleted; the same guarantees as merging a portable backup),
  "Keep this device", or "Use the account version". Every option takes a local
  safety snapshot first and is recorded in Restore history.
- Retries reuse one idempotency key — a lost response never creates a
  duplicate revision. Pending uploads survive reloads and resume online.
- Restores save a local safety snapshot first, are recorded as a new server
  revision, and appear in Settings → Emergency recovery → Restore history.
- "Delete cloud copies" removes revisions, conflicts, shares, and device
  records for the caller only; local data is untouched.
- Sync metadata never contains tokens or workspace content.

## Not yet included

- Binary attachment (question image) sync — images stay on the device and
  travel only inside portable backups.
- Shared/friend features (study groups, shared leaderboards). These need
  explicit consent, membership tables, and aggregate-only RLS policies before
  any learner data leaves a device.
- Account deletion of the auth user itself (requires a service-role edge
  function); "Delete cloud copies" covers all learner data today.
