"""Measure multiply yield through a running sim worker (stdlib client). Resumable: the worker reuses finished seeds.

    python sim_worker\\scripts\\client_multiply.py --n 30 --seed0 100 --prefix yield_clean_franka
    python sim_worker\\scripts\\client_multiply.py --demo <set>/<id>/demo.json --n 5 --seed0 0 --prefix ...

The source is the scripted expert on the base scene unless --demo gives a Demo JSON (its trajectory and scene).
Prints one YIELD line (attempts, successes, reasons histogram) and writes it to --out if given.
"""

import argparse
import collections
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))  # repo root, for `sim_worker`

from demo_pipeline.schemas import Demo, Pose, Scene  # noqa: E402
from demo_pipeline.sim_protocol import MultiplyRequest, MultiplyResponse  # noqa: E402
from sim_worker.http_client import WorkerError, post_json  # noqa: E402
from sim_worker.scripted import scripted_expert  # noqa: E402

parser = argparse.ArgumentParser()
parser.add_argument("--url", default="http://127.0.0.1:8770")
parser.add_argument("--robot", default="franka")
parser.add_argument("--demo", type=Path, default=None, help="Demo JSON to multiply (default: the scripted expert)")
parser.add_argument("--n", type=int, default=30)
parser.add_argument("--seed0", type=int, default=100)
parser.add_argument("--prefix", required=True)
parser.add_argument("--out", type=Path, default=None)
args = parser.parse_args()


def main() -> None:
    if args.demo is not None:
        demo = Demo.model_validate_json(args.demo.read_text(encoding="utf-8"))
        traj, scene = demo.trajectory, demo.scene
    else:
        scene = Scene(cube_pose=Pose(pos=(0.5, 0.0, 0.025), quat_wxyz=(1, 0, 0, 0)),
                      bin_pose=Pose(pos=(0.5, 0.3, 0.0), quat_wxyz=(1, 0, 0, 0)), robot=args.robot, seed=0)
        traj = scripted_expert(scene)
    body = MultiplyRequest(trajectory=traj, scene=scene, robot=args.robot, n=args.n, seed0=args.seed0,
                           out_prefix=args.prefix).model_dump_json().encode()
    t0 = time.time()
    try:  # retries a dropped connection or 409 busy; finished seeds come back from disk at once
        resp = MultiplyResponse.model_validate(post_json(args.url + "/multiply", body))
    except WorkerError as e:
        print("ERROR", e.status, e.body, flush=True)
        sys.exit(1)
    reasons = collections.Counter(x for v in resp.variants for x in v.verification.reasons)
    out = {"source": str(args.demo) if args.demo else "scripted_expert", "robot": args.robot, "prefix": args.prefix,
           "seed0": args.seed0, "attempts": resp.attempts, "successes": resp.successes,
           "yield": resp.successes / resp.attempts if resp.attempts else 0.0, "reasons": dict(reasons),
           "worker_wall_s": round(resp.wall_s, 1), "client_s": round(time.time() - t0, 1),
           "variants": [{"seed": v.seed, "success": v.verification.success, "reasons": v.verification.reasons,
                         "ep_dir": v.ep_dir} for v in resp.variants]}
    if args.out is not None:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(out, indent=1), encoding="utf-8")
    print("YIELD " + json.dumps({k: v for k, v in out.items() if k != "variants"}), flush=True)


if __name__ == "__main__":
    main()
