"""Home-start multiply dataset for T3 (T2 sprint 6, Task 2). Resumable: finished episodes are reused by scene.

    C:\\isaac\\env_isaaclab\\Scripts\\python.exe sim_worker\\scripts\\home_dataset.py --sources 10 --variants 10

For each source seed (sim_worker.homeset): the scripted expert with home_start on sample_scene(seed) -> replay with
cameras -> DATA_DIR/episodes/home_src_<seed>/; then multiply it (transform_trajectory, as the sim worker's /multiply)
into 10 variant scenes -> DATA_DIR/episodes/home_src_<seed>_<variant seed>/. Every episode is stamped with a
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

from demo_pipeline.multiply import sample_scene  # noqa: E402
from demo_pipeline.paths import data_dir  # noqa: E402
from demo_pipeline.sim_protocol import MultiplyRequest, ReplayRequest  # noqa: E402
from sim_worker.homeset import dataset_manifest, passport, source_name, source_seeds, stamp, variant_seeds  # noqa: E402
from sim_worker.isaac_executor import IsaacExecutor  # noqa: E402
from sim_worker.jobs import _stored_variant, episodes_dir, run_multiply, run_replay, variant_name  # noqa: E402
from sim_worker.keepawake import KeepAwake  # noqa: E402
from sim_worker.replay import make_sim_cfg  # noqa: E402
from sim_worker.scripted import scripted_expert  # noqa: E402


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
            ep = (eps / name).resolve()
            t_src = time.time()
            stored = _stored_variant(ep, scene)
            if stored is not None:
                verification = stored[1]
                print(f"[home] {name}: reused (success={verification.success})", flush=True)
            else:
                req = ReplayRequest(trajectory=traj, scene=scene, record_cameras=cameras, out_name=name)
                verification = run_replay(req, ex._replay_fn, recover=ex.recover, **common).verification
            stamp(ep, passport(name, [name], verification))
            row = {"name": name, "seed": seed, "success": verification.success, "reasons": verification.reasons,
                   "ep_dir": str(ep), "n_steps": len(traj.t), "wall_s": round(time.time() - t_src, 1)}
            sources.append(row)
            print("SOURCE " + json.dumps(row), flush=True)

            seeds = variant_seeds(i, args_cli.variants)
            req = MultiplyRequest(trajectory=traj, scene=scene, robot="franka", n=len(seeds), seed0=seeds[0],
                                  record_cameras=cameras, out_prefix=name)
            resp = run_multiply(req, ex._replay_fn, recover=ex.recover, **common)
            for v in resp.variants:
                vname = variant_name(name, v.seed)
                if v.ep_dir is not None:
                    stamp(v.ep_dir, passport(vname, [name, vname], v.verification, variant_seed=v.seed))
                variants.append({"name": vname, "source": name, "seed": v.seed, "success": v.verification.success,
                                 "reasons": v.verification.reasons, "ep_dir": v.ep_dir})
            print(f"MULTIPLY {name}: {resp.successes}/{resp.attempts} in {resp.wall_s:.0f} s", flush=True)

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
