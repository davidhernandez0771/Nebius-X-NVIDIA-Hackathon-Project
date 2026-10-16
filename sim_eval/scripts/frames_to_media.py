"""Turn sim_eval.recording frames into a contact sheet (PNG) and an animated GIF per recorded seed and camera.

    C:\\isaac\\env_isaaclab\\Scripts\\python.exe sim_eval\\scripts\\frames_to_media.py <frames dir> [--fps 10] [--cols 8]

For every seed_<seed>.npz: seed_<seed>_sheet.png (front over wrist, `cols` evenly spaced frames, step labels) and
seed_<seed>_<camera>.gif (PIL; this machine's cv2 cannot write MP4). Needs PIL (in the Isaac env).
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np


def contact_sheet(frames: dict[str, np.ndarray], every: int, cols: int = 8):
    from PIL import Image, ImageDraw

    cams = [c for c in ("front", "wrist") if c in frames] or sorted(frames)
    n = len(frames[cams[0]])
    idx = np.linspace(0, n - 1, min(cols, n)).round().astype(int)
    h, w = frames[cams[0]].shape[1:3]
    sheet = Image.new("RGB", (len(idx) * w, len(cams) * h + 14), "white")
    draw = ImageDraw.Draw(sheet)
    for j, i in enumerate(idx):
        for r, cam in enumerate(cams):
            sheet.paste(Image.fromarray(frames[cam][i]), (j * w, 14 + r * h))
        draw.text((j * w + 2, 1), f"t={i * every / 50:.1f}s", fill="black")
    return sheet


def write_gif(path: Path, frames: np.ndarray, fps: int) -> bool:
    """Animated GIF via PIL (this machine's cv2 has no MP4 writer, and no shared FFmpeg is installed)."""
    from PIL import Image

    imgs = [Image.fromarray(f) for f in frames]
    imgs[0].save(path, save_all=True, append_images=imgs[1:], duration=int(1000 / fps), loop=0)
    return path.is_file() and path.stat().st_size > 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("frames_dir", type=Path)
    p.add_argument("--fps", type=int, default=10)
    p.add_argument("--cols", type=int, default=8)
    args = p.parse_args(argv)
    for npz in sorted(args.frames_dir.glob("seed_*.npz")):
        meta = json.loads(npz.with_suffix(".json").read_text(encoding="utf-8"))
        with np.load(npz) as z:
            frames = {k: z[k] for k in z.files}
        sheet = npz.with_name(npz.stem + "_sheet.png")
        contact_sheet(frames, meta["every"], args.cols).save(sheet)
        videos = [str(npz.with_name(f"{npz.stem}_{cam}.gif")) for cam in frames
                  if write_gif(npz.with_name(f"{npz.stem}_{cam}.gif"), frames[cam], args.fps)]
        print(f"{npz.name}: {meta['n_frames']} frames -> {sheet.name}, {[Path(v).name for v in videos]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
