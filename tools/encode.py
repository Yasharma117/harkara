# Dev tool: turn a tools/record.mjs capture into an MP4, with the voice clips mixed in where they played.
#   python3 -I tools/encode.py <framesDir> <out.mp4>
import json, os, subprocess, sys
d, out = sys.argv[1], sys.argv[2]
t = json.load(open(f'{d}/times.json')); c = json.load(open(f'{d}/clips.json'))
with open(f'{d}/list.txt', 'w') as f:
    for i in range(len(t)):
        dur = (t[i + 1] - t[i]) if i + 1 < len(t) else 0.05
        f.write(f"file 'f{i:06d}.jpg'\nduration {max(dur, 0.001):.4f}\n")
    f.write(f"file 'f{len(t) - 1:06d}.jpg'\n")
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '../client/public/')
ins, flt = [], []
for x in c:
    p = root + x['url'].split('/', 3)[3]
    if not os.path.exists(p): continue
    off = max(0, int((x['t'] - t[0]) * 1000)); ins += ['-i', p]; flt.append(f"[{len(ins) // 2}:a]adelay={off}|{off}[a{len(flt)}]")
audio = (';'.join(flt) + ';' + ''.join(f'[a{k}]' for k in range(len(flt))) + f'amix=inputs={len(flt)}:normalize=0,volume=1.3,alimiter=limit=0.9,apad[aout]') if flt else 'anullsrc=r=44100:cl=mono[aout]'
subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', f'{d}/list.txt'] + ins + ['-filter_complex', audio, '-map', '0:v', '-map', '[aout]', '-vf', 'format=yuv420p', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-r', '30', '-c:a', 'aac', '-b:a', '128k', '-shortest', out], check=True)
print(out)
