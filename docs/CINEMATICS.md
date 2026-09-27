# Cinematics — opening, update and installing films

Short, silent brand films. They are decoration only: they never wait for data,
never play under reduced motion (OS or AXOM setting), and always skip on click
or Escape. A hard deadline (film length + 0.7 s) guarantees the app is usable.

## When a film plays

| Moment | Film (default) | Code |
| --- | --- | --- |
| First run, then the first open of each day / week / every launch / never | Slow sweep | `lib/cinematics.ts` `decideStartupCinematic` → `lib/startupIntro.ts` |
| First open after the app **version** changes (with "Updated to vX" caption) | Push sweep | same, trigger `update` |
| While an approved update saves, installs and restarts | Edge glint | `components/shell/UpdateCinematic.tsx` |

The schedule is a device preference (`axom.cinematics.v1`); a small ledger
(`axom.cinematics.ledger.v1`) remembers the last day/week played and the last
version seen, so an update film plays exactly once. Settings → Appearance →
Opening film changes the schedule and film and previews each one.

## Swapping in a final render (Higgsfield, Blender, anything)

```sh
npm run cinematic:import -- ~/Downloads/final-intro.mp4 --id slow-sweep --final
```

The tool transcodes to ≤1920 px / ≤60 fps H.264 with fast start and no audio,
writes a poster from the settled last frame, measures the edge color and the
duration, and records them in `web/src/data/cinematics.json`. Keep films
between 1 and 2.5 seconds, silent, and on a dark ground. A new film id also
needs a label in `FILM_COPY` and a place in `INTRO_FILM_ORDER`.

Current films are placeholders from the Optical Luster Blender kit
(`design/startup/`, `scripts/render-startup-luster.*`, and the three takes in
`public/cinematics/`). Direction notes: `docs/planning/AXOM-STARTUP-CINEMATIC.md`.

## AXOM ident (final render)

`brand-ident` is the finished 7 s brand ident: the full lockup in brushed
metal, revealed by one sweep of light. It is offered alongside the films above,
in the Opening film picker and in "rotate". It is longer than the 1–2.5 s
guidance because the brief asked for a 5–7 s ident; the hard deadline still
follows the film (7.0 s + 0.7 s).

It is the only film with `sources`: 10-bit HEVC and VP9 cuts that the player
tries first (`pickFilmSource`, via `canPlayType`), because 8-bit H.264 bands in
its near-black gradient. Its `src` is the H.264 fallback. It is rendered and
published by `scripts/startup-ident/` (see the README there), not by
`cinematic:import`, which would collapse it to a single 8-bit file.

## Update flow

`lib/appUpdates.ts` owns the lifecycle. Desktop builds download a signed
update in the background (Settings → Advanced → App updates can turn that
off), then show **Update now**. Nothing installs or restarts until the learner
clicks. Applying saves and verifies a recovery checkpoint first
(`lib/updateCheckpoint.ts`). Web builds stage the new service worker and
refresh only on approval. Release and signing setup: `docs/DESKTOP-RELEASE.md`.
