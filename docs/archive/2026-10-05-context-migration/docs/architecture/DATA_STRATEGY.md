# AXOM Data Strategy & Persistence

This document outlines the "Bulletproof" data architecture to ensure zero data loss and seamless migration as the app evolves.

## 1. The Persistence Hierarchy
AXOM uses a multi-layered storage approach to balance speed and durability.

### Layer 1: Reactive State (Zustand)
- **Purpose**: UI state, current session data, transient filters.
- **Lifecycle**: In-memory, mirrored to Layer 2.

### Layer 2: Local Vault (IndexedDB / SQLite)
- **Purpose**: Primary storage for Anki cards, Question Bank, Activity Logs.
- **Implementation**: `storageService.ts` $\rightarrow$ `nativeSqlite.ts`.
- **Guarantee**: Every "Save" action is an atomic transaction.

### Layer 3: Hard Backup (JSON/File)
- **Purpose**: Disaster recovery and cross-device sync.
- **Mechanism**: `localBackup.ts` exports the entire vault to a timestamped JSON file in the user's Downloads/Backup folder.

## 2. The Migration Engine (Bulletproofing)
As the schema changes (e.g., adding `priority` to Anki cards), the app must migrate data without wiping it.

### Migration Flow
1. **Version Check**: On boot, `storageMigrations.ts` compares `storageSchemaVersion` in `localStorage` vs the current build's version.
2. **Linear Execution**: Migrations are run as an ordered array: `[m1, m2, m3]`.
3. **Snapshotting**: Before a major migration, the app takes a `preMigrationSnapshot` to allow 1-click rollback if the migration fails.

## 3. Data Integrity Checks
To prevent "corrupt state" bugs:
- **Checksums**: Every large export/import uses `checksum.ts` to verify file integrity.
- **Orphan Repair**: `orphanRepair.ts` runs on boot to find cards/logs that lost their parent course/session and re-assigns them to a "Recovered" folder.
