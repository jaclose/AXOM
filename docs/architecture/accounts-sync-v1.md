---
tags:
  - axom/architecture
authority: canonical
---
# AXOM Accounts & Sync V1

AXOM remains local-first. IndexedDB Local Vault is the immediate interactive store and manual JSON export/import remains an emergency portable recovery path. A signed-in account adds server-acknowledged, immutable protected versions; it never makes network availability a prerequisite for ordinary work.

Extends: [workspace persistence](data-model.md). Governed by:
[additive account protection](../decisions/002-local-workspace-and-accounts.md).

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
- Server history keeps the newest canonical revisions that fit in 50 MB of stored size per account, at most 60 and never fewer than the newest three. Older revisions are pruned when a new one is accepted; a new revision is never refused because history is full. Historical rows are immutable from the client.
- Restore validates the portable Workspace shape, creates a local safety snapshot, confirms replacement, persists locally, and submits the result as a new revision.

## Upload policy and failure behaviour

Background protection is a courtesy, never a loop. Every number that bounds it lives in `web/src/lib/sync/syncPolicy.ts`.

| Situation | What the device does |
| --- | --- |
| Things work | Uploads 8 s after the last change, and no more than about 5 MB a minute (a 10 MB workspace: at most one upload every two minutes). An unchanged workspace is not uploaded. |
| An upload fails (no network, a timeout, a 5xx, an expired session) | Waits 5 s, 15 s, 45 s, 2 min, 5 min, 15 min (each spread by a fifth), then one try every half hour. Status: Retrying, then Retrying later. |
| The account refuses the upload (it would refuse the same upload again) | Does not repeat it. One try an hour, in case the account was repaired. Status: Not protected, with the reason. |
| The workspace is over the size limit | Measured on the device (14 MB of the compressed checkpoint and reference metadata; the account's limit is 15 MB of its own, slightly longer, text). Nothing is sent. Measured again after the next change. |
| The learner presses Protect now / Try again | Runs at once, whatever the wait. |

The wait is stored in the device's sync bookkeeping (`axom.sync.metadata.v1`: `nextAttemptAt`, `lastAttemptAt`, `lastError`), so a reload, a second tab, a reconnect or a new local change cannot shorten it. One tab uploads at a time (Web Locks, `axom.sync.upload`); the others follow the shared state through the `storage` event. The revision RPC has a bounded deadline. Private object requests have a two-minute deadline each; an initial large library can take multiple requests and substantially longer than one ordinary checkpoint. A failed transfer retains local originals and retries immutable object paths.

Failures are sorted by what the account said, not by the HTTP status alone (`syncFailure.ts`). PostgREST maps SQLSTATE to status (class 54 and 57 become 500, P0001 becomes 400, PTxyz becomes xyz), so a refusal can arrive looking like a server error. The bookkeeping stores the kind, the HTTP status and the SQLSTATE of the last failure, never the account's message or any content. Settings > Account shows a plain sentence, and Technical details shows the codes.

The server function answers with exactly two shapes, `accepted` and `conflict`. Anything else is an exception. The client treats an answer it cannot read as a failure; clients before 2026-10-01 read any unknown shape as "accepted", so a new shape must never be added without a new function name.

### Why this section exists (2026-09-30)

The storage bound added on 2026-09-28 refused every new revision once an account's retained history passed 50 MB, raised as SQLSTATE 54000, which PostgREST reports as HTTP 500. A 9.6 MB workspace reached the cap after five revisions and was refused from then on. The client treated every failure as a blip and re-sent the whole workspace on a 1 s to 60 s clock and again 8 s after every local change, from every tab. Full record: `docs/release/2026-10-01-ACCOUNT-SYNC-INCIDENT.md`.

## Sharing model

Question Set shares are immutable, unlisted snapshots with 192-bit random tokens. They retain resolved ordered membership. The payload allow-list includes stems, options, correct mapping, explanations/rationales, safe tags/topics, and optional citation. It excludes attempts, answers selected by the learner, notes, highlights, annotations, analytics, course association, source filenames, local paths, attachments, and owner email. Import remaps IDs and reuses only deterministic exact duplicates. Revocation stops future resolution but cannot delete a recipient-owned copy already imported.

## Evolution

- V1: Local Vault plus versioned server snapshots and dedicated Question Set share records.
- Cloud format 2: compact personal checkpoint, separate immutable source content and private question images. This is an additive recovery format, not a canonical workspace schema change.
- Pending academic-library work: shared revision references, incremental per-attempt sync, paged content and bounded offline course downloads.
- Later: domain-aware multi-device reconciliation. Concurrent unprotected edits still use explicit conflict resolution.

## Private recovery format 2

`cloudSnapshot.ts` keeps personal records in a lossless gzip envelope when compression saves bytes. `cloudContent.ts` removes document raw/page text and question source fields from that envelope and stores them once under `workspace-content/{account UUID}/{SHA-256 of packed bytes}`. Notes, attempts, highlights, flags and other learner overlays stay in the private checkpoint. Unchanged source objects are reused; source projections are cached for unchanged record identities. Full source hydration and a canonical SHA-256 check precede restoring a recovery version.

`cloudMedia.ts` uses `workspace-media/{account UUID}/{SHA-256 of original bytes}` for question and retained review images. Originals remain unchanged. Deduplication is within an account, never an authorization shortcut across accounts. The image manifest must exactly match the workspace's required image references. Images download on first display, verify size and hash, and enter the existing offline/export attachment store. A complete portable export intentionally resolves all referenced images; an offline device without every image cannot produce a complete media backup.

Both buckets are private. Owner-path RLS permits read, insert and explicit deletion, with no update/upsert policy. The format-2 RPC requires referenced objects and their declared sizes before accepting a revision. It calls the existing atomic revision writer for conflict handling, idempotency and bounded history. Files are limited to 8 MiB each; referenced unique images to 2 GiB, image references to 20,000, source references to 30,000 and expanded workspace text to 256 MiB. These are safety bounds, not a promise of provisioned account quota. Unreferenced objects from interrupted uploads are retained for resumability; automatic garbage collection is not implemented. Explicit cloud-account deletion uses the Storage API before removing revision records.

Each storage/restore operation captures the starting account token and rejects an account change. A linked unchanged device checks for newer protected revisions on focus, reconnect and a one-minute interval. A local edit, pending upload or unresolved conflict prevents automatic replacement. Edits during upload remain pending under a fresh idempotency key after the older snapshot is acknowledged.

The canonical schema remains 34. Existing plain local backups and legacy cloud snapshots remain readable. New local safety snapshots are compressed; the active workspace remains in the existing Local Vault representation. Failed local saves are shown as failures, not green success badges. A stale-route reload verifies a current local checkpoint before reloading.

### Activation and rollback boundary

Apply `20261011173750_private_workspace_media.sql` to an authorized test backend first, then deploy the matching frontend after two-account Auth/Storage acceptance. The migration does not rewrite existing accounts or upload their files. The first accepted format-2 checkpoint makes the old upload RPC refuse further legacy snapshots for that account. Old clients also cannot parse a format-2 recovery payload; they must update. Do not roll back to an older client after adoption without exporting a verified portable backup and planning the compatibility transition. Keep private files out of public release artifacts. Production migration/deployment require separate approval.

This format only covers source text and question/review images. Other generated binary artifacts retain their existing local-only behavior. Recovery is whole-source hydration; it does not establish catalog-first academic bootstrap or per-answer record-level traffic. Those belong to the academic-library contract and require separate integration acceptance.

## Local service acceptance

The opt-in `src/lib/sync/backend.local.test.ts` requires `AXOM_LOCAL_SUPABASE_STATUS`
pointing to a private native-stack status JSON and refuses hosted URLs. It creates
only synthetic accounts, verifies private source and image round trips through real
Auth/REST/Storage, denies cross-account access and overwrite, and proves idempotent
revision acknowledgement. It never resets users or storage. Keep status files and
credentials outside Git. This recovery test does not establish incremental academic
sync or production readiness.
