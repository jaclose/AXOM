---
tags:
  - axom/decision
authority: canonical
---
# 002: Local workspace with optional account protection

**Status:** records the existing implementation at base `9f29327`, not a new product decision.

**Context:** Historical readmes describe name-only Postgres sync and SQLite-primary
persistence. Current source instead uses Local Vault persistence and optional Supabase
accounts with revision-based conflict handling.

**Decision:** Preserve local work, portable JSON backup and compatibility storage keys.
Treat cloud account protection as additive. Retired name/PIN account/data APIs remain
410 tombstones. Keep the canonical native shell at root `src-tauri/`.

**Reason:** Signing in, changing deployments or refreshing code must not silently
replace a learner's workspace. See the authoritative [accounts safety model](../architecture/accounts-sync-v1.md)
and [data map](../architecture/data-model.md) for implementation and tests.

**Consequences:** Validate migrations, push policy/conflict behavior and backup compatibility
when changing persisted data. Never infer live database configuration from repository files.
