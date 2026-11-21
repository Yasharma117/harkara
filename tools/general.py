# Make the kite / orchid / tiger card generals from the hand-made rhino general: same body, skeleton and 77 animations,
# with that general's headgear, props and (when given) painted face.
#   tools/blender.sh --python tools/general.py -- <general-rhino.glb> <house> <out.glb> [face.png]
# The rhino faces -Y with arms out along X. Props are rigid: weighted fully to one bone, so they move with the hand.
import bpy, bmesh, sys, math
from mathutils import Vector, Matrix

src, house, out = sys.argv[sys.argv.index('--') + 1:][:3]
face = (sys.argv[sys.argv.index('--') + 1:] + [None])[3]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
body = next(o for o in bpy.data.objects if o.type == 'MESH')
mats = {m.name: m for m in body.data.materials}
groups = {g.index: g.name for g in body.vertex_groups}

def mat(name, rgb, rough=0.8, metal=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1); b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal
    return m

# ---- remove what this general doesn't carry, by material and the bone that carries it
def bone_of(v):
    return groups[max(v.groups, key=lambda g: g.weight).group] if v.groups else ''

def remove(test):
    bm = bmesh.new(); bm.from_mesh(body.data)
    vb = [bone_of(v) for v in body.data.vertices]
    dead = [f for f in bm.faces if test(body.data.materials[f.material_index].name, vb[f.verts[0].index], f.calc_center_median())]
    bmesh.ops.delete(bm, geom=dead, context='FACES')
    bm.to_mesh(body.data); bm.free()

HELMET = lambda m, b, c: (m in ('Patinated forged steel', 'Worn warm brass') and b == 'Head') or m == 'Dark woven steel mail'
SHIELD = lambda m, b, c: m in ('Patinated forged steel', 'Worn warm brass', 'Waxed dark leather') and b == 'Forearm.L'
SWORD = lambda m, b, c: m == 'Clean forged talwar steel' or (m in ('Worn warm brass', 'Waxed dark leather') and b == 'Hand.R')
BEARD = lambda m, b, c: m == 'Warm silver-grey beard'
cut = {'kite': [HELMET, SHIELD, SWORD, BEARD], 'orchid': [HELMET, SHIELD, SWORD, BEARD], 'tiger': [HELMET, SHIELD, SWORD, BEARD]}[house]
remove(lambda m, b, c: any(t(m, b, c) for t in cut))

# ---- new parts: built in rest space, bound rigidly to one bone, joined into the body
parts = []
def part(obj, bone, material):
    obj.data.materials.clear(); obj.data.materials.append(material)
    vg = obj.vertex_groups.new(name=bone); vg.add(range(len(obj.data.vertices)), 1.0, 'REPLACE')
    for p in obj.data.polygons: p.use_smooth = True
    parts.append(obj); return obj

def cyl(r1, r2, depth, at, rot=(0, 0, 0), verts=24):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2, depth=depth, location=at, rotation=rot); return bpy.context.object

def sphere(r, at, scale=(1, 1, 1), seg=32):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=seg // 2, radius=r, location=at); o = bpy.context.object; o.scale = scale
    bpy.ops.object.transform_apply(scale=True); return o

def torus(R, r, at, scale=(1, 1, 1), rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=48, minor_segments=12, location=at, rotation=rot)
    o = bpy.context.object; o.scale = scale; bpy.ops.object.transform_apply(scale=True, rotation=True); return o

def box(size, at, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=at, rotation=rot); o = bpy.context.object; o.scale = size
    bpy.ops.object.transform_apply(scale=True, rotation=True); return o

def bevel(o, w=0.01):
    m = o.modifiers.new('b', 'BEVEL'); m.width = w; m.segments = 2
    bpy.context.view_layer.objects.active = o; bpy.ops.object.modifier_apply(modifier='b'); return o

linen = mat('Wrapped linen turban', (0.88, 0.84, 0.76))          # "linen" → dyed in the house colour on the card
wood = mat('Oiled dark wood', (0.28, 0.16, 0.08), 0.55)
steel = mats['Clean forged talwar steel'] if 'Clean forged talwar steel' in mats else mat('Forged steel', (0.7, 0.7, 0.72), 0.3, 0.9)
brass = mats['Worn warm brass']
leather = mats['Waxed dark leather']
HEAD = Vector((0, -0.01, 2.72))  # where the helmet's brim sat, just above the brow

def turban(height=0.2, tail=False, pin=False, cap=False):
    # a wrapped turban: a domed crown inside three stacked wraps, each a touch smaller and tipped back
    crown = sphere(0.2, HEAD + Vector((0, 0.02, 0.04)), (1.0, 1.08, 0.55 + height))
    part(crown, 'Head', linen)
    for i, (z, R) in enumerate(((0.0, 0.19), (0.048, 0.183), (0.094, 0.163))):
        if cap and i == 2: break
        w = torus(R, 0.038, HEAD + Vector((0, 0.01 + 0.012 * i, z)), (1.0, 1.1, 0.9), (math.radians(-8 - 4 * i), 0, math.radians(8 * (-1) ** i)))
        part(w, 'Head', linen)
    if tail:
        t = box((0.07, 0.03, 0.22), HEAD + Vector((0.12, 0.22, -0.08)), (math.radians(15), math.radians(-10), 0)); part(bevel(t), 'Head', linen)
    if pin:
        part(sphere(0.03, HEAD + Vector((0, -0.21, 0.08))), 'Head', mat('Ruby jewel', (0.55, 0.05, 0.08), 0.2))
        part(cyl(0.018, 0.004, 0.16, HEAD + Vector((0, -0.2, 0.2)), (math.radians(-10), 0, 0), 8), 'Head', brass)

GRIP_R = Vector((-1.285, -0.02, 1.815)); GRIP_L = Vector((1.285, -0.02, 1.815))  # inside each closed fist
# held props are built upright in a local frame (Z up, -Y forward, origin in the fist) and mapped back to the rest pose
# through the hand's pose in Card_Idle, so they stand upright on the card and swing with the hand in every emote
act = bpy.data.actions.get('Card_Idle') or bpy.data.actions.get('Idle')
arm.animation_data_create(); arm.animation_data.action = act
try: arm.animation_data.action_slot = act.slots[0]
except Exception: pass
bpy.context.scene.frame_set(int(act.frame_range[0])); bpy.context.view_layer.update()
def held(bone, grip, tilt=0):  # tilt: lean the top outward (degrees) so a long pole clears the face
    pb = arm.pose.bones[bone]
    R = ((arm.matrix_world @ pb.matrix) @ (arm.matrix_world @ pb.bone.matrix_local).inverted()).to_3x3().normalized()
    return Matrix.Translation(grip) @ R.inverted().to_4x4() @ Matrix.Rotation(math.radians(tilt), 4, 'Y')
def place(o, F):
    o.matrix_world = F @ o.matrix_world; bpy.ops.object.select_all(action='DESELECT'); o.select_set(True)
    bpy.context.view_layer.objects.active = o; bpy.ops.object.transform_apply(location=True, rotation=True, scale=True); return o

if house == 'kite':
    turban(0.12, tail=True)
    F = held('Hand.R', GRIP_R, -22)  # short spear, upright, leaf blade overhead
    part(place(cyl(0.022, 0.022, 2.0, Vector((0, 0, 0.35))), F), 'Hand.R', wood)
    part(place(sphere(0.05, Vector((0, 0, 1.47)), (0.55, 0.18, 2.6)), F), 'Hand.R', steel)
    part(place(cyl(0.03, 0.026, 0.06, Vector((0, 0, 1.36))), F), 'Hand.R', brass)
    part(bevel(box((0.11, 0.3, 0.26), Vector((0.48, -0.02, 1.4))), 0.025), 'Hips', leather)  # dispatch satchel on the left hip
elif house == 'orchid':
    turban(0.16, pin=True)
    F = held('Hand.L', GRIP_L)  # recurve bow, upright, belly forward, string toward her
    bpy.ops.curve.primitive_bezier_curve_add(location=(0, 0, 0)); cu = bpy.context.object
    sp = cu.data.splines[0]; sp.bezier_points.add(1)
    for bp, p in zip(sp.bezier_points, [(0, 0.14, -0.72), (0, -0.02, 0), (0, 0.14, 0.72)]): bp.co = p; bp.handle_left_type = bp.handle_right_type = 'AUTO'
    cu.data.bevel_depth = 0.018; cu.data.bevel_resolution = 3; cu.data.resolution_u = 24
    bpy.ops.object.convert(target='MESH'); part(place(bpy.context.object, F), 'Hand.L', wood)
    part(place(cyl(0.004, 0.004, 1.44, Vector((0, 0.14, 0)), verts=6), F), 'Hand.L', mat('Bowstring', (0.85, 0.8, 0.7)))
    part(place(cyl(0.032, 0.032, 0.09, Vector((0, 0, 0)), verts=12), F), 'Hand.L', leather)
    q = cyl(0.07, 0.06, 0.62, Vector((-0.12, 0.33, 1.72)), (math.radians(-12), math.radians(-25), 0), 16); part(q, 'Chest', leather)  # quiver on the back
    for i in range(5): part(cyl(0.022, 0.004, 0.12, Vector((-0.24 + 0.02 * i, 0.36 + 0.01 * (i % 2), 2.08)), (math.radians(-12), math.radians(-25), 0), 4), 'Chest', mat(f'Fletching {i}', (0.85, 0.82, 0.74) if i % 2 else (0.3, 0.3, 0.32)))
    part(cyl(0.5, 0.37, 0.64, Vector((0, -0.01, 0.45)), verts=40), 'Hips', mats['Unbleached linen binding'])  # the jama falls to the ankles
elif house == 'tiger':
    turban(0.0, cap=True)
    F = held('Hand.R', GRIP_R, -16)  # the house standard: tall pole, brass finial, a short stiff banner at the top
    part(place(cyl(0.028, 0.024, 2.9, Vector((0, 0, 0.75))), F), 'Hand.R', wood)
    part(place(sphere(0.055, Vector((0, 0, 2.24))), F), 'Hand.R', brass)
    part(place(cyl(0.045, 0.01, 0.16, Vector((0, 0, 2.34))), F), 'Hand.R', brass)
    part(place(bevel(box((0.62, 0.022, 0.44), Vector((-0.33, 0, 1.92)))), F), 'Hand.R', mat('Stiff painted banner', (0.9, 0.86, 0.78), 0.9))
    part(bevel(box((0.03, 0.06, 0.24), Vector((0.2, -0.36, 1.5))), 0.006), 'Hips', steel)  # katar on the belt
    part(bevel(box((0.05, 0.08, 0.06), Vector((0.2, -0.36, 1.64))), 0.008), 'Hips', brass)

for o in parts:
    o.parent = arm; md = o.modifiers.new('Armature', 'ARMATURE'); md.object = arm
bpy.ops.object.select_all(action='DESELECT')
for o in parts: o.select_set(True)
body.select_set(True); bpy.context.view_layer.objects.active = body
bpy.ops.object.join()

if True:
    # none of the three has the rhino's full beard: pull the bearded lower face back in depth only, so the projected
    # face (mapped from the front) keeps its proportions
    for v in body.data.vertices:
        if 2.2 < v.co.z < 2.47 and abs(v.co.x) < 0.25 and v.co.y < 0 and bone_of(v) == 'Head':
            k = (2.47 - v.co.z) / 0.27
            v.co.y *= 1 - 0.4 * k
if house == 'kite':
    # lean: the torso narrower than the heavy rhino
    for v in body.data.vertices:
        if bone_of(v) in ('Hips', 'Spine', 'Chest') and v.co.z > 0.7: v.co.x *= 0.9; v.co.y *= 0.9

if face:
    img = bpy.data.images.load(face); img.pack()
    for n in mats['Projected painted portrait'].node_tree.nodes:
        if n.type == 'TEX_IMAGE': n.image = img

for o in (arm, body):
    o.name = o.name.replace('rhino', house)
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_animation_mode='ACTIONS', export_yup=True, export_apply=False)
print('WROTE', out)
