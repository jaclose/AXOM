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

- **Production project:** `AXOM Production` (`jofkmfwkidubxcutkwzf`, us-east-2),
  linked in `supabase/.temp`. All six migrations are applied and recorded
  (`npx supabase migration list`). Function ACLs are hardened:
  authenticated-only RPCs refuse `anon`, trigger/internal functions are not
  client-callable, and `resolve_question_set_share` stays anonymous by design
  (the share token is the capability). `web/src/lib/sync/supabaseMigrations.pglite.test.ts`
  replays every migration on real Postgres (PGlite) with Supabase's default
  privileges and asserts those ACLs, so a regression fails CI.
- **Auth config:** `supabase/config.toml` mirrors production (8-digit codes,
  60 s resend window, TOTP MFA on, pooler sizes) so `npx supabase config push`
  cannot silently regress it. Run `npx supabase config diff` first — it is
  read-only. `site_url` and the redirect allow-list are the only declared
  values that still differ (see step 4 below).
- **Not verified live yet:** the end-to-end account test needs the project's
  publishable key in `web/.env.local` (see step 5). The old project
  `skksijapfqmfczjsvfiw` is inactive; nothing references it.

## Turning it on

1. **Migrations** — applied to production through `20260928130000`.
   **`20261001090000_prune_revision_history_within_budget.sql` is not applied
   yet and is needed** (accounts with a large workspace cannot upload without
   it): see `docs/release/2026-10-01-ACCOUNT-SYNC-INCIDENT.md`. It replaces one
   function, keeps its signature and answers, and is safe to run twice. For a
   new project: connect
   GitHub in the Supabase dashboard (**Working directory: `.`**) or run
   `npx supabase link --project-ref <ref>` then `npx supabase db push`. Never
   apply `db/migrations/001–002` (legacy PIN backend without row-level security).
2. **Email delivery (required before real users)** — Supabase's built-in
   mailer sends only a few emails per hour and only to project team members.
   Add custom SMTP under Authentication → Emails → SMTP. With Resend (already
   in your bookmarks): host `smtp.resend.com`, port `465`, user `resend`,
   password = a Resend API key, sender e.g. `AXOM <auth@your-domain>` on a
   domain verified in Resend. Then raise Authentication → Rate limits → emails.
3. **Templates** — every auth email carries the code *and* the link, because a
   link opened from the desktop app lands in a browser. Paste into
   Authentication → Emails: **Confirm signup** ← `supabase/templates/confirmation.html`,
   **Magic Link** ← `magic_link.html`, **Reset password** ← `recovery.html`
   (subjects are in `config.toml`). The app verifies confirmation and reset
   codes in-app (`verifyOtp` types `email` / `recovery`).
4. **URLs** — Authentication → URL configuration. Site URL: your production
   web origin (currently `https://axom-jacloses-projects.vercel.app/`). Keep the
   Vercel preview patterns and add `http://127.0.0.1:5173/**`,
   `http://localhost:5173/**`, `http://127.0.0.1:5187/**`,
   `http://localhost:5187/**` for local development. Mirror the final list in
   `config.toml` (`site_url`, `additional_redirect_urls`) before any
   `config push`: its `site_url` still points at the local dev server.
5. **Keys** — Dashboard → Project Settings → API Keys. Copy `web/.env.example`
   to `web/.env.local` and paste the **publishable** key
   (`VITE_SUPABASE_PUBLISHABLE_KEY`, `sb_publishable_…`; the legacy
   `VITE_SUPABASE_ANON_KEY` also works). In Vercel → Project → Settings →
   Environment Variables, add `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_PUBLISHABLE_KEY` for Production and Preview, then redeploy.
   Never put a secret/service-role key in any `VITE_` variable.
6. **Verify live** — `cd web && AXOM_LIVE_EMAIL=<fresh address> SUPABASE_SECRET_KEY=<secret key> npm run test:accounts:live`.
   The secret key stays in that one shell command; the test uses it only to
   mint the same one-time codes the emails carry and to delete its throwaway
   user afterwards. It covers: create account → confirm by code → password
   sign-in → code sign-in → protect → second device conflict → **Merge both** →
   restore → devices → delete cloud copies. It sends two real emails, so
   don't loop it on the built-in mailer.

## Desktop (Tauri) packaging

- The desktop build bakes the same two `VITE_` values at build time; no other
  secret is needed.
- Email **codes** are the passwordless path in the desktop app (sign-in,
  sign-up confirmation and password reset); a link click opens the system
  browser, which cannot hand a PKCE session back to the app window. Password
  sign-in works everywhere.
- The desktop CSP (`src-tauri/tauri.conf.json`) allows `connect-src https:`,
  which covers `https://<ref>.supabase.co`. AXOM does not use Realtime, so no
  `wss:` entry is needed.
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
