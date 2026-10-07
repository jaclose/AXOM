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
| The workspace is over the size limit | Measured on the device (14 MB of compact JSON; the account's limit is 15 MB of its own, slightly longer, text). Nothing is sent. Measured again after the next change. |
| The learner presses Protect now / Try again | Runs at once, whatever the wait. |

The wait is stored in the device's sync bookkeeping (`axom.sync.metadata.v1`: `nextAttemptAt`, `lastAttemptAt`, `lastError`), so a reload, a second tab, a reconnect or a new local change cannot shorten it. One tab uploads at a time (Web Locks, `axom.sync.upload`); the others follow the shared state through the `storage` event. An upload gives up after 45 s plus time for a slow uplink (five minutes at most), so a silent connection cannot hold "Syncing" for ever.

Failures are sorted by what the account said, not by the HTTP status alone (`syncFailure.ts`). PostgREST maps SQLSTATE to status (class 54 and 57 become 500, P0001 becomes 400, PTxyz becomes xyz), so a refusal can arrive looking like a server error. The bookkeeping stores the kind, the HTTP status and the SQLSTATE of the last failure, never the account's message or any content. Settings > Account shows a plain sentence, and Technical details shows the codes.

The server function answers with exactly two shapes, `accepted` and `conflict`. Anything else is an exception. The client treats an answer it cannot read as a failure; clients before 2026-10-01 read any unknown shape as "accepted", so a new shape must never be added without a new function name.

### Why this section exists (2026-09-30)

The storage bound added on 2026-09-28 refused every new revision once an account's retained history passed 50 MB, raised as SQLSTATE 54000, which PostgREST reports as HTTP 500. A 9.6 MB workspace reached the cap after five revisions and was refused from then on. The client treated every failure as a blip and re-sent the whole workspace on a 1 s to 60 s clock and again 8 s after every local change, from every tab. Full record: `docs/release/2026-10-01-ACCOUNT-SYNC-INCIDENT.md`.

## Sharing model

Question Set shares are immutable, unlisted snapshots with 192-bit random tokens. They retain resolved ordered membership. The payload allow-list includes stems, options, correct mapping, explanations/rationales, safe tags/topics, and optional citation. It excludes attempts, answers selected by the learner, notes, highlights, annotations, analytics, course association, source filenames, local paths, attachments, and owner email. Import remaps IDs and reuses only deterministic exact duplicates. Revocation stops future resolution but cannot delete a recipient-owned copy already imported.

## Evolution

- V1: Local Vault plus versioned server snapshots and dedicated Question Set share records.
- V2: record-level sync journal and tombstones for high-value domains. This is also what makes large workspaces cheap: today every change re-sends the whole workspace, so the cost of protection grows with the workspace, not with the change.
- V3: domain-aware multi-device reconciliation.

Binary question attachments and AI-generation artifact bytes remain local-only in V1; the JSON snapshot protects their metadata, not their bytes. A future private object-storage design must add ownership policies, content hashing, and restore validation before claiming binary protection.
