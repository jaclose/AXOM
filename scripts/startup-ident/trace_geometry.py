#!/usr/bin/env python3
"""Vectorise the supplied AXOM identity into exact, symmetric geometry.

No vector master exists for the mark, so the brand PNGs in ``axom/`` are the
source of truth. Every straight edge is recovered by fitting a line to the
sub-pixel 50% iso-contour of the artwork (typical residual: 0.05 px) and
vertices are the intersections of neighbouring edge lines, which restores
the true corners that anti-aliasing rounds off. Mirrored pairs are then
averaged about the fitted axis so the mark is exactly symmetric.

Nothing is redesigned: the truncated arm tips (cut parallel to the diamond
facets), the leg cuts, the ~74% M vertex and the crossbar-free Λ are all read
from the pixels. The lockup spacing is measured from ``axom overview.png``.

Output: design/startup/axom-ident-geometry.json
Usage:  python3 scripts/startup-ident/trace_geometry.py
Needs:  numpy, opencv-python-headless, scikit-image
"""
from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np
from skimage import measure

ROOT = Path(__file__).resolve().parents[2]
MARK_SRC = ROOT / "axom" / "app icon.png"
WORD_SRC = ROOT / "axom" / "axom lettering.16.43.png"
OUT = ROOT / "design" / "startup" / "axom-ident-geometry.json"


def luminance(path: Path) -> np.ndarray:
    img = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)[..., :3].astype(np.float64)
    return 0.2126 * img[..., 2] + 0.7152 * img[..., 1] + 0.0722 * img[..., 0]


def fit_line(pts: np.ndarray):
    """Total-least-squares line: (point, unit direction, rms residual)."""
    c = pts.mean(0)
    _, _, vt = np.linalg.svd(pts - c)
    return c, vt[0], float(np.sqrt((((pts - c) @ vt[1]) ** 2).mean()))


def intersect(l1, l2) -> np.ndarray:
    (c1, d1, *_), (c2, d2, *_) = l1, l2
    t = np.linalg.solve(np.array([d1, -d2]).T, c2 - c1)
    return c1 + t[0] * d1


def unit(v: np.ndarray) -> np.ndarray:
    return v / np.linalg.norm(v)


def traced_polygons(g: np.ndarray, level: float, tol: float, min_edge: float):
    """Sub-pixel contours -> polygons whose vertices are edge-line intersections."""
    shapes = []
    for c in measure.find_contours(g, level):
        if len(c) < 30:
            continue
        pts = c[:, ::-1]  # (x, y)
        rough = measure.approximate_polygon(pts, tolerance=tol)[:-1]
        lines = []
        for i in range(len(rough)):
            a, b = rough[i], rough[(i + 1) % len(rough)]
            length = np.linalg.norm(b - a)
            if length < min_edge:  # corner rounding, not a real edge
                continue
            d = (b - a) / length
            proj = (pts - a) @ d
            perp = np.abs((pts - a) @ np.array([-d[1], d[0]]))
            keep = (proj > 0.18 * length) & (proj < 0.82 * length) & (perp < 1.6)
            lines.append(fit_line(pts[keep]))
        verts = np.array([intersect(lines[i - 1], lines[i]) for i in range(len(lines))])
        shapes.append(dict(pts=pts, verts=verts, rms=max(l[2] for l in lines)))
    return shapes


def trace_mark():
    g = luminance(MARK_SRC)
    level = (np.percentile(g, 20) + np.percentile(g, 97)) / 2
    shapes = traced_polygons(g, level, tol=1.6, min_edge=5.0)
    by = {}
    for s in shapes:
        v = s["verts"]
        cx = v[:, 0].mean()
        if len(v) == 8:
            by["chevron"] = s
        elif len(v) == 4 and abs(cx - g.shape[1] / 2) < 6:
            by["diamond"] = s
        elif len(v) == 4:
            by["legL" if cx < g.shape[1] / 2 else "legR"] = s

    # Identify features geometrically so contour start points never matter.
    ch = by["chevron"]["verts"]
    apex_v = ch[np.argmin(ch[:, 1])]
    o_l, o_r = ch[np.argmin(ch[:, 0])], ch[np.argmax(ch[:, 0])]
    tips = ch[np.argsort(ch[:, 1])[-2:]]
    tip_l, tip_r = sorted(tips, key=lambda p: p[0])
    rest = [p for p in ch if not any(np.allclose(p, q) for q in (apex_v, o_l, o_r, tip_l, tip_r))]
    rest.sort(key=lambda p: p[1])
    in_apex = rest[0]
    i_l, i_r = sorted(rest[1:], key=lambda p: p[0])

    def leg_parts(v):
        order = np.argsort(v[:, 1])
        top, bottom = sorted(v[order[:2]], key=lambda p: p[0]), sorted(v[order[2:]], key=lambda p: p[0])
        return top[0], top[1], bottom[1], bottom[0]  # top-left, top-right, bottom-right, bottom-left
    lL, lR = leg_parts(by["legL"]["verts"]), leg_parts(by["legR"]["verts"])
    dmv = by["diamond"]["verts"]
    dm_top, dm_bot = dmv[np.argmin(dmv[:, 1])], dmv[np.argmax(dmv[:, 1])]
    dm_l, dm_r = dmv[np.argmin(dmv[:, 0])], dmv[np.argmax(dmv[:, 0])]

    ax = np.mean([(o_l[0] + o_r[0]) / 2, (i_l[0] + i_r[0]) / 2, (tip_l[0] + tip_r[0]) / 2,
                  *[(a[0] + b[0]) / 2 for a, b in zip(lL, reversed(lR))],
                  (dm_l[0] + dm_r[0]) / 2, apex_v[0], in_apex[0], dm_top[0], dm_bot[0]])
    mir = lambda p: np.array([2 * ax - p[0], p[1]])
    sym = lambda left, right: (left + mir(right)) / 2
    flip = lambda v: np.array([-v[0], v[1]])

    apex, inner_apex = np.array([ax, apex_v[1]]), np.array([ax, in_apex[1]])
    shoulder_o, shoulder_i = sym(o_l, o_r), sym(i_l, i_r)
    base = np.mean([lL[2][1], lL[3][1], lR[2][1], lR[3][1]])
    # left leg from its own corners averaged with the mirrored right leg
    leg = [sym(lL[0], lR[1]), sym(lL[1], lR[0]), sym(lL[2], lR[3]), sym(lL[3], lR[2])]
    leg[2][1] = leg[3][1] = base
    dm = {"top": dm_top, "bot": dm_bot, "l": dm_l, "r": dm_r}
    half_w = ((ax - dm["l"][0]) + (dm["r"][0] - ax)) / 2
    d_mid = (dm["l"][1] + dm["r"][1]) / 2
    d_top, d_bot, d_left = np.array([ax, dm["top"][1]]), np.array([ax, dm["bot"][1]]), np.array([ax - half_w, d_mid])

    # The arms end in a short cut parallel to the diamond's upper facet. The
    # sharp extrapolation would pierce the diamond, so the cut is real design.
    facet = unit(d_top - d_left)
    normal = np.array([-facet[1], facet[0]])
    if (np.array([ax, d_mid]) - d_left) @ normal > 0:
        normal = -normal
    chev_pts = by["chevron"]["pts"]
    near_tip = chev_pts[(chev_pts[:, 0] < ax) & (chev_pts[:, 0] > ax - 14) & (chev_pts[:, 1] > d_top[1])]
    gaps = (near_tip - d_left) @ normal
    gap = float(np.median(gaps[gaps < gaps.min() + 0.45]))
    # Directions of the fitted lower edges (their raw intersection is the
    # over-sharp tip that the facet-parallel cut truncates).
    lower_o = unit(unit(tip_l - o_l) + flip(unit(tip_r - o_r)))
    lower_i = unit(unit(tip_l - i_l) + flip(unit(tip_r - i_r)))
    cut = (d_left + normal * gap, facet)
    tip_o = intersect((shoulder_o, lower_o), cut)
    tip_i = intersect((shoulder_i, lower_i), cut)

    left = [shoulder_o, tip_o, tip_i, shoulder_i]
    chevron = [apex, *left, inner_apex, *[mir(p) for p in reversed(left)]]
    leg_l = leg  # top-left, top-right, bottom-right, bottom-left
    leg_r = [mir(p) for p in reversed(leg_l)]
    diamond = [d_top, np.array([ax + half_w, d_mid]), d_bot, d_left]
    height = base - apex[1]
    norm = lambda pts: [[round((p[0] - ax) / height, 6), round((p[1] - apex[1]) / height, 6)] for p in pts]
    rms = max(s["rms"] for s in shapes)
    return dict(chevron=norm(chevron), diamond=norm(diamond), legLeft=norm(leg_l), legRight=norm(leg_r)), \
        dict(axis_px=ax, apex_px=apex[1], height_px=height, tip_gap_px=gap, edge_rms_px=rms)


def trace_wordmark():
    g = luminance(WORD_SRC)
    level = (np.percentile(g, 30) + np.percentile(g, 99.5)) / 2
    polys, rings = {}, {}
    for c in measure.find_contours(g, level):
        if len(c) < 30:
            continue
        pts = c[:, ::-1]
        x0, x1 = pts[:, 0].min(), pts[:, 0].max()
        if 200 < x0 < 300:
            (cx, cy), (w, h), ang = cv2.fitEllipse(pts.astype(np.float32))
            # cv2's first axis is ~vertical here (angle ~90 deg)
            rings["inner" if x1 - x0 < 55 else "outer"] = (cx, cy, h / 2, w / 2) if abs(ang - 90) < 45 else (cx, cy, w / 2, h / 2)
        else:
            polys["A" if x0 < 60 else "X" if x0 < 200 else "M"] = pts
    out = {}
    for key, pts in polys.items():
        rough = measure.approximate_polygon(pts, tolerance=1.3)[:-1]
        lines = []
        for i in range(len(rough)):
            a, b = rough[i], rough[(i + 1) % len(rough)]
            length = np.linalg.norm(b - a)
            if length < 3.5:
                continue
            d = (b - a) / length
            proj = (pts - a) @ d
            perp = np.abs((pts - a) @ np.array([-d[1], d[0]]))
            keep = (proj > 0.2 * length) & (proj < 0.8 * length) & (perp < 1.5)
            if keep.sum() < 3:  # very short terminals: use more of the edge
                keep = (proj > 0.1 * length) & (proj < 0.9 * length) & (perp < 1.5)
            lines.append(fit_line(pts[keep]))
        out[key] = np.array([intersect(lines[i - 1], lines[i]) for i in range(len(lines))])
    all_pts = np.concatenate(list(polys.values()))
    top_est, base_est = np.percentile(all_pts[:, 1], 2), np.percentile(all_pts[:, 1], 98)
    band = 0.12 * (base_est - top_est)
    at_top = lambda v: v[v[:, 1] < top_est + band]
    at_base = lambda v: v[v[:, 1] > base_est - band]
    by_x = lambda v: v[np.argsort(v[:, 0])]
    A, X, M = out["A"], out["X"], out["M"]
    # Flat terminals sit on the cap line and baseline; snap their tiny fit noise.
    cap_y = np.mean(np.concatenate([at_top(X)[:, 1], at_top(M)[:, 1]]))
    base_y = np.mean(np.concatenate([at_base(A)[:, 1], at_base(X)[:, 1], at_base(M)[:, 1]]))

    # Λ: crossbar-free with a sharp apex, from its four long edge lines.
    a_bot = by_x(at_base(A))  # outer-left, inner-left, inner-right, outer-right
    a_mid = A[(A[:, 1] > top_est + band) & (A[:, 1] < base_est - band)]
    crotch = a_mid[np.argmax(a_mid[:, 1])] if len(a_mid) else None
    a_top = A[A[:, 1] < top_est + band]
    # outer edges: from each outer foot to the nearest apex-region vertex
    foot_l, foot_r = a_bot[0], a_bot[-1]
    near = lambda foot: a_top[np.argmin(np.linalg.norm(a_top - foot, axis=1))]
    apex = intersect((foot_l, unit(near(foot_l) - foot_l)), (foot_r, unit(near(foot_r) - foot_r)))
    if crotch is None:
        crotch = intersect((a_bot[1], unit(A[0] - a_bot[1])), (a_bot[2], unit(A[0] - a_bot[2])))
    a_ax = np.mean([(a_bot[0][0] + a_bot[3][0]) / 2, (a_bot[1][0] + a_bot[2][0]) / 2, crotch[0], apex[0]])
    am = lambda p: np.array([2 * a_ax - p[0], p[1]])
    bl_o, bl_i = (a_bot[0] + am(a_bot[3])) / 2, (a_bot[1] + am(a_bot[2])) / 2
    bl_o[1] = bl_i[1] = base_y
    lam = [np.array([a_ax, apex[1]]), am(bl_o), am(bl_i), np.array([a_ax, crotch[1]]), bl_i, bl_o]

    # X: mirror-symmetric left/right only (it is wider at the foot, as drawn).
    xt, xb = by_x(at_top(X)), by_x(at_base(X))
    xc = X[(X[:, 1] > top_est + band) & (X[:, 1] < base_est - band)]
    xc_top, xc_bot = xc[np.argmin(xc[:, 1])], xc[np.argmax(xc[:, 1])]
    xc_l, xc_r = xc[np.argmin(xc[:, 0])], xc[np.argmax(xc[:, 0])]
    x_ax = np.mean([(xt[0][0] + xt[3][0]) / 2, (xt[1][0] + xt[2][0]) / 2, (xb[0][0] + xb[3][0]) / 2,
                    (xb[1][0] + xb[2][0]) / 2, (xc_l[0] + xc_r[0]) / 2, xc_top[0], xc_bot[0]])
    xm = lambda p: np.array([2 * x_ax - p[0], p[1]])
    xs = lambda l, r: (l + xm(r)) / 2
    tl_o, tl_i, bl_xo, bl_xi = xs(xt[0], xt[3]), xs(xt[1], xt[2]), xs(xb[0], xb[3]), xs(xb[1], xb[2])
    tl_o[1] = tl_i[1] = cap_y
    bl_xo[1] = bl_xi[1] = base_y
    x_left = xs(xc_l, xc_r)
    xpoly = [tl_o, tl_i, np.array([x_ax, xc_top[1]]), xm(tl_i), xm(tl_o), xm(x_left), xm(bl_xo), xm(bl_xi),
             np.array([x_ax, xc_bot[1]]), bl_xi, bl_xo, x_left]

    # M: vertical stems, flat stem tops, V meets at ~74% of the cap height.
    mt, mb = by_x(at_top(M)), by_x(at_base(M))
    mc = by_x(M[(M[:, 1] > top_est + band) & (M[:, 1] < base_est - band)])
    sh_l, sh_r = mc[0], mc[-1]
    v_pair = sorted(mc[1:-1], key=lambda p: p[1])
    v_outer, v_inner = v_pair[0], v_pair[-1]
    m_ax = np.mean([(mb[0][0] + mb[3][0]) / 2, (mb[1][0] + mb[2][0]) / 2, (sh_l[0] + sh_r[0]) / 2,
                    (mt[0][0] + mt[3][0]) / 2, v_outer[0], v_inner[0]])
    mm = lambda p: np.array([2 * m_ax - p[0], p[1]])
    stem_o = (mb[0][0] + mt[0][0]) / 2          # the outer stem edge is vertical
    stem_i = (mb[1][0] + mm(mb[2])[0]) / 2
    shoulder = np.array([stem_i, (sh_l[1] + sh_r[1]) / 2])
    top_i = np.array([mt[1][0], cap_y])          # left stem top (right one is a noisier fit)
    mpoly = [np.array([stem_o, base_y]), np.array([stem_o, cap_y]), top_i, np.array([m_ax, v_outer[1]]),
             mm(top_i), mm(np.array([stem_o, cap_y])), mm(np.array([stem_o, base_y])), mm(np.array([stem_i, base_y])),
             mm(shoulder), np.array([m_ax, v_inner[1]]), shoulder, np.array([stem_i, base_y])]

    cap = base_y - cap_y
    left_x, right_x = bl_o[0], mm(np.array([stem_o, 0]))[0]
    cx = (left_x + right_x) / 2
    norm = lambda pts: [[round((p[0] - cx) / cap, 6), round((p[1] - cap_y) / cap, 6)] for p in pts]
    oo, oi = rings["outer"], rings["inner"]
    ring = dict(center=[round(((oo[0] + oi[0]) / 2 - cx) / cap, 6), round(((oo[1] + oi[1]) / 2 - cap_y) / cap, 6)],
                outer=[round(oo[2] / cap, 6), round(oo[3] / cap, 6)],
                inner=[round(oi[2] / cap, 6), round(oi[3] / cap, 6)])
    return dict(Lambda=norm(lam), X=norm(xpoly), O=ring, M=norm(mpoly)), dict(cap_px=cap, width_caps=(right_x - left_x) / cap)


def main():
    mark, mark_info = trace_mark()
    word, word_info = trace_wordmark()
    doc = {
        "about": "AXOM identity vectorised from the supplied brand artwork by scripts/startup-ident/trace_geometry.py. "
                 "Mark units: 1.0 = mark height, origin at the apex, x right, y down. Wordmark units: 1.0 = cap height, "
                 "origin at the wordmark's horizontal centre on the cap line.",
        "sources": {"mark": str(MARK_SRC.relative_to(ROOT)), "wordmark": str(WORD_SRC.relative_to(ROOT)),
                    "lockup": "axom/axom overview.png"},
        "fit": {**{k: round(float(v), 4) for k, v in mark_info.items()}, **{k: round(float(v), 4) for k, v in word_info.items()}},
        "mark": mark,
        "wordmark": word,
        # Vertical lockup measured from axom/axom overview.png, in mark heights below the apex.
        "lockup": {
            "wordmarkCapTop": 1.2823, "wordmarkCapHeight": 0.2977,
            "ruleCenter": 1.7917, "ruleWidth": 0.2043, "ruleThickness": 0.0086,
            "subtitle": ["PRIVATE ACADEMIC", "OPERATING SYSTEM"],
            "subtitleFont": "Poppins Regular (design/startup/fonts)",
            "subtitleCapHeight": 0.0505, "subtitleTracking": 0.0432,
            "subtitleBaselines": [2.0735, 2.1995],
        },
        "palette": {"night": "#0D0D0E", "graphite": "#1C1C1E", "ivory": "#E6E2D6", "gold": "#C8A96A"},
    }
    OUT.write_text(json.dumps(doc, indent=2) + "\n")
    print(f"wrote {OUT.relative_to(ROOT)}  edge rms {mark_info['edge_rms_px']:.3f}px  tip gap {mark_info['tip_gap_px']:.2f}px")


if __name__ == "__main__":
    main()
