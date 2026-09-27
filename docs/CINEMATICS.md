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

## Update flow

`lib/appUpdates.ts` owns the lifecycle. Desktop builds download a signed
update in the background (Settings → Advanced → App updates can turn that
off), then show **Update now**. Nothing installs or restarts until the learner
clicks. Applying saves and verifies a recovery checkpoint first
(`lib/updateCheckpoint.ts`). Web builds stage the new service worker and
refresh only on approval. Release and signing setup: `docs/DESKTOP-RELEASE.md`.
