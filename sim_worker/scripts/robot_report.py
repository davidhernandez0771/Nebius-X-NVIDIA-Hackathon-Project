"""The "Bring your robot" report card (docs/design/byor-api.md section 6): one uploaded robot, its saved roles, the
pick-place task on fixed seeds -> <robot dir>/report.json.

Usage (headless, Isaac python; the backend's evaluate job runs exactly this):
    C:\\isaac\\env_isaaclab\\Scripts\\python.exe sim_worker\\scripts\\robot_report.py \\
        --robot-dir data\\robots\\byor_3f9a1c2b7d [--seed0 100 --n 30]

Stages (written to <robot dir>/report_progress.json for the report route): convert (URDF -> USD, cached in usd/),
reach_map (IK on the URDF chain), pick_place (the scripted expert on the base scene, moved into each seed's scene,
replayed and judged, like multiply_run.py). Per scene, run/var_<seed>/ holds scene.json, trajectory.json,
verification.json, signals.npz and steps.npz (joint_pos + joint_names). Exits 1 without writing report.json if
anything but a single scene fails; a scene that crashes the replay is a failed scene ("sim_error").
"""

import argparse
import json
import os
import subprocess
import sys
import time
import traceback
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from isaaclab.app import add_launcher_args, launch_simulation

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))  # for `sim_worker`

parser = argparse.ArgumentParser(description="Report card for an uploaded robot.")
parser.add_argument("--robot-dir", type=Path, required=True)
parser.add_argument("--seed0", type=int, default=100)
parser.add_argument("--n", type=int, default=30)
parser.add_argument("--lift-z", type=float, default=0.25, help="scripted expert carry/retreat height (m)")
parser.add_argument("--hold-s", type=float, default=0.5, help="the source demo's hold at each gripper event")
add_launcher_args(parser)
args_cli = parser.parse_args()

from demo_pipeline.episode_io import save_signals  # noqa: E402
from demo_pipeline.multiply import sample_scene, transform_trajectory  # noqa: E402
from demo_pipeline.schemas import Pose, Scene  # noqa: E402
from sim_worker import byor_report as card  # noqa: E402
from sim_worker.byor_store import RobotStore  # noqa: E402
from sim_worker.keepawake import KeepAwake  # noqa: E402
from sim_worker.byor_scene import convert  # noqa: E402
from sim_worker.replay import DECIMATION, PHYSICS_DT, bin_pose_for, make_sim_cfg, replay  # noqa: E402
from sim_worker.robots import register_robot  # noqa: E402
from sim_worker.scripted import scripted_expert  # noqa: E402
from sim_worker.tracking import TrackingOptions  # noqa: E402
from sim_worker.urdf_import import Roles, build_spec  # noqa: E402

BASELINES = {"franka_builtin": "27/30, unreachable 3 (data/multiply_franka/yield.json, 2026-10-16)",
             "openarm_builtin": "0/30, unreachable 30 (data/multiply_openarm/yield.json, 2026-10-16)"}


def _write_json(path: Path, obj) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, indent=1), encoding="utf-8")
    os.replace(tmp, path)


def _git_commit() -> str | None:
    try:
        out = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=REPO, capture_output=True, text=True,
                             timeout=10)
        dirty = subprocess.run(["git", "status", "--porcelain", "--untracked-files=no"], cwd=REPO,
                               capture_output=True, text=True, timeout=10).stdout.strip()
        return out.stdout.strip() + ("+dirty" if dirty else "") if out.returncode == 0 else None
    except (OSError, subprocess.SubprocessError):
        return None


def _run_scene(robot: str, traj, scene: Scene, ep: Path, opts: TrackingOptions) -> tuple[dict, np.ndarray, list]:
    """(row, joint_pos, joint_names). A replay that raises is a failed scene (sim_error), never a crashed run."""
    st: dict = {}
    t0 = time.time()
    try:
        result, signals = replay(traj, scene, ep_dir=None, record_cameras=False, tracking=opts, stats=st, robot=robot)
    except Exception as exc:
        traceback.print_exc()
        return {"success": False, "reasons": ["sim_error"], "error": repr(exc), "tracking_mean_mm": None,
                "tracking_max_mm": None, "n_steps": 0, "wall_s": round(time.time() - t0, 2)}, np.zeros((0, 0)), []
    ep.mkdir(parents=True, exist_ok=True)
    (ep / "scene.json").write_text(scene.model_dump_json(indent=1), encoding="utf-8")
    (ep / "trajectory.json").write_text(st["trajectory"].model_dump_json(), encoding="utf-8")
    (ep / "verification.json").write_text(result.model_dump_json(indent=1), encoding="utf-8")
    save_signals(ep, signals)
    np.savez(ep / "steps.npz", joint_pos=st["joint_pos"].astype(np.float32), joint_names=np.array(st["joint_names"]))
    row = {"success": result.success, "reasons": result.reasons, "tracking_mean_mm": round(st["mean_mm"], 2),
           "tracking_max_mm": round(st["max_mm"], 2), "n_steps": int(len(st["joint_pos"])),
           "wall_s": round(time.time() - t0, 2)}
    return row, st["joint_pos"], st["joint_names"]


def main() -> None:
    t_start = time.time()
    robot_dir = args_cli.robot_dir.resolve()
    rid = robot_dir.name
    store = RobotStore(robot_dir.parent)
    saved = store.roles(rid)
    if saved is None:
        raise SystemExit(f"{robot_dir} has no roles.json: set the roles first")
    info = store.summary_file(rid)
    roles = Roles.model_validate(saved["roles"])
    u = store.urdf(rid)
    resolved = build_spec(u, roles, rid, mesh_loader=store.mesh_loader(rid), urdf_path=str(store.urdf_path(rid)),
                          ros_packages=tuple((n, str(p)) for n, p in store.packages(rid).items()))
    spec = replace(resolved.spec, usd_dir=str(robot_dir / "usd"))
    register_robot(spec)
    seeds = list(range(args_cli.seed0, args_cli.seed0 + args_cli.n))

    def progress(stage: str, done: int, total: int) -> None:
        _write_json(robot_dir / "report_progress.json", {"stage": stage, "done": done, "total": total})
        print(f"PROGRESS {stage} {done}/{total}", flush=True)

    opts = TrackingOptions()
    with launch_simulation(make_sim_cfg(args_cli.device), args_cli), KeepAwake():  # no idle sleep mid-run
        progress("convert", 0, 1)
        t0 = time.time()
        usd, reused = convert(spec)
        convert_s = time.time() - t0
        progress("convert", 1, 1)

        progress("reach_map", 0, 1)
        t0 = time.time()
        reach = card.reach_map(u, spec, roles)
        reach_s = time.time() - t0
        progress("reach_map", 1, 1)

        src_scene = Scene(cube_pose=Pose(pos=(0.5, 0.0, 0.025), quat_wxyz=(1.0, 0.0, 0.0, 0.0)),
                          bin_pose=bin_pose_for(0.5, 0.3), robot=card.WORKSPACE_ROBOT, seed=0)
        src_traj = scripted_expert(src_scene, hold_s=args_cli.hold_s, lift_z=args_cli.lift_z)
        run_dir = robot_dir / "run"
        progress("pick_place", 0, len(seeds))
        source, _, _ = _run_scene(rid, src_traj, src_scene, run_dir / "source", opts)
        print("SOURCE " + json.dumps(source), flush=True)
        rows, joints, names = [], [], None
        for k, seed in enumerate(seeds):
            dst = sample_scene(np.random.default_rng(seed), card.WORKSPACE_ROBOT, seed)
            row, q, jn = _run_scene(rid, transform_trajectory(src_traj, src_scene, dst), dst,
                                    run_dir / f"var_{seed:04d}", opts)
            names = names or jn
            scene_hits = card.joint_limit_hits(u, roles.arm_joints, jn or [], [q]) if len(q) else []
            row = {"seed": seed, **row, "cube": [round(v, 4) for v in dst.cube_pose.pos[:2]],
                   "cube_yaw": round(float(np.arctan2(2 * dst.cube_pose.quat_wxyz[0] * dst.cube_pose.quat_wxyz[3],
                                                      1 - 2 * dst.cube_pose.quat_wxyz[3] ** 2)), 4),
                   "bin": [round(v, 4) for v in dst.bin_pose.pos[:2]],
                   "limit_hits": [f"{h['joint']}:{h['limit']}" for h in scene_hits]}
            rows.append(row)
            joints.append(q)
            print("ROW " + json.dumps(row), flush=True)
            progress("pick_place", k + 1, len(seeds))
        # still inside launch_simulation: leaving it closes the app, which ends this process
        hits = card.joint_limit_hits(u, roles.arm_joints, names or [], [q for q in joints if len(q)])
        report = card.build_report(
            robot={"id": rid, "name": info["name"], "urdf_sha256": info["sha256"], "dof": len(roles.arm_joints)},
            roles=saved["roles"], spec=saved["spec"], seeds=(seeds[0], seeds[-1]), rows=rows, reach=reach,
            limit_hits=hits,
            provenance={
                "git_commit": _git_commit(),
                "created_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "wall_s": round(time.time() - t_start, 1),
                "stage_s": {"convert": round(convert_s, 1), "reach_map": round(reach_s, 1),
                            "pick_place": round(sum(r["wall_s"] for r in rows) + source["wall_s"], 1)},
                "sim": {"physics_dt": PHYSICS_DT, "decimation": DECIMATION, "isaac_lab": "3.0", "physics": "PhysX"},
                "usd": {"path": os.path.relpath(usd, robot_dir), "reused_cache": reused,
                        "converter": "isaaclab.sim.converters.UrdfConverter (fix_base, merge_fixed_joints, convex hull "
                                     "collisions, no self-collision, PhysX variant)"},
                "drives": card.GAINS_SOURCE,
                "expert": {"lift_z": args_cli.lift_z, "hold_s": args_cli.hold_s, "tracking": vars(opts)},
                "source_demo": {"success": source["success"], "reasons": source["reasons"],
                                "note": "the scripted expert on the base scene (cube (0.5, 0), bin (0.5, 0.3)); every "
                                        "scene replays this demo moved into it"},
                "baseline": BASELINES,
            })
        _write_json(robot_dir / "report.json", report)
        s = report["pick_place"]["successes"]
        print(f"REPORT {s['value']}/{s['of']} reasons {report['pick_place']['failure_reasons']['value']} "
              f"reach {report['reach_map']['fraction']['value']}", flush=True)


if __name__ == "__main__":
    main()
