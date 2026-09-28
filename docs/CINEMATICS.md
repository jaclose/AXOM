# Cinematics — opening, update and installing films

Short, silent brand films. They are a presentation layer, not a loading step.
The app mounts and hydrates underneath while the film plays. Films never play
under reduced motion (OS or AXOM setting) and always skip on click or Escape.
A hard deadline guarantees the app is usable: film length, plus the exit, plus
the longest wait for the first frame, plus 0.7 s.

## When a film plays

| Moment | Film (default) | Code |
| --- | --- | --- |
| The very first open on a device | AXOM ident (7 s, 4K, as supplied) | `lib/cinematics.ts` `decideStartupCinematic` (`FIRST_RUN_FILM`) → `lib/startupIntro.ts` |
| First open of each day / week / every launch / never | Wordmark (2 s) | same, trigger `daily` / `weekly` / `always` |
| First open after the app **version** changes (with "Updated to vX" caption) | Wordmark, long (3 s) | same, trigger `update` |
| While an approved update saves, installs and restarts | Wordmark (2 s) | `components/shell/UpdateCinematic.tsx` |

Preferences written before the finished films (version 1) keep their schedule
and move to these films. The schedule is a device preference
(`axom.cinematics.v1`); a small ledger
(`axom.cinematics.ledger.v1`) remembers the last day/week played and the last
version seen, so an update film plays exactly once. Settings → Appearance →
Opening film changes the schedule and film and previews each one.

## Film → black → AXOM

`lib/startupIntro.ts` plays the film on a fixed black layer (the film's measured
edge color, `#0d0d0d`). The app beneath stays `inert` until the handover.

1. **Exit.** A film that ends on black (`exit: "black"`, the ident) starts the
   handover in its last 0.42 s. A film that holds its lockup (`"hold"`, the
   wordmarks) first fades to its own black (380 ms), so two AXOM marks never
   share the screen.
2. **Wait for the real frame.** The handover waits on black until the
   workspace (or setup) has rendered. `PresentationReady` in `App.tsx` signals
   this, and the wait is capped at 2.5 s, so the film never hands over to a
   loading state.
3. **Resolve.** The black layer fades out over 560 ms, which is what brings
   the shell up from dark. `revealApp("intro")` settles the regions in:
   sidebar zones and the page heading first, then page sections, then
   dashboard widgets and secondary controls. It uses 8 px of rise, a
   0.99 scale for cards and ease-out with no spring, and lasts about 0.9 s.
   The overlay and video are then removed and released.

Skip, Escape and media errors take the same path with a 240 ms fade and no
extra fade to black. Without a film, `revealApp("open")` gives the same quiet
settle as the workspace first renders. The first visit to each tab this
session gets a lighter version (`.page[data-enter]`). All of this lives in
`lib/presentation.ts` and `styles/presentation.css`, applied to whole regions,
never per widget. Reduced motion turns the reveal off entirely.
`index.html` paints the brand black (or the light theme's paper) before any
stylesheet loads, so a cold start never flashes white.

## Adding a render

```sh
npm run cinematic:import -- ~/Downloads/final-intro.mp4 --id wordmark-2s --final --as-is
```

By default the tool transcodes to ≤1920 px / ≤60 fps H.264 with fast start and
no audio. `--as-is` keeps a finished H.264 master byte-for-byte, and only
remuxes losslessly if it lacks fast start or carries audio. The tool then
measures how the film ends (`exit`), the edge color and the duration. It
writes a poster (never a black frame) and records all of it in
`web/src/data/cinematics.json`. Keep films
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
