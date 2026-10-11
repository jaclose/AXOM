---
tags:
  - axom/operations
authority: canonical
---
# Validation routes

Start with the affected behavior. A successful command validates its checkout, not
another worktree or production. Save full logs outside active context and report summaries.

| Change | First check | Broader check |
| --- | --- | --- |
| Context/docs/hygiene | `npm run test:repo` | `npm run repo:check` |
| Domain logic/component | `cd web && npm test -- src/path/to/affected.test.ts` | `npm --prefix web run quality` |
| Question import | `npm --prefix web run verify:question-imports` | Relevant question E2E specs |
| Account sync/migrations | Focused `web/src/lib/sync/` tests (including PGlite) | Account safety E2E; live tests separately authorized |
| Release/update tooling | `npm run test:release` | Production build + `verify:app-updates` |
| Native Rust | `cargo test --manifest-path src-tauri/Cargo.toml --lib --locked` | `cargo fmt --manifest-path src-tauri/Cargo.toml --check`, `cargo check --manifest-path src-tauri/Cargo.toml --locked`, launch/exercise |

## Narrow commands

Use Node 22.23.1 from `.nvmrc` and npm 10.9.8 (`npm run check:toolchain`).
Both package roots support Node >=22.23.1 <23 and pin the npm version. Repository checks use
only Node built-ins; no install is needed for documentation/tooling-only work.

| Need | Command from repository root |
| --- | --- |
| One unit/component file | `npm --prefix web test -- src/lib/courseScheduleImport.test.ts` |
| A subsystem | `npm --prefix web test -- src/lib/sync/` |
| Typecheck | `npm --prefix web run typecheck` |
| Lint | `npm --prefix web run lint` |
| Build | `npm --prefix web run build` |
| One browser spec | `npm --prefix web run test:e2e -- e2e/question-bank-persistence.spec.ts` |
| Repository gate without npm aliases | `node scripts/repository-hygiene.mjs` |
| Repository tests without npm aliases | `node --test scripts/repository-hygiene.test.mjs` |

Do not add another test runner or move adjacent unit tests. Full logs belong in a
unique `/tmp/axom-<task>.log`; preserve the command exit status before filtering it.
Node 26's experimental global localStorage can break jsdom: prefer the pinned Node,
or the documented `NODE_OPTIONS=--no-experimental-webstorage` workaround.

## Integration and release

Full web gate for runtime integration/release:

```sh
cd web
npm run verify:all
```

It runs repository hygiene, typecheck, ESLint, Vitest, production build, update recovery,
offline daily-games checks and Playwright E2E. The live-accounts spec is opt-in and is
normally skipped. It creates/deletes cloud users and can send real email; skipping it
must never be described as live account verification.

Playwright uses `web/e2e/fixtures.ts`, reduced motion via `contextOptions`, one worker,
and local port 5187 unless `AXOM_E2E_BASE_URL` is explicitly set. Use a free local port
and isolated server, not an unrelated running app. Install its Chromium if required:
`cd web && npx playwright install chromium`. Installed Chrome can be selected with
`AXOM_E2E_CHANNEL=chrome`. UI edits additionally need 1440×900 / 390×844 interaction,
console, resize and reduced-motion review.

`.github/workflows/quality.yml` runs web quality, release tests, update/offline checks,
production dependency audit and native checks on PRs, main/integration pushes and merge
groups. Both root and web dependencies are installed. It does not currently run the general
Playwright E2E suite; do not equate CI green with the full local gate.

Do not retry unrelated failures blindly. Reproduce them on the base revision, capture
an exact failing test/command, and keep scope clear. Known environment traps and
production-state limits are in [troubleshooting](troubleshooting.md).

## Vercel deployment inputs

Run from the repository root after committing the candidate:

```sh
npm ci
npm run test:deployment
npm run verify:deployment -- --without-goer-allowlist --expect-build-failure
npm run verify:deployment
```

`verify:deployment` builds committed HEAD, not working-tree edits. `--ref SHA` selects
another committed candidate. It enumerates Git's exact tracked paths, filters them using
Vercel's rules, archives only selected files into a new temporary directory, runs the
install/build commands from that candidate's `vercel.json`, then removes only that
temporary directory. No existing node_modules, output, private files or untracked inputs
are copied. Commands and the full tested SHA are printed. Allow roughly 2 GB of free
space per run in addition to the working checkout and its dependencies.

The negative run removes the GOER allowlist from the rules used to prepare the source.
It must reach the real web TypeScript build and fail with TS2307 for a GOER manifest;
an installation error or an early input-guard failure does not count. To reproduce the
historical rules exactly in a checkout containing that history:
`npm run verify:deployment -- --ignore-ref c23e8c2^ --expect-build-failure`.
The positive run executes the normal Vercel build, including exact-case input validation.
TypeScript and all original manifests/content remain intact.

Filtering uses pinned `ignore@4.0.6`, the parser used by `@vercel/client@18.8.2`
(CLI 63.1.2), with its default exclusions and relative-pattern normalization. The
implementation was compared against that client's `getVercelIgnore` over 7,850
path/rule combinations, including the actual tracked tree, current/original rules,
parent negation and defaults. See [Vercel's ignore contract](https://vercel.com/docs/deployments/vercel-ignore)
and [upstream implementation](https://github.com/vercel/vercel/blob/main/packages/client/src/utils/index.ts).
Update parser/defaults together after checking upstream semantics. The full deployment
client is intentionally not installed: its unrelated networking/archive dependencies
added eight high audit findings in the inspected version. There are no dependency overrides.

The project is rooted at the repository root. CLI default excludes are applied as well
as `.vercelignore`; this is conservative compared with Git deployment defaults. This
gate validates source filtering, both clean npm installations and the production web
build. It is not a Vercel preview, serverless-runtime or browser acceptance claim.
The `deployment-inputs` CI job proves negative and positive builds on Linux. Existing
web/native checks remain; release quality additionally runs the positive filtered build.

Remote settings inspected 2026-10-11: Vercel `axom` uses rootDirectory=null, Node 22.x,
GitHub jaclose/AXOM and production branch main; install/build/output overrides are null.
Repository `vercel.json` supplies those commands. No Vercel settings change is needed
for this root/Node baseline. GitHub reports main/integration unprotected and no repository
rulesets. To enforce merging only after checks, the owner must require `deployment-inputs`,
`web` and `native` through branch protection/rulesets; configure Vercel deployment checks
separately if production must wait for CI. No remote setting was changed by this task.
