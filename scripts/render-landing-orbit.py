"""Original AXOM armillary sculpture. Blender 5: --background --python this.py -- output [animate]."""
import bpy, math, sys, os
from mathutils import Vector
args = sys.argv[sys.argv.index('--') + 1:]
out = args[0]
os.makedirs(out, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 12
scene.cycles.use_denoising = True
scene.cycles.device = 'CPU'
scene.render.resolution_x = 1920
scene.render.resolution_y = 1080
scene.render.resolution_percentage = 100
scene.render.fps = 24
scene.frame_start = 1
scene.frame_end = 192
scene.world.color = (0.035, 0.035, 0.045)
scene.view_settings.view_transform = 'AgX'
scene.render.image_settings.file_format = 'PNG'
scene.render.film_transparent = False

def material(name, color, metal=0, rough=.2, transmission=0, emission=0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Metallic'].default_value = metal
    p.inputs['Roughness'].default_value = rough
    p.inputs['Transmission Weight'].default_value = transmission
    p.inputs['IOR'].default_value = 1.46
    p.inputs['Emission Color'].default_value = (*color, 1)
    p.inputs['Emission Strength'].default_value = emission
    return m
metal = material('Brushed titanium', (.42,.47,.54), 1,.24)
dark = material('Black titanium', (.085,.095,.12), .95,.22)
glass = material('Optical mineral glass', (.72,.82,.95), .15,.075,.92)
light = material('Cold silver inlay', (.55,.7,1), .6,.2,0,1.25)
lavender = material('Lavender inlay', (.53,.48,.8), .6,.2,0,.8)
root = bpy.data.objects.new('Cyclic assembly',None)
scene.collection.objects.link(root)
root.location = (2.55,0,0)

def ring(radius, thickness, rotation, mat, name):
    bpy.ops.mesh.primitive_torus_add(major_radius=radius,minor_radius=thickness,major_segments=160,minor_segments=12)
    o=bpy.context.object;o.name=name;o.rotation_euler=rotation;o.data.materials.append(mat);o.parent=root
    for p in o.data.polygons:p.use_smooth=True
    return o
ring(2.48,.049,(1.22,.36,-.45),metal,'Outer gimbal')
ring(2.39,.012,(1.22,.36,-.45),light,'Outer light etching')
ring(2.07,.072,(.58,-.9,.7),metal,'Middle gimbal')
ring(1.98,.014,(.58,-.9,.7),lavender,'Middle light etching')
ring(1.70,.04,(1.68,.4,.3),metal,'Inner gimbal')
ring(1.51,.02,(.4,.8,.5),dark,'Inner meridian')
# A skeletal icosahedron around a refractive core.
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=1.31)
frame=bpy.context.object; frame.name='Polyhedral knowledge lattice';frame.parent=root
frame.data.materials.append(metal)
w=frame.modifiers.new('Precision struts','WIREFRAME'); w.thickness=.022
bevel=frame.modifiers.new('Soft machined edges','BEVEL');bevel.width=.014;bevel.segments=3
for i,v in enumerate(frame.data.vertices):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=20,ring_count=12,radius=.058,location=v.co)
    o=bpy.context.object;o.name='Lattice junction';o.parent=root;o.data.materials.append(metal)
    for p in o.data.polygons:p.use_smooth=True
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=.94)
o=bpy.context.object;o.name='Cut optical core';o.parent=root;o.rotation_euler=(.22,.16,.22);o.data.materials.append(glass)
bevel=o.modifiers.new('Polished facet edges','BEVEL');bevel.width=.018;bevel.segments=3
bpy.ops.mesh.primitive_uv_sphere_add(segments=48,ring_count=24,radius=.23)
o=bpy.context.object;o.name='Cold nucleus';o.parent=root;o.data.materials.append(light)
for p in o.data.polygons:p.use_smooth=True
# Delicate calibration details on the outer gimbal.
from mathutils import Euler
rot=Euler((1.22,.36,-.45)).to_matrix()
for i in range(72):
    a=i*math.tau/72
    pos=rot@Vector((2.48*math.cos(a),2.48*math.sin(a),0))
    bpy.ops.mesh.primitive_uv_sphere_add(segments=8,ring_count=6,radius=.029 if i%6==0 else .012,location=pos)
    o=bpy.context.object;o.name='Calibration stud';o.parent=root;o.data.materials.append(light if i%6==0 else metal)
# Obsidian ground gives only a soft silver reflection.
floor=material('Obsidian ground',(.009,.011,.015),.5,.28)
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-3.15));bpy.context.object.data.materials.append(floor)

def area(name,loc,power,color,size,target=(2.55,0,0)):
    data=bpy.data.lights.new(name,'AREA');data.energy=power;data.color=color;data.shape='DISK';data.size=size
    o=bpy.data.objects.new(name,data);scene.collection.objects.link(o);o.location=loc
    o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler()
area('Large cold softbox',(1,-4,6),1500,(.78,.86,1),5)
area('Silver edge',(6,1,3),1900,(.65,.76,1),3)
area('Lavender grazing light',(0,3,.7),1100,(.55,.46,.8),3)
area('Low neutral fill',(4,-5,-.5),350,(.85,.88,1),2)
bpy.ops.object.camera_add(location=(0,-17,4.4))
cam=bpy.context.object;cam.rotation_euler=(Vector((0,0,-.1))-cam.location).to_track_quat('-Z','Y').to_euler()
cam.data.type='ORTHO';cam.data.ortho_scale=13.4;scene.camera=cam
# Small analytic oscillations close at frame 193; omit that duplicate frame in the film.
for f in range(1,194):
    phase=(f-1)/192*math.tau
    root.rotation_euler=(.07*math.sin(phase),.09*math.cos(phase),.11*math.sin(phase))
    root.location.z=.055*math.sin(phase)
    root.keyframe_insert('rotation_euler',frame=f);root.keyframe_insert('location',frame=f)
scene.frame_set(1)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out,'axom-orbit.blend'))
if len(args)>1 and args[1]=='animate':
    scene.render.filepath=os.path.join(out,'frame-')
    bpy.ops.render.render(animation=True)
else:
    scene.render.filepath=os.path.join(out,'poster.png')
    bpy.ops.render.render(write_still=True)
