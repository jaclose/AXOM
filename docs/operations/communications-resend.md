# AXOM Communications: Resend and Supabase activation

This runbook is for the operator or next AI after the local implementation is reviewed.
It contains manual actions, not evidence that a production system is connected.
Do not send a broadcast as a configuration test. Start with a dedicated allowlisted
recipient and disposable account. User authorization is required for external sends,
production deployment or destructive live-account validation.

## 1. Review and integrate the committed branch

Use `feat/axom-communications-pulse`. Inspect live ownership first. The course/QBank
worktree has active media-lifecycle work in Settings; merge only this branch's small
account-tab entries without replacing that work. App route/title changes also require
normal integration review. No database migration was applied during this implementation.

Install using the repository lockfiles in a fresh checkout with Node 22.23.1, then:

```sh
node scripts/build-communications.mjs
node scripts/render-communications-auth.mjs
node scripts/preview-communications.mjs
node scripts/verify-communications-artifacts.mjs
npm --prefix web run typecheck
npm --prefix web test -- src/lib/communications
npm run test:repo
npm run repo:check
```

The bundle includes the shared React renderer and canonical report adapters. Do not edit
`supabase/functions/communications/service.js` by hand. The visual gallery opens at
`artifacts/communications/index.html`. Build and deploy the web application only through
the repository's authorized release path.

## 2. Resend dashboard: domains and sender identity

1. Open **Domains → Add domain**. A sending subdomain such as `mail.axom.info` keeps
   account/report traffic recognizable. An optional separate `notes.axom.info` gives
   editorial traffic its own sender identity. These are proposed names, not claimed
   existing/verified domains.
2. Copy the exact DNS records that Resend generates into the authoritative DNS provider.
   Verify DKIM and the required sending records in Resend. Do not paste example DNS
   values from documentation or create conflicting SPF policies. Inspect existing DNS
   before changing it. Confirm DMARC alignment and the organization's chosen policy.
3. Confirm the From identities below belong to verified domains. Confirm the Reply-To
   actually receives messages. Do not substitute a personal Gmail address automatically.
4. Review tracking settings for each domain. Start with open/click tracking disabled;
   core state never depends on either. Keep transactional and editorial streams separate
   operationally. Check current plan quotas, throughput and account restrictions.

Suggested identities, pending operator verification:

| Use | From | Reply-To |
| --- | --- | --- |
| Auth and account | `AXOM <account@mail.axom.info>` | A monitored AXOM support inbox |
| Reports and learning | `AXOM Reports <reports@mail.axom.info>` | A monitored AXOM support inbox |
| Essays | `Jafar from AXOM <jafar@notes.axom.info>` | Jafar's chosen monitored AXOM inbox |

## 3. Resend dashboard: credentials and Topics

Create an API key in **API Keys**. The server key needs the permissions used by email
sending and Contacts/Topics operations; a sending-only key will not support contact
synchronization. Store it only as a Supabase function secret. Use a separate restricted
sending key for Supabase SMTP where supported. Never put either in a `VITE_*` variable,
commit, prompt, screenshot or frontend bundle.

Create one Topic per optional category in **Contacts / Topics** (dashboard grouping can
vary). Set default subscription to opt-out. Copy the resulting IDs into `RESEND_TOPIC_IDS`.
Do not collapse weekly and monthly into one Topic: the product allows independent choices.
Current Resend uses Contacts, Topics and Segments; legacy Audiences are deprecated.
See [Topics](https://resend.com/docs/api-reference/topics/create-topic) and
[contact Topic updates](https://resend.com/docs/api-reference/contacts/update-contact-topics).

| AXOM key | Topic name |
| --- | --- |
| `daily_learning` | Daily learning |
| `daily_games` | Daily Games |
| `weekly_report` | Weekly Report |
| `monthly_report` | Monthly Report |
| `exam_reminders` | Exam reminders |
| `annual_pulse` | AXOM Pulse |
| `essays_from_jafar` | Essays & Notes from Jafar |
| `product_updates` | Product updates |
| `research_news` | Research & News |
| `marketing` | Offers & announcements |

`RESEND_TOPIC_IDS` is a JSON object mapping these exact keys to actual provider IDs.
Do not create Topics for mandatory auth/security/privacy communications. The account's
canonical preferences are in AXOM. The worker mirrors them into Resend only in live mode.
A provider opt-out travels back through webhooks; provider opt-ins do not create consent.
Segments may narrow Broadcast audiences, but a matching Topic is still required.

## 4. Supabase migration and function secrets

Review `supabase/migrations/20261010000100_communications_pulse.sql` against a disposable
or staging Supabase project first. It adds 13 communications tables, RLS/policies,
restricted worker/rate-limit/campaign RPCs, the welcome trigger and private
`communications-exports` storage bucket. It does not alter the local workspace schema.
A restrictive policy also denies anonymous/authenticated access to this bucket even
when another Storage policy is broadly permissive; download URLs are minted by the
verified server endpoint. An existing public bucket of this name blocks the migration.

After selecting the correct project and reviewing migration history:

```sh
supabase migration list
supabase db push --dry-run
# Apply only after the operator has reviewed the actual project and pending migrations.
supabase db push
supabase functions deploy communications
```

The normal `db push` may include other pending repository migrations. Do not blindly
apply unrelated pending changes. Resolve the actual migration boundary first.

Set function secrets through **Edge Functions → Secrets** or an untracked, protected
local env file consumed by `supabase secrets set --env-file <private-path>`. Do not put
secret values directly into shared shell commands or logs.

| Variable | Required / meaning |
| --- | --- |
| `SUPABASE_URL` | Supabase-provided project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase-provided server credential; never browser-side |
| `RESEND_API_KEY` | Server key; account/contact permissions described above |
| `RESEND_WEBHOOK_SECRET` | Signing secret from the webhook created below |
| `AXOM_PUBLIC_URL` | Actual public app origin, normally `https://axom.info` |
| `AXOM_ALLOWED_ORIGINS` | Comma-separated exact browser origins; include staging only deliberately |
| `AXOM_EMAIL_MODE` | `disabled` initially, then `test`, finally `live` |
| `AXOM_EMAIL_TEST_RECIPIENTS` | Comma-separated explicit safe test addresses |
| `AXOM_EMAIL_FROM_ACCOUNT` | Verified account sender name/address |
| `AXOM_EMAIL_FROM_REPORTS` | Verified report sender name/address |
| `AXOM_EMAIL_FROM_EDITORIAL` | Verified essay sender name/address |
| `AXOM_EMAIL_REPLY_TO` | Chosen monitored Reply-To address |
| `AXOM_COMMUNICATIONS_ADMINS` | Comma-separated Supabase user UUIDs; never client metadata roles |
| `AXOM_COMMUNICATIONS_CRON_SECRET` | Random 32-byte-or-longer secret used only by worker invocation |
| `AXOM_COMMUNICATIONS_TOKEN_SECRET` | Separate random secret for unsubscribe capabilities; retain across releases |
| `RESEND_TOPIC_IDS` | JSON category-to-Topic-ID map for all ten categories |
| `AXOM_ACCOUNT_DELETION_ENABLED` | Keep `false` until retention/cascade/provider cleanup is accepted |

Use a cryptographic password manager or secret generator for the two independent random
secrets. Rotating the token secret does not invalidate already stored unsubscribe tokens;
rotating the webhook secret must coordinate provider and function configuration.

`verify_jwt=false` is intentional for this one function because public signed webhooks and
unsubscribe capabilities share its endpoint. The handler validates private requests with
`auth.getUser`, the worker with its dedicated secret and webhooks with Svix signatures.
It is not an anonymous privileged API. The service role never leaves the server.

## 5. Resend dashboard: webhook

Create a webhook under **Webhooks** with URL:

```text
https://<project-ref>.supabase.co/functions/v1/communications?action=webhook
```

Subscribe to `email.sent`, `email.delivered`, `email.bounced`, `email.complained`,
`email.failed`, `email.suppressed`, `contact.updated` and `contact.topics.updated`.
Copy its signing secret into `RESEND_WEBHOOK_SECRET`. The endpoint verifies unmodified
raw request bytes, `svix-id`, timestamp and v1 signature. Use Resend's event replay/test
facility to verify a valid event, replay idempotency and rejection of an invalid signature.
Check the provider's current [webhook event catalog](https://resend.com/docs/webhooks/event-types)
if account event options differ. Do not rely on outdated unsubscribe event names.

Provider opt-outs are handled from contact updates/Topic updates. Every bounce is
conservatively suppressed in this implementation, including provider-reported temporary
bounces; operator review is required before removing a suppression. Unknown signed event
types are stored/acknowledged without changing delivery state.

## 6. Supabase Auth through Resend SMTP

In the project dashboard open **Authentication → Email under Notifications → SMTP Settings**.
Enable custom SMTP with the chosen verified sender and name. Use host `smtp.resend.com`,
port `465`, username `resend`, and the restricted Resend API key as password.
This preserves Supabase's authentication/token flow. [Official SMTP setup](https://resend.com/docs/send-with-supabase-smtp).

In the corresponding **Email Templates** sections paste the generated HTML:

| Supabase template | Repository file under `supabase/templates/communications/` |
| --- | --- |
| Confirm signup | `confirmation.html` |
| Magic link / OTP | `magic_link.html` |
| Reset password | `recovery.html` |
| Invite user | `invite.html` |
| Change email | `email_change.html` |
| Reauthentication | `reauthentication.html` |
| Supported security notification variants | `security.html`, with the variant's own subject |

Set clear matching subjects. Enable the available security notifications deliberately in
Supabase's settings; the generic security template is not a separate event detector.
Keep the supported variables intact. OTP-based sign-in still needs `{{ .Token }}`;
secure action links use `{{ .ConfirmationURL }}`. Reauthentication has no action link.
Review Site URL and redirect allowlist against the existing AXOM web/native auth flow.
Do not broaden redirect allowlists to wildcards as a shortcut.
[Supabase template variables](https://supabase.com/docs/guides/auth/auth-email-templates).

## 7. Worker scheduling

The worker is POST-only:

```text
https://<project-ref>.supabase.co/functions/v1/communications?action=worker
Authorization: Bearer <AXOM_COMMUNICATIONS_CRON_SECRET>
Content-Type: application/json
Body: {}
```

Create a scheduled invocation every five minutes through Supabase Cron/pg_net, keeping
the endpoint and authorization secret in Supabase Vault, or use the organization's
existing secure scheduler. Do not expose the cron secret in a browser or public SQL file.
See [Supabase scheduled functions](https://supabase.com/docs/guides/functions/schedule-functions).

The cron task must invoke the full URL including `action=worker`. Observe actual function
execution time and queue age before scaling. Each pass is bounded, but this initial
implementation is optimized for an early product audience, not unbounded bulk campaigns.
Increase throughput only after measuring provider rate limits and Edge execution budgets.
A 10-minute global lease handles overlapping invocations; stale exports retry after
15 minutes, while interrupted deletions require manual reconciliation.

The worker still processes privacy exports and deletion jobs when email mode is disabled.
Deletion has its own separate flag. To pause all work, disable the scheduler as well as
email delivery. To pause destructive work alone, set the deletion flag false.

## 8. Safe staged acceptance, then activation

1. Keep email mode disabled. Verify preference save/reload, user isolation, administrator
   rejection, published/unpublished article access, an export with a small disposable
   protected workspace and the 15-minute/7-day expiration behavior. The export-ready
   email opens authenticated Privacy & Data; the actual signed URL is created only when
   Download is selected, so delayed emails remain usable.
2. Set test mode and exactly one safe address in the test-recipient list. Use an account
   whose email is verified and whose desired category is explicitly enabled. Queue an
   editorial test from the studio, invoke the worker and confirm accepted/delivered status.
   Test commands still require user authorization to send mail.
3. Check welcome, OTP/login, weekly report, monthly report, Pulse and export-ready in
   Gmail desktop/mobile, Apple Mail and Outlook. Inspect images-off rendering, text
   alternative, light/dark mode, link destinations, header unsubscribe and mobile tap areas.
   No real-client compatibility claim has been made yet.
4. Exercise the actual unsubscribe confirmation and one-click POST. Verify optional mail
   stops and account/security remains logically available. Verify hard-bounce/complaint
   suppression with provider-supported test fixtures. Do not send deliberately to strangers.
5. Test cancellation and deletion on a disposable account only after inspecting every
   deployed FK/Storage retention boundary. Verify reauthentication, account rejection after
   deletion, provider contact removal and minimal completion receipt. If interrupted, inspect
   the failure marker instead of rerunning removal blindly.
6. Set live mode only after those tests. Verify Topic synchronization for the safe account
   and round-trip provider opt-out. Topic synchronization is deliberately dormant in test mode.
7. Start a small explicitly approved campaign. Watch provider errors, queue age and bounce
   rate. Production readiness depends on this acceptance, not on passing local mocks.

## 9. Publishing an essay using either path

**AXOM delivery:** open `/#communications-admin`, author, save, review eligible audience,
queue an approved allowlisted test, choose a future time and type `SCHEDULE EMAIL`.
The worker expands recipients and rechecks consent at send time. Resend supplies transport.

**Resend Broadcast:** save the AXOM draft, review the full article, type `PUBLISH ESSAY`
and publish. Export for Resend Broadcasts downloads HTML and JSON containing subject,
plain text and operator note. Import the HTML into a Resend Broadcast, retain
`{{{RESEND_UNSUBSCRIBE_URL}}}`, choose the verified editorial sender and corresponding
opt-in Topic, optionally narrow with a Segment, preview and obtain the actual send approval.
Do not schedule the same content through both paths. The canonical essay URL remains AXOM's.
[Current Broadcast fields and variables](https://resend.com/docs/api-reference/broadcasts/create-broadcast).

Native Resend Broadcast recipient events are not AXOM job rows. Their full campaign history
is viewed in Resend; opt-out/suppression feedback still reaches AXOM. This division avoids
creating an artificial duplicate campaign-history store.

## 10. Recovery and rollback

Disable scheduling and set email mode disabled before debugging a delivery incident.
Cancel queued campaigns in the studio. A provider-accepted message cannot be recalled.
For `delivery-reconciliation-required`, inspect Resend by provider/idempotency reference
before deciding whether to create a replacement job. Never reset all failed jobs blindly.
`email_jobs.delivery_payload` is the frozen request; `first_attempt_at` starts the
23-hour retry window. Preserve both during reconciliation. Resend retains idempotency
keys for 24 hours and rejects different request bodies for a reused key.
[Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys).

`receipt-reconciliation-required` concerns the post-deletion notification only. Inspect
`completion_payload`, `completion_attempt_at` and `completion_attempts` before deciding
on a replacement receipt. Never repeat account deletion to retry a notification. The
receipt loop backs off and stops after five failures or the 23-hour boundary.

For `deletion-reconciliation-required`, inspect whether Auth removal occurred, provider
contact removal completed and temporary export objects remain. Reconcile the one request
with recorded evidence; do not batch retry destructive work. Suppression continues while
an account-owned failed deletion remains unresolved. The user can cancel a failed request.

Rollback application code first while retaining additive tables and consent history.
Remove/disable the welcome trigger if reverting the backend. Do not drop queues, snapshots
or privacy records containing user state as part of a routine rollback. A reverse migration
requires a reviewed data-retention/export plan. Keep suppression history until an approved
retention decision says otherwise.
