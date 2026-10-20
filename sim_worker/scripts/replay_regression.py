"""Replay stored episodes again with a given version of the code, for the replay regression check (sim_worker.regression).

Each episode's own inputs are replayed as the experiment that made it did: its trajectory.json (the executed
trajectory) in its scene.json, default tracking (lookahead 0, no gripper gate; the human demo experiment's frozen
setting), from the default start pose, without cameras. Each run is written as an episode folder (steps.npz,
signals.npz, verification.json) under <out>/<label>/run<k>/<episode>.

--code picks which code replays: this checkout, or the base commit's code exported by scene_smoke.py. Its sim_worker and
demo_pipeline are imported, never this file's.

Usage (Isaac python, headless; one process per code version):
    C:\\isaac\\env_isaaclab\\Scripts\\python.exe sim_worker\\scripts\\replay_regression.py --code . --label branch \\
        --runs 2 --out data\\scene_smoke\\regression --episodes <ep_dir> [<ep_dir> ...] [--no-lock]
"""

import argparse
import json
import sys
from pathlib import Path

from isaaclab.app import add_launcher_args, launch_simulation

parser = argparse.ArgumentParser(description="Replay stored episodes with one version of the code.")
parser.add_argument("--code", type=Path, required=True, help="repo root whose sim_worker / demo_pipeline replay")
parser.add_argument("--label", required=True, help="base | branch")
parser.add_argument("--runs", type=int, default=2)
parser.add_argument("--out", type=Path, required=True)
parser.add_argument("--episodes", type=Path, nargs="+", required=True)
parser.add_argument("--no-lock", action="store_true", help="the caller already holds the GPU lock")
add_launcher_args(parser)
args_cli = parser.parse_args()

CODE = args_cli.code.resolve()
sys.path.insert(0, str(CODE / "src"))
sys.path.insert(0, str(CODE))

from contextlib import nullcontext  # noqa: E402

from demo_pipeline.schemas import Scene, Trajectory  # noqa: E402
from sim_worker.keepawake import KeepAwake  # noqa: E402
from sim_worker.replay import make_sim_cfg, replay  # noqa: E402
from sim_worker.tracking import TrackingOptions  # noqa: E402


def main() -> None:
    import sim_worker

    print(f"[regression] {args_cli.label}: replaying with {Path(sim_worker.__file__).parent}", flush=True)
    lock = nullcontext()
    if not args_cli.no_lock:
        from sim_worker.gpulock import GpuLock

        lock = GpuLock(task=f"replay-regression:{args_cli.label}", terminal="T5")
    with lock, launch_simulation(make_sim_cfg(args_cli.device), args_cli), KeepAwake():
        for k in range(args_cli.runs):
            for ep in args_cli.episodes:
                traj = Trajectory.model_validate_json((ep / "trajectory.json").read_text(encoding="utf-8"))
                scene = Scene.model_validate_json((ep / "scene.json").read_text(encoding="utf-8"))
                out = args_cli.out / args_cli.label / f"run{k + 1}" / ep.name
                result, _signals = replay(traj, scene, ep_dir=out, record_cameras=False, tracking=TrackingOptions())
                (out / "verification.json").write_text(result.model_dump_json(indent=1), encoding="utf-8")
                print(f"[regression] {args_cli.label} run {k + 1} {ep.name}: {result.reasons or 'success'}", flush=True)
        (args_cli.out / args_cli.label / "done.json").write_text(
            json.dumps({"code": str(CODE), "runs": args_cli.runs, "episodes": [str(e) for e in args_cli.episodes]}, indent=1),
            encoding="utf-8")
        # still inside launch_simulation: leaving it closes the app, which ends this process


if __name__ == "__main__":
    main()
