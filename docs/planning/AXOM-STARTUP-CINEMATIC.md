# AXOM startup cinematic

Status: the September 27 brief (cinematic brand ident) is implemented and ships
as `web/public/startup/axom-ident*` (10-bit HEVC/VP9, with an H.264 fallback). The earlier optical-luster direction
below is kept for history; its launch contract still applies.

## Current direction: cinematic brand ident (September 27)

A 7-second reveal of the full identity (mark, wordmark, gold rule, subtitle) as
a physical object: champagne-ivory brushed metal with a machined bevel, hanging
a short distance in front of a near-black textured wall.

- 0–0.8 s: black; a faint rim appears on the upper edges.
- 0.8–2.2 s: the mark emerges through light as it moves slightly forward.
- 2.2–3.1 s: a narrow studio-light luster crosses the mark and gathers briefly
  on the diamond.
- 3.1–4.4 s: the wordmark settles in from soft focus; the rule and subtitle
  follow more quietly.
- 4.4–5.5 s: hold.
- 5.5–6.5 s: the light retreats: subtitle, then wordmark, then mark.
- 6.5–7.0 s: clean `#0D0D0E` for the crossfade into the app.

The geometry is vectorised from the supplied artwork, never redrawn, and
rendered by a deterministic in-repo renderer instead of Blender. The mark-only
constraint of the earlier direction no longer applies: the brief asks for the
wordmark and subtitle. Pipeline, measurements and reproduction steps are in
`scripts/startup-ident/README.md`.

## Earlier direction: Optical luster (superseded)

Revised after the user's September 24 screen-recording reference and request for
very fast, restrained 3D luster suitable for a medical-school app. The reference's
useful gesture is a brief luminous reveal resolving into a clean mark, not its
illustrated action, lightning, or long logo hold.

Use the current ivory AXOM mark, preserving its exact front-face geometry, as a
shallow 3D object on near-black. Matte ivory ceramic face, very narrow polished
titanium bevel, fixed camera, neutral-white light with a faint cool reflection.
Think precision optical instrument: clarity and calm, without medical stock motifs.

- 0–0.2 s: the mark emerges softly from near-black.
- 0.2–0.85 s: one diagonal light sweep catches the bevel and crosses the face.
- 0.85–1.05 s: the highlight settles into the familiar flat ivory mark.
- 1.05–1.3 s: dissolve into the already prepared setup or workspace.

No component assembly, camera orbit, particles, lightning, full-screen flash,
heartbeat trace, DNA helix, or prolonged logo hold. The symbol is sufficient;
do not add a separate wordmark beat unless testing shows the name is needed.

## Implementation recommendation

For the requested real 3D finish, author and render the exact logo in Blender,
then bundle a short silent video locally with a matching static image fallback.
Retain the editable scene and render recipe. Routine app updates do not require
rerendering an unchanged cinematic. Do not add a live 3D engine just for startup.

Use CSS only for the handoff to the interface. Validate video decoding on each
supported wrapper/browser; media failure must immediately use the static mark.
Prefer an opaque near-black render over relying on cross-platform video alpha.
No remote media request is required at launch. A lighter SVG/CSS rendition remains
a fallback option, not an equivalent claim of physically rendered 3D materials.

Any concept renders should retain the exact supplied mark. Generated video can
explore lighting and mood; it should not be the source of truth for the logo.

## Launch contract

- Run in parallel with migrations and store hydration; never alter completion
  flags, choose a route, or pretend data is ready.
- End the cinematic on schedule. If startup is still pending, show a quiet,
  honest loading state; preserve the existing startup-error recovery.
- A skipped, failed, or disabled animation must not stop the app from opening.
- Play once per cold app launch, not on navigation or foregrounding. Warm resumes
  go straight to the app. Web should avoid replaying it within the same tab session.
- Escape/click can skip; provide a persistent disable option.
- Respect reduced-motion preferences with a static mark and short fade.
- Silent by default. If added, use an original short, soft two-note sonic logo,
  behind an opt-in sound preference and tolerant of browser autoplay restrictions.
- Test fresh and existing profiles, slow/failed hydration, offline startup,
  reduced motion, minimum window size, rapid relaunch, and skip behavior.

## Branding compatibility

The active native executable/package and cloud package now use AXOM naming.
Existing bundle/database identifiers, persistence keys, migration matchers, and
verified repository/hosting URLs remain intact. They are compatibility addresses,
not instructions to display the retired brand. Changing them requires a separate
data migration or hosting transition. No installed app, remote repository, or
deployment has been renamed by these source changes.
