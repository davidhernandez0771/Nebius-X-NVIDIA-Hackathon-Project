"""Dry run of the perfect + multiply chain with the 2026-10-20 data fixes, on CPU (no Isaac): what the GPU run would
replay, checked as far as code can check it. Reads a demo store, writes only to --out.

For each human demo it does what scripts/run_human_demo_experiment.py does up to the physics check:
- repair: round 1 of app.jobs.perfect_stored_demo with the rules (the stored raw replay's signals and verdict, as
  there), with and without retime_grasp; refine_diagnosis; apply_repairs;
- align: sim_worker.human_exp.align_home;
- multiply: --variants scenes per demo (the experiment's seeds and sample_scene), each made twice: as today, and with
  the fixes (yaw wrap, the centered approach at the hover with offsets up to --approach-offset).
Then it measures the grasp (frames within 3 cm before the close, the close speed, close -> lifted), the repair
budget and the jitter windows of each repaired demo, and for every variant the workspace, the largest step, the jerk,
the wrist turn at the close against the cube's nearest face, and the research note's look-alike conflict count
(pairs of variants whose cubes look the same, yaw mod 90 within 5 degrees, with wrist turns more than 45 apart).
Not checked here: reach and collisions (Isaac does that in the GPU run).

    uv run --no-sync python scripts/sant_data_fixes_dryrun.py --store C:/dev/pm-t6/data/human_exp/mouse20261020/store \
        --tag "human_*" --input mouse --out <dir> [--variants 10] [--approach-offset 0.04]
"""

from __future__ import annotations

import argparse
import itertools
import json
import math
import sys
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(REPO / "src"), str(REPO)]

from app.jobs import align_signals, bin_rim_z, stored_raw  # noqa: E402
from demo_pipeline.edit_plan import WORKSPACE, _window_jerk  # noqa: E402
from demo_pipeline.grasp_retime import grasp_stats, is_swoop, retime_grasp  # noqa: E402
from demo_pipeline.measure import compute_windows  # noqa: E402
from demo_pipeline.multiply import _yaw, nearest_face_yaw, sample_scene  # noqa: E402
from demo_pipeline.refine import refine_diagnosis  # noqa: E402
from demo_pipeline.repair import apply_repairs  # noqa: E402
from demo_pipeline.rules import detect_rules  # noqa: E402
from demo_pipeline.store import DemoStore  # noqa: E402
from sim_worker.homeset import approach_misalignment, find_hover  # noqa: E402
from sim_worker.human_exp import align_home, select_ids, variant_seed, variant_trajectory  # noqa: E402

ROBOT = "franka"


def wrist_yaw(q) -> float:
    w, x, y, z = q
    return math.atan2(2 * (x * y + w * z), 1 - 2 * (y * y + z * z))


def grasp_row(traj) -> dict:
    s = grasp_stats(traj)
    if s is None:
        return {"closes": False}
    return {"frames_in_3cm": s.frames_near, "close_speed_m_s": round(s.close_speed, 4),
            "close_to_lifted_frames": s.frames_to_lift, "swoop": is_swoop(s), "duration_s": round(traj.t[-1], 2)}


def variant_row(traj, dst) -> dict:
    p = np.asarray(traj.ee_pos)
    lo = np.array([WORKSPACE[k][0] for k in "xyz"])
    hi = np.array([WORKSPACE[k][1] for k in "xyz"])
    s = grasp_stats(traj)
    cube_yaw = _yaw(dst.cube_pose.quat_wxyz)
    wrist = wrist_yaw(np.asarray(traj.ee_quat)[s.close_index])
    return {"in_workspace": bool(np.all((p >= lo - 1e-9) & (p <= hi + 1e-9))),
            "max_step_mm": round(float(np.linalg.norm(np.diff(p, axis=0), axis=1).max()) * 1000, 2),
            "max_jerk_window": round(max(j for _, _, j in _window_jerk(np.asarray(traj.t), p)), 1),
            "cube_yaw_deg": round(math.degrees(cube_yaw), 1), "wrist_at_close_deg": round(math.degrees(wrist), 1),
            "frames_in_3cm": s.frames_near, "close_speed_m_s": round(s.close_speed, 4),
            "duration_s": round(traj.t[-1], 2)}


def conflicts(rows: list[dict]) -> dict:
    """Pairs whose cubes look the same (yaw mod 90 within 5 deg) and whose wrist turns at the close differ > 45."""
    def wrap(a, period):
        return (a + period / 2) % period - period / 2
    pairs = bad = 0
    for a, b in itertools.combinations(rows, 2):
        if abs(wrap(a["cube_yaw_deg"] - b["cube_yaw_deg"], 90)) < 5:
            pairs += 1
            bad += abs(wrap(a["wrist_at_close_deg"] - b["wrist_at_close_deg"], 360)) > 45
    return {"look_alike_pairs": pairs, "conflicting": bad}


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--store", type=Path, required=True, help="a DemoStore root (read only)")
    p.add_argument("--tag", default="human_*")
    p.add_argument("--input", default=None, choices=("camera", "keyboard", "mouse"))
    p.add_argument("--variants", type=int, default=10)
    p.add_argument("--approach-offset", type=float, default=0.04)
    p.add_argument("--out", type=Path, required=True)
    args = p.parse_args(argv)

    store = DemoStore(args.store)
    ids = select_ids(store, tag=args.tag, input=args.input)
    report = {"store": str(args.store), "ids": ids, "variants_per_demo": args.variants,
              "approach_offset_m": args.approach_offset, "demos": {}}
    old_rows, new_rows = [], []
    for i, id in enumerate(ids):
        demo = store.get_demo(id)
        traj = demo.trajectory
        raw = stored_raw(store, id, need_cameras=False)
        row = {"raw": grasp_row(traj), "raw_replay": None if raw is None else raw.verification.success}
        signals = None if raw is None else align_signals(raw.signals.to_signals(), traj.t)
        windows = [] if signals is None else compute_windows(traj, signals)
        reasons = [] if raw is None else list(raw.verification.reasons)
        repaired = {}
        for label, retime in (("rules", False), ("rules_retime", True)):
            diag = refine_diagnosis(detect_rules(traj, windows, reasons=reasons, signals=signals, scene=demo.scene,
                                                 retime_grasp=retime), traj)
            out = traj if diag.decision == "keep" else apply_repairs(traj, diag.repairs, demo.scene,
                                                                     bin_rim_z(demo.scene))
            repaired[label] = out
            row[label] = {"decision": diag.decision, "repairs": [r.op for r in diag.repairs],
                          "issues": [f"{x.type}: {x.evidence}" for x in diag.issues if x.type == "swoop_grasp"],
                          **grasp_row(out)}
        new = repaired["rules_retime"]
        if "retime_grasp" in row["rules_retime"]["repairs"]:
            # what the retime itself did (its budget and heights), on the demo the other rules' ops left
            done = retime_grasp(repaired["rules"], grasp_stats(repaired["rules"]).close_t)
            row["rules_retime"].update(max_moved_cm=round(done.max_moved_m * 100, 2), hover_m=done.hover_m,
                                       lift_m=done.lift_m, added_s=round(done.added_s, 2))
        row["rules_retime"]["max_jerk_window"] = round(max(j for _, _, j in _window_jerk(np.asarray(new.t),
                                                                                         np.asarray(new.ee_pos))), 1)
        row["rules"]["max_jerk_window"] = round(max(j for _, _, j in _window_jerk(
            np.asarray(repaired["rules"].t), np.asarray(repaired["rules"].ee_pos))), 1)
        aligned_old, k_old = align_home(repaired["rules"])
        aligned_new, k_new = align_home(new)
        row["hover_for_centring"] = find_hover(new) is not None
        variants = []
        for j in range(args.variants):
            seed = variant_seed(i, j)
            dst = sample_scene(np.random.default_rng(seed), ROBOT, seed)
            old = variant_trajectory(aligned_old, k_old, demo.scene, dst)
            fixed = variant_trajectory(aligned_new, k_new, demo.scene, dst, wrap_yaw=True,
                                       approach=approach_misalignment(seed, args.approach_offset))
            o, f = variant_row(old, dst), variant_row(fixed, dst)
            old_rows.append(o)
            new_rows.append(f)
            variants.append({"seed": seed, "today": o, "fixed": f,
                             "wrist_within_45_of_nearest_face": abs(f["wrist_at_close_deg"] - math.degrees(
                                 nearest_face_yaw(math.radians(f["cube_yaw_deg"])))) < 45.01})
        row["variants"] = variants
        report["demos"][id] = row
        print(f"{id}: raw {row['raw']} -> retimed {row['rules_retime'].get('frames_in_3cm')} frames, "
              f"{row['rules_retime'].get('close_speed_m_s')} m/s; repairs {row['rules_retime']['repairs']}", flush=True)
    report["look_alike"] = {"today": conflicts(old_rows), "fixed": conflicts(new_rows)}
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "dryrun.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report["look_alike"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
