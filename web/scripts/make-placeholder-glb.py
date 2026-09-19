#!/usr/bin/env python3
"""Writes web/public/models/placeholder-room.glb: a tiny box-built room with
vertex colours, standing in for a real scan until one exists.

    python3 web/scripts/make-placeholder-glb.py
"""
import json
import struct
from pathlib import Path

# (center x,y,z), (size x,y,z), colour
BOXES = [
    ((0, -0.08, 0), (4.6, 0.16, 4.6), (0.30, 0.27, 0.25)),  # floor
    ((0, 1.25, -2.24), (4.6, 2.5, 0.12), (0.34, 0.42, 0.41)),  # back wall
    ((-2.24, 1.25, 0), (0.12, 2.5, 4.6), (0.30, 0.38, 0.37)),  # left wall
    ((0.2, 0.01, 0.6), (2.4, 0.02, 1.7), (0.38, 0.30, 0.24)),  # rug
    ((1.25, 0.24, 0.7), (0.9, 0.48, 1.9), (0.42, 0.34, 0.28)),  # sofa base
    ((1.6, 0.6, 0.7), (0.2, 0.6, 1.9), (0.42, 0.34, 0.28)),  # sofa back
    ((-1.75, 0.89, -1.98), (0.06, 1.78, 0.4), (0.45, 0.36, 0.28)),  # shelf side
    ((-0.45, 0.89, -1.98), (0.06, 1.78, 0.4), (0.45, 0.36, 0.28)),  # shelf side
    ((-1.1, 0.05, -1.98), (1.36, 0.05, 0.4), (0.45, 0.36, 0.28)),  # shelf boards
    ((-1.1, 0.6, -1.98), (1.36, 0.05, 0.4), (0.45, 0.36, 0.28)),
    ((-1.1, 1.15, -1.98), (1.36, 0.05, 0.4), (0.45, 0.36, 0.28)),
    ((-1.1, 1.7, -1.98), (1.36, 0.05, 0.4), (0.45, 0.36, 0.28)),
    ((1.1, 0.75, -1.8), (1.5, 0.06, 0.7), (0.45, 0.36, 0.28)),  # desk top
    ((0.42, 0.36, -2.08), (0.06, 0.72, 0.06), (0.45, 0.36, 0.28)),  # desk legs
    ((1.78, 0.36, -2.08), (0.06, 0.72, 0.06), (0.45, 0.36, 0.28)),
    ((0.42, 0.36, -1.52), (0.06, 0.72, 0.06), (0.45, 0.36, 0.28)),
    ((1.78, 0.36, -1.52), (0.06, 0.72, 0.06), (0.45, 0.36, 0.28)),
    ((0.2, 0.05, 0.9), (0.28, 0.06, 0.2), (0.85, 0.55, 0.20)),  # loose items
    ((-0.5, 0.12, 1.5), (0.3, 0.2, 0.22), (0.85, 0.55, 0.20)),
    ((0.4, 0.045, -0.3), (0.1, 0.05, 0.1), (0.85, 0.55, 0.20)),
]

# 6 faces: normal, then 4 corners (counter-clockwise seen from outside)
FACES = [
    ((1, 0, 0), [(1, -1, -1), (1, 1, -1), (1, 1, 1), (1, -1, 1)]),
    ((-1, 0, 0), [(-1, -1, 1), (-1, 1, 1), (-1, 1, -1), (-1, -1, -1)]),
    ((0, 1, 0), [(-1, 1, -1), (-1, 1, 1), (1, 1, 1), (1, 1, -1)]),
    ((0, -1, 0), [(-1, -1, 1), (-1, -1, -1), (1, -1, -1), (1, -1, 1)]),
    ((0, 0, 1), [(-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)]),
    ((0, 0, -1), [(1, -1, -1), (-1, -1, -1), (-1, 1, -1), (1, 1, -1)]),
]

pos, nor, col, idx = [], [], [], []
for (cx, cy, cz), (sx, sy, sz), c in BOXES:
    for n, corners in FACES:
        base = len(pos) // 3
        for (x, y, z) in corners:
            pos += [cx + x * sx / 2, cy + y * sy / 2, cz + z * sz / 2]
            nor += list(n)
            col += list(c)
        idx += [base, base + 1, base + 2, base, base + 2, base + 3]

pos_b = struct.pack(f"<{len(pos)}f", *pos)
nor_b = struct.pack(f"<{len(nor)}f", *nor)
col_b = struct.pack(f"<{len(col)}f", *col)
idx_b = struct.pack(f"<{len(idx)}I", *idx)
blob = pos_b + nor_b + col_b + idx_b  # every part is a multiple of 4 bytes

n_vert = len(pos) // 3
mins = [min(pos[i::3]) for i in range(3)]
maxs = [max(pos[i::3]) for i in range(3)]

gltf = {
    "asset": {"version": "2.0", "generator": "make-placeholder-glb.py"},
    "scene": 0,
    "scenes": [{"nodes": [0]}],
    "nodes": [{"mesh": 0, "name": "placeholder-room"}],
    "materials": [{"pbrMetallicRoughness": {"baseColorFactor": [1, 1, 1, 1], "metallicFactor": 0, "roughnessFactor": 0.85}}],
    "meshes": [{"primitives": [{"attributes": {"POSITION": 0, "NORMAL": 1, "COLOR_0": 2}, "indices": 3, "material": 0}]}],
    "buffers": [{"byteLength": len(blob)}],
    "bufferViews": [
        {"buffer": 0, "byteOffset": 0, "byteLength": len(pos_b), "target": 34962},
        {"buffer": 0, "byteOffset": len(pos_b), "byteLength": len(nor_b), "target": 34962},
        {"buffer": 0, "byteOffset": len(pos_b) + len(nor_b), "byteLength": len(col_b), "target": 34962},
        {"buffer": 0, "byteOffset": len(pos_b) + len(nor_b) + len(col_b), "byteLength": len(idx_b), "target": 34963},
    ],
    "accessors": [
        {"bufferView": 0, "componentType": 5126, "count": n_vert, "type": "VEC3", "min": mins, "max": maxs},
        {"bufferView": 1, "componentType": 5126, "count": n_vert, "type": "VEC3"},
        {"bufferView": 2, "componentType": 5126, "count": n_vert, "type": "VEC3"},
        {"bufferView": 3, "componentType": 5125, "count": len(idx), "type": "SCALAR"},
    ],
}

js = json.dumps(gltf, separators=(",", ":")).encode()
js += b" " * (-len(js) % 4)
total = 12 + 8 + len(js) + 8 + len(blob)
out = struct.pack("<4sII", b"glTF", 2, total)
out += struct.pack("<I4s", len(js), b"JSON") + js
out += struct.pack("<I4s", len(blob), b"BIN\x00") + blob

dest = Path(__file__).resolve().parent.parent / "public" / "models" / "placeholder-room.glb"
dest.parent.mkdir(parents=True, exist_ok=True)
dest.write_bytes(out)
print(f"wrote {dest} ({len(out)} bytes, {n_vert} vertices)")
