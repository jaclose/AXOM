---
tags:
  - axom/architecture
authority: canonical
---
# Workspace data and persistence

**Purpose:** Preserve a learner's local workspace, support portable JSON export and
optional cloud protection without replacing local work on sign-in.

Governed by: [local workspace with additive account protection](../decisions/002-local-workspace-and-accounts.md).

| Responsibility | Source of truth |
| --- | --- |
| Workspace domain shape | `web/src/lib/types.ts` (`NoctyriumState`) |
| Current schema and defaults | `web/src/lib/seed.ts` (`SCHEMA_VERSION`, 34 at the migration baseline) |
| Actions, persisted selection, normalization | `web/src/lib/store.ts` (`useStore`, `partialize`, `migratePersistedState`) |
| Local Vault writes, flush and failure checks | `web/src/lib/localVault.ts` |
| Boot-time migration/recovery | `storageMigrations.ts`, `storeHydration.ts`, `storageRecovery.ts` under `web/src/lib/` |
| Portable state, attachments, import/merge | `web/src/lib/backup.ts` (`toPortableState`, `exportStateWithAttachments`, `parseImport`, `mergeStates`) |
| Local recovery and update checkpoints | `web/src/lib/localBackup.ts`, `updateCheckpoint.ts` |
| Account revision sync | [Accounts contract](accounts-sync-v1.md), `web/src/lib/sync/` |

IndexedDB-backed Local Vault is primary persisted workspace storage, with the existing
fallback/recovery paths. Native SQLite is used by update checkpoint support; it is not
a replacement for normal Zustand/Local Vault persistence. A save that cannot reach
IndexedDB is written to localStorage beside a marker; the next start reads that marked
copy first and moves it into the vault, so a stale IndexedDB copy never shadows it. While
a vault upgrade waits on another tab, later saves go to that fallback instead of queueing
behind it. A save that reaches neither store is reported to the learner
(`vaultActivity.ts`, `components/shell/VaultSaveWatcher.tsx`). Account sessions are outside
portable workspace data. Cloud revision snapshots do not imply upload of local attachment
or generated-media binary bytes.

Preserve Noctyrium keys/type compatibility. Coordinate schema changes first, migrate
additively, and test old imports/defaults. Do not infer an atomic cross-store guarantee
from an action name; follow write/flush/error behavior in the relevant boundary.

Focused tests: `localVault.test.ts`, `storeMigrations.test.ts`, `storageRecovery.test.ts`,
`backup.test.ts` and affected sync snapshot/migration tests under `web/src/lib/`.
`web/scripts/verify-app-updates.mjs` checks checkpoint/update behavior. The 2,857-line
baseline `store.ts` is a future incremental refactor candidate, not a reason to read
or split it wholesale for every feature task.
