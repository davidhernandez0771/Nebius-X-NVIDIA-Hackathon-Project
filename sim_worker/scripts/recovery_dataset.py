"""Recovery copies (grasp fix, run 2): replay the expert's way out of every recovery state, with cameras, verified.

    C:\\isaac\\env_isaaclab\\Scripts\\python.exe sim_worker\\scripts\\recovery_dataset.py --states states.json ^
        --manifest recovery_manifest.json

states.json: {"states": [sim_worker.recovery.RecoveryState, ...]} (sim_eval.overnight writes it from the traced
practice rollouts). Each state's scene is its eval scene (sim_eval.scenes) with the cube where the trace had it;
the robot starts at the traced joints. Episodes go to DATA_DIR/episodes/<state name>/ (a fresh DATA_DIR: episodes
are reused by folder name + scene), each stamped with a passport whose lineage root is "recovery-<policy cell>".
The manifest lists every attempt and the verified episode dirs. Resumable: finished folders are reused.
"""

import argparse
import json
import sys
import time
from pathlib import Path

from isaaclab.app import add_launcher_args, launch_simulation

REPO = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(REPO / "src"), str(REPO)]  # this worktree's demo_pipeline first (the Isaac env has pm-t2's)

parser = argparse.ArgumentParser(description="Replay recovery copies from traced policy states.")
parser.add_argument("--states", type=Path, required=True)
parser.add_argument("--manifest", type=Path, required=True)
parser.add_argument("--no-cameras", action="store_true")
add_launcher_args(parser)
args_cli = parser.parse_args()
if not args_cli.no_cameras:
    args_cli.enable_cameras = True

from demo_pipeline.paths import data_dir  # noqa: E402
from sim_eval.scenes import eval_scenes  # noqa: E402
from sim_worker import replay as _replay  # noqa: E402
from sim_worker.isaac_executor import IsaacExecutor  # noqa: E402
from sim_worker.keepawake import KeepAwake  # noqa: E402
from sim_worker.recovery import RecoveryState, recovery_manifest, run_recovery  # noqa: E402
from sim_worker.replay import make_sim_cfg  # noqa: E402


def main() -> None:
    states = [RecoveryState.model_validate(s) for s in json.loads(args_cli.states.read_text("utf-8"))["states"]]
    seeds = sorted({s.seed for s in states})
    bin_poses = {sc.seed: sc.bin_pose for seed in seeds for sc in eval_scenes(1, seed)}
    root, cameras, t0 = Path(data_dir()), not args_cli.no_cameras, time.time()
    print(f"[recovery] {len(states)} states from {len(seeds)} scenes -> {root / 'episodes'}", flush=True)
    with launch_simulation(make_sim_cfg(args_cli.device), args_cli), KeepAwake():
        ex = IsaacExecutor(robot="franka", cameras=cameras, root=root)
        ex.warm_up()

        def replay_fn(traj, scene, ep_dir, record_cameras, start_joint_pos):
            st: dict = {}
            try:
                result, signals = _replay.replay(traj, scene, ep_dir=ep_dir, record_cameras=record_cameras,
                                                 tracking=ex.tracking, stats=st, start_joint_pos=start_joint_pos)
            except Exception as exc:
                if not ex.recover(exc):  # e.g. CUDA after a Windows sleep: wait for the GPU, then retry once
                    raise
                st = {}
                result, signals = _replay.replay(traj, scene, ep_dir=ep_dir, record_cameras=record_cameras,
                                                 tracking=ex.tracking, stats=st, start_joint_pos=start_joint_pos)
            return result, signals, st["trajectory"]

        rows = run_recovery(states, bin_poses, replay_fn, root=root, cameras=cameras,
                            log=lambda m: print(m, flush=True))
        manifest = recovery_manifest(rows)
        manifest.update(states_file=str(args_cli.states), data_dir=str(root), cameras=cameras,
                        total_wall_s=round(time.time() - t0, 1))
        args_cli.manifest.parent.mkdir(parents=True, exist_ok=True)
        args_cli.manifest.write_text(json.dumps(manifest, indent=1), encoding="utf-8")
        print("RECOVERY " + json.dumps({k: manifest[k] for k in ("attempts", "verified", "yield", "by_mode",
                                                                   "reasons")}), flush=True)


if __name__ == "__main__":
    main()
