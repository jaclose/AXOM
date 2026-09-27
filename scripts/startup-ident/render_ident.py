#!/usr/bin/env python3
"""AXOM cinematic brand ident: a deterministic, physically based renderer.

The mark, wordmark and lockup come from design/startup/axom-ident-geometry.json
(traced from the supplied artwork by trace_geometry.py) and are never
re-drawn. The camera is nearly head-on, so every surface is a plane parallel
to the sensor and can be evaluated analytically per pixel:

* Exact signed distance fields of the traced polygons/ellipses give crisp
  silhouettes and a machined bevel (outer roll, 38 degree chamfer, inner
  fillet). Convex corners mitre sharply, as a real chamfer does.
* Brushed champagne metal: anisotropic Ward-Duer BRDF with Schlick Fresnel,
  horizontal grain (roughness 0.07 along / 0.22 across), faint groove texture.
* Every light is a sampled area light: a gridded fill softbox, a narrow strip
  that performs the luster sweep (with a hotspot aligned to cross the
  diamond), a grazing top rim and a muted-gold kicker. The sweep is motion
  blurred by integrating the strip over a 180 degree shutter.
* The emblem hangs in front of a near-black textured wall. Area-light shadows
  are traced against its silhouette, so the shadow softens and shifts as the
  lights and the emblem move.
* A true perspective camera dolly provides the push-in; the emblem also
  advances a little towards camera as it is revealed.

Everything is additive over the brand night colour (#0D0D0E): with the lights
off every pixel is exactly that colour, so the film starts and ends on the
app's own background.

Usage (from the repo root):
  python3 scripts/startup-ident/render_ident.py stills  --out build/ident/stills
  python3 scripts/startup-ident/render_ident.py frames  --out build/ident/frames --jobs 4
  python3 scripts/startup-ident/render_ident.py encode  --frames build/ident/frames --out build/ident --publish

Requires: numpy, scipy, pillow, fonttools, brotli, opencv-python-headless,
imageio-ffmpeg (bundled ffmpeg), optionally numexpr for speed.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageChops, ImageDraw
from scipy import ndimage

try:
    import numexpr as ne
except ImportError:  # pragma: no cover - optional accelerator
    ne = None

ROOT = Path(__file__).resolve().parents[2]
GEOMETRY = ROOT / "design" / "startup" / "axom-ident-geometry.json"
FONT = ROOT / "design" / "startup" / "fonts" / "poppins-latin-400-normal.woff2"

FPS = 30
DURATION = 7.0
FRAMES = int(round(FPS * DURATION))
SHUTTER = 0.5 / FPS  # 180 degree shutter

# ---------------------------------------------------------------- colour


def srgb_to_linear(c):
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(x):
    x = np.clip(x, 0.0, 1.0)
    return np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def hex_lin(h: str) -> np.ndarray:
    return srgb_to_linear(np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)]) / 255.0)


NIGHT = hex_lin("#0D0D0E")
GOLD = hex_lin("#C8A96A")
SUBTITLE_INK = hex_lin("#8C8981")
# Champagne-ivory metal reflectance (linear); tuned against the brand #E6E2D6.
METAL_F0 = np.array([0.835, 0.79, 0.69])

# ---------------------------------------------------------------- timing


def smoother(x):
    x = np.clip(x, 0.0, 1.0)
    return x * x * x * (x * (x * 6 - 15) + 10)


def ramp(t, a, b):
    return float(smoother((t - a) / (b - a)))


def fall(t, a, b):
    return 1.0 - ramp(t, a, b)


def sine_io(x):
    x = min(max(x, 0.0), 1.0)
    return 0.5 - 0.5 * math.cos(math.pi * x)


@dataclass
class Beat:
    """Every animated quantity at time t (seconds). Units: mark heights."""
    t: float
    cam_z: float = 0.0
    mark_z: float = 0.0
    fill: float = 0.0
    top: float = 0.0
    fill_dx: float = 0.0
    rim: float = 0.0
    kick: float = 0.0
    key: float = 0.0
    key_x: float = 0.0
    word: float = 0.0
    word_blur: float = 0.0
    word_dy: float = 0.0
    rule: float = 0.0
    sub: float = 0.0
    sub_blur: float = 0.0
    sub_dy: float = 0.0
    grain: float = 0.0


KEY_T0, KEY_T1 = 1.95, 3.45  # strip travel window
KEY_X0, KEY_X1 = -1.45, 1.45  # strip travel (relative to the mark centre)


def key_state(t: float):
    x = KEY_X0 + (KEY_X1 - KEY_X0) * sine_io((t - KEY_T0) / (KEY_T1 - KEY_T0))
    level = ramp(t, 1.95, 2.35) * fall(t, 2.98, 3.42)
    return x, level


def beat(t: float) -> Beat:
    b = Beat(t)
    # Camera: a slow dolly of ~3.5% over the whole film.
    b.cam_z = 7.25 - 0.26 * float(smoother(t / DURATION))
    # Emblem advances a fraction towards camera while it is revealed.
    b.mark_z = -0.11 * (1.0 - ramp(t, 0.55, 2.7))
    # 0.0-0.8 a faint edge; 0.8-2.2 emergence; hold; 5.9-6.5 the last highlight dies.
    b.rim = (0.06 * ramp(t, 0.05, 0.85) + 0.94 * ramp(t, 0.8, 2.35)) * fall(t, 5.9, 6.5)
    b.fill = (0.22 * ramp(t, 0.85, 2.3) + 0.78 * ramp(t, 2.8, 3.8)) * fall(t, 5.6, 6.3)
    b.top = (0.55 * ramp(t, 0.8, 2.2) + 0.45 * ramp(t, 2.7, 3.6)) * fall(t, 5.65, 6.35)
    b.fill_dx = 0.30 * ramp(t, 3.3, 6.2)  # residual drift during the hold
    b.kick = ramp(t, 1.1, 2.6) * fall(t, 5.65, 6.25)
    b.key_x, b.key = key_state(t)
    # Wordmark only after the luster has revealed the mark.
    b.word = ramp(t, 3.12, 3.98) * fall(t, 5.72, 6.2)
    b.word_blur = 0.016 * (1.0 - ramp(t, 3.08, 3.95))
    b.word_dy = 0.012 * (1.0 - ramp(t, 3.08, 4.05))
    b.rule = ramp(t, 3.6, 4.15) * fall(t, 5.6, 6.02)
    b.sub = 0.86 * ramp(t, 3.72, 4.42) * fall(t, 5.5, 5.95)
    b.sub_blur = 0.008 * (1.0 - ramp(t, 3.7, 4.4))
    b.sub_dy = 0.008 * (1.0 - ramp(t, 3.7, 4.45))
    b.grain = ramp(t, 0.15, 0.7) * fall(t, 6.35, 6.5)
    return b


# ---------------------------------------------------------------- layout

G = json.loads(GEOMETRY.read_text())
LK = G["lockup"]
LOCKUP_H = LK["subtitleBaselines"][1]
Y_APEX = -LOCKUP_H / 2.0          # world origin = lockup centre on the mark axis
MARK_CY = Y_APEX + 0.5
WORD_TOP = Y_APEX + LK["wordmarkCapTop"]
WORD_CAP = LK["wordmarkCapHeight"]
CAM_Y = 0.05                      # optical lift: lockup sits slightly above centre
F_4K = 486.0 * 7.0                # focal length (px @3840) -> mark 486 px tall at z=7
WALL_Z = -0.30                    # wall sits 0.3 mark heights behind the emblem
BEVEL = 0.019                     # emblem bevel width (mark heights)
WORD_BEVEL = 0.021                # wordmark bevel width (cap heights)
POOL_PEAK = 0.0046                # wall pool brightness above night at full fill (linear)

MARK_POLYS = [np.array(G["mark"][k], dtype=np.float64) for k in ("chevron", "diamond", "legLeft", "legRight")]
WORD_POLYS = [np.array(G["wordmark"][k], dtype=np.float64) for k in ("Lambda", "X", "M")]
RING = G["wordmark"]["O"]


# ---------------------------------------------------------------- distance fields


def polygon_sdf(px, py, polys):
    """Signed distance (positive inside) to disjoint polygons, with unit gradient."""
    best = np.full(px.shape, np.inf)
    vx = np.zeros(px.shape)
    vy = np.zeros(px.shape)
    inside = np.zeros(px.shape, dtype=bool)
    for poly in polys:
        ins = np.zeros(px.shape, dtype=bool)
        n = len(poly)
        for i in range(n):
            ax, ay = poly[i]
            bx, by = poly[(i + 1) % n]
            ex, ey = bx - ax, by - ay
            wx, wy = px - ax, py - ay
            tt = np.clip((wx * ex + wy * ey) / (ex * ex + ey * ey), 0.0, 1.0)
            dx, dy = wx - tt * ex, wy - tt * ey
            d2 = dx * dx + dy * dy
            m = d2 < best
            best = np.where(m, d2, best)
            vx = np.where(m, dx, vx)
            vy = np.where(m, dy, vy)
            if ey != 0:
                cross = (ay > py) != (by > py)
                ins ^= cross & (px < ax + (py - ay) * ex / ey)
        inside |= ins
    dist = np.sqrt(best)
    sgn = np.where(inside, 1.0, -1.0)
    inv = sgn / np.maximum(dist, 1e-12)
    return sgn * dist, vx * inv, vy * inv


def ellipse_sdf(px, py, cx, cy, rx, ry):
    x, y = px - cx, py - cy
    k = np.sqrt((x / rx) ** 2 + (y / ry) ** 2)
    gx, gy = x / (rx * rx), y / (ry * ry)
    gl = np.sqrt(gx * gx + gy * gy) + 1e-12
    d = (1.0 - k) * np.maximum(k, 1e-9) / gl
    return d, -gx / gl, -gy / gl


def wordmark_sdf(px, py):
    d, gx, gy = polygon_sdf(px, py, WORD_POLYS)
    (cx, cy), (ox, oy), (ix, iy) = RING["center"], RING["outer"], RING["inner"]
    do, gox, goy = ellipse_sdf(px, py, cx, cy, ox, oy)
    di, gix, giy = ellipse_sdf(px, py, cx, cy, ix, iy)
    use_o = do < -di
    dr = np.where(use_o, do, -di)
    grx = np.where(use_o, gox, -gix)
    gry = np.where(use_o, goy, -giy)
    use_r = dr > d
    return np.where(use_r, dr, d), np.where(use_r, grx, gx), np.where(use_r, gry, gy)


def bevel_angle(s):
    """Machined profile: outer roll (80->38 deg), flat chamfer, inner fillet to 0."""
    thc = math.radians(38.0)
    tho = math.radians(80.0)
    so, si = 0.16, 0.60
    s = np.clip(s, 0.0, None)
    a = np.where(s < so, thc + (tho - thc) * (0.5 + 0.5 * np.cos(np.pi * s / so)), thc)
    a = np.where(s >= si, thc * (0.5 + 0.5 * np.cos(np.pi * np.clip((s - si) / (1 - si), 0, 1))), a)
    return np.where(s >= 1.0, 0.0, a)


# ---------------------------------------------------------------- lights


def _unit(v):
    v = np.asarray(v, dtype=np.float64)
    return v / np.linalg.norm(v)


def _stratified(n, seed):
    rng = np.random.default_rng(seed)
    return (np.arange(n) + 0.5 + 0.7 * (rng.random(n) - 0.5)) / n - 0.5


@dataclass
class AreaLight:
    """Rectangular emitter sampled on a fixed stratified grid (no temporal noise)."""
    name: str
    size: tuple
    nu: int
    nw: int
    colour: np.ndarray
    k: float = 1.0                  # emission lobe cos^k (softbox grid)
    feather: float = 0.25           # soft edge, fraction of the half size
    hotspot: float = 0.0            # extra gain at the centre of the long axis
    hot_sigma: float = 0.3
    wall: bool = False
    wall_nu: int = 0
    wall_nw: int = 0
    wall_gain: float = 1.0          # studio flag: how much of it reaches the wall
    seed: int = 1
    _grid: dict = field(default_factory=dict)

    def grid(self, nu, nw):
        key = (nu, nw)
        if key not in self._grid:
            a = _stratified(nu, self.seed) * self.size[0]
            b = _stratified(nw, self.seed + 7) * self.size[1]
            A, B = np.meshgrid(a, b, indexing="ij")
            A, B = A.ravel(), B.ravel()
            fu = np.clip((0.5 * self.size[0] - np.abs(A)) / (self.feather * 0.5 * self.size[0]), 0, 1)
            fw = np.clip((0.5 * self.size[1] - np.abs(B)) / (self.feather * 0.5 * self.size[1]), 0, 1)
            prof = smoother(fu) * smoother(fw)
            if self.hotspot:
                prof = prof * (1.0 + self.hotspot * np.exp(-0.5 * (A / self.hot_sigma) ** 2))
            area = self.size[0] * self.size[1] / (nu * nw)
            self._grid[key] = (A, B, prof * area)
        return self._grid[key]

    def samples(self, centre, u, normal, level, wall=False):
        """World positions (m,3), rgb weights (m,3) and emitter normal."""
        nu, nw = (self.wall_nu or self.nu, self.wall_nw or self.nw) if wall else (self.nu, self.nw)
        A, B, wgt = self.grid(nu, nw)
        u = _unit(u)
        n = _unit(normal)
        w = np.cross(n, u)
        pos = centre[None] + A[:, None] * u[None] + B[:, None] * w[None]
        return pos, (wgt * level)[:, None] * self.colour[None], n


# Large scrim behind the camera: what the flat ivory faces reflect.
FRONT = AreaLight("front", (8.5, 9.5), 14, 14, np.array([1.0, 0.985, 0.96]) * 1.12, k=1.0, feather=0.8,
                  wall=True, wall_nu=6, wall_nw=6, wall_gain=0.3, seed=11)
# Overhead softbox: builds the wall pool and casts the shadow beneath the mark.
TOP = AreaLight("top", (3.0, 1.6), 10, 5, np.array([1.0, 0.98, 0.95]) * 0.36, k=2.0, feather=0.5,
                wall=True, wall_nu=9, wall_nw=5, wall_gain=3.2, seed=17)
# The luster: a narrow strip whose centre hotspot crosses the diamond.
KEY = AreaLight("key", (6.2, 0.15), 44, 2, np.array([1.0, 0.975, 0.94]) * 1.75, k=1.0, feather=0.5,
                hotspot=0.75, hot_sigma=0.42, wall=True, wall_nu=24, wall_nw=1, wall_gain=0.9, seed=23)
# Grazing top rim for the upward chamfers, and a muted-gold kicker from the left.
RIM = AreaLight("rim", (6.5, 0.38), 28, 2, np.array([0.97, 0.98, 1.0]) * 0.7, k=2.0, feather=0.4, seed=31)
KICK = AreaLight("kick", (3.2, 0.34), 14, 2, (GOLD / GOLD.max()) * 0.3, k=2.0, feather=0.4, seed=41)

KEY_TILT = math.radians(19.0)
KEY_Z = 1.3


def light_rig(b: Beat, cam, for_wall=False):
    """(light, positions, weights, emitter normal) for every light that is on."""
    mc = np.array([0.0, MARK_CY, b.mark_z])
    rig = []

    def aim(centre):
        return mc - centre

    if b.fill > 1e-5:
        c = np.array([-0.9 + b.fill_dx, MARK_CY - 1.25, 9.6])
        rig.append((FRONT, *FRONT.samples(c, [1, 0, 0], aim(c), b.fill, wall=for_wall)))
    if b.top > 1e-5:
        c = mc + np.array([-0.45 + 0.5 * b.fill_dx, -2.75, 2.6])
        rig.append((TOP, *TOP.samples(c, [1, 0, 0], aim(c), b.top, wall=for_wall)))
    if b.key > 1e-5:
        # Hotspot height chosen so its mirror image crosses the diamond.
        dia = np.array([0.0, Y_APEX + 0.6604, 0.0])
        cz = cam[2]
        hot_y = (dia[1] * (cz + KEY_Z) - cam[1] * KEY_Z) / cz
        u = np.array([math.sin(KEY_TILT), -math.cos(KEY_TILT), 0.0])
        if for_wall:
            c = np.array([b.key_x, hot_y, KEY_Z])
            rig.append((KEY, *KEY.samples(c, u, [0, 0, -1], b.key, wall=True)))
        else:
            # Integrate the moving strip over the shutter (motion blur).
            nt = 5
            for j in range(nt):
                tj = b.t + (j / (nt - 1) - 0.5) * SHUTTER
                xj, lj = key_state(tj)
                c = np.array([xj, hot_y, KEY_Z])
                rig.append((KEY, *KEY.samples(c, u, [0, 0, -1], lj / nt)))
    if b.rim > 1e-5 and not for_wall:
        c = mc + np.array([-0.25, -2.35, 0.78])
        rig.append((RIM, *RIM.samples(c, [1, 0, 0], aim(c), b.rim)))
    if b.kick > 1e-5 and not for_wall:
        c = mc + np.array([-2.45, -0.55, 0.85])
        rig.append((KICK, *KICK.samples(c, [0, 1, 0], aim(c), b.kick)))
    return rig


# ---------------------------------------------------------------- metal BRDF


def _ev(expr, local):
    if ne is not None:
        return ne.evaluate(expr, local_dict=local)
    return eval(expr, {"np": np, "exp": np.exp, "sqrt": np.sqrt, "where": np.where}, local)


def metal_radiance(P, N, T, B, at, ab, F0, cam, rig, block=24576, chunk=40):
    """Outgoing radiance of brushed metal for sample points (n,3). float32 rgb."""
    n = P.shape[0]
    out = np.zeros((n, 3), dtype=np.float64)
    V = cam[None] - P
    V /= np.linalg.norm(V, axis=1, keepdims=True)
    for i0 in range(0, n, block):
        sl = slice(i0, i0 + block)
        loc = {}
        for name, arr in (("P", P), ("N", N), ("T", T), ("B", B), ("V", V)):
            a = arr[sl].astype(np.float32)
            for j, ax in enumerate("xyz"):
                loc[name + ax] = a[:, j:j + 1]
        loc["at"] = at[sl].astype(np.float32)[:, None]
        loc["ab"] = ab[sl].astype(np.float32)[:, None]
        acc = np.zeros((a.shape[0], 3))
        accf = np.zeros((a.shape[0], 3))
        for light, pos, wgt, nrm in rig:
            kp1 = np.float32(light.k + 1.0)
            for j0 in range(0, len(pos), chunk):
                S = pos[j0:j0 + chunk].astype(np.float32)
                W = wgt[j0:j0 + chunk]
                L = dict(loc)
                L.update(Sx=S[None, :, 0], Sy=S[None, :, 1], Sz=S[None, :, 2],
                         Lnx=np.float32(nrm[0]), Lny=np.float32(nrm[1]), Lnz=np.float32(nrm[2]), kp1=kp1,
                         inv4pi=np.float32(1 / np.pi))
                L["dx"] = _ev("Sx-Px", L)
                L["dy"] = _ev("Sy-Py", L)
                L["dz"] = _ev("Sz-Pz", L)
                L["r2"] = _ev("dx*dx+dy*dy+dz*dz", L)
                L["ir"] = _ev("1/sqrt(r2)", L)
                L["ndl"] = _ev("(dx*Nx+dy*Ny+dz*Nz)*ir", L)
                L["ce"] = _ev("-(dx*Lnx+dy*Lny+dz*Lnz)*ir", L)
                L["hx"] = _ev("dx*ir+Vx", L)
                L["hy"] = _ev("dy*ir+Vy", L)
                L["hz"] = _ev("dz*ir+Vz", L)
                L["hn"] = _ev("where(hx*Nx+hy*Ny+hz*Nz>1e-4, hx*Nx+hy*Ny+hz*Nz, 1e-4)", L)
                L["hh"] = _ev("hx*hx+hy*hy+hz*hz", L)
                g = _ev("where((ndl>0)&(ce>0), inv4pi/(at*ab)*hh/(hn*hn*hn*hn)"
                        "*exp(-((hx*Tx+hy*Ty+hz*Tz)**2/(at*at)+(hx*Bx+hy*By+hz*Bz)**2/(ab*ab))/(hn*hn))"
                        "*ndl*ce**kp1/r2, 0)", L)
                L["g"] = g
                L["om"] = _ev("1-(hx*Vx+hy*Vy+hz*Vz)/sqrt(hh)", L)
                fr = _ev("g*where(om>0, om, 0)**5", L)
                acc += g.astype(np.float64) @ W
                accf += fr.astype(np.float64) @ W
        f0 = F0[sl]
        out[sl] = f0 * (acc - accf) + accf
    return out


# ---------------------------------------------------------------- textures


def brushed_texture(seed, shape, sig_along, sig_across):
    rng = np.random.default_rng(seed)
    t = ndimage.gaussian_filter(rng.standard_normal(shape), (sig_across, sig_along), mode="wrap")
    return (t / t.std()).astype(np.float32)


def slate_texture(h, w, k, seed=5):
    """Near-imperceptible stone/paper tooth for the wall (unit-ish amplitude)."""
    rng = np.random.default_rng(seed)
    sh = (max(8, h // 4), max(8, w // 4))
    low = ndimage.gaussian_filter(rng.standard_normal(sh), 22.0 * k, mode="wrap")
    low = ndimage.zoom(low / low.std(), (h / sh[0], w / sh[1]), order=3)[:h, :w]
    mid = ndimage.gaussian_filter(rng.standard_normal((h, w)), (5 * k, 9 * k), mode="wrap")
    fine = ndimage.gaussian_filter(rng.standard_normal((h, w)), 0.9 * max(k, 0.5), mode="wrap")
    return (0.55 * low + 0.3 * mid / mid.std() + 0.25 * fine / fine.std()).astype(np.float32)


# ---------------------------------------------------------------- subtitle glyphs


def poppins_line_polys(text, cap, tracking):
    """Glyph contours (world units) for one centred subtitle line, baseline y=0."""
    from fontTools.pens.recordingPen import DecomposingRecordingPen
    from fontTools.ttLib import TTFont
    font = TTFont(str(FONT))
    cmap, gs, hmtx = font.getBestCmap(), font.getGlyphSet(), font["hmtx"]
    units_cap = font["OS/2"].sCapHeight
    s = cap / units_cap
    contours, pen_x = [], 0.0
    ink_l, ink_r = None, None
    for ch in text:
        name = cmap[ord(ch)]
        rec = DecomposingRecordingPen(gs)
        gs[name].draw(rec)
        cur, last = [], None
        for op, args in rec.value:
            if op == "moveTo":
                cur, last = [args[0]], args[0]
            elif op == "lineTo":
                cur.append(args[0])
                last = args[0]
            elif op == "qCurveTo":
                offs, end = list(args[:-1]), args[-1]
                p0 = last
                for i, o in enumerate(offs):
                    nxt = end if i == len(offs) - 1 else ((o[0] + offs[i + 1][0]) / 2, (o[1] + offs[i + 1][1]) / 2)
                    for tt in np.linspace(0, 1, 10)[1:]:
                        cur.append(((1 - tt) ** 2 * p0[0] + 2 * (1 - tt) * tt * o[0] + tt * tt * nxt[0],
                                    (1 - tt) ** 2 * p0[1] + 2 * (1 - tt) * tt * o[1] + tt * tt * nxt[1]))
                    p0 = nxt
                last = end
            elif op == "curveTo":
                (c1, c2, p3), p0 = args, last
                for tt in np.linspace(0, 1, 12)[1:]:
                    cur.append(tuple((1 - tt) ** 3 * np.array(p0) + 3 * (1 - tt) ** 2 * tt * np.array(c1)
                                     + 3 * (1 - tt) * tt * tt * np.array(c2) + tt ** 3 * np.array(p3)))
                last = p3
            elif op in ("closePath", "endPath") and cur:
                arr = np.array(cur, dtype=np.float64)
                pts = np.stack([pen_x + arr[:, 0] * s, -arr[:, 1] * s], 1)
                contours.append(pts)
                ink_l = pts[:, 0].min() if ink_l is None else min(ink_l, pts[:, 0].min())
                ink_r = pts[:, 0].max() if ink_r is None else max(ink_r, pts[:, 0].max())
                cur = []
        pen_x += hmtx[name][0] * s + tracking
    shift = -(ink_l + ink_r) / 2
    return [c + np.array([shift, 0.0]) for c in contours]


# ---------------------------------------------------------------- scene


class Scene:
    def __init__(self, width=3840, height=2160, ss=2):
        self.W, self.H, self.ss = width, height, ss
        self.k = width / 3840.0
        self.F = F_4K * self.k
        # Occluder silhouette for wall shadows, in mark units.
        self.occ_res = 260.0
        self.occ_x0, self.occ_y0 = -0.7, -0.12
        gy, gx = np.mgrid[0:int(1.24 * self.occ_res), 0:int(1.4 * self.occ_res)]
        mx = self.occ_x0 + (gx + 0.5) / self.occ_res
        my = self.occ_y0 + (gy + 0.5) / self.occ_res
        d, _, _ = polygon_sdf(mx, my, MARK_POLYS)
        self.occ = np.clip(d * self.occ_res + 0.5, 0, 1).astype(np.float32)
        # Brushing textures, parameterised in object units (texels per unit).
        self.tex_res = 1400.0
        self.tex_a = brushed_texture(3, (1600, 1800), 240.0, 1.5)
        self.tex_b = brushed_texture(4, (1600, 1800), 90.0, 0.8)
        self.slate = slate_texture(height, width, self.k)
        yy, xx = np.mgrid[0:height, 0:width].astype(np.float32)
        r = np.sqrt(((xx - width / 2) / (0.5 * width)) ** 2 + ((yy - height * 0.45) / (0.5 * height)) ** 2)
        self.vignette = (1.0 - smoother((r - 0.3) / 0.72)).astype(np.float32)
        self.sub_lines = [poppins_line_polys(txt, LK["subtitleCapHeight"], LK["subtitleTracking"])
                          for txt in LK["subtitle"]]
        self._pool_norm = None

    # -- projection helpers ------------------------------------------------
    def to_screen(self, X, Y, z, cam):
        s = self.F / (cam[2] - z)
        return self.W / 2 + s * (X - cam[0]), self.H / 2 + s * (Y - cam[1])

    def sample_grid(self, x0, x1, y0, y1, z, cam):
        """Supersample grid over a pixel box, back-projected onto plane z."""
        ss = self.ss
        xs = x0 + (np.arange((x1 - x0) * ss) + 0.5) / ss
        ys = y0 + (np.arange((y1 - y0) * ss) + 0.5) / ss
        SX, SY = np.meshgrid(xs, ys)
        scale = (cam[2] - z) / self.F
        return cam[0] + (SX - self.W / 2) * scale, cam[1] + (SY - self.H / 2) * scale, scale / ss

    def box(self, X0, X1, Y0, Y1, z, cam, pad=3):
        sx0, sy0 = self.to_screen(X0, Y0, z, cam)
        sx1, sy1 = self.to_screen(X1, Y1, z, cam)
        x0, y0 = max(0, int(math.floor(sx0)) - pad), max(0, int(math.floor(sy0)) - pad)
        x1, y1 = min(self.W, int(math.ceil(sx1)) + pad), min(self.H, int(math.ceil(sy1)) + pad)
        return x0, x1, y0, y1

    def downsample(self, a):
        ss = self.ss
        h, w = a.shape[0] // ss, a.shape[1] // ss
        return a.reshape(h, ss, w, ss, *a.shape[2:]).mean(axis=(1, 3))

    # -- metal layers -----------------------------------------------------
    def metal_layer(self, kind, b: Beat, cam, rig):
        if kind == "mark":
            z, bev, unit = b.mark_z, BEVEL, 1.0
            X0, X1, Y0, Y1 = -0.6, 0.6, Y_APEX - 0.02, Y_APEX + 1.02
        else:
            z, bev, unit = 0.0, WORD_BEVEL, WORD_CAP
            dy = b.word_dy
            X0, X1 = -3.3 * WORD_CAP, 3.3 * WORD_CAP
            Y0, Y1 = WORD_TOP + dy - 0.1 * WORD_CAP, WORD_TOP + dy + 1.1 * WORD_CAP
        x0, x1, y0, y1 = self.box(X0, X1, Y0, Y1, z, cam)
        X, Y, spacing = self.sample_grid(x0, x1, y0, y1, z, cam)
        if kind == "mark":
            lx, ly = X, Y - Y_APEX
            d, gx, gy = polygon_sdf(lx, ly, MARK_POLYS)
        else:
            lx, ly = X / WORD_CAP, (Y - WORD_TOP - b.word_dy) / WORD_CAP
            d, gx, gy = wordmark_sdf(lx, ly)
        cov = np.clip(d * unit / spacing + 0.5, 0.0, 1.0)
        sel = cov > 0
        colour = np.zeros(cov.shape + (3,))
        if sel.any():
            th = bevel_angle(d[sel] / bev)
            sn, cs = np.sin(th), np.cos(th)
            N = np.stack([-gx[sel] * sn, -gy[sel] * sn, cs], 1)
            # texture coordinates in object units (wrap)
            tu = lx[sel] * self.tex_res + (0 if kind == "mark" else 900)
            tv = ly[sel] * self.tex_res + (0 if kind == "mark" else 700)
            coords = np.stack([tv % self.tex_a.shape[0], tu % self.tex_a.shape[1]])
            ta = ndimage.map_coordinates(self.tex_a, coords, order=1, mode="wrap")
            tb = ndimage.map_coordinates(self.tex_b, coords, order=1, mode="wrap")
            # groove direction: horizontal, projected into the tangent plane
            T = np.array([1.0, 0.0, 0.0])[None] - N[:, 0:1] * N
            T /= np.linalg.norm(T, axis=1, keepdims=True)
            Bv = np.cross(N, T)
            N = N + (0.0035 * ta + 0.0025 * tb)[:, None] * Bv
            N /= np.linalg.norm(N, axis=1, keepdims=True)
            T = T - (T * N).sum(1, keepdims=True) * N
            T /= np.linalg.norm(T, axis=1, keepdims=True)
            Bv = np.cross(N, T)
            at = 0.040 * (1 + 0.08 * tb)
            ab = 0.22 * (1 + 0.10 * ta)
            F0 = METAL_F0[None] * (1 + 0.006 * ta + 0.004 * tb)[:, None]
            P = np.stack([X[sel], Y[sel], np.full(sel.sum(), z)], 1)
            lit = metal_radiance(P, N, T, Bv, at, ab, F0, cam, rig)
            colour[sel] = lit
        colour += NIGHT[None, None]
        prem = self.downsample(colour * cov[..., None])
        alpha = self.downsample(cov)
        return (x0, x1, y0, y1), prem, alpha

    # -- wall ------------------------------------------------------------
    def wall(self, b: Beat, cam):
        W, H = self.W, self.H
        f = 4
        h, w = H // f, W // f
        sy, sx = np.mgrid[0:h, 0:w].astype(np.float64)
        sx, sy = (sx + 0.5) * f, (sy + 0.5) * f
        scale = (cam[2] - WALL_Z) / self.F
        QX, QY = cam[0] + (sx - W / 2) * scale, cam[1] + (sy - H / 2) * scale
        E = np.zeros((h, w, 3))
        for light, pos, wgt, nrm in light_rig(b, cam, for_wall=True):
            for s, wv in zip(pos, wgt):
                dx, dy, dz = s[0] - QX, s[1] - QY, s[2] - WALL_Z
                r2 = dx * dx + dy * dy + dz * dz
                ir = 1 / np.sqrt(r2)
                ce = np.clip(-(dx * nrm[0] + dy * nrm[1] + dz * nrm[2]) * ir, 0, None)
                cw = np.clip(dz * ir, 0, None)
                irr = ce ** (light.k + 1) * cw / r2
                # shadow: where does the segment wall->light cross the emblem plane?
                tt = (b.mark_z - WALL_Z) / dz
                mx, my = QX + tt * dx, QY + tt * dy - Y_APEX
                occ = ndimage.map_coordinates(self.occ, [(my - self.occ_y0) * self.occ_res - 0.5,
                                                         (mx - self.occ_x0) * self.occ_res - 0.5], order=1, cval=0.0)
                E += (irr * (1 - occ))[..., None] * (wv * light.wall_gain)[None, None]
        if self._pool_norm is None:
            ref = beat(4.8)
            Eref = self._pool_at_centre(ref, cam_for(ref))
            self._pool_norm = POOL_PEAK / max(Eref, 1e-12)
        E = ndimage.gaussian_filter(E, (1.2, 1.2, 0))
        E = cv2.resize(E.astype(np.float32), (W, H), interpolation=cv2.INTER_CUBIC)
        E = np.clip(E, 0, None) * self._pool_norm
        tex = 1.0 + 0.085 * self.slate
        return NIGHT.astype(np.float32)[None, None] + E * (self.vignette * tex)[..., None]

    def _pool_at_centre(self, b, cam):
        Q = np.array([0.0, MARK_CY + 0.25, WALL_Z])
        tot = 0.0
        for light, pos, wgt, nrm in light_rig(b, cam, for_wall=True):
            for s, wv in zip(pos, wgt):
                d = s - Q
                r2 = d @ d
                ce = max(-(d @ nrm) / math.sqrt(r2), 0)
                tot += ce ** (light.k + 1) * max(d[2] / math.sqrt(r2), 0) / r2 * wv.mean() * light.wall_gain
        return tot

    # -- flat typography ---------------------------------------------------
    def rasterise(self, polys_screen, x0, y0, x1, y1, ss=4):
        """Even-odd coverage of screen-space contours in a pixel box."""
        wv, hv = (x1 - x0) * ss, (y1 - y0) * ss
        acc = Image.new("1", (wv, hv), 0)
        for poly in polys_screen:
            m = Image.new("1", (wv, hv), 0)
            pts = [((x - x0) * ss, (y - y0) * ss) for x, y in poly]
            ImageDraw.Draw(m).polygon(pts, fill=1)
            acc = ImageChops.logical_xor(acc, m)
        a = np.asarray(acc, dtype=np.float32)
        return a.reshape(y1 - y0, ss, x1 - x0, ss).mean(axis=(1, 3))

    def subtitle_layer(self, b: Beat, cam):
        s = self.F / cam[2]
        polys, allp = [], []
        for base, line in zip(LK["subtitleBaselines"], self.sub_lines):
            for c in line:
                X = c[:, 0]
                Y = Y_APEX + base + c[:, 1] + b.sub_dy
                sx, sy = self.to_screen(X, Y, 0.0, cam)
                polys.append(list(zip(sx, sy)))
                allp.append(np.stack([sx, sy], 1))
        allp = np.concatenate(allp)
        pad = int(4 + 3 * b.sub_blur * s)
        x0, y0 = int(allp[:, 0].min()) - pad, int(allp[:, 1].min()) - pad
        x1, y1 = int(allp[:, 0].max()) + pad, int(allp[:, 1].max()) + pad
        cov = self.rasterise(polys, x0, y0, x1, y1)
        return (x0, x1, y0, y1), cov, b.sub_blur * s

    def rule_layer(self, b: Beat, cam):
        s = self.F / cam[2]
        cx, cy = self.to_screen(0.0, Y_APEX + LK["ruleCenter"], 0.0, cam)
        hw, ht = 0.5 * LK["ruleWidth"] * s, 0.5 * LK["ruleThickness"] * s
        x0, x1 = int(cx - hw) - 3, int(cx + hw) + 4
        y0, y1 = int(cy - ht) - 3, int(cy + ht) + 4
        xs = np.arange(x0, x1) + 0.5
        ys = np.arange(y0, y1) + 0.5
        cxv = np.clip(np.minimum(xs + 0.5, cx + hw) - np.maximum(xs - 0.5, cx - hw), 0, 1)
        cyv = np.clip(np.minimum(ys + 0.5, cy + ht) - np.maximum(ys - 0.5, cy - ht), 0, 1)
        # the rule tapers very slightly at its ends like a drawn hairline
        taper = np.clip(1.0 - np.abs(xs - cx) / hw, 0, 1) ** 0.15
        return (x0, x1, y0, y1), np.outer(cyv, cxv * taper)

    # -- frame ----------------------------------------------------------------
    def render(self, t: float) -> np.ndarray:
        b = beat(t)
        cam = cam_for(b)
        img = self.wall(b, cam)
        rig = light_rig(b, cam)
        # emblem
        (x0, x1, y0, y1), prem, alpha = self.metal_layer("mark", b, cam, rig)
        img[y0:y1, x0:x1] = img[y0:y1, x0:x1] * (1 - alpha[..., None]) + prem
        # wordmark: opacity + soft focus
        if b.word > 1e-4:
            (x0, x1, y0, y1), prem, alpha = self.metal_layer("word", b, cam, rig)
            sig = b.word_blur * self.F / cam[2]
            if sig > 0.05:
                prem = ndimage.gaussian_filter(prem, (sig, sig, 0))
                alpha = ndimage.gaussian_filter(alpha, sig)
            img[y0:y1, x0:x1] = img[y0:y1, x0:x1] * (1 - b.word * alpha[..., None]) + b.word * prem
        if b.rule > 1e-4:
            (x0, x1, y0, y1), cov = self.rule_layer(b, cam)
            a = (0.78 * b.rule * cov)[..., None]
            img[y0:y1, x0:x1] = img[y0:y1, x0:x1] * (1 - a) + a * GOLD[None, None]
        if b.sub > 1e-4:
            (x0, x1, y0, y1), cov, sig = self.subtitle_layer(b, cam)
            if sig > 0.05:
                cov = ndimage.gaussian_filter(cov, sig)
            a = (b.sub * cov)[..., None]
            img[y0:y1, x0:x1] = img[y0:y1, x0:x1] * (1 - a) + a * SUBTITLE_INK[None, None]
        return img.astype(np.float32)


def cam_for(b: Beat):
    return np.array([0.0, CAM_Y, b.cam_z])


# ---------------------------------------------------------------- output


def tonemap(lin):
    """Identity below 0.72, smooth shoulder to 1.0 above (keeps highlight colour)."""
    k = 0.72
    x = lin.astype(np.float32)
    over = np.maximum(x - k, 0)
    y = np.where(x > k, k + (1 - k) * (1 - np.exp(-over / (1 - k))), x)
    return linear_to_srgb(y).astype(np.float32)


def save_png16(path, srgb):
    arr = np.clip(np.round(srgb * 65535.0), 0, 65535).astype(np.uint16)
    cv2.imwrite(str(path), arr[..., ::-1])


def load_png16(path):
    a = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
    return a[..., ::-1].astype(np.float32) / 65535.0


# ---------------------------------------------------------------- commands

_SCENE = None


def _worker_init(w, h, ss):
    global _SCENE
    if ne is not None:
        ne.set_num_threads(1)
    _SCENE = Scene(w, h, ss)


def _worker_frame(args):
    i, out = args
    path = Path(out) / f"frame_{i:04d}.png"
    if path.exists():
        return i, 0.0
    t0 = time.time()
    img = _SCENE.render(i / FPS)
    save_png16(path, tonemap(img))
    return i, time.time() - t0


def cmd_frames(a):
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    lo, hi = (int(v) for v in a.range.split(":")) if a.range else (0, FRAMES)
    todo = [(i, str(out)) for i in range(lo, hi)]
    if a.jobs > 1:
        import multiprocessing as mp
        with mp.get_context("fork").Pool(a.jobs, _worker_init, (a.width, a.height, a.ss)) as pool:
            for i, dt in pool.imap_unordered(_worker_frame, todo):
                print(f"frame {i:4d}  {dt:6.1f}s", flush=True)
    else:
        _worker_init(a.width, a.height, a.ss)
        for job in todo:
            i, dt = _worker_frame(job)
            print(f"frame {i:4d}  {dt:6.1f}s", flush=True)


def cmd_stills(a):
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    scene = Scene(a.width, a.height, a.ss)
    times = [float(v) for v in a.times.split(",")]
    tiles = []
    for t in times:
        t0 = time.time()
        srgb = tonemap(scene.render(t))
        save_png16(out / f"still_{t:05.2f}.png", srgb)
        tiles.append((t, srgb))
        print(f"t={t:5.2f}s  {time.time() - t0:5.1f}s", flush=True)
    if a.sheet:
        cols = 3
        th, tw = tiles[0][1].shape[:2]
        rows = math.ceil(len(tiles) / cols)
        sheet = np.zeros((rows * (th + 30), cols * tw, 3), np.float32)
        for n, (t, im) in enumerate(tiles):
            r, c = divmod(n, cols)
            sheet[r * (th + 30) + 30:(r + 1) * (th + 30), c * tw:(c + 1) * tw] = im
        pil = Image.fromarray((np.clip(sheet, 0, 1) * 255 + 0.5).astype(np.uint8))
        d = ImageDraw.Draw(pil)
        for n, (t, _) in enumerate(tiles):
            r, c = divmod(n, cols)
            d.text((c * tw + 8, r * (th + 30) + 8), f"t = {t:.2f}s", fill=(160, 150, 120))
        pil.save(out / "contact_sheet.png")


def grain_frame(srgb, i, amount, lsb):
    """Monochrome temporal grain + dither, in display units of one code value."""
    if amount <= 0:
        return srgb
    rng = np.random.default_rng(1000 + i)
    h, w = srgb.shape[:2]
    luma = srgb @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    sigma = (0.55 + 0.9 * np.sqrt(np.clip(luma, 0, 1))) * amount
    noise = rng.standard_normal((h, w), dtype=np.float32) * sigma
    return srgb + (noise * lsb)[..., None]


def cmd_encode(a):
    import imageio_ffmpeg
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    frames = sorted(Path(a.frames).glob("frame_*.png"))
    if len(frames) != FRAMES:
        sys.exit(f"expected {FRAMES} frames, found {len(frames)}")
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    tags = ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv"]
    vf = "scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int"
    targets = {
        "4k-h264": dict(size=None, bits=8, grain=1.0, file="AXOM_ident_4K_30p_h264.mp4",
                        codec=["-c:v", "libx264", "-preset", "slow", "-crf", "14", "-tune", "film", "-profile:v", "high",
                               "-x264-params", "aq-mode=3:aq-strength=0.9:deblock=-1,-1", "-pix_fmt", "yuv420p"]),
        "4k-hevc10": dict(size=None, bits=10, grain=1.0, file="AXOM_ident_4K_30p_hevc10.mp4",
                          codec=["-c:v", "libx265", "-preset", "slow", "-crf", "14", "-pix_fmt", "yuv420p10le",
                                 "-tag:v", "hvc1", "-x265-params",
                                 "aq-mode=3:colorprim=bt709:transfer=bt709:colormatrix=bt709:range=limited:log-level=error"]),
        "1080-h264": dict(size=(1920, 1080), bits=8, grain=a.web_grain, file="AXOM_ident_1080p_30p_h264.mp4",
                          codec=["-c:v", "libx264", "-preset", "veryslow", "-crf", str(a.web_crf), "-tune", "film",
                                 "-profile:v", "high", "-x264-params", "aq-mode=3:aq-strength=1.0",
                                 "-pix_fmt", "yuv420p"]),
    }
    h0, w0 = load_png16(frames[0]).shape[:2]
    jobs = []
    for name in a.targets.split(","):
        spec = targets[name]
        w, h = spec["size"] or (w0, h0)
        pix = "rgb48le" if spec["bits"] > 8 else "rgb24"
        cmd = [ffmpeg, "-y", "-hide_banner", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", pix,
               "-s", f"{w}x{h}", "-r", str(FPS), "-i", "-", "-vf", vf, *spec["codec"], *tags,
               "-movflags", "+faststart", "-an", str(out / spec["file"])]
        jobs.append((name, spec, (w, h), subprocess.Popen(cmd, stdin=subprocess.PIPE)))
    # One pass over the 16-bit masters feeds every encoder.
    for i, fp in enumerate(frames):
        master = load_png16(fp)
        amount = beat(i / FPS).grain
        for name, spec, (w, h), proc in jobs:
            srgb = master
            if (w, h) != (w0, h0):
                lin = cv2.resize(srgb_to_linear(master).astype(np.float32), (w, h), interpolation=cv2.INTER_AREA)
                srgb = linear_to_srgb(lin).astype(np.float32)
            srgb = grain_frame(srgb, i, amount * spec["grain"], 1 / 255.0)
            if spec["bits"] > 8:
                q = np.clip(np.round(srgb * 1023.0), 0, 1023).astype(np.uint16) * 64
            else:
                q = np.clip(np.round(srgb * 255.0), 0, 255).astype(np.uint8)
            proc.stdin.write(np.ascontiguousarray(q).tobytes())
    for name, spec, _, proc in jobs:
        proc.stdin.close()
        if proc.wait() != 0:
            sys.exit(f"ffmpeg failed for {name}")
        print(f"{name}: {out / spec['file']}  {(out / spec['file']).stat().st_size / 1e6:.1f} MB")

    # A finished still of the full lockup (t = 5.0 s), dithered to 8 bit.
    hold = grain_frame(load_png16(frames[int(5.0 * FPS)]), 150, 1.0, 1 / 255.0)
    cv2.imwrite(str(out / "AXOM_ident_lockup_4K.png"),
                np.clip(np.round(hold * 255), 0, 255).astype(np.uint8)[..., ::-1])
    if a.publish:
        publish(out)


def _sha(path: Path) -> str:
    import hashlib
    return hashlib.sha256(path.read_bytes()).hexdigest()


def publish(out: Path):
    """Install the 1080p cut as the app's startup film and record provenance."""
    import shutil
    web = ROOT / "web" / "public" / "startup"
    web.mkdir(parents=True, exist_ok=True)
    movie, poster = web / "axom-ident.mp4", web / "axom-ident-poster.png"
    shutil.copyfile(out / "AXOM_ident_1080p_30p_h264.mp4", movie)
    # Frame 1 of the film is exactly the overlay colour, so the poster is too.
    night = np.round(linear_to_srgb(NIGHT) * 255).astype(np.uint8)
    cv2.imwrite(str(poster), np.broadcast_to(night[::-1], (1080, 1920, 3)).copy())
    rel = lambda p: str(p.relative_to(ROOT))
    manifest = {
        "renderer": rel(Path(__file__)),
        "geometry": {"path": rel(GEOMETRY), "sha256": _sha(GEOMETRY)},
        "fps": FPS, "frames": FRAMES, "durationSeconds": DURATION,
        "master": [3840, 2160], "web": [1920, 1080],
        "background": "#0D0D0E",
        "audio": False,
        "beats": {"faintEdge": [0.0, 0.8], "emerge": [0.8, 2.2], "luster": [2.2, 3.1],
                  "wordmark": [3.1, 4.0], "subtitle": [3.7, 4.4], "hold": [4.4, 5.5],
                  "retreat": [5.5, 6.5], "black": [6.5, 7.0]},
        "assets": [{"path": rel(p), "bytes": p.stat().st_size, "sha256": _sha(p)} for p in (movie, poster)],
    }
    (ROOT / "design" / "startup" / "ident-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"published {rel(movie)} ({movie.stat().st_size / 1e6:.2f} MB) and {rel(poster)}")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    for name in ("frames", "stills"):
        q = sub.add_parser(name)
        q.add_argument("--out", required=True)
        q.add_argument("--width", type=int, default=3840 if name == "frames" else 1280)
        q.add_argument("--height", type=int, default=2160 if name == "frames" else 720)
        q.add_argument("--ss", type=int, default=2)
        if name == "frames":
            q.add_argument("--jobs", type=int, default=os.cpu_count() or 1)
            q.add_argument("--range", default="")
        else:
            q.add_argument("--times", default="0.4,0.8,1.5,2.2,2.45,2.62,2.8,3.1,3.6,4.2,5.0,6.1")
            q.add_argument("--sheet", action="store_true")
    q = sub.add_parser("encode")
    q.add_argument("--frames", required=True)
    q.add_argument("--out", required=True)
    q.add_argument("--targets", default="4k-h264,4k-hevc10,1080-h264")
    q.add_argument("--publish", action="store_true", help="install the 1080p cut into web/public/startup")
    q.add_argument("--web-crf", type=int, default=18, help="x264 CRF of the app cut")
    q.add_argument("--web-grain", type=float, default=0.7, help="grain scale of the app cut")
    a = p.parse_args()
    {"frames": cmd_frames, "stills": cmd_stills, "encode": cmd_encode}[a.cmd](a)


if __name__ == "__main__":
    main()
