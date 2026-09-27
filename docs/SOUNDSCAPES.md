# Soundscapes and the focus dock

## Synthesis (`web/src/lib/soundscapes/`)

Everything is generated on the device with Web Audio. Nothing is downloaded,
loops never seam, and no copyrighted recordings ship with the app.

- `presets.ts` — the six presets, the learner's 90-minute-block rotation and
  the research principles. Binaural carriers were measured with an FFT of the
  learner's own recordings: 20 Hz = 100/120 Hz, 10 Hz = 55.5/65.5 Hz,
  2 Hz = 39/41 Hz. 40 Hz uses 200/240 Hz under a soft drone (that recording is
  music, not a pure tone). Every preset carries an evidence level and a note
  that is shown wherever the preset is offered.
- `engine.ts` — one `AudioContext`. Layers crossfade over 1.6 s. Headphones
  mode sends one tone per ear (binaural). Speakers mode puts both tones in both
  ears (audible monaural beats) and lifts carriers below 140 Hz. Noise beds are
  12 s stereo buffers that loop seamlessly (tested). Output goes through a
  media element when allowed, so macOS Now Playing and media keys work.
- `store.ts` — play / pause / stop, volume, output, stop timer (sleep presets
  arm one automatically and fade over 8 s), Media Session, and the listening
  log. `SoundscapeTimerSync` switches to 10 Hz during Pomodoro breaks when
  "follow my Pomodoro" is on.
- `listeningLog.ts` — device-only intervals (≥1 min). `compareListeningConditions`
  splits question attempts and in-app card reviews by what was playing,
  starting from the first logged play. It reports a rate only when a
  condition has 20 or more answers. The page labels it observational.

## Visuals (`web/src/components/soundscapes/`)

`SoundscapeVisual` is a DPR-aware canvas that pauses offscreen and in hidden
tabs, draws one still frame under reduced motion, and re-reads palette colors
on theme or palette change. Renderers (`visuals.ts`) are deliberately slow. No
luminance change repeats faster than about every 2 s, so a 40 Hz preset never
becomes 40 Hz flicker (WCAG 2.3.1).

### Scenes

Scenes are looping video clips (`web/src/data/scenes.json`, files in
`web/public/scenes/`), each tagged with a `genre`: nature, future, space,
waves or fun. `scripts/import-scenes.mjs` cuts seamless crossfade loops
(`--crf`, default 29; `--width`, default 1280). By default it writes to the
personal manifest (`scenes.personal.json`, files in `public/scenes/personal/`).
Both are gitignored, so your own wallpapers never enter the repository.
`--publish` writes redistributable clips to the committed manifest. Unit tests
ignore the personal manifest.

## Personalization (`taste.ts`, `SoundscapeOpener.tsx`, `ForYouRow.tsx`)

The first visit opens a two-step opener: sounds you're into (frequencies,
birds & nature, rain & waves, noise, places, piano & jazz), then scenes you like
to look at (the five genres plus random). Tiles widen on hover. After
"Turn on previews" (a click, so the audio context may start), they also play a
short preview. A preview never overwrites preferences, the stop timer or the
listening log, and never interrupts something that is already playing. Picks
are optional and can be changed with Personalize.

- `forYouOrder` puts pinned presets first, then the presets of each picked
  genre in pick order. The For you row, section order and card order follow it.
- `sceneForTaste` keeps a preset's designed scene when it fits your visual picks.
  Otherwise it chooses one from those genres; "random" reshuffles each session.
  A scene you choose in the picker always wins.
- Taste and pins live in `axom.soundscapes.v1` on this device.
- The opener renders through a portal on `document.body`. The shell's
  backdrop filter would otherwise contain a fixed overlay, clipping it and
  placing it under notices.

## Focus dock (`web/src/components/dock/FocusDock.tsx`, `styles/dock.css`)

It appears whenever a session, a Pomodoro phase (including paused mid-sprint)
or a soundscape is active. Two rows share one grid cell: `.focus-dock-goo`
draws only the capsule shapes through an SVG goo filter, so the pill visibly
pinches apart when it splits. `.focus-dock-content` holds the crisp,
interactive content. Hovering or focusing the sound capsule opens the genie
panel: a clip-path funnel anchored at the capsule, which Escape closes from
anywhere. `SessionOverlay` now owns only focus mode and the closing capture,
shared through `lib/sessionUi.ts`.
