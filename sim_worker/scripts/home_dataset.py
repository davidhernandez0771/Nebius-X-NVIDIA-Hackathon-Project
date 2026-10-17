"""Home-start multiply dataset for T3 (T2 sprint 6, Task 2). Resumable: finished episodes are reused by scene.

    C:\\isaac\\env_isaaclab\\Scripts\\python.exe sim_worker\\scripts\\home_dataset.py --sources 10 --variants 10

For each source seed (sim_worker.homeset): the scripted expert with home_start on sample_scene(seed) -> replay with
cameras -> DATA_DIR/episodes/home_src_<seed>/; then multiply it (transform_trajectory, as the sim worker's /multiply,
then homeset.rehome so every variant also starts at home) into 10 variant scenes ->
DATA_DIR/episodes/home_src_<seed>_<variant seed>/. Every episode is stamped with a
Passport (lineage source -> variant). Writes DATA_DIR/episodes/<name>_manifest.json (yield, every episode dir) and
<name>_grid.json (lerobot_tools.experiments grid: raw and raw_multiply cells of the verified episodes).
"""

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np

from isaaclab.app import add_launcher_args, launch_simulation

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))  # repo root, for `sim_worker`

parser = argparse.ArgumentParser(description="Render home-start scripted sources and multiply each one.")
parser.add_argument("--sources", type=int, default=10)
parser.add_argument("--variants", type=int, default=10)
parser.add_argument("--name", default="home_v1", help="manifest / grid file name prefix")
parser.add_argument("--no-cameras", action="store_true")
add_launcher_args(parser)
args_cli = parser.parse_args()
if not args_cli.no_cameras:
    args_cli.enable_cameras = True

from demo_pipeline.multiply import sample_scene, transform_trajectory  # noqa: E402
from demo_pipeline.paths import data_dir  # noqa: E402
from demo_pipeline.sim_protocol import ReplayRequest  # noqa: E402
from sim_worker.homeset import (dataset_manifest, first_move_steps, passport, rehome, source_name,  # noqa: E402
                                source_seeds, stamp, variant_seeds)
from sim_worker.isaac_executor import IsaacExecutor  # noqa: E402
from sim_worker.jobs import _stored_variant, episodes_dir, run_replay, variant_name  # noqa: E402
from sim_worker.keepawake import KeepAwake  # noqa: E402
from sim_worker.replay import make_sim_cfg  # noqa: E402
from sim_worker.scripted import scripted_expert  # noqa: E402


def _render(ex, traj, scene, name: str, common: dict) -> dict:
    """Replay into episodes/<name>, or reuse a finished folder recorded for this scene."""
    ep, t0 = (episodes_dir(common["root"]) / name).resolve(), time.time()
    stored = _stored_variant(ep, scene)
    if stored is not None:
        verification = stored[1]
        print(f"[home] {name}: reused (success={verification.success})", flush=True)
    else:
        try:
            req = ReplayRequest(trajectory=traj, scene=scene, record_cameras=common["worker_cameras"], out_name=name)
            verification = run_replay(req, ex._replay_fn, recover=ex.recover, **common).verification
        except Exception as exc:  # one broken replay is a recorded failure; the next run retries it
            print(f"[home] {name}: sim_error {exc!r}", flush=True)
            return {"success": False, "reasons": ["sim_error"], "ep_dir": None, "verification": None,
                    "wall_s": round(time.time() - t0, 1)}
    return {"success": verification.success, "reasons": verification.reasons, "ep_dir": str(ep),
            "verification": verification, "wall_s": round(time.time() - t0, 1)}


def main() -> None:
    root, cameras = Path(data_dir()), not args_cli.no_cameras
    eps = episodes_dir(root)
    common = dict(root=root, worker_robot="franka", worker_cameras=cameras)
    sources, variants, t0 = [], [], time.time()
    with launch_simulation(make_sim_cfg(args_cli.device), args_cli), KeepAwake():  # no idle sleep mid-run
        ex = IsaacExecutor(robot="franka", cameras=cameras, root=root)
        ex.warm_up()
        for i, seed in enumerate(source_seeds(args_cli.sources)):
            scene = sample_scene(np.random.default_rng(seed), "franka", seed)
            traj = scripted_expert(scene, home_start=True)
            name = source_name(seed)
            row = _render(ex, traj, scene, name, common) | {"name": name, "seed": seed, "n_steps": len(traj.t)}
            verification = row.pop("verification")
            if row["ep_dir"] is not None:
                stamp(row["ep_dir"], passport(name, [name], verification))
            sources.append(row)
            print("SOURCE " + json.dumps(row), flush=True)

            k, ok = first_move_steps(scene), 0
            for vseed in variant_seeds(i, args_cli.variants):
                dst = sample_scene(np.random.default_rng(vseed), "franka", vseed)
                vname = variant_name(name, vseed)
                vtraj = rehome(transform_trajectory(traj, scene, dst), k)
                row = _render(ex, vtraj, dst, vname, common) | {"name": vname, "source": name, "seed": vseed}
                verification = row.pop("verification")
                if row["ep_dir"] is not None:
                    stamp(row["ep_dir"], passport(vname, [name, vname], verification, variant_seed=vseed))
                variants.append(row)
                ok += row["success"]
                print("VARIANT " + json.dumps(row), flush=True)
            print(f"MULTIPLY {name}: {ok}/{args_cli.variants}", flush=True)

        manifest = dataset_manifest(sources, variants)
        manifest.update(name=args_cli.name, cameras=cameras, total_wall_s=round(time.time() - t0, 1))
        (eps / f"{args_cli.name}_manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
        grid = dict(manifest["grid"], name=args_cli.name)
        (eps / f"{args_cli.name}_grid.json").write_text(json.dumps(grid, indent=1), encoding="utf-8")
        print("MANIFEST " + json.dumps({k: manifest[k] for k in ("sources_verified", "variant_attempts",
                                                                  "variant_successes", "yield", "variant_reasons")}),
              flush=True)


if __name__ == "__main__":
    main()
