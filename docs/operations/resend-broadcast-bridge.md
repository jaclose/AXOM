# AXOM Resend Broadcast bridge: draft-only operator contract

Status: **code candidate, not Resend activation or production-delivery evidence**.
See [communications-resend](communications-resend.md) and [communications-readiness](communications-readiness.md).

## Routing

| Route | Message types | Scheduling and consent owner |
| --- | --- | --- |
| Supabase Auth via Resend SMTP | Verification, sign-in, password recovery, security | Supabase Auth; not Broadcasts |
| AXOM worker via Resend Emails | Welcome, personal learning reports, exam reminders, AXOM Pulse/Wrapped, privacy receipts | AXOM preferences, per-user timezone, source snapshots and send-time suppression |
| Resend Broadcasts | Published essays, product release notes, curated research and opted-in announcements | An audited, category-specific opt-in Resend Segment |

**Never put grades, attempts, Journal content, private course data or personalized Pulse into a Broadcast.** A Broadcast must use generic canonical editorial copy.

## What this bridge can do

The operator script validates an AXOM Studio Broadcast export, creates a draft with the Resend API, checks the verified sending domain and Segment identity, stores the provider ID and content hash, inspects its status, and can update that same remote draft. It has **no send or schedule action**. The create request deliberately omits `send` and `scheduled_at`.

The API takes a `segment_id`, not a Topic ID. A Topic configured with opt-out defaults does **not** prove the recipient set is category-consented. `RESEND_TOPIC_IDS` is audit metadata here; it is not passed as an unsupported Broadcast-create field. A separate eligible, category-scoped Segment is needed. This script cannot itself prove Segment membership is current.

## Operator configuration

Keep all credentials and provider IDs in a protected operator environment (not Git, browser bundles or screenshots).

- `RESEND_API_KEY`: provider API credential with appropriate draft/domain/segment access.
- `AXOM_EMAIL_FROM_REPORTS` and `AXOM_EMAIL_FROM_EDITORIAL`: from-addresses on Resend-verified domains.
- `RESEND_TOPIC_IDS`: canonical ten-category opt-in Topic map.
- `AXOM_RESEND_BROADCAST_SEGMENTS`: map of the four **eligible** broadcast categories to separate, reviewed Segment UUIDs, never All Contacts. Categories are `essays_from_jafar`, `product_updates`, `research_news` and `marketing`.

Example **shape only**, without real IDs:

~~~text
AXOM_RESEND_BROADCAST_SEGMENTS='{"essays_from_jafar":"<uuid>","product_updates":"<uuid>","research_news":"<uuid>","marketing":"<uuid>"}'
~~~

The operator must reconcile each Segment against currently opted-in, email-confirmed AXOM users, filtering current Topic opt-outs, global unsubscribes, pending deletion requests, changed addresses and hard-bounce/complaint suppressions. Never import an unscreened database export into All Contacts. Check sender DNS, DKIM, SPF and DMARC in Resend, as well as a monitored reply mailbox.

## Draft commands

In AXOM Studio (`/#communications-admin`), save an editorial campaign, review its audience and export the Resend Broadcast JSON. A canonical essay must be published before its export. Record the AXOM `email_campaigns.id` UUID.

Preview without provider calls or files:

~~~sh
node scripts/resend-broadcast-bridge.mjs preview --file /private/path/axom-resend-broadcast.json --campaign YOUR-CAMPAIGN-UUID
~~~

After reviewing a Segment containing **only** the intended opted-in cohort, attest that check and create an *unsent draft*:

~~~sh
node scripts/resend-broadcast-bridge.mjs create-draft --file /private/path/axom-resend-broadcast.json --campaign YOUR-CAMPAIGN-UUID --consent-attested --apply
node scripts/resend-broadcast-bridge.mjs inspect --campaign YOUR-CAMPAIGN-UUID
~~~

Update the existing draft before it is scheduled or sent:

~~~sh
node scripts/resend-broadcast-bridge.mjs update-draft --file /private/path/revised-broadcast.json --campaign YOUR-CAMPAIGN-UUID --consent-attested --apply
~~~

Consent attestation is a manual operator confirmation, **not** an automated consent verification. No real mail is sent or scheduled by these commands.

The ignored local ledger at `artifacts/communications/resend-broadcast-ledger/<campaign-id>.json` records campaign ID, provider draft ID, category, Segment, Topic, content hash and operation state, not secrets or recipient addresses. Creation uses exclusive file locking: a second invocation cannot create another remote draft for the same local campaign.

An ambiguous provider response leaves `creation-uncertain` or `update-uncertain`. Do not delete the ledger or automatically retry. Inspect the Resend Broadcast by its deterministic internal name (`AXOM <campaign-id> | <category>`) and reconcile it manually first.

## Gates before live Broadcast scheduling

1. Automate category-Segment membership reconciliation from AXOM consent changes. Verify provider/global opt-outs, suppressions and deletion barriers immediately before publication.
2. Save provider draft ID, frozen content digest, delivery path, approval and status in a durable shared database record. The current local ledger is not a distributed exactly-once guarantee.
3. Enforce **mutual exclusion** between AXOM's own scheduled campaign route and Resend's Broadcast route. The Studio currently offers both. Operator instructions alone are insufficient for live safety.
4. Require human review of the exact subject, preheader, HTML/text, links, original Orb, unsubscribe token, published-article status and opted-in cohort before a timed send.
5. Add separately authorized send/schedule and [cancel](https://resend.com/docs/api-reference/broadcasts/cancel-broadcast) actions only after testing a verified safe cohort. A provider-accepted message cannot be recalled.
6. Complete live Auth SMTP, webhook signature/replay, worker schedule, domain verification and inbox-client tests before declaring AXOM delivery operational.

Resend's [Create Broadcast](https://resend.com/docs/api-reference/broadcasts/create-broadcast) and [Send Broadcast](https://resend.com/docs/api-reference/broadcasts/send-broadcast) APIs support drafts and scheduled sends. This implementation intentionally exposes only the safer draft subset.

## Cadence and editorial discipline

- **Broadcasts** are event-driven: substantive product releases, approved essays, curated research and opted-in announcements. There is no artificial daily marketing schedule.
- **User reports** are individual emails from the AXOM worker: daily learning, previous completed week's report, previous completed month's report and the previous completed year's Pulse. Keep per-user timezone, idempotency and missing-source disclosure.
- **Auth/security** are actual event-triggered emails. Never generate fake OTP or privacy notices as marketing tests.
- **Acceptance** uses synthetic previews and one explicitly approved, allowlisted recipient before considering an opt-in cohort.

Validation: `node --test scripts/resend-broadcast-bridge.test.mjs`, then `npm run test:release` and exact-head AXOM Quality CI. Mocked tests are not evidence of a delivered email or an audited provider audience.
