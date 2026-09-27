#!/usr/bin/env python3
"""Generate the macOS menu bar (status item) icon for the AXOM focus timer.

The icon is a black stopwatch glyph on a transparent background. macOS treats
it as a *template* image (`icon_as_template(true)` in menu_bar_timer.rs), so
only the alpha channel matters: the system tints it for light/dark menu bars
and for the highlighted state.

36x36 px renders crisply at the 18 pt status item height on Retina displays.
Edges are anti-aliased with 4x4 supersampling. The script only uses the
standard library (zlib + struct) and is deterministic, so re-running it
produces a byte-identical PNG.

Usage (from the repository root):
    python3 src-tauri/scripts/generate_menu_bar_icon.py
"""

from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path

SIZE = 36
SUPERSAMPLE = 4
OUTPUT = Path(__file__).resolve().parent.parent / "icons" / "menu-bar-timer.png"

# Dial geometry, in output pixels (y grows downwards).
CENTER = (18.0, 20.5)
RING_RADIUS = 12.0
RING_HALF_WIDTH = 1.6
HAND_HALF_WIDTH = 1.5
HUB_RADIUS = 2.4


def segment_distance(px: float, py: float, ax: float, ay: float, bx: float, by: float) -> float:
    """Distance from point P to the line segment AB."""
    abx, aby = bx - ax, by - ay
    apx, apy = px - ax, py - ay
    length_sq = abx * abx + aby * aby
    t = 0.0 if length_sq == 0 else max(0.0, min(1.0, (apx * abx + apy * aby) / length_sq))
    dx, dy = px - (ax + t * abx), py - (ay + t * aby)
    return math.hypot(dx, dy)


def polar(radius: float, degrees_from_twelve: float) -> tuple[float, float]:
    """Point on the dial, measured clockwise from 12 o'clock."""
    radians = math.radians(degrees_from_twelve)
    return CENTER[0] + radius * math.sin(radians), CENTER[1] - radius * math.cos(radians)


HAND_TIP = polar(8.0, 60.0)
SIDE_BUTTON = (polar(RING_RADIUS + 1.2, 45.0), polar(RING_RADIUS + 3.6, 45.0))


def inside(x: float, y: float) -> bool:
    cx, cy = CENTER
    distance = math.hypot(x - cx, y - cy)
    # Dial ring.
    if abs(distance - RING_RADIUS) <= RING_HALF_WIDTH:
        return True
    # Crown cap and stem above 12 o'clock.
    if 13.5 <= x <= 22.5 and 1.5 <= y <= 4.5:
        return True
    if 16.5 <= x <= 19.5 and 4.5 <= y <= cy - RING_RADIUS:
        return True
    # Side button at 1:30.
    (ax, ay), (bx, by) = SIDE_BUTTON
    if segment_distance(x, y, ax, ay, bx, by) <= 1.5:
        return True
    # Centre hub and a single hand pointing to 2 o'clock.
    if distance <= HUB_RADIUS:
        return True
    if segment_distance(x, y, cx, cy, HAND_TIP[0], HAND_TIP[1]) <= HAND_HALF_WIDTH:
        return True
    return False


def render() -> bytes:
    rows = bytearray()
    step = 1.0 / SUPERSAMPLE
    samples = SUPERSAMPLE * SUPERSAMPLE
    for py in range(SIZE):
        rows.append(0)  # PNG filter type 0 (None) for every scanline.
        for px in range(SIZE):
            covered = 0
            for sy in range(SUPERSAMPLE):
                for sx in range(SUPERSAMPLE):
                    if inside(px + (sx + 0.5) * step, py + (sy + 0.5) * step):
                        covered += 1
            alpha = round(255 * covered / samples)
            rows.extend((0, 0, 0, alpha))
    return bytes(rows)


def chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


def encode_png(raw: bytes) -> bytes:
    header = struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0)  # 8-bit RGBA, no interlace.
    return b"".join(
        (
            b"\x89PNG\r\n\x1a\n",
            chunk(b"IHDR", header),
            chunk(b"IDAT", zlib.compress(raw, 9)),
            chunk(b"IEND", b""),
        )
    )


def main() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_bytes(encode_png(render()))
    print(f"wrote {OUTPUT} ({SIZE}x{SIZE} RGBA)")


if __name__ == "__main__":
    main()
