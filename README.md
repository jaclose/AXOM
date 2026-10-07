# AXOM

AXOM is a local-first study workspace: question import and practice, course tracking,
focus sessions, journal and study planning. The current application is React/TypeScript
in `web/`, with the canonical Tauri desktop shell in `src-tauri/`.
Optional accounts and workspace protection use Supabase. JSON export remains available
without an account. Noctyrium compatibility names and storage keys preserve existing data.

## Run

Use Node 22 (`.nvmrc`), then:

```sh
npm --prefix web ci
npm --prefix web run dev
```

For native, backend and environment setup see [development](docs/operations/development.md).
Package versions live in `package.json` and `web/package.json`; the workspace schema lives
in `web/src/lib/seed.ts`. Deployment state must be checked independently of these values.

## Find what you need

- Coding agents: [AGENTS.md](AGENTS.md), then [current state](docs/AI_STATE.md).
- Architecture, features, operations and history: [context router](docs/INDEX.md).
- Product principles: [product routes](docs/product/README.md).
- Validation: [testing](docs/operations/testing.md); full gate is `cd web && npm run verify:all`.
- Releases and packaging: [deployment](docs/operations/deployment.md).

The old name/PIN Vercel account and data endpoints are retired (HTTP 410). Do not use
their historical setup instructions for new accounts. [Accounts architecture](docs/architecture/accounts-sync-v1.md)
is the current contract; configuration and dated deployment notes are in [account setup](docs/ACCOUNTS-SETUP.md).

The Swift prototype and historical planning remain available. Their claims describe
their original checkpoints, not current release status. [Archive routes](docs/archive/README.md)
include the exact pre-migration README for historical file-and-line citations.
