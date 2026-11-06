---
tags:
  - axom/feature
  - axom/design
authority: canonical
---
# Cinematic public entry

AXOM's public root opens a lightweight full-page cinematic. Open AXOM uses the
canonical browser entry constant; Sign In uses the canonical account entry constant.
The public page does not import the workspace store, migrate data, start account
sync or register the workspace worker. Existing hash links, non-root hosting paths,
installed PWA/native startup and auth callbacks still enter the canonical bootstrap.
Explicit sign-in and callback URLs show the existing AccountSyncPanel **after**
migration and hydration, with a clear Continue to AXOM link. Setup and account logic
are unchanged.

The root HTML selects `entry.tsx`, which dynamically imports either landing UI or
`main.tsx`. Existing application E2E fixtures explicitly select `app=1` for their
legacy root visits. Public-entry tests use base Playwright and exercise the real root.

## Motion and assets

The owner approved the uploaded 36-second AXOM launch film as **v1 alpha** for the
public homepage, including commit, push and publication. The approved desktop
1920x1080 and separately composed portrait 1080x1920 H.264/AAC files are preserved
byte-for-byte at `web/public/landing/alpha-v1/`. Both are 30 fps SDR, not HDR.
The manifest in that directory records the approved filenames, byte lengths and
SHA-256 digests. Posters come from the supplied launch package. The public player
uses same-origin assets; there is no external media-host dependency at runtime.
The earlier armillary assets remain untouched for historical/recovery use.

The cinematic occupies the entire viewport without marketing copy over the film.
The original frame is contained, not cropped, so reference UI stays readable on
wide and tall displays. Portrait viewports select only the portrait movie; rotation
preserves playback position, mute state and deliberate user pause. Discreet Open
AXOM, Sign In, download, sound and playback controls remain reachable. No minimum
watch time, loading gate or completion redirect blocks the workspace.

Playback begins muted and loops. Sound requires an explicit user gesture; changing
sound never starts or resumes a paused film. The page pauses media when hidden,
offscreen or while the download dialog is open. A rejected autoplay request exposes
Play film. A decode/network failure preserves the poster, entry actions and retry.

Reduced motion, AXOM's device motion preference, data saver and slow connections
receive only the poster, without downloading either video. A deliberate Play film
action can opt into motion. Subsequent preference changes revoke that override.
A screen-reader text equivalent and VTT visual description accompany the film.
The cinematic palette is scoped and never changes the learner's stored theme.
Account UI retains the existing light/dark system.

This is an approved animated demonstration, not a recording of a live learner's
workspace or evidence that every depicted feature has passed production acceptance.
The alpha approval does not authorize publishing private study records.

## Downloads

Download for Desktop opens an accessible native dialog. It checks the public GitHub
release feed only on demand and shows verified installer asset URLs from
`jaclose/AXOM`. Preview releases are labelled. Drafts, updater feeds, empty files and
external URLs are excluded. Loading, empty, timeout, error, retry and download states
are explicit. Escape/close restore focus. No package URL is invented, and no installer
is bundled into the web app.

As checked on 2026-10-11, no GitHub releases were published. The empty state offers
the browser experience and a release-page link. Production desktop download acceptance
requires the release owner to publish an approved installer. Local tests verify the
actual browser download event against a test-only fixture, not an official installer.

## Verification

`web/e2e/cinematic-alpha.spec.ts` checks approved media hashes, viewport coverage,
portrait selection, sound/pause behavior, rotation, autoplay refusal, retry, device
motion changes and no-download fallbacks. `web/e2e/cinematic-landing.spec.ts` retains
public-entry isolation, download-dialog, account-routing and theme regression checks.
The scoped Homepage Cinematic workflow runs these browser checks, repository checks,
full web quality and update/offline checks. CI results and live deployment evidence
must be reported separately; source changes alone do not establish publication.

## Acceptance boundaries

The original build's Higgsfield Free/credit state and installer availability were
historical observations, not current platform claims. The installed account panel
shows the existing unavailable state in builds without public backend config. Live
authentication and installer integrity require the release/backend owner's configured
environment; simulated tests do not establish those outcomes.

Future replacement films require owner approval. This feature contract by itself
does not grant push, main merge or production deployment authority.
