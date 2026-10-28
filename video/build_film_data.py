"""The film's data (web/public/film/), read-only from the data store. Everything is something Isaac recorded:

- demos/<id>.json   the 10 mouse demos behind the 30/40 result + the 927 N webcam demo, as twin replays
                    (video/build_demo_replays.py writes them to video/data/demos; copied here)
- variants.json     the 100 multiplied copies of the 10 mouse demos (10 each, mouse20261020 store): seed, verdict, cube and bin,
                    and the hand's path (every 5th step)
- variants.jpg      an atlas of their front-camera frames: one row per copy, 16 frames across its run, 128 px each

    python video/build_film_data.py [DATA_DIR]
"""
import json
import shutil
import sys
from pathlib import Path

import numpy as np
from PIL import Image

DATA = Path(sys.argv[1] if len(sys.argv) > 1 else "C:/dev/pm-t6/data")
HERE = Path(__file__).parent
OUT = HERE.parent / "web" / "public" / "film"
(OUT / "demos").mkdir(parents=True, exist_ok=True)
for f in (HERE / "data" / "demos").glob("*.json"):
    shutil.copy(f, OUT / "demos" / f.name)

STORE = DATA / "human_exp/mouse20261020/store/demos"
attempts = [a for f in sorted((DATA / "human_exp/mouse20261020/stages/multiply").glob("*.json"))
            for a in json.loads(f.read_text())["attempts"]]
FRAMES = 16
rows, atlas = [], Image.new("RGB", (128 * FRAMES, 128 * len(attempts)))
for r, a in enumerate(attempts):
    ep = STORE / a["id"] / "episode"
    scene = json.loads((ep / "scene.json").read_text())
    s = np.load(ep / "steps.npz")
    hand = s["ee_pos"][::5]
    frames = sorted((ep / "front").glob("*.png"))
    for c in range(FRAMES):
        im = Image.open(frames[round(c * (len(frames) - 1) / (FRAMES - 1))]).convert("RGB")
        atlas.paste(im, (c * 128, r * 128))
    rows.append({"id": a["id"], "seed": a["seed"], "success": a["success"], "reasons": a["reasons"], "scene": scene,
                 "hand": np.round(hand, 3).tolist(), "frames": len(frames)})
(OUT / "variants.json").write_text(json.dumps(rows, separators=(",", ":")))
atlas.save(OUT / "variants.jpg", quality=88)
print(len(rows), "variants,", sum(r["success"] for r in rows), "pass;", "scene keys", list(rows[0]["scene"].keys()))

# demos.jpg: the 10 mouse demos' (and the webcam demo's) front camera, one row each, 24 frames across the take.
DFRAMES = 24
ids = sorted(f.stem for f in (OUT / "demos").glob("human_*.json"))
datlas = Image.new("RGB", (128 * DFRAMES, 128 * len(ids)))
for r, i in enumerate(ids):
    frames = sorted((DATA / "demos" / i / "episode" / "front").glob("*.png"))
    for c in range(DFRAMES):
        datlas.paste(Image.open(frames[round(c * (len(frames) - 1) / (DFRAMES - 1))]).convert("RGB"), (c * 128, r * 128))
datlas.save(OUT / "demos.jpg", quality=88)
(OUT / "demos.json").write_text(json.dumps(ids))
print("demo rows", ids)
