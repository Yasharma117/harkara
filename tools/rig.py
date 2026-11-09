# Rig a generated (static) mesh onto an existing skeleton and keep all of that skeleton's animations.
#   tools/blender.sh --python tools/rig.py -- --skeleton client/public/models/Knight.glb --mesh new.glb --out client/public/models/Infantry.glb [--apose 30]
# Steps: import the skeleton (armature + its actions), drop its own meshes; import the new mesh as one object, scale and
# centre it to the skeleton's height; if the mesh was drawn in an A-pose (arms --apose degrees below horizontal) while the
# skeleton rests in a T-pose, pose the arms down to match, bind, then bake the mesh back to the T-pose so every original
# animation still applies; bind with automatic weights; export a .glb with all actions.
import bpy, sys, math, argparse
from mathutils import Vector

a = argparse.ArgumentParser()
a.add_argument('--skeleton', required=True); a.add_argument('--mesh', required=True); a.add_argument('--out', required=True)
a.add_argument('--apose', type=float, default=0.0); a.add_argument('--strip-skin', action='store_true')
args = a.parse_args(sys.argv[sys.argv.index('--') + 1:])

bpy.ops.wm.read_factory_settings(use_empty=True)
imp = lambda p: bpy.ops.import_scene.gltf(filepath=p)

# ---- the skeleton and its animations
imp(args.skeleton)
arm = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
for o in [o for o in bpy.context.scene.objects if o.type == 'MESH']: bpy.data.objects.remove(o, do_unlink=True)
actions = list(bpy.data.actions)
arm.animation_data_clear()
before = set(bpy.context.scene.objects)

# ---- the new mesh, joined into one object, free of any rig it came with
imp(args.mesh)
new = [o for o in bpy.context.scene.objects if o not in before]
meshes = [o for o in new if o.type == 'MESH']
for o in new:
    if o.type == 'ARMATURE': bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    o.select_set(True)
    for m in list(o.modifiers):
        if m.type == 'ARMATURE': o.modifiers.remove(m)
    o.vertex_groups.clear()
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
if len(meshes) > 1: bpy.ops.object.join()
mesh = bpy.context.view_layer.objects.active
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# ---- fit: same height as the skeleton, feet on its floor, centred on it
bones = [arm.matrix_world @ b.head_local for b in arm.data.bones] + [arm.matrix_world @ b.tail_local for b in arm.data.bones]
bz0, bz1 = min(v.z for v in bones), max(v.z for v in bones)
cx, cy = sum(v.x for v in bones) / len(bones), sum(v.y for v in bones) / len(bones)
vs = [mesh.matrix_world @ v.co for v in mesh.data.vertices]
mz0, mz1 = min(v.z for v in vs), max(v.z for v in vs)
mx, my = (min(v.x for v in vs) + max(v.x for v in vs)) / 2, (min(v.y for v in vs) + max(v.y for v in vs)) / 2
k = (bz1 - bz0) * 1.08 / (mz1 - mz0)  # the head mesh rises a little above the head bone
mesh.scale = (k, k, k); mesh.location = (cx - mx * k, cy - my * k, bz0 - mz0 * k)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# ---- A-pose meshes: bring the arms down to meet the mesh before binding
def arms(angle):
    # lower (angle>0) or raise both upper arms by `angle` degrees about the body's front-back axis, in world space
    from mathutils import Matrix
    bpy.context.view_layer.objects.active = arm; bpy.ops.object.mode_set(mode='POSE')
    for pb in arm.pose.bones: pb.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()
    for side in ('l', 'r'):
        pb = arm.pose.bones.get(f'upperarm.{side}')
        if not pb: continue
        out = 1 if (pb.head.x > 0) else -1  # which side of the body this arm sits on (armature space)
        R = Matrix.Rotation(math.radians(angle) * out, 4, 'Y')
        h = pb.head.copy()
        pb.matrix = Matrix.Translation(h) @ R @ Matrix.Translation(-h) @ pb.matrix
        bpy.context.view_layer.update()
    bpy.ops.object.mode_set(mode='OBJECT')

def apply_rest():
    bpy.context.view_layer.objects.active = arm; bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.pose.select_all(action='SELECT'); bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode='OBJECT')

if args.apose: arms(args.apose); apply_rest()  # rest pose now matches the A-posed mesh, so weights land right

# ---- bind with automatic weights
bpy.ops.object.select_all(action='DESELECT'); mesh.select_set(True); arm.select_set(True)
bpy.context.view_layer.objects.active = arm
# only body bones deform: IK targets, roll controls and weapon slots must never pull the skin
for b in arm.data.bones:
    if any(k in b.name for k in ('IK', 'control', 'handslot', 'root')): b.use_deform = False
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
weighted = sum(1 for v in mesh.data.vertices if v.groups)
if weighted < 0.95 * len(mesh.data.vertices):
    # bone heat needs one closed surface; game and generated meshes are often many loose pieces. Compute heat weights on
    # a sealed voxel copy of the mesh, then transfer them to the real mesh (nearest surface, interpolated).
    print(f'PROXY bone heat weighted {weighted}/{len(mesh.data.vertices)}; weighting a sealed copy instead')
    for g in list(mesh.vertex_groups): mesh.vertex_groups.remove(g)
    bpy.ops.object.select_all(action='DESELECT'); mesh.select_set(True); bpy.context.view_layer.objects.active = mesh
    bpy.ops.object.duplicate(); proxy = bpy.context.view_layer.objects.active
    for m in list(proxy.modifiers): proxy.modifiers.remove(m)
    proxy.parent = None
    r = proxy.modifiers.new('remesh', 'REMESH'); r.mode = 'VOXEL'; r.voxel_size = (bz1 - bz0) / 90
    bpy.ops.object.modifier_apply(modifier=r.name)
    bpy.ops.object.select_all(action='DESELECT'); proxy.select_set(True); arm.select_set(True); bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    pw = sum(1 for v in proxy.data.vertices if v.groups)
    print(f'PROXY weighted {pw}/{len(proxy.data.vertices)}')
    for g in proxy.vertex_groups: mesh.vertex_groups.new(name=g.name)
    dt = mesh.modifiers.new('weights', 'DATA_TRANSFER'); dt.object = proxy; dt.use_vert_data = True
    dt.data_types_verts = {'VGROUP_WEIGHTS'}; dt.vert_mapping = 'POLYINTERP_NEAREST'; dt.layers_vgroup_select_src = 'ALL'; dt.layers_vgroup_select_dst = 'NAME'
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.object.modifier_move_to_index(modifier=dt.name, index=0); bpy.ops.object.modifier_apply(modifier=dt.name)
    bpy.ops.object.vertex_group_normalize_all(lock_active=False)
    bpy.data.objects.remove(proxy, do_unlink=True)
groups = sum(1 for g in mesh.vertex_groups)
wsum = sum(g.weight for v in mesh.data.vertices for g in v.groups)
print('BIND', 'parent', mesh.parent and mesh.parent.name, 'mods', [(m.type, m.object and m.object.name) for m in mesh.modifiers], 'weighted verts', sum(1 for v in mesh.data.vertices if v.groups), '/', len(mesh.data.vertices), 'wsum', round(wsum))

if args.apose:
    # raise the arms back to the skeleton's original T rest, bake the mesh into that shape, and make T the rest again,
    # so every original animation (keyed against the T rest) still applies
    arms(-args.apose)
    bpy.context.view_layer.objects.active = mesh
    mod = next(m for m in mesh.modifiers if m.type == 'ARMATURE')
    bpy.ops.object.modifier_apply(modifier=mod.name)
    apply_rest()
    m = mesh.modifiers.new('Armature', 'ARMATURE'); m.object = arm

# ---- keep every action on the armature for export
arm.animation_data_create()
for act in actions:
    tr = arm.animation_data.nla_tracks.new(); tr.name = act.name
    st = tr.strips.new(act.name, int(act.frame_range[0]), act); st.name = act.name
bpy.ops.export_scene.gltf(filepath=args.out, export_format='GLB', export_animations=True, export_animation_mode='NLA_TRACKS', export_skins=True)
print(f'RIG_OK {args.out} groups={groups} actions={len(actions)} verts={len(mesh.data.vertices)}')
