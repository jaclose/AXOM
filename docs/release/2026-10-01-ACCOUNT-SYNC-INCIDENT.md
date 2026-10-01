# Account uploads refused in production (2026-09-30 to 2026-10-01)

Status: **fix built and verified locally; production needs one database migration and a deploy.** Both are JD's to run (see "What production needs").

## What happened

From about 2026-09-30 05:52 UTC an account with a large workspace could no longer be protected. Every call to `rpc/push_workspace_revision` answered HTTP 500, and the app kept sending the whole workspace again: dozens of failures in one session. Local work was never at risk (AXOM saves on the device first); the cloud copy simply stopped moving.

## What was found

| Evidence | Where it comes from |
| --- | --- |
| The device's sync bookkeeping: upload pending, retry counter at its maximum, last protected 2026-09-30 05:51:42 UTC, base revision 71, no conflict | `axom.sync.metadata.v1` on the affected device (bookkeeping only) |
| The workspace is 9,628,115 bytes of JSON: questions 5.98 MB (1,258 questions; 3.7 MB of that is import provenance snippets), profile 2.54 MB (one 2.5 MB profile photo stored as a data URL), documents 0.50 MB | measured on the device |
| The deployed function refuses a new revision when the newest 59 plus the new one pass 50,000,000 bytes, with SQLSTATE 54000 | `supabase/migrations/20260928130000_bound_account_snapshot_storage.sql`; the function ACL it sets is live in production (an anonymous call answers 401 / 42501) |
| PostgREST reports SQLSTATE class 54 as HTTP 500 | PostgREST's error table |
| The same refusal locally: an 8 MB workspace is accepted six times, then refused with 54000 on every later call | every migration replayed on PGlite (real Postgres); kept as tests in `supabaseMigrations.pglite.test.ts` |
| The client retried any failure for ever on a 1 s to 60 s clock, and again 8 s after every local change, from every tab, each time uploading the full snapshot | `web/src/lib/sync/syncCoordinator.ts` before this fix |
| 13 uploads in two minutes from one tab (a change every 20 s, account always refusing); 1 after the fix | a real browser against a stand-in account |

Not observed directly: the body of a failing production response for the affected account. Nothing was sent to production on that account's behalf during the investigation. To confirm in ten seconds: open DevTools > Network on the affected device, pick a failing `push_workspace_revision`, and read the response (`"code":"54000"`); or, after the client deploy, Settings > Account > Technical details shows the HTTP status and code of the last failure.

One more cost of the old function, also removed: on every call it converted every retained snapshot to text to measure it. With a history of multi-megabyte snapshots that is tens to hundreds of megabytes of work per upload attempt, and under load it can run into the statement timeout (also an HTTP 500).

## Root cause

Two mistakes that needed each other.

1. **Server:** a storage bound was enforced by refusing the newest snapshot, the one thing an account exists to protect, and the refusal was raised with a SQLSTATE that reads as a server error. An account already over the bound when it was introduced was refused from the first call.
2. **Client:** every failure was treated as temporary. There was no notion of "the account said no", no limit on tries, no memory of the wait across reloads or tabs, and a new local change restarted the upload regardless.

## The fix

Server, `supabase/migrations/20261001090000_prune_revision_history_within_budget.sql` (replaces one function; same signature, same two answers, safe to run twice):

- History is pruned oldest-first to fit 50 MB of stored size (at most 60 revisions, never fewer than the newest three). A new revision is never refused because history is full.
- Size is read with `pg_column_size` on the stored column (the TOAST pointer), so no retained snapshot is read back or converted.
- At the conflict limit the caller still gets a `conflict` answer; the server just does not store another copy.
- An oversized snapshot is SQLSTATE `PT413` (HTTP 413).
- A retry whose first attempt was preserved as a conflict stays a conflict (it used to answer "accepted"). A replayed retry returns the stored content hash.

Client:

- `web/src/lib/sync/syncFailure.ts` sorts a failure by what the account said. A refusal is not repeated, whatever status it arrives with.
- `web/src/lib/sync/syncPolicy.ts` holds every bound: about 5 MB a minute while things work; 5 s, 15 s, 45 s, 2 min, 5 min, 15 min after failures, then every half hour; once an hour after a refusal. "Protect now" always runs at once.
- The wait is stored with the pending state, so reloads, tabs, reconnects and new changes cannot shorten it. One tab uploads at a time. An unchanged workspace is not uploaded. An upload gives up after a bounded time.
- Settings > Account says what happened in plain words ("Not protected", "Retrying later") and when AXOM tries next; the codes are in Technical details.
- A large profile photo is stored at display size (`web/src/lib/avatarImage.ts`): 2.5 MB becomes a few tens of kilobytes, a quarter of the affected workspace.

Regression coverage: `supabaseMigrations.pglite.test.ts` (history pruned to budget, an account already over the bound recovers, conflict limit, 413, retries), `syncCoordinator.test.ts`, `syncPolicy.test.ts`, `accountStore.test.ts`, and a browser replay of the incident, `web/e2e/accounts-sync-failure.spec.ts`.

## What production needs (JD)

Order matters only a little: the migration alone restores uploads for clients already deployed; the client alone stops the repeated uploads but stays "Not protected" until the migration is in.

1. **Apply the migration.** Either paste the file into the Supabase SQL editor (project `AXOM Production`) and run it, or from a linked checkout: `npx supabase db push`. If the project's GitHub integration deploys migrations from `main`, pushing `main` does this step. Effect to know about: the next accepted upload on an account over the bound removes its oldest protected versions beyond what fits in 50 MB. Nothing on any device changes.
2. **Push `main`** (deploys the web client).
3. **Check:** on the affected device open Settings > Account. It should read Protected within a minute or two (or press Try again). Protected versions should list a new revision. In the Supabase dashboard, API logs for `push_workspace_revision` should show 200s and no 500s.

Until then, to stop the repeated uploads from a device still running the old client: close extra AXOM tabs, or sign out of the AXOM account on that device (local work stays).

## Follow-ups (logged in `docs/directions/05-FUTURE.md`)

- Uploading the whole workspace on every change does not scale; the record-level journal (accounts-sync V2) is the real answer.
- Import provenance snippets are 3.7 MB of a 9.6 MB workspace and mostly repeat the stem and explanation.
- History under a byte budget is short for a large workspace (about ten versions at 5 MB stored each). Thinning (keep hourly, then daily versions) would make the same budget cover weeks.
- `create_question_set_share` still reports its storage limit as SQLSTATE 54000 (HTTP 500). It is a deliberate user action, not a loop, but the status is wrong.
- Build the snapshot off the main thread and serialise it once (it is stringified twice today).
