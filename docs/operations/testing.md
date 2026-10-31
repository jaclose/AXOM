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
npm run verify:deployment -- --with-fixture-probe --expect-privacy-failure
npm run verify:deployment
```

`verify:deployment` builds committed HEAD, not working-tree edits. `--ref SHA` selects
another committed candidate. It enumerates Git's exact tracked paths, filters them using
Vercel's rules, archives only selected files into a new temporary directory, runs the
install/build commands from that candidate's `vercel.json`, then removes only that
temporary directory. No existing node_modules, output, private files or untracked inputs
are copied. Commands and the full tested SHA are printed. Allow roughly 2 GB of free
space per run in addition to the working checkout and its dependencies.

The negative run temporarily reopens the tracked fixture tree and must be rejected by
the deployment privacy guard before installation. This proves private/source-audit
fixtures cannot enter a Vercel upload. The positive run executes the normal filtered
Vercel build, including exact-case registry and build-input validation. If the registry
adds an external manifest import later, the guard discovers it and requires that exact
file; the current registry uses sanitized inline metadata and deploys no fixture files.

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

### Dependency warning inventory (2026-10-11)

Inspected independently of deployment filtering. No existing dependency was upgraded,
overridden, removed or silenced. The only added package is the deployment harness's
small, exact Vercel-compatible ignore parser.

Commands: `npm explain whatwg-encoding inflight glob --json` in each package root;
`npm view <parent>@latest version dependencies engines deprecated --json` and the npm
registry's version metadata for the latest compatible parent releases.

| Package root | Exact installed version | Parent chain |
| --- | --- | --- |
| Root | whatwg-encoding 3.1.1 | @wdio/cli 9.32.0 → webdriverio 9.32.0 → cheerio 1.2.0 → encoding-sniffer 0.2.1 → whatwg-encoding 3.1.1 |
| Root | inflight 1.0.6 | @wdio/mocha-framework 9.32.0 → mocha 10.8.2 → glob 8.1.0 → inflight 1.0.6 |
| Root | glob 8.1.0 | @wdio/mocha-framework 9.32.0 → mocha 10.8.2 → glob 8.1.0 (nested under mocha) |
| Root | glob 10.5.0 | @wdio/config 9.32.0 → glob 10.5.0 (root node_modules) |
| Web | None of the three | npm explain exits 1 with “No dependencies found matching”; the web lock contains none of them |

The shared @wdio/config 9.32.0 is reached through @wdio/cli 9.32.0,
webdriverio 9.32.0, webdriver 9.32.0 and the runner 9.32.0 beneath
@wdio/local-runner 9.32.0. The webdriverio chain is also reachable through peer links
from @wdio/globals 9.29.1 / nested 9.31.3 and expect-webdriverio 5.7.0 / nested 6.1.0.
These are alternate paths to the same versions, not additional warning-package versions.
Both local package roots were reinstalled successfully with npm ci on Node 22.23.1 /
npm 10.9.8, then the explain commands were repeated in this isolated worktree. An earlier
web install hit ENOSPC; only its incomplete generated node_modules was removed before
the successful fresh installation after disk headroom recovered.

Available remediation, deliberately separate from this deployment-input change:

- **whatwg-encoding:** 3.1.1 is its latest and is deprecated. encoding-sniffer 1.0.2
  uses @exodus/bytes, but cheerio's latest 1.2.0 still requires ^0.2.1. Even webdriverio
  10.0.2 retains cheerio. Wait for or contribute the parent update, or separately test
  a supported parent migration. A transitive major override is not a demonstrated fix.
- **inflight / glob 8:** latest compatible @wdio/mocha-framework 9.32.0 still requires
  mocha ^10.8.2. Framework 10.0.1 requires mocha ^12.0.2; mocha 12.0.3 uses glob ^13.0.0
  without inflight. A coordinated WebdriverIO 10 migration can remove this chain, but
  needs its own API/peer and live browser-audit validation.
- **glob 10:** 10.5.0 is the latest 10.x. Even @wdio/config 10.0.1 still requests
  glob ^10.2.2. Glob 13.0.6 is available but outside the parent's range. A WebdriverIO
  major upgrade alone does not remove this warning; a compatible upstream change is
  still needed. Do not force glob 13 into an untested caller.

Deprecation is not itself a vulnerability finding. The current root audit reports
20 high findings across development tooling; the deployment harness introduces none.
Web's full audit reports source-map-js high (development tooling) and three moderate
mammoth/argparse/sprintf-js findings; the latter remain in the production dependency
audit. These findings remain unresolved and require a separate scoped dependency
maintenance change. Production dependency audits and existing quality gates remain enabled.

### Historical validated checkpoint

Code tested: `af21e9b29580d8530a436ececd9b134fec928cbe`, on
`fix/deployment-input-reliability`, based on integration `baf340bd`.
[Linux CI run 38141538198](https://github.com/jaclose/AXOM/actions/runs/38141538198)
passed all three jobs: deployment-inputs, web and native. Later documentation-only
commits record this evidence; they do not imply a different code revision was tested.
The GOER allowlist and missing-manifest commands below describe that historical revision;
their retired flags are not part of the current verifier interface.

| Exact command | Result / environment |
| --- | --- |
| `npm ci` and `npm --prefix web ci` | Both pass, macOS and Ubuntu 24.04; Node 22.23.1 / npm 10.9.8 |
| `npm run test:deployment` | Seven regressions pass on macOS and Linux |
| `npm run verify:deployment -- --without-goer-allowlist --expect-build-failure` | Linux: 1,050 filtered files; actual web build fails with all three required GOER TS2307 errors; harness confirms expected failure |
| `npm run verify:deployment` | Linux: 1,053 filtered files; both fresh installs, exact-case guard, TypeScript, Vite and bundle verification pass |
| `npm run verify:deployment -- --ignore-ref c23e8c2^ --expect-build-failure` | macOS at e2ebc8aa: exact historical ignore file, 1,089 files (older rules admitted more scripts); same three real TS2307 errors reproduced |
| `npm run test:release` | 79 root tests pass, including 43 repository tests and seven deployment regressions |
| `npm run typecheck:api` and `npm run repo:check` | Pass locally and in Linux CI |
| `npm --prefix web run quality` | Linux: typecheck, lint, 2,910 tests (five existing skips) and build pass |
| `npm --prefix web run test:e2e -- e2e/native-package-zip.spec.ts` | Linux Chromium: actual ZIP import, required decoded image, quiz, answers, saved result and reload pass; local installed Chrome also passes |
| `npm --prefix web run verify:app-updates` and `npm --prefix web run verify:daily-games-offline` | Linux production-browser checks pass |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | Linux: pass |
| `cargo check --manifest-path src-tauri/Cargo.toml --locked` | Linux: pass |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib --locked` | Linux: 16 pass |
| `npm --prefix web audit --omit=dev --audit-level=high` | Passes threshold with three existing moderate findings; root `npm audit --omit=dev` reports zero |

The first CI run at e2ebc8aa exposed an existing instant `img.count()` race in the ZIP
browser test. The corrected test explicitly waits for the fixture's required image and
checks decoded pixels; no assertion was removed, relaxed or skipped. The negative
deployment test deliberately prints TS2307 (including three GitHub error annotations);
it fails if those real errors are absent or if dependency installation itself fails.

Not verified: hosted Vercel preview, axom.info browser behavior, Windows/macOS signed
release packaging or native app launch. No production deployment, remote settings
mutation, dependency maintenance upgrade, main update or integration merge occurred.
