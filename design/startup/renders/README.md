# AXOM rendered videos

Finished renders of the AXOM brand films. Every file comes in two formats:

- `…_h264.mp4` plays everywhere. Use it to share or preview.
- `…_hevc10.mp4` is the higher-quality 10-bit master, with no banding in the
  dark gradients. It plays in QuickTime, Safari, macOS and iOS, and in most
  editors.

## `ident-7s/`: the 7-second ident (4K)

The full lockup (logo, AXOM, gold rule and subtitle), revealed by a single
light sweep. It ends on black.

- `AXOM_ident_4K_30p_hevc10.mp4`: master
- `AXOM_ident_4K_30p_h264.mp4`: compatible copy
- `AXOM_ident_lockup_4K.jpg`: still of the finished lockup

## `shorts-2s/`, `shorts-3s/`, `shorts-4s/`: short stings (1080p)

In each short, the logo turns into place in 3D, showing its thickness, while a
glint sweeps across it and sparkles along the edges. It ends on the settled
logo.

| File name contains | Shows |
| --- | --- |
| `mark` | the logo only |
| `wordmark` | the logo and AXOM |
| `lockup` | the logo, AXOM, gold rule and "Private Academic Operating System" |

Example: `shorts-3s/AXOM_wordmark-3s_1080p_30p_h264.mp4` is the logo and AXOM,
3 seconds, 1080p.

Re-render or change any of these with `scripts/startup-ident/render_ident.py`;
see `scripts/startup-ident/README.md`.
