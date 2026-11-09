# Turn one view of a ChatGPT turnaround sheet into a 3D mesh with TripoSR (MIT), locally on Apple Silicon.
#   tools/ml.sh tools/sheet2mesh.py <sheet.png> <out.glb> [--view 0] [--views 4] [--res 256]
# The sheet is split into equal columns (--views); --view picks which (0 = front, or the side view for animals).
# Background is removed (rembg), the figure centred on grey, then TripoSR builds the shape with vertex colours.
import argparse, sys, os, time
import numpy as np, torch
from PIL import Image

a = argparse.ArgumentParser()
a.add_argument('sheet'); a.add_argument('out')
a.add_argument('--view', type=int, default=0); a.add_argument('--views', type=int, default=4)
a.add_argument('--res', type=int, default=256); a.add_argument('--debug')
args = a.parse_args()

sys.path.insert(0, os.path.join(os.environ['ML'], 'TripoSR'))
from tsr.system import TSR
from tsr.utils import remove_background, resize_foreground
import rembg

img = Image.open(args.sheet).convert('RGB')
w, h = img.size
# find each view by the empty columns between figures (equal splits clip wide props like shields)
px = np.asarray(img).astype(np.int16)
bg = np.median(np.concatenate([px[:8].reshape(-1, 3), px[-8:].reshape(-1, 3)]), axis=0)
occ = (np.abs(px - bg).sum(axis=2) > 40).sum(axis=0) > 3
runs, x = [], 0
while x < w:
    if occ[x]:
        x0 = x
        while x < w and occ[x]: x += 1
        runs.append([x0, x])
    x += 1
merged = []  # close gaps narrower than 2% of the width: a sword tip apart from its hand is still one figure
for r in runs:
    if merged and r[0] - merged[-1][1] < w * 0.02: merged[-1][1] = r[1]
    else: merged.append(r)
figs = [r for r in merged if r[1] - r[0] > w * 0.04]
cnt = (np.abs(px - bg).sum(axis=2) > 40).sum(axis=0)
while len(figs) < args.views:  # two views touching (a shield against the next sword): split the widest at its emptiest column
    i = max(range(len(figs)), key=lambda k: figs[k][1] - figs[k][0]); a_, b_ = figs[i]; q = (b_ - a_) // 4
    cut = a_ + q + int(np.argmin(cnt[a_ + q:b_ - q]))
    figs[i:i + 1] = [[a_, cut], [cut, b_]]
if len(figs) != args.views: print(f'NOTE found {len(figs)} figures, expected {args.views}: {figs}')
x0, x1 = figs[min(args.view, len(figs) - 1)]
pad = int(w * 0.01)
crop = img.crop((max(0, x0 - pad), 0, min(w, x1 + pad), h))
session = rembg.new_session()
fg = remove_background(crop, session)                 # RGBA
fg = resize_foreground(fg, 0.85)
arr = np.array(fg).astype(np.float32) / 255.0
arr = arr[:, :, :3] * arr[:, :, 3:4] + (1 - arr[:, :, 3:4]) * 0.5  # composite on mid grey, as TripoSR expects
inp = Image.fromarray((arr * 255).astype(np.uint8))
if args.debug: inp.save(args.debug)

dev = 'mps' if torch.backends.mps.is_available() else 'cpu'
t0 = time.time()
model = TSR.from_pretrained('stabilityai/TripoSR', config_name='config.yaml', weight_name='model.ckpt')
model.renderer.set_chunk_size(8192)
model.to(dev)
with torch.no_grad():
    codes = model([inp], device=dev)
    mesh = model.extract_mesh(codes, True, resolution=args.res)[0]
import trimesh
mesh.apply_transform(trimesh.transformations.rotation_matrix(-np.pi / 2, [1, 0, 0]))  # TripoSR is Z-up; glTF is Y-up
mesh.apply_transform(trimesh.transformations.rotation_matrix(-np.pi / 2, [0, 1, 0]))  # and faces +X; glTF characters face +Z
mesh.export(args.out)
print(f'MESH_OK {args.out} verts={len(mesh.vertices)} faces={len(mesh.faces)} {time.time() - t0:.0f}s on {dev}')
