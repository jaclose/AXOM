# AXOM Accounts & Sync V1

AXOM remains local-first. IndexedDB Local Vault is the immediate interactive store and manual JSON export/import remains an emergency portable recovery path. A signed-in account adds server-acknowledged, immutable protected versions; it never makes network availability a prerequisite for ordinary work.

```text
React/Zustand → IndexedDB Local Vault → persisted pending revision
                                      → Sync Coordinator → Supabase RPC
                                                           ├─ workspace revision history
                                                           ├─ conflict preservation
                                                           └─ private Question Set snapshot shares
```

## Provider decision

Supabase was selected over the existing custom Neon API, Firebase, and Clerk plus a separate database. The repository already deploys a browser SPA and needs managed authentication, relational Postgres, migrations, row-level authorization, atomic RPCs, and private share records. Supabase supplies those boundaries without custom password handling. Firebase makes ordered relational history and authorization testing less natural; Clerk would still require a database and authorization layer; the custom Neon scaffold currently lacks enforced session ownership on data routes.

## Safety model

- The browser writes locally first. Network work is asynchronous.
- Auth sessions are owned by the Supabase client and are never serialized into the Workspace or JSON backup.
- Sync metadata contains only a random device UUID, base revision, retry state, idempotency key, hash, and account UUID association.
- SHA-256 content hashes identify snapshots. Retries reuse their persisted idempotency key.
- The server transaction locks the workspace row and accepts a write only when `base_revision` equals the current revision.
- A stale writer is retained as a conflict revision; it never overwrites the canonical revision.
- Server history retains the latest 60 canonical revisions. Historical rows are immutable from the client.
- Restore validates the portable Workspace shape, creates a local safety snapshot, confirms replacement, persists locally, and submits the result as a new revision.

## Sharing model

Question Set shares are immutable, unlisted snapshots with 192-bit random tokens. They retain resolved ordered membership. The payload allow-list includes stems, options, correct mapping, explanations/rationales, safe tags/topics, and optional citation. It excludes attempts, answers selected by the learner, notes, highlights, annotations, analytics, course association, source filenames, local paths, attachments, and owner email. Import remaps IDs and reuses only deterministic exact duplicates. Revocation stops future resolution but cannot delete a recipient-owned copy already imported.

## Evolution

- V1: Local Vault plus versioned server snapshots and dedicated Question Set share records.
- V2: record-level sync journal and tombstones for high-value domains.
- V3: domain-aware multi-device reconciliation.

Binary question attachments and AI-generation artifact bytes remain local-only in V1; the JSON snapshot protects their metadata, not their bytes. A future private object-storage design must add ownership policies, content hashing, and restore validation before claiming binary protection.
