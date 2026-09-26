"""Build AXOM's editable 3D ident from its current raster icon silhouette.

Run with Blender 4.5+: blender -b --python scripts/render-startup-luster.py --
Use --preview to render four look-development frames, not the whole sequence.
No external Python packages, downloads, fonts, or user preference changes.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument("--preview", action="store_true")
parser.add_argument("--samples", type=int, default=32)
args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
OUT = ROOT / "build/startup-luster"
SOURCE = ROOT / "design/startup"
OUT.mkdir(parents=True, exist_ok=True)
SOURCE.mkdir(parents=True, exist_ok=True)
ICON = ROOT / "web/public/icon-512.png"


def simplify(points, epsilon=2.6):
    """Ramer-Douglas-Peucker, retaining the traced raster's angular contour."""
    if len(points) < 3:
        return points
    a, b = points[0], points[-1]
    dx, dy = b[0] - a[0], b[1] - a[1]
    denom = math.hypot(dx, dy)
    distances = [abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / denom
                 if denom else math.dist(a, p) for p in points]
    index = max(range(len(points)), key=distances.__getitem__)
    if distances[index] > epsilon:
        return simplify(points[:index + 1], epsilon)[:-1] + simplify(points[index:], epsilon)
    return [a, b]


def silhouette():
    image = bpy.data.images.load(str(ICON))
    width, height = image.size
    pixels = list(image.pixels)
    # The icon's face is light against textured near-black. Use an intentionally
    # separated threshold; exclude texture and cast shadow, retain antialiased edges.
    mask = set()
    for y in range(height):
        for x in range(width):
            offset = ((height - 1 - y) * width + x) * 4
            if min(pixels[offset:offset + 3]) > 0.26 and pixels[offset + 3] > 0.5:
                mask.add((x, y))
    components = []
    while mask:
        seed = mask.pop()
        component, stack = {seed}, [seed]
        while stack:
            x, y = stack.pop()
            for p in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if p in mask:
                    mask.remove(p)
                    component.add(p)
                    stack.append(p)
        if len(component) > 300:
            components.append(component)
    if len(components) != 4:
        raise RuntimeError(f"Expected four AXOM shapes, found {len(components)}; review changed icon.")
    polygons = []
    for component in components:
        edges = {}
        for x, y in component:
            for neighbor, a, b in [((x, y - 1), (x, y), (x + 1, y)),
                                   ((x + 1, y), (x + 1, y), (x + 1, y + 1)),
                                   ((x, y + 1), (x + 1, y + 1), (x, y + 1)),
                                   ((x - 1, y), (x, y + 1), (x, y))]:
                if neighbor not in component:
                    edges.setdefault(a, []).append(b)
        contours = []
        while edges:
            start = current = min(edges)
            contour = [start]
            while current in edges:
                nxt = edges[current].pop()
                if not edges[current]:
                    del edges[current]
                if nxt == start:
                    break
                contour.append(nxt)
                current = nxt
            contours.append(contour)
        contour = max(contours, key=len)
        # Split a closed curve into two open halves before simplification.
        split = max(range(len(contour)), key=lambda i: math.dist(contour[0], contour[i]))
        polygon = simplify(contour[:split + 1])[:-1] + simplify(contour[split:] + [contour[0]])[:-1]
        polygons.append(polygon)
    polygons.sort(key=lambda p: (min(y for _, y in p), min(x for x, _ in p)))
    image.pack()
    return polygons


def material(name, color, metallic, roughness):
    result = bpy.data.materials.new(name)
    result.use_nodes = True
    shader = result.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1)
    shader.inputs["Metallic"].default_value = metallic
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Coat Weight"].default_value = 0.22
    shader.inputs["Coat Roughness"].default_value = 0.2
    return result


def area(name, position, power, size, color=(1, 1, 1), width=None):
    data = bpy.data.lights.new(name, "AREA")
    data.energy, data.color = power, color
    data.shape = "RECTANGLE" if width else "DISK"
    data.size = width or size
    if width:
        data.size_y = size
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = position
    obj.rotation_euler = (Vector((0, 0, 0)) - obj.location).to_track_quat("-Z", "Y").to_euler()
    return obj


bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = args.samples
scene.cycles.use_denoising = True
scene.cycles.max_bounces = 4
scene.render.resolution_x, scene.render.resolution_y = 1280, 720
scene.render.resolution_percentage = 100
scene.render.fps = 60
scene.frame_start, scene.frame_end = 1, 78
scene.render.film_transparent = True
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.image_settings.color_depth = "8"
scene.view_settings.view_transform = "AgX"
scene.world.use_nodes = True
scene.world.node_tree.nodes["Background"].inputs[0].default_value = (0.08, 0.08, 0.08, 1)
scene.world.node_tree.nodes["Background"].inputs[1].default_value = 0.18

# Prefer Metal on Apple Silicon, but remain renderable on CPU elsewhere.
try:
    preferences = bpy.context.preferences.addons["cycles"].preferences
    preferences.compute_device_type = "METAL"
    preferences.get_devices()
    for device in preferences.devices:
        device.use = device.type == "METAL"
    if any(device.use for device in preferences.devices):
        scene.cycles.device = "GPU"
except (TypeError, RuntimeError):
    pass

polygons = silhouette()
xs = [x for p in polygons for x, _ in p]
ys = [y for p in polygons for _, y in p]
cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
scale = 3.5 / (max(ys) - min(ys))
ceramic = material("AXOM — satin ivory ceramic", (0.78, 0.75, 0.66), 0.22, 0.24)
titanium = material("AXOM — polished titanium bevel", (0.69, 0.70, 0.69), 0.88, 0.18)
for index, polygon in enumerate(polygons):
    points = [((x - cx) * scale, (cy - y) * scale) for x, y in polygon]
    # Front-face winding must be CCW in model coordinates.
    if sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(points, points[1:] + points[:1])) < 0:
        points.reverse()
    n = len(points)
    vertices = [(x, y, z) for z in (-0.12, 0.08) for x, y in points]
    faces = [tuple(reversed(range(n))), tuple(range(n, n * 2))]
    faces += [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
    mesh = bpy.data.meshes.new(f"Raster-traced mark {index + 1}")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(f"AXOM mark — piece {index + 1}", mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(ceramic)
    obj.data.materials.append(titanium)
    for face in mesh.polygons:
        face.material_index = 0 if face.index == 1 else 1
    bevel = obj.modifiers.new("Narrow optical edge", "BEVEL")
    bevel.width, bevel.segments, bevel.material = 0.045, 4, 1
    bevel.affect = "EDGES"
    obj.modifiers.new("Weighted surface normals", "WEIGHTED_NORMAL")

camera_data = bpy.data.cameras.new("Fixed orthographic camera")
camera = bpy.data.objects.new("Camera", camera_data)
bpy.context.collection.objects.link(camera)
camera.location = (0.7, -0.45, 15)
camera.rotation_euler = (math.atan2(0.45, 15), math.atan2(0.7, 15), 0)
camera_data.type, camera_data.ortho_scale = "ORTHO", 20
scene.camera = camera
key = area("Soft neutral key", (-3.5, 4, 6), 240, 7)
for frame, energy in ((1, 75), (24, 100), (50, 270), (68, 330), (78, 330)):
    key.data.energy = energy
    key.data.keyframe_insert(data_path="energy", frame=frame)
area("Faint cool edge", (4, -1.5, 3), 60, 4, (0.87, 0.94, 1))
sweep = area("Single optical sweep", (-4, 2, 4), 650, 5, (1, 0.98, 0.92), 0.28)
for frame, position, energy in [(1, (-5, 2.5, 4), 0), (9, (-4, 2, 4), 650),
                                 (49, (4, -2, 4), 650), (63, (5, -2.5, 4), 0),
                                 (78, (5, -2.5, 4), 0)]:
    sweep.location = position
    # A front-parallel strip reflection traverses the object; no camera/mark motion.
    sweep.rotation_euler = (Vector((position[0], position[1], 0)) - sweep.location).to_track_quat("-Z", "Y").to_euler()
    sweep.keyframe_insert(data_path="location", frame=frame)
    sweep.keyframe_insert(data_path="rotation_euler", frame=frame)
    sweep.data.energy = energy
    sweep.data.keyframe_insert(data_path="energy", frame=frame)

scene.render.filepath = str(OUT / "frame_")
scene.frame_set(39)
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE / "axom-optical-luster.blend"))
manifest = {"source": "web/public/icon-512.png", "sourceSha256": hashlib.sha256(ICON.read_bytes()).hexdigest(),
            "silhouette": "threshold-traced raster, 2.6 px simplification tolerance; no original vector supplied",
            "polygons": polygons, "fps": 60, "frames": 78, "durationSeconds": 1.3,
            "resolution": [1280, 720], "background": "#0d0d0e", "audio": False,
            "blenderVersion": bpy.app.version_string}
(SOURCE / "render-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
if args.preview:
    for frame in (1, 23, 40, 68):
        scene.frame_set(frame)
        scene.render.filepath = str(OUT / f"look_{frame:04d}.png")
        bpy.ops.render.render(write_still=True)
else:
    bpy.ops.render.render(animation=True)
