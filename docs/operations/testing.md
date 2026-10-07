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

Use Node from `.nvmrc` (22.23.1 on this maintenance checkout). Repository checks use
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

Full web integration gate, required before integration/release:

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
production dependency audit and native checks. It does not currently run the general
Playwright E2E suite; do not equate CI green with the full local gate.

Do not retry unrelated failures blindly. Reproduce them on the base revision, capture
an exact failing test/command, and keep scope clear. Known environment traps and
production-state limits are in [troubleshooting](troubleshooting.md).
