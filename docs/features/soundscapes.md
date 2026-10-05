# Soundscapes and media

**Purpose/user behavior:** Keep study audio and immersive scenes usable through route,
focus-session and playback changes; preserve imported originals on the device.

| Boundary | Files under `web/src/` |
| --- | --- |
| Soundscape page/library | `pages/SoundscapesPage.tsx`, `components/soundscapes/` |
| Persistent controls | `components/dock/FocusDock.tsx` |
| Audio state, engine, presets, user media | `lib/soundscapes/` (separate Zustand store) |
| Additive media pipeline | `lib/media/model.ts`, `assetService.ts`, `processor.ts`, `jobs.ts`, fingerprints |

Read [Soundscapes](../SOUNDSCAPES.md) for the established feature contract. The media
pipeline is a branch-local extension, not proof all import/playback paths use it.
Inspect consumers and ownership before connecting it to the existing soundscape engine.

Invariants: preserve originals; report optimization only for a real verified derivative;
keep long-lived audio lifecycle separate from route mounts. Device media bytes and
external embed permissions are separate from portable workspace/cloud protection.
Do not rename playback actions or add AudioContexts without auditing callers.

Known integration questions from the coordination board: truthful optimization status
in existing user-media imports and adoption of shared audio context/lifecycle boundaries.
Recheck them against source before treating them as current blockers.

Tests: `web/src/lib/media/assetService.test.ts`, `mediaPipeline.test.ts`, fingerprint/job
and soundscape tests; `web/e2e/focus-dock-soundscapes.spec.ts`,
`your-sounds-persistence.spec.ts`, `soundscape-scenes.spec.ts`.
Use licensed synthetic fixtures. Private root audio/PDF files are not test data.
