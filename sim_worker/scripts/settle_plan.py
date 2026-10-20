"""Build one ScenePlan in Isaac, let physics run 1 s, and write the settle check (sim_worker.settle) as JSON:
{"errors": [...], "moved": {cube: metres}, "before": ..., "after": ...}, plus a front-camera PNG with --screenshot.

Usage (Isaac python, headless by default; one plan per process):
    C:\\isaac\\env_isaaclab\\Scripts\\python.exe sim_worker\\scripts\\settle_plan.py --plan plan.json --out settle.json \\
        [--screenshot shot.png] [--robot franka] [--no-lock]

sim_worker.settle.settle_in_isaac (the scene creator's --settle) runs exactly this. It takes the shared GPU lock
(C:\\dev\\gpu.lock, sim_worker.gpulock) and waits while another GPU job holds it.
"""

import argparse
import json
import sys
from contextlib import nullcontext
from pathlib import Path

from isaaclab.app import add_launcher_args, launch_simulation

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))  # for `sim_worker`
sys.path.insert(0, str(REPO / "src"))  # for `demo_pipeline`

parser = argparse.ArgumentParser(description="Settle one ScenePlan in Isaac.")
parser.add_argument("--plan", type=Path, required=True, help="a ScenePlan JSON file")
parser.add_argument("--out", type=Path, required=True, help="where to write the result JSON")
parser.add_argument("--screenshot", type=Path, default=None, help="also save the front camera's view (PNG)")
parser.add_argument("--robot", default="franka")
parser.add_argument("--no-lock", action="store_true", help="the caller already holds the GPU lock (scene_smoke.py)")
add_launcher_args(parser)
args_cli = parser.parse_args()
if args_cli.screenshot is not None:
    args_cli.enable_cameras = True

from demo_pipeline.scene_plan import ScenePlan  # noqa: E402
from sim_worker.keepawake import KeepAwake  # noqa: E402
from sim_worker.plan_scene import settle_plan  # noqa: E402
from sim_worker.replay import make_sim_cfg  # noqa: E402


def main() -> None:
    plan = ScenePlan.model_validate_json(args_cli.plan.read_text(encoding="utf-8"))
    lock = nullcontext()
    if not args_cli.no_lock:
        from sim_worker.gpulock import GpuLock

        lock = GpuLock(task=f"settle:{args_cli.plan.stem}", terminal="T5")
    with lock, launch_simulation(make_sim_cfg(args_cli.device), args_cli), KeepAwake():
        res = settle_plan(plan, robot=args_cli.robot, screenshot=args_cli.screenshot is not None, device=args_cli.device)
        image = res.pop("image", None)
        if image is not None:
            from PIL import Image

            args_cli.screenshot.parent.mkdir(parents=True, exist_ok=True)
            Image.fromarray(image).save(args_cli.screenshot)
        args_cli.out.parent.mkdir(parents=True, exist_ok=True)
        args_cli.out.write_text(json.dumps(res, indent=1), encoding="utf-8")
        print(f"[settle] {args_cli.plan.name}: " + ("settled" if not res["errors"] else "; ".join(res["errors"])))
        # still inside launch_simulation: leaving it closes the app, which ends this process


if __name__ == "__main__":
    main()
