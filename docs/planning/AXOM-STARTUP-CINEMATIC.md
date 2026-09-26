# AXOM startup cinematic — proposed direction

Status: design recommendation, not implemented or approved as final animation.

## Direction: Optical luster

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
