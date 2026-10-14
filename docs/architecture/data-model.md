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
portable workspace data. Legacy cloud snapshots protect attachment metadata only. The
[private recovery format 2](accounts-sync-v1.md#private-recovery-format-2) adds verified,
owner-scoped source objects and question/review images without changing schema 34.
Other generated-media bytes retain their existing local-only behavior.

The optional `deferredContent` field keeps account-bound source metadata and immutable
references outside canonical questions/documents until an explicit verified download.
It is persisted and preserved in safety snapshots, cleared by deliberate replacement,
and resolved for full portable export. It never supplies partial questions to scoring.
See [metadata checkpoints](accounts-sync-v1.md#metadata-checkpoints-and-explicit-content-downloads).

Original source binaries remain outside the workspace schema. Decode's existing
`axom-decode-originals-v1` database accepts legacy Blob values and immutable
`["version", documentId, checksum]` entries with a current-edition pointer. Portable
ZIP format 2 carries verified originals separately; JSON and format-1 ZIP remain
readable. See [original recovery](../features/academic-library.md#original-files-and-portable-recovery).

Daily challenge delivery keeps only a versioned, account/challenge-scoped launch
reference in the existing Local Vault. Its session ID resolves canonical `quizSessions`;
no parallel answer or progress engine exists. Web Locks serialize creation/retirement.
A resumed view requires explicit verification of already-saved answers; server event
identities survive a lost acknowledgement. The reference itself is device-only, while
canonical quiz history keeps its existing backup and account behavior. See
[daily challenges](../features/academic-library.md#verified-daily-challenges).

A later failed fallback save preserves the marker for the last successful fallback;
otherwise a reload could prefer an older vault record. Reviewed imports wait for both
image bytes and the workspace's image associations before counting an image as attached.
A failed association is reported without discarding the questions already saved.

Preserve Noctyrium keys/type compatibility. Coordinate schema changes first, migrate
additively, and test old imports/defaults. Do not infer an atomic cross-store guarantee
from an action name; follow write/flush/error behavior in the relevant boundary.

Focused tests: `localVault.test.ts`, `storeMigrations.test.ts`, `storageRecovery.test.ts`,
`backup.test.ts` and affected sync snapshot/migration tests under `web/src/lib/`.
`web/scripts/verify-app-updates.mjs` checks checkpoint/update behavior. The 2,857-line
baseline `store.ts` is a future incremental refactor candidate, not a reason to read
or split it wholesale for every feature task.
