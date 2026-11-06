---
tags:
  - axom/feature
authority: canonical
---
# Soundscapes and media

**Purpose/user behavior:** Keep study audio and immersive scenes usable through route,
focus-session and playback changes; preserve imported originals on the device.

| Relationship | Canonical route |
| --- | --- |
| Lifecycle contract | [Frontend and persistent services](../architecture/frontend.md) |
| Storage boundary, not cloud media upload | [Workspace data and portability](../architecture/data-model.md) |
| Related study-session feature | [Productivity and timers](productivity.md) |

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
Generated noise loops stay below full scale. If a filtered random sequence exceeds
that bound, attenuate the entire loop after its crossfade so the waveform and seam
are preserved; ordinary lower-level loops are unchanged.

The bundled AXOM Soundscape 1 is the default main sound and initial pinned choice.
Main selection persists by preset and version without autoplay. Imports keep their
original bytes and report no savings unless a verified derivative exists.
Playback labels refer to the version actually loaded, including while paused;
choosing another version does not rewrite the identity of the paused recording.
Recording errors surface without claiming successful playback. See the engine
lifecycle in [Soundscapes](../SOUNDSCAPES.md#synthesis-websrclibsoundscapes).

Known integration question from the coordination board: adoption of shared audio context/lifecycle boundaries.
Recheck them against source before treating them as current blockers.

Tests: `web/src/lib/media/assetService.test.ts`, `mediaPipeline.test.ts`, fingerprint/job
and soundscape tests; `web/e2e/focus-dock-soundscapes.spec.ts`,
`your-sounds-persistence.spec.ts`, `soundscape-scenes.spec.ts`.
Use licensed synthetic fixtures. Private root audio/PDF files are not test data.
