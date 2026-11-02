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
an in-progress release and is not an audience, campaign or delivered email.
Both generators check the source manifest and refuse a stale bundle.

For provider setup and real acceptance, follow the
[Resend/Supabase runbook](communications-resend.md). Keep account deletion off
until its separate retention and cleanup review is complete. The final gate is
one explicitly approved allowlisted test through the real worker, signed webhook
replay, consent/readback, and Gmail, Apple Mail and Outlook inspection. Local
previews and synthetic tests do not replace that evidence.
