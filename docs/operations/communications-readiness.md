---
tags:
  - axom/operations
  - axom/communications
authority: canonical
---
# Communications readiness and email drafts

AXOM's communications pipeline already renders the welcome email, optional reports,
editorials and account notices. The local audit below checks configuration shape;
it makes no network requests and prints no credentials, addresses or Topic IDs.

```sh
node scripts/check-communications-readiness.mjs
node scripts/check-communications-readiness.mjs --json
node scripts/check-communications-readiness.mjs --strict
```

The default command always reports its findings. `--strict` exits nonzero when the
local environment is incomplete. Run it only with a deliberately selected server
environment, for example with Node's `--env-file` pointing to a protected file.
Do not copy secret values into terminal arguments, tickets, screenshots or chat.
The audit checks mode, server credentials, sender/reply addresses, public origin,
allowlisted test recipients, administrator IDs, separate secrets and all ten
optional Resend Topic mappings. A pass means only that those local inputs have
the expected shape. It cannot establish verified DNS, hosted secrets, worker
scheduling, SMTP setup, consent readback or inbox delivery.

Generate a local review package directly from the same renderer used by the Edge
function:

```sh
node scripts/render-welcome-draft.mjs
node scripts/render-product-update-draft.mjs
```

Open `artifacts/communications/welcome-draft/index.html` for dark and light
views. The folder also contains raw email HTML, the plain-text alternative and
the authentic Orb image. Alex Morgan is a fictional fixture. The review copies
replace only the hosted Orb URL with a relative image so they open offline.
`welcome-resend-draft.html` keeps the hosted Orb URL and uses a generic greeting
for import into a Resend draft. The live server renderer personalizes the actual
message separately.
They are draft assets, not sent messages or email-client acceptance evidence.
The product-update draft is at
`artifacts/communications/product-update-0.0.3-prebeta/index.html`, with dark
and light views, plain text and a hosted-image Resend draft file. It describes
an in-progress release. A matching [Resend product-update template draft](https://resend.com/templates/38931a1a-ec16-450f-aa49-3b61a10f3385/editor)
was imported and visually checked on 2026-11-02. It remains a draft: no sender,
reply address, audience, campaign or delivery was configured. Recheck the copy,
links and unsubscribe handling against the live release before publication.
An [unsent Resend Broadcast draft](https://resend.com/broadcasts/e5b79bf2-953c-48f8-be9c-a9d717b42ed2/editor)
now uses the same design, All Contacts with the opt-out **Product updates** Topic,
and the [Resend per-contact unsubscribe placeholder](https://resend.com/features/broadcasts).
The imported link was checked in a fresh editor tab. Sender and reply addresses
remain unset, the audience has zero contacts, and no test or live email was sent.
Its source file is `artifacts/communications/product-update-0.0.3-prebeta/product-update-resend-broadcast.html`.
Both generators check the source manifest and refuse a stale bundle.

On 2026-11-02, the ten optional Resend Topics in the
[activation runbook](communications-resend.md) were created and checked in the
dashboard. Each is public on the preference page and defaults to opt-out; the
audience still has zero contacts. Their provider IDs are preserved in the
local ignored, owner-only file
`artifacts/communications/resend-topic-ids-2026-11-02.json` for later server
configuration. The IDs have not been set as `RESEND_TOPIC_IDS` in production,
and no contact sync or broadcast delivery has occurred. The Resend preference and success
pages now use AXOM's Orb, Midnight colors and concise confirmation copy; both
were visually checked and saved in the dashboard.

For provider setup and real acceptance, follow the
[Resend/Supabase runbook](communications-resend.md). Keep account deletion off
until its separate retention and cleanup review is complete. The final gate is
one explicitly approved allowlisted test through the real worker, signed webhook
replay, consent/readback, and Gmail, Apple Mail and Outlook inspection. Local
previews and synthetic tests do not replace that evidence.
