# AXOM startup ident

A 7-second cinematic reveal of the AXOM identity, rendered as a physical
object: a champagne-ivory brushed-metal mark hanging a short distance in front
of a near-black wall, revealed by light. It ends on the overlay's own
`#0D0D0E`, so the app crossfades in seamlessly.

In the app it is the `brand-ident` film of the cinematics catalog
(`web/src/data/cinematics.json`; see `docs/CINEMATICS.md`). Learners choose it
under Settings → Appearance → Opening film, and it takes part in "rotate".
The player (`pickFilmSource` in `web/src/lib/startupIntro.ts`) picks the best
cut the engine can decode:

1. `axom-ident-hevc10.mp4`: HEVC Main 10. Safari, macOS WebKit, and Chromium
   where hardware HEVC is available.
2. `axom-ident-vp9.webm`: VP9 profile 2, 10-bit. Chromium and Firefox.
3. `axom-ident.mp4`: 8-bit H.264, the universal fallback.

8-bit H.264 cannot keep dither in the dark wall gradient at a sane bitrate:
CRF 18 bands, and keeping the dither costs about 30 MB. The 10-bit cuts are
smooth at 0.2–0.4 MB.

## Source of truth

No vector master of the mark exists, so the supplied artwork in `axom/` is
vectorised rather than redrawn:

| Element | Source | Method |
| --- | --- | --- |
| Mark | `axom/app icon.png` | line fits to the sub-pixel 50% contour (edge RMS 0.09 px), corners from line intersections, mirror pairs averaged |
| Wordmark | `axom/axom lettering.16.43.png` | same for Λ, X and M; least-squares ellipses for the O ring |
| Lockup spacing | `axom/axom overview.png` | measured offsets of wordmark, rule and subtitle, in mark heights |

`trace_geometry.py` writes `design/startup/axom-ident-geometry.json`. Details
the trace preserves:

- The chevron arms stop short of the diamond. Each ends in a short cut parallel
  to the diamond's upper facet, leaving an even gap. Extending the edges to a
  sharp point would pierce the diamond.
- The legs sit exactly on the outer 60° triangle of the chevron.
- The wordmark is **not** stock Poppins. Its Λ and X are 30–40% wider than
  Poppins at the same cap height, its M vertex stops at 74% of the cap height
  (Poppins' reaches the baseline), and the strokes are monoline at 0.112 × cap
  (Poppins Medium is 0.168). The lettering is therefore used as drawn.
- The subtitle is Poppins Regular. Size and tracking come from a least-squares
  fit to the glyph positions in the overview (cap 0.0505 H, tracking 0.91 cap).
  The font ships in `design/startup/fonts` under the SIL OFL.

## Renderer

`render_ident.py` is a deterministic, physically based renderer written for
this shot. The camera is nearly head-on, so each surface is a plane that can be
evaluated per pixel with no meshing:

- **Shape**: exact signed distance fields give crisp silhouettes and a machined
  bevel (outer roll → 38° chamfer → inner fillet) with sharp mitres at convex
  corners.
- **Material**: anisotropic Ward–Dür BRDF with Schlick Fresnel and horizontal
  brushing (α 0.04 along, 0.22 across), plus a faint groove texture.
- **Lights**: all area lights on fixed stratified grids, so there is no
  temporal noise:
  - a scrim behind the camera (the ivory faces);
  - an overhead softbox (wall pool and the shadow beneath the mark);
  - a grazing top rim (upward chamfers);
  - a muted-gold kicker;
  - the **luster**: a narrow strip crossing the mark, integrated over a 180°
    shutter for motion blur. Its central hotspot is positioned so that its
    mirror image passes over the diamond.
- **Shadow**: area-light shadows are traced against the silhouette onto the
  wall, so they soften and drift as the lights and the emblem move.
- **Camera**: a true perspective dolly (~3.5% push-in), and the emblem advances
  0.11 mark heights towards camera while it is revealed.
- Everything is additive over `#0D0D0E`. With the lights off, every pixel is
  exactly that colour.

### Timeline (seconds)

| Beat | Time |
| --- | --- |
| Black; faint rim on the upper edges | 0.0 – 0.8 |
| Emergence through light; slight forward move | 0.8 – 2.2 |
| Luster sweep; brief concentration on the diamond | 2.2 – 3.1 |
| Wordmark (opacity, 3 px settle, soft focus → sharp) | 3.1 – 4.0 |
| Gold rule, then subtitle (quieter) | 3.6 – 4.4 |
| Hold with slow residual light drift | 4.4 – 5.5 |
| Retreat: subtitle, wordmark, emblem; last rim highlight dies | 5.5 – 6.5 |
| Clean `#0D0D0E` | 6.5 – 7.0 |

## Reproduce

```sh
pip install numpy scipy pillow fonttools brotli opencv-python-headless \
            scikit-image imageio-ffmpeg numexpr
python3 scripts/startup-ident/trace_geometry.py                      # geometry JSON
python3 scripts/startup-ident/render_ident.py stills --out build/ident/stills --sheet
python3 scripts/startup-ident/render_ident.py frames --out build/ident/frames --jobs 4   # 3840x2160, 16-bit PNG
python3 scripts/startup-ident/render_ident.py encode --frames build/ident/frames --out build/ident --publish
```

`encode` writes:

- `AXOM_ident_4K_30p_hevc10.mp4`: 10-bit master, no banding;
- `AXOM_ident_4K_30p_h264.mp4`: 4K, widest compatibility;
- `AXOM_ident_1080p_30p_{hevc10.mp4,vp9.webm,h264.mp4}`: the app cuts;
- `AXOM_ident_lockup_4K.png`: a still of the full lockup.

Film grain and dither are added at encode time, per target bit depth. All
files are tagged BT.709 / TV range.

`--publish` (or `render_ident.py publish --out build/ident` for cuts that are
already encoded) does three things:

- installs the app cuts and a lockup poster (the Settings thumbnail) into
  `web/public/startup/`;
- writes the `brand-ident` entry, with its 10-bit `sources`, into
  `web/src/data/cinematics.json`;
- records hashes in `design/startup/ident-manifest.json`.

Don't re-import this film with `npm run cinematic:import`. That tool makes a
single 8-bit file and would drop the 10-bit sources.
