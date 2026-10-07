# Local development

Use the installed versions and lockfiles. `.nvmrc` selects Node 22; the root package
requires 22.x, while current CI explicitly runs Node 24. Do not change that mismatch
incidentally. No new dependency is needed for the repository context tools.

```sh
nvm use
npm ci
npm --prefix web ci
npm --prefix web run dev
```

Root install supports release/native/API tools; frontend-only work needs `web/` install.
Use `npm ci` in a fresh worktree, never to overwrite another agent's dependency work.

| Work | Entry |
| --- | --- |
| Frontend | `npm --prefix web run dev` (Vite) |
| Optional local Vercel handlers | `npm run dev` (Vercel CLI) |
| Desktop | `npm run tauri:dev`; canonical config `src-tauri/tauri.conf.json` |
| API typecheck | `npm run typecheck:api` |
| Tests and quality gate | [Testing](testing.md) |
| Build/package/release | [Deployment](deployment.md) |

Environment templates: root `.env.example`, `web/.env.example`. Inspect variable names
in templates rather than dumping local secrets. Frontend-only development requires no
cloud secrets. Optional account configuration uses the public Supabase URL/publishable
key; never a service-role key in a `VITE_` value. Follow [account setup](../ACCOUNTS-SETUP.md)
for that task, treating its dated production claims as needing live verification.

App data is local to browser origin/profile or native container. Use a separate QA
profile and synthetic fixtures. Export JSON before switching environments containing
valuable work. Do not use private root study files as public test fixtures.

`web/scripts/` holds frontend verification/data tooling; root `scripts/` holds release,
asset import, native wrappers and repository checks. Existing legacy tools remain in
`scripts/legacy/`. Generated output belongs in ignored `artifacts/`, `dist/` or test reports.
