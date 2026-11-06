# AXOM — Alpha 1 Release Guide

How to ship **`0.1.0-alpha.1`**: deploy the web app, build the downloadable
packages, and publish a GitHub Release. Alpha 1 is **manual-update** for the
downloadable Mac app — see [UPDATE-POLICY.md](UPDATE-POLICY.md).

## 0. One-time prerequisites

- Node 18+ and npm.
- Optional for the experimental native shell: Rust 1.77.2+ and the Tauri v2
  prerequisites for the target platform.
- A Vercel project pointed at the **repository root** (not `web/`). The root
  `vercel.json` builds `web/`, serves `web/dist`, and keeps `/api/*` serverless.
  Alpha 1 groups backend actions into five route files so it stays below the
  Vercel Hobby serverless function cap.
- (Optional) A Neon/Supabase/Postgres `DATABASE_URL` for cloud sync. The app is
  fully usable without it — the Local Vault (IndexedDB + localStorage) is the
  source of truth.

## 1. Verify a clean build from a fresh clone

```sh
git clean -xdn            # preview what would be removed (sanity)
npm install
npm run build             # builds web/ → web/dist
npm --prefix web run package
```

`package` produces (and the repo ignores) both:

- `web/AXOM-web-v0.1.0-alpha.1.zip` — static web bundle (unzip → open `index.html`).
- `web/AXOM-mac-v0.1.0-alpha.1.zip` — double-clickable macOS wrapper (built only on
  macOS with `swiftc`; ad-hoc signed, not notarized).

Confirm the zips do **not** appear in `git status` (they are gitignored).

## 2. Deploy the web app to Vercel

```sh
npm install
npm run typecheck:api
npm run build
# then deploy from the repo root (CI or `vercel --prod`)
find api -maxdepth 1 -type f -name '*.ts' | wc -l  # expected: 5
```

- Set env on Vercel: `AI_PROVIDER=mock` for Alpha 1; optionally `DATABASE_URL`
  and `AXOM_AUTO_MIGRATE=true`.
- Public API URLs such as `/api/user/login`, `/api/data/:userId/backup`, and
  `/api/ai/next-move` are compatibility rewrites into grouped functions. Do not
  add one serverless file per tiny action during Alpha unless the function budget
  is intentionally revisited.
- If Vercel returns `404: NOT_FOUND`, the project root is wrong or it's an old
  deployment — redeploy from the repository root after committing `vercel.json`.

The deployed web URL is the **auto-updating** channel: pushing to the default
branch redeploys, and users get the new build on next load (service worker
refreshes the app shell; their Local Vault data is untouched).

## 3. Build the downloadable packages

```sh
npm --prefix web run package
```

Upload the two zips from `web/` as release assets (next step).

Experimental native shell checks:

```sh
npm run tauri:dev      # development shell, uses web dev server
npm run tauri:build    # future native bundle path; not the Alpha 1 primary asset yet
```

The Tauri shell is wired to `sqlite:noctyrium.db` and a first migration, but the
Alpha 1 release assets remain the static web zip and lightweight macOS wrapper.

## 4. Draft a GitHub Release

1. Tag: `v0.1.0-alpha.1` (annotated) on the release commit.
2. Title: `AXOM 0.1.0-alpha.1`.
3. Mark it as a **pre-release**.
4. Body: paste the `0.1.0-alpha.1` section from [`CHANGELOG.md`](../CHANGELOG.md),
   plus the one-line update note: *“Web auto-updates via the hosted link; the Mac
   download is manual for Alpha 1.”*
5. **Upload these assets:**
   - `AXOM-web-v0.1.0-alpha.1.zip`
   - `AXOM-mac-v0.1.0-alpha.1.zip`
6. Link the hosted Vercel URL in the release body as the recommended way to use it.

> Distribution is via **GitHub Releases assets** — not GitHub Packages.

## 5. What users do

- **Easiest:** open the hosted Vercel link (auto-updates).
- **Offline web:** download `AXOM-web-…zip`, unzip, open `index.html`.
- **Mac app:** download `AXOM-mac-…zip`, unzip, right-click `AXOM.app`
  → Open once (ad-hoc signed, not notarized).

## 6. Updating for Alpha 1

- Web/hosted: automatic on next load.
- Mac/offline downloads: **manual** — download the newest release. No in-app
  auto-updater ships in Alpha 1 (see [UPDATE-POLICY.md](UPDATE-POLICY.md)).
- Always **Export a JSON backup** (Settings → Backup) before switching devices,
  domains, or package types.

## Environment variables (optional services)

| Variable | Used by | If unset |
|---|---|---|
| `DATABASE_URL` | cloud sync, admin account list | App stays fully local-first; cloud features off |
| `RESEND_API_KEY` | `/api/feedback` email send | Feedback form falls back to "copy + email jdabbagh@sgu.edu" |
| `FEEDBACK_TO` / `FEEDBACK_FROM` | `/api/feedback` | Defaults to `jdabbagh@sgu.edu` / Resend sandbox sender |
| `ADMIN_VIEW_KEY` | admin account visibility | Admin view is disabled (no broken UI shown) |

Never expose these client-side. All live only in Vercel project env.

## Admin account visibility (host)

To list registered Alpha cloud profiles (account name, user ID, created/last-synced,
device label, backup count), the deployment must have **both** `DATABASE_URL` and
`ADMIN_VIEW_KEY` set. Until those are configured this is intentionally **not built into the
client** (no admin button is shown to normal users, and no data is faked).

> **TODO (admin visibility):** Admin account visibility requires `DATABASE_URL` and an
> `ADMIN_VIEW_KEY`. With both set, add a protected `GET /api/admin/accounts` route that
> checks the key header before returning account records — do not expose it publicly.

## Manual QA — persistence (run before each release)

Local-first data must survive updates. Verify:

1. Create a profile (name + icon).  2. Add a task.  3. Add a productivity log.
4. Add a Course Tracker item.  5. Add a journal entry.
6. **Refresh** the page → all present.  7. `npm run build` and reload the local build → all present.
8. Redeploy (or bump schema) → all present; only additive migrations run, never a reset.

Data lives separately from app code (browser Local Vault / JSON backups), so replacing the
app bundle never overwrites user data.

## Remaining blockers before the GitHub Release

- Push the release branch and annotated tag to `jaclose/AXOM`.
- Decide the canonical hosted URL to advertise (a stable Vercel domain or custom domain).
- Optional: notarize the Mac wrapper (Apple Developer account) to avoid the Gatekeeper prompt.
- Optional: build/sign/notarize the Tauri bundle once the native shell graduates
  from scaffold to release channel.
