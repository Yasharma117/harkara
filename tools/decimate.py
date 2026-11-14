# Thin a generated mesh that needs no skeleton (a seated rider, a tent) and export it with its vertex colours.
#   tools/blender.sh --python tools/decimate.py -- in.glb out.glb 4000
import bpy, sys
src, out, faces = sys.argv[-3], sys.argv[-2], int(sys.argv[-1])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
m = next(o for o in bpy.context.scene.objects if o.type == 'MESH'); bpy.context.view_layer.objects.active = m
d = m.modifiers.new('d', 'DECIMATE'); d.ratio = min(1, faces / len(m.data.polygons)); bpy.ops.object.modifier_apply(modifier=d.name)
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_vertex_color='ACTIVE')
print('DECIMATE_OK', out, len(m.data.polygons))
