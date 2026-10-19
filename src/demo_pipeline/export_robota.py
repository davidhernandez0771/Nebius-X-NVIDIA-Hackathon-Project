"""Export SANT's sim-verified episodes as Robota-Embed anchors (the math is in demo_pipeline.robota).

    uv run python -m demo_pipeline.export_robota --dataset <LeRobot dataset dir> --out <dir>
        [--stride-s 0.5 --horizon-s 4 --frames 16 --val-frac 0.1 --test-frac 0.1 --split-seed 0]

The LeRobot dataset holds joints, actions and video. Its manifest.json (lerobot_tools.experiments) points each
episode at its source folder (demo_pipeline.episode_io), which also has the cube track, the gripper command, the
scene poses and one PNG per step; the crops and phase labels come from there. Writes <out>/anchors.jsonl,
<out>/crops/*.jpg, <out>/manifest.json and <out>/README.md.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from . import robota
from .episode_io import load_episode, load_signals

CROP_CAMERA = "front"
JPEG_QUALITY = 90
DIGITS = 6  # decimals kept for floats in anchors.jsonl


def _round(x) -> list:
    return np.round(np.asarray(x, dtype=np.float64), DIGITS).tolist()


def _load_dataset(dataset: Path) -> tuple[dict, dict, list[dict]]:
    """(info.json, manifest.json, episode entries with their passports)."""
    info = json.loads((dataset / "meta" / "info.json").read_text(encoding="utf-8"))
    manifest = json.loads((dataset / "manifest.json").read_text(encoding="utf-8"))
    passports = {}
    path = dataset / "passports.jsonl"
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                row = json.loads(line)
                passports[row["episode_index"]] = row.get("passport")
    entries = [dict(e, passport=passports.get(e["episode_index"])) for e in manifest["episodes"]]
    return info, manifest, entries


def _verified(entry: dict) -> bool:
    p = entry.get("passport")
    return bool(p and p.get("verification", {}).get("success"))


def _source_demo(entry: dict) -> str:
    lineage = entry.get("lineage") or []
    return entry.get("human_root") or (lineage[0] if lineage else entry["demo_id"])


def _load_source(entry: dict, fps: int) -> dict:
    ep_dir = Path(entry["episode_dir"])
    meta, arrays, images = load_episode(ep_dir)
    signals = load_signals(ep_dir)
    if signals is None:
        raise ValueError(f"{ep_dir} has no signals.npz (cube track); phases and crops need it")
    if meta.demo_id != entry["demo_id"] or meta.n_steps != entry["n_steps"] or meta.fps != fps:
        raise ValueError(f"{ep_dir} ({meta.demo_id}, {meta.n_steps} steps, {meta.fps} fps) doesn't match the dataset "
                         f"entry ({entry['demo_id']}, {entry['n_steps']} steps, {fps} fps)")
    if CROP_CAMERA not in images:
        raise ValueError(f"{ep_dir} has no {CROP_CAMERA!r} camera images")
    scene = json.loads((ep_dir / "scene.json").read_text(encoding="utf-8"))
    return {"meta": meta, "arrays": arrays, "images": images, "cube": signals.cube_pos, "bin": scene["bin_pose"]}


def _save_crop(png: Path, box, dest: Path) -> None:
    from PIL import Image

    with Image.open(png) as im:
        im.convert("RGB").resize((robota.CROP_W, robota.CROP_H), Image.Resampling.BICUBIC, box=box).save(
            dest, "JPEG", quality=JPEG_QUALITY)


def export(dataset: Path, out: Path, *, stride_s: float = 0.5, horizon_s: float = 4.0, frames: int = 16,
           val_frac: float = 0.1, test_frac: float = 0.1, split_seed: int = 0, max_iou: float = 0.25,
           source_id: str = "sant_isaac_franka_pick_place") -> dict:
    """Write the export to `out` (must be missing or empty) and return its manifest."""
    dataset, out = Path(dataset), Path(out)
    if out.exists() and any(out.iterdir()):
        raise FileExistsError(f"{out} is not empty")
    info, ds_manifest, entries = _load_dataset(dataset)
    fps = int(info["fps"])
    stride, horizon = round(stride_s * fps), round(horizon_s * fps)
    if abs(stride - stride_s * fps) > 1e-6 or abs(horizon - horizon_s * fps) > 1e-6:
        raise ValueError(f"stride {stride_s} s and horizon {horizon_s} s must be whole steps at {fps} fps")

    kept = [e for e in entries if _verified(e)]
    if not kept:
        raise ValueError(f"{dataset} has no sim-verified episodes")
    split_of = robota.assign_splits([_source_demo(e) for e in kept], val_frac, test_frac, split_seed)
    sources = {e["episode_index"]: _load_source(e, fps) for e in kept}

    robot = info.get("robot_type") or kept[0].get("robot")
    act_dim = next(iter(sources.values()))["arrays"]["action"].shape[1]
    names = robota.ACTION_NAMES.get(robot)
    if names is None or len(names) != act_dim:
        names = info["features"]["action"].get("names") or [f"action_{i}" for i in range(act_dim)]
    train_actions = np.concatenate([sources[e["episode_index"]]["arrays"]["action"] for e in kept
                                    if split_of[_source_demo(e)] == "train"])
    stats = robota.norm_stats(train_actions)

    def norm(x):
        return _round(robota.pad(robota.normalize(x, stats["q01"], stats["q99"])))

    (out / "crops").mkdir(parents=True, exist_ok=True)
    counts = {s: {"sources": 0, "episodes": 0, "anchors": 0, "phases": dict.fromkeys(robota.PHASES, 0)}
              for s in robota.SPLITS}
    for s in set(split_of.values()):
        counts[s]["sources"] = sum(v == s for v in split_of.values())
    episodes, n_anchors, n_clipped = [], 0, 0
    with (out / "anchors.jsonl").open("w", encoding="utf-8") as f:
        for e in kept:
            src, idx = sources[e["episode_index"]], e["episode_index"]
            meta, a = src["meta"], src["arrays"]
            split, demo = split_of[_source_demo(e)], _source_demo(e)
            labels = robota.phases(a["gripper"], src["cube"], src["bin"]["pos"], src["bin"]["quat_wxyz"])
            steps = robota.dedup_anchors(robota.anchor_steps(meta.n_steps, stride, horizon), horizon, max_iou)
            for t in steps:
                window = robota.future_window(t, horizon)
                picked = robota.sample_frames(window, frames)
                px = robota.project(robota.interaction_points(src["cube"][t], a["ee_pos"][t], a["ee_quat"][t]),
                                    robota.FRONT_CAMERA)
                box, clipped = robota.crop_box(px, robota.FRONT_CAMERA.width, robota.FRONT_CAMERA.height)
                anchor_id = f"ep{idx:04d}_t{t:06d}"
                crop = f"crops/{anchor_id}.jpg"
                _save_crop(src["images"][CROP_CAMERA][t], box, out / crop)
                future = a["action"][window[0]:window[1] + 1]
                row = {
                    "anchor_id": anchor_id, "split": split, "episode_index": idx, "demo_id": meta.demo_id,
                    "source_demo": demo, "t": t, "t_s": round(t / fps, DIGITS),
                    "query": {
                        "instruction": meta.task_text, "source_id": source_id, "crop": crop,
                        "crop_camera": CROP_CAMERA, "crop_box_px": _round(box), "crop_clipped": clipped,
                        "frame_index": t, "action": {"raw": _round(a["action"][t]), "norm": norm(a["action"][t])},
                    },
                    "target": {
                        "instruction": meta.task_text, "video_key": f"observation.images.{CROP_CAMERA}",
                        "window": list(window), "frame_index": picked,
                        "frame_time_s": [round(i / fps, DIGITS) for i in picked],
                        "actions": {"raw": _round(future), "norm": norm(future)},
                    },
                    "labels": {"phase": labels[t], "target_phases": [labels[i] for i in picked],
                               "object_roles": dict(robota.OBJECT_ROLES)},
                }
                f.write(json.dumps(row, separators=(",", ":")) + "\n")
                counts[split]["anchors"] += 1
                counts[split]["phases"][labels[t]] += 1
                n_clipped += clipped
            counts[split]["episodes"] += 1
            n_anchors += len(steps)
            episodes.append({"episode_index": idx, "demo_id": meta.demo_id, "source_demo": demo, "split": split,
                             "n_steps": meta.n_steps, "anchors": len(steps)})

    manifest = {
        "format_version": robota.FORMAT_VERSION,
        "paper": {"title": "Robota-Embed", "url": robota.PAPER_URL, "section": "Appendix A"},
        "created": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source_dataset": {"path": str(dataset), "repo_id": ds_manifest.get("repo_id"),
                           "codebase_version": info.get("codebase_version"),
                           "video_keys": [k for k, v in info["features"].items() if v.get("dtype") == "video"]},
        "source_id": source_id,
        "robot": robot,
        "instruction_texts": sorted({src["meta"].task_text for src in sources.values()}),
        "rates": {"fps": fps, "action_hz": fps, "video_fps": fps},
        "action": {
            "names": names, "dim": act_dim, "padded_dim": robota.PAD_DIM,
            "meaning": "absolute joint position targets (arm joints in rad, finger joints in m)",
            "normalization": {"method": "per coordinate, q01 -> -1 and q99 -> +1, not clipped", "split": "train",
                              "rows": int(train_actions.shape[0]), **stats},
        },
        "windowing": {"stride_s": stride_s, "stride_steps": stride, "horizon_s": horizon_s, "horizon_steps": horizon,
                      "target_frames": frames, "max_temporal_iou": max_iou,
                      "rule": "t + horizon + 1 < N; window = steps t+1 .. t+horizon"},
        "crop": {"camera": CROP_CAMERA, "size": [robota.CROP_W, robota.CROP_H],
                 "source_size": [robota.FRONT_CAMERA.width, robota.FRONT_CAMERA.height], "format": "jpeg",
                 "quality": JPEG_QUALITY, "method": "sim cube + gripper poses projected into the camera",
                 "clipped": n_clipped},
        "labels": {"phases": list(robota.PHASES), "object_roles": robota.OBJECT_ROLES},
        "splits_by": "source demo (human_root), before anchoring",
        "split_params": {"val_frac": val_frac, "test_frac": test_frac, "seed": split_seed},
        "splits": counts,
        "totals": {"episodes": len(kept), "sources": len(split_of), "anchors": n_anchors},
        "skipped": {"unverified": len(entries) - len(kept)},
        "episodes": episodes,
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    (out / "README.md").write_text(readme(manifest), encoding="utf-8")
    return manifest


def readme(m: dict) -> str:
    """The plain-words guide written next to the data."""
    s, w, c, act = m["splits"], m["windowing"], m["crop"], m["action"]
    split_rows = "\n".join(f"| {k} | {v['sources']} | {v['episodes']} | {v['anchors']} |" for k, v in s.items())
    return f"""# SANT Robota-Embed export

Format `{m['format_version']}`. It follows the anchor format of Robota-Embed ({m['paper']['url']},
{m['paper']['section']}). The paper's code isn't released, so we match the content in our own simple layout.

Source: `{m['source_dataset']['repo_id']}` (LeRobot {m['source_dataset']['codebase_version']}), robot
`{m['robot']}`, {m['rates']['fps']} steps per second. Only episodes that passed the physics check in simulation are
included ({m['totals']['episodes']} kept, {m['skipped']['unverified']} skipped).

## What an anchor is

An anchor is one moment `t` in one episode. It pairs what the robot sees and does now (the query) with what
happens next (the target).

- **Query**: the instruction text, a {c['size'][0]}x{c['size'][1]} crop of the cube and gripper area at `t`, the
  robot's action at `t`, and a source id (`{m['source_id']}`, which data source the anchor comes from).
- **Target**: the same instruction, {w['target_frames']} frames spread evenly over the next {w['horizon_s']} s
  (steps `t+1` to `t+{w['horizon_steps']}`, so `t` itself is never in it), and every action in that window at the
  native rate ({w['horizon_steps']} actions).

Anchors are taken every {w['stride_s']} s, and only where the whole future window fits inside the episode
(`t + horizon + 1 < N`). Within one episode, an anchor is dropped when its future window overlaps an earlier kept
anchor's window by more than {w['max_temporal_iou']} temporal IoU. With a {w['horizon_s']} s window, that leaves
kept anchors about {0.6 * w['horizon_s']:.1f} s or more apart.

## Splits

Splits are made by source demo before any anchor is cut. All the multiplied copies of one human demo land in the
same split, so no demo is seen in training and tested on. Split by: {m['splits_by']}.

| split | source demos | episodes | anchors |
|---|---|---|---|
{split_rows}

## Files

- `anchors.jsonl`: one anchor per line.
  - `query.crop` is the crop image path. `query.crop_box_px` is the box `[x0, y0, x1, y1]` in the source camera
    image, and `query.crop_clipped` is true when the box couldn't hold both the cube and the gripper.
  - `query.frame_index` and `target.frame_index` are frame numbers inside the episode (LeRobot's `frame_index`)
    in the video `target.video_key`. LeRobot packs many episodes into one video file; the episode's start time in
    that file is in the dataset's `meta/episodes`.
  - `query.action` and `target.actions` each have `raw` (native values) and `norm` (normalized and padded).
  - `labels` holds the weak labels.
- `crops/`: the crop images (JPEG).
- `manifest.json`: robot, action names, rates, normalization statistics, split counts, parameters, and every
  episode with its split.

## Actions

Each action is {act['dim']} numbers: {act['meaning']}, in the order
`{', '.join(act['names'])}`.

- `raw` keeps the native values.
- `norm` maps each coordinate's 1st percentile to -1 and its 99th percentile to +1. The percentiles come from the
  train split only and are stored in `manifest.json`. Values outside that range aren't clipped. `norm` is then
  zero-padded to {act['padded_dim']} numbers, so actions from different robots fit one shape.

## Crops: from the simulation, not a detector

We don't run an object detector to find the interaction region. The simulator knows exactly where the cube and the
gripper are at every step. We project the cube's corners, the fingertips and the back of the hand into the
{c['camera']} camera with its known pose and lens. Then we take a box around them with a margin, shaped
{c['size'][0]}:{c['size'][1]}, and cut it out.

The {c['camera']} camera renders {c['source_size'][0]}x{c['source_size'][1]} images, so the crop is upsampled
from a smaller box; `crop_box_px` shows its real size. {c['clipped']} crops were clipped.

## Weak labels

- `labels.phase`: the operation phase at `t`. `labels.target_phases`: the phase at each target frame. Both come
  from the gripper command and the cube's position:
  - **reach**: before the gripper first closes;
  - **grasp**: closed, cube still on the table;
  - **carry**: closed, cube lifted;
  - **place**: closed, cube over the bin;
  - **release**: open again.
- `labels.object_roles`: the cube is the manipulated object and the bin is the target.
"""


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--dataset", required=True, type=Path, help="LeRobot dataset dir with manifest.json")
    p.add_argument("--out", required=True, type=Path, help="output dir (missing or empty)")
    p.add_argument("--stride-s", type=float, default=0.5)
    p.add_argument("--horizon-s", type=float, default=4.0)
    p.add_argument("--frames", type=int, default=16)
    p.add_argument("--val-frac", type=float, default=0.1)
    p.add_argument("--test-frac", type=float, default=0.1)
    p.add_argument("--split-seed", type=int, default=0)
    args = p.parse_args(argv)
    m = export(args.dataset, args.out, stride_s=args.stride_s, horizon_s=args.horizon_s, frames=args.frames,
               val_frac=args.val_frac, test_frac=args.test_frac, split_seed=args.split_seed)
    print(f"{m['totals']['anchors']} anchors from {m['totals']['episodes']} verified episodes "
          f"({m['totals']['sources']} source demos; {m['skipped']['unverified']} unverified skipped) -> {args.out}")
    for name, c in m["splits"].items():
        print(f"  {name:5s}: {c['sources']} sources, {c['episodes']} episodes, {c['anchors']} anchors, phases {c['phases']}")
    print(f"  crops clipped: {m['crop']['clipped']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
