---
tags:
  - axom/feature
  - axom/design
authority: canonical
---
# Cinematic public entry

AXOM's public root opens a lightweight landing page. Launch in Browser uses
`/?app=1`; Sign In uses `/?app=1&account=1`. The public page does not import the
workspace store, migrate data, start account sync or register the workspace worker.
Existing hash links, non-root hosting paths, installed PWA/native startup and auth
callbacks still enter the canonical bootstrap. Explicit sign-in and callback URLs
show the existing AccountSyncPanel **after** migration and hydration, with a clear
Continue to AXOM link. Setup and account logic are unchanged.

The root HTML selects `entry.tsx`, which dynamically imports either landing UI or
`main.tsx`. Existing application E2E fixtures explicitly select `app=1` for their
legacy root visits. Public-entry tests use base Playwright and exercise the real root.

## Motion and assets

A locally rendered titanium/glass armillary is the current fallback. A gentle,
periodic camera drift produces the silent eight-second 24 fps film. 1080p WebM,
H.264 MP4, 720p WebM and WebP posters live in `web/public/landing/`. Source,
reproduction commands and the approved replacement prompt are in
[the asset specification](../../design/landing/ASSETS.md).

Reduced motion, AXOM's device motion preference, data saver and slow connections
receive only the poster. Active playback can be paused, stops when offscreen or the
tab is hidden, and leaves the poster in place on failure. A rejected autoplay request
exposes Play motion. The dark cinematic palette is scoped and never changes the
learner's stored theme. Account UI retains the existing light/dark system.

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

## Acceptance boundaries

Higgsfield remained Free with 0 spendable credits and a pending, unusable credits
trial. No paid generation or trial activation was performed. The installed account
panel shows the existing unavailable state in builds without public backend config.
Live authentication and installer integrity require the release/backend owner's
configured environment; simulated tests do not establish those outcomes.

This feature does not authorize a push, main merge or production deployment.
