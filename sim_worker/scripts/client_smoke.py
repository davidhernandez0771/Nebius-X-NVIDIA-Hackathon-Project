"""Live smoke test of a running sim worker, stdlib client only (any python with demo_pipeline importable).

    C:\\isaac\\env_isaaclab\\Scripts\\python.exe sim_worker\\scripts\\client_smoke.py [--url http://127.0.0.1:8770]

Checks: /health; one /replay (base scene, scripted expert); one /multiply with n=3, during which a second /replay
must get 409 busy; then the same /multiply again, which must reuse every variant from disk (resume by seed).
"""

import argparse
import json
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))  # repo root, for `sim_worker`
from sim_worker.own_code import check_own_code, put_own_code_first  # noqa: E402

put_own_code_first()  # this checkout's src before the venv's editable install (it points at another worktree)

from demo_pipeline.schemas import Pose, Scene  # noqa: E402
from demo_pipeline.sim_protocol import (  # noqa: E402
    HealthResponse,
    MultiplyRequest,
    MultiplyResponse,
    ReplayRequest,
    ReplayResponse,
)
from sim_worker.scripted import scripted_expert  # noqa: E402

parser = argparse.ArgumentParser()
parser.add_argument("--url", default="http://127.0.0.1:8770")
parser.add_argument("--robot", default="franka")
parser.add_argument("--n", type=int, default=3)
parser.add_argument("--prefix", default="smoke_mult")
args = parser.parse_args()


def call(path: str, body: str | None = None, timeout: float = 3600) -> tuple[int, dict]:
    req = urllib.request.Request(args.url + path, data=None if body is None else body.encode(),
                                 method="GET" if body is None else "POST", headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def main() -> None:
    check_own_code()  # logs where demo_pipeline came from; stops if not this checkout
    status, body = call("/health")
    health = HealthResponse.model_validate(body)
    print("HEALTH", status, health.model_dump_json(), flush=True)
    scene = Scene(cube_pose=Pose(pos=(0.5, 0.0, 0.025), quat_wxyz=(1, 0, 0, 0)),
                  bin_pose=Pose(pos=(0.5, 0.3, 0.0), quat_wxyz=(1, 0, 0, 0)), robot=args.robot, seed=0)
    traj = scripted_expert(scene)

    t0 = time.time()
    status, body = call("/replay", ReplayRequest(trajectory=traj, scene=scene, out_name="smoke_server",
                                                 record_cameras=health.cameras).model_dump_json())
    rep = ReplayResponse.model_validate(body)
    print("REPLAY", status, json.dumps({"success": rep.verification.success, "reasons": rep.verification.reasons,
                                        "n_steps": rep.n_steps, "ep_dir": rep.ep_dir, "wall_s": round(rep.wall_s, 1),
                                        "client_s": round(time.time() - t0, 1)}), flush=True)

    mreq = MultiplyRequest(trajectory=traj, scene=scene, robot=args.robot, n=args.n, seed0=100,
                           out_prefix=args.prefix).model_dump_json()
    out: dict = {}
    t = threading.Thread(target=lambda: out.update(r=call("/multiply", mreq)))
    t0 = time.time()
    t.start()
    time.sleep(3)
    status, body = call("/replay", ReplayRequest(trajectory=traj, scene=scene, out_name="smoke_busy").model_dump_json(),
                        timeout=30)
    print("BUSY_PROBE", status, json.dumps(body), flush=True)
    _, health_body = call("/health")
    print("HEALTH_DURING", json.dumps(health_body), flush=True)
    t.join()
    status, body = out["r"]
    mult = MultiplyResponse.model_validate(body)
    print("MULTIPLY", status, json.dumps({"attempts": mult.attempts, "successes": mult.successes,
                                         "wall_s": round(mult.wall_s, 1), "client_s": round(time.time() - t0, 1),
                                         "variants": [[v.seed, v.verification.success, v.verification.reasons,
                                                       v.ep_dir] for v in mult.variants]}), flush=True)

    t0 = time.time()
    status, body = call("/multiply", mreq)
    again = MultiplyResponse.model_validate(body)
    print("MULTIPLY_RESUME", status, json.dumps({"attempts": again.attempts, "successes": again.successes,
                                                "wall_s": round(again.wall_s, 2),
                                                "client_s": round(time.time() - t0, 2)}), flush=True)


if __name__ == "__main__":
    main()
