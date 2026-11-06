# AXOM Correspondents: 25 personalized email identities

Status: **implemented candidate POC and allowlisted test-send tool; no live Resend configuration or delivery**.

The implementation lives in `web/src/lib/communications/correspondents.ts`.
The 25 names are Meridian, Vellum, Fathom, Serein, Calder, Lattice, Oriel,
Kestrel, Morrow, Nacre, Aster, Vesper, Vela, Argent, Atlas, Ember, Arc, Cairn,
Solstice, Mosaic, Quill, Juniper, Cipher, Harbor and Verge.

## Contract

Each learner has **one stable, user-reversible** AXOM correspondent selected
from **explicitly chosen** accent and declared work-style preferences. This is
an aesthetic/workflow match, **not a psychological personality assessment**.
Without declared preferences, the learner gets a deterministic starter name
with an honest explanation; that is not described as a personality match.
A manual choice always takes precedence. Once saved, the correspondent must
remain pinned until changed by the user.

Optional journal-derived themes are acceptable **only after each learner's
explicit opt-in**, using a small user-reviewed abstract tag list on-device.
The original journal entries, mood descriptions, health/diagnostic signals,
secrets, or other sensitive content must never reach Supabase, Resend, or the
email itself for this feature. An owner request does not constitute consent
for all AXOM users. The email may disclose the optional source category but
must not print the underlying tag or private writing.

## First email and diagram

The prototype's email includes the original AXOM Orb, Ink/Graphite/Bone/Gold
identity palette, inbox-safe typography and an accessible table-rendered
**SOURCE → MATCH → CORRESPONDENT** diagram. The text clearly explains the
criteria that were actually present. It has a plain-text counterpart and
identifies the pseudonym as an AXOM-generated communication identity, not a
human support representative.

The subject for a proof-of-concept begins with its exact use case, e.g.
**AXOM POC · WELCOME · Meet Vesper**. A later academic report or Pulse POC
must use its real source-backed template rather than relabel a welcome mockup.

The final welcome delivery should occur after account verification and the
onboarding preference decision. If there are no declared preferences, the
starter rationale is shown. The existing account/security sender must remain
unaffected.

## Generate all 25 local previews

~~~sh
node --experimental-strip-types scripts/render-correspondents-poc.mjs
~~~

Open `artifacts/communications/correspondents/index.html` and compare all
individual email HTML/text variants plus the preference-based example.
Only synthetic fixtures are rendered; no account state or provider is read.

## Allowlisted Resend test-send protocol

The operator-side sender is
`scripts/send-correspondent-poc.mjs`. It only supports the welcome identity
introduction, defaults to dry-run, and cannot be invoked from a public browser
or bulk broadcast action.

Required server-only configuration:

- `AXOM_EMAIL_MODE=test`
- `AXOM_EMAIL_TEST_RECIPIENTS=jdabbagh@sgu.edu` or another authorized test mailbox
- `AXOM_CORRESPONDENT_ALIAS_DOMAIN=axom.info` **only after provider verification**
- `AXOM_EMAIL_REPLY_TO`, a monitored and valid inbox
- `RESEND_API_KEY` with domain-read and email-send permissions

Commands:

~~~sh
node --experimental-strip-types scripts/send-correspondent-poc.mjs preview --to jdabbagh@sgu.edu --id vesper --revision v1
node --experimental-strip-types scripts/send-correspondent-poc.mjs send-test --to jdabbagh@sgu.edu --id vesper --revision v1 --confirm-allowlisted-send
~~~

A send cannot proceed without exact recipient allowlisting, test-mode
configuration, explicit operator approval, a Resend-verified sender domain,
and a monitored Reply-To. The script submits frozen HTML/text with a digest
Idempotency-Key and returns a provider ID only after acknowledgment. It does
not claim inbox delivery, perform background sends, or send a fake OTP.
Inspect ambiguous responses in Resend before replacing a test. Increment
the revision when intended content/sender changes.

## Provider and deliverability trade-offs

Resend can send from any local part of a **verified sending domain**.
However, changing sender addresses can hurt deliverability. Keep one chosen
identity fixed for each recipient, and fall back to a stable AXOM From address
if real inbox tests show a problem. Replies must route to monitored support.
For example, `AXOM · Vesper <vesper@axom.info>` is a *proposed*, not verified,
sender.

**Resend Broadcasts have one From address per campaign.** A per-recipient
From cannot vary inside one broadcast. Keep nonpersonal public announcements
on the shared broadcast sender; personalized optional messages must use
the AXOM per-account job queue and the Resend individual-email transport.
Never schedule the same editorial publication through both.

## Production release blockers

1. Review names and cultural/brand suitability.
2. Persist a user-owned correspondent ID and explicit selection evidence,
   with secure RLS and an override/disable control in Settings.
3. Keep optional journal tags on-device. Provide a clear opt-in/out before
   any on-device derivation.
4. Integrate the introductory diagram into the **canonical welcome renderer**;
   regenerate the Edge bundle and integrity manifest. Do not modify the
   generated bundle by hand.
5. Verify from-domain DNS (SPF/DKIM/DMARC), Reply-To, user email, consent,
   and suppression status before any real message.
6. Validate desktop/mobile HTML, images-disabled and plain-text clients,
   accessibility, Auth sender separation, cancellation and idempotency.
7. Send exactly one allowlisted POC, verify Resend receipt and real inbox,
   then authorize rollout separately. Do not merge against failing CI.

This candidate does not change live Supabase, the Resend dashboard, account
settings or hosted welcome notifications. It is a tested design/logic slice,
not a production activation claim.
