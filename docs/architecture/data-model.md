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

If both the vault write and the plain localStorage fallback fail, the active
workspace can use a separate `noctyrium-state:packed-fallback:v1` record. This
self-contained envelope binds the local profile, logical workspace fingerprint,
previous vault base and unchanged legacy fallback records. It uses bounded gzip
decoding, an expanded-byte count, SHA-256 and exact write/readback verification.
It leaves existing raw records and safety backups in place; it does not free
space by pruning them. Missing codec support, corrupt bytes, account mismatch or
a competing commit fails visibly. Compression and readback recheck concurrent
changes before acknowledging a save. Only the same captured packed record can
be retired after a successful vault promotion or explicit verified restore.
Older clients cannot read this additional record, so conflicting older-client
writes are held for recovery rather than silently selecting a stale workspace.

Captured-backup inspection and update checkpoints use the same read-only
workspace selector, including the packed record's identity and base checks.
The active-workspace envelope is independent from compressed safety snapshots;
neither changes backup retention or the required-image persistence gate. Browser
usage/quota estimates and an open IndexedDB connection do not prove a write will
fit. The visible local-save receipt and latest failure describe the actual
outcome; compression can still fail for lack of room.

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
Saved-work exports keep deferred source metadata outside the scoring engine and read
only local binary caches. Restoring such a copy reuses exact source-digest retention;
the imported personal overlay wins without fetching or discarding matching local bytes.

Existing legacy binary ownership receipts are read with a read-only IndexedDB
transaction, so access does not depend on the store accepting writes. Only an
absent receipt enters a readwrite transaction, which rechecks before creating
the permanent owner or null receipt. Concurrent receipts keep precedence; a
failed read or uncommitted write never grants access from the boot-time hint.
This applies to the shared image/original-file ownership check without changing
account scope, blob hashes, cloud fallback, binary rows or required-image saves.

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

Automatic safety backups use a self-contained, versioned compressed localStorage
envelope when IndexedDB cannot accept the snapshot and compression reduces its size.
Restoration checks the bounded expanded size, SHA-256, wrapper identity and exact
saved readback; legacy plain snapshots remain readable. Retention and migration run
only after a new durable copy succeeds. Compression does not guarantee available
quota and never substitutes for a successful save.

Recovery from a captured backup compares its two storage tiers using the saved
newer-fallback marker. A valid marker can supersede its recorded vault base; a
different committed vault record keeps precedence. Unmarked mirrors retain the
existing vault-first behavior, while corrupt or ambiguous marked copies are refused.
Inspection is read-only and does not change the live vault's conflict policy.

Preserve Noctyrium keys/type compatibility. Coordinate schema changes first, migrate
additively, and test old imports/defaults. Do not infer an atomic cross-store guarantee
from an action name; follow write/flush/error behavior in the relevant boundary.

Focused tests: `localVault.test.ts`, `localVault.packedFallback.test.ts`,
`storeMigrations.test.ts`, `storageRecovery.test.ts`,
`backup.test.ts` and affected sync snapshot/migration tests under `web/src/lib/`.
`web/scripts/verify-app-updates.mjs` checks checkpoint/update behavior. The 2,857-line
baseline `store.ts` is a future incremental refactor candidate, not a reason to read
or split it wholesale for every feature task.
