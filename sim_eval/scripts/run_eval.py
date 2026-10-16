"""Evaluate a served policy on N seeded test scenes in Isaac Lab -> success out of N (+ registry update).

Start the policy server first (lerobot venv), then run this with the Isaac Python, headless:
    C:\\venvs\\lerobot\\Scripts\\python.exe -m lerobot_tools.policy_server --checkpoint <run dir> --port 8765
    C:\\isaac\\env_isaaclab\\Scripts\\python.exe sim_eval\\scripts\\run_eval.py --checkpoint-url http://127.0.0.1:8765 ^
        --n 50 --seed0 5000 --cell raw_multiply_10 --cameras

Never run two Isaac processes at once (the GPU is shared with Terminal 2).
With --cell, eval_success is written into that cell's row of DATA_DIR/results/registry.jsonl (matched by the
checkpoint the server reports). Results go to DATA_DIR/evals/<cell>_<timestamp>.json unless --out is given.
The last stdout line is "RESULT_JSON {...summary...}".
"""

import argparse
import json
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
# This worktree's demo_pipeline (src/) and sim_worker/sim_eval/lerobot_tools (root) go first: the Isaac env has an
# editable demo_pipeline from C:\dev\pm-t2, which is being changed while we evaluate.
sys.path[:0] = [str(REPO / "src"), str(REPO)]

from isaaclab.app import add_launcher_args, launch_simulation  # noqa: E402

parser = argparse.ArgumentParser(description="Evaluate a served policy on seeded test scenes.")
parser.add_argument("--checkpoint-url", default="http://127.0.0.1:8765", help="policy server URL")
parser.add_argument("--n", type=int, default=50, help="number of test scenes")
parser.add_argument("--seed0", type=int, default=5000, help="first test-scene seed (>= 5000)")
parser.add_argument("--cell", default=None, help="experiment cell name; writes eval_success into the registry")
parser.add_argument("--cameras", action="store_true", help="render front + wrist 128x128 (needed by image policies)")
parser.add_argument("--max-seconds", type=float, default=30.0, help="per-episode time limit")
parser.add_argument("--out", type=Path, default=None, help="results JSON (default DATA_DIR/evals/...)")
parser.add_argument("--registry", type=Path, default=None, help="default DATA_DIR/results/registry.jsonl")
parser.add_argument("--no-registry", action="store_true", help="do not touch the registry even with --cell")
parser.add_argument("--num_envs", type=int, default=1, help="must be 1")
add_launcher_args(parser)
args_cli = parser.parse_args()
if args_cli.num_envs != 1:
    parser.error("--num_envs must be 1")
if args_cli.cameras:
    args_cli.enable_cameras = True  # cameras need the rendering extensions in headless launches

from demo_pipeline.paths import data_dir  # noqa: E402
from lerobot_tools.policy_client import PolicyClient, PolicyServerError  # noqa: E402
from sim_eval.eval_policy import evaluate  # noqa: E402
from sim_eval.registry import update_registry  # noqa: E402
from sim_eval.report import default_results_path, preflight, write_results  # noqa: E402
from sim_eval.retry import RetryingPolicy  # noqa: E402
from sim_eval.scenes import eval_scenes  # noqa: E402
from sim_worker.replay import make_sim_cfg  # noqa: E402
from sim_worker.scene_cfg import IMAGE_SIZE  # noqa: E402


class VramPoller(threading.Thread):
    """Whole-GPU memory used (MiB) via nvidia-smi; per-process numbers are N/A under WDDM."""

    def __init__(self, interval_s: float = 1.0):
        super().__init__(daemon=True)
        self.interval_s, self.samples, self._halt = interval_s, [], threading.Event()

    @staticmethod
    def read_mib():
        try:
            out = subprocess.run(["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"],
                                 capture_output=True, text=True, timeout=10).stdout
            return int(out.strip().splitlines()[0])
        except (OSError, ValueError, IndexError, subprocess.SubprocessError):
            return None

    def run(self):
        while not self._halt.is_set():
            if (v := self.read_mib()) is not None:
                self.samples.append(v)
            self._halt.wait(self.interval_s)

    def stop(self):
        self._halt.set()
        self.join(timeout=5)


def main() -> None:
    t0 = time.time()
    client = PolicyClient(args_cli.checkpoint_url, timeout=60)
    try:
        health = client.health()
    except PolicyServerError as e:
        print(f"[eval] policy server not reachable: {e}", flush=True)
        sys.exit(2)
    problems = preflight(health, cameras=args_cli.cameras, image_size=IMAGE_SIZE)
    if problems:
        print("[eval] refusing to start:\n  " + "\n  ".join(problems), flush=True)
        sys.exit(2)
    scenes = eval_scenes(args_cli.n, args_cli.seed0)
    out = args_cli.out or default_results_path(data_dir(), args_cli.cell)
    run = {
        "cell": args_cli.cell, "checkpoint_url": args_cli.checkpoint_url, "checkpoint": health.get("checkpoint"),
        "policy_type": health.get("policy_type"), "policy_device": health.get("device"), "n": args_cli.n,
        "seed0": args_cli.seed0, "max_seconds": args_cli.max_seconds, "cameras": args_cli.cameras,
        "started": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    print(f"[eval] policy {health.get('checkpoint')} ({health.get('policy_type')}, {health.get('device')}); "
          f"{args_cli.n} scenes from seed {args_cli.seed0}; cameras={args_cli.cameras}", flush=True)

    vram_baseline = VramPoller.read_mib()
    poller = VramPoller()
    poller.start()
    with launch_simulation(make_sim_cfg(args_cli.device), args_cli):
        from sim_eval.isaac_env import IsaacEvalEnv

        t_build = time.time()
        env = IsaacEvalEnv(cameras=args_cli.cameras, device=args_cli.device)
        build_s = time.time() - t_build
        print(f"[eval] scene built in {build_s:.1f} s; joints {env.joint_names}", flush=True)

        policy = RetryingPolicy(client)  # absorbs Windows loopback connection resets; see sim_eval/retry.py
        retries_per_episode = []

        def progress(i, ep):
            retries_per_episode.append(policy.retries - sum(retries_per_episode))
            print(f"[eval] {i + 1}/{len(scenes)} seed={ep.seed} success={ep.success} ended_by={ep.ended_by} "
                  f"steps={ep.steps} sim_s={ep.sim_s:.2f} wall_s={ep.wall_s:.1f} reasons={ep.reasons} "
                  f"retries={retries_per_episode[-1]}" + (f" error={ep.error}" if ep.error else ""), flush=True)

        episodes, summary = evaluate(env, policy, scenes, on_episode=progress, max_seconds=args_cli.max_seconds)
        poller.stop()
        run.update(
            scene_build_s=round(build_s, 1),
            wall_s_total=round(time.time() - t0, 1),
            wall_s_per_episode=[round(e.wall_s, 2) for e in episodes],
            connection_retries_per_episode=retries_per_episode,
            vram_baseline_mib=vram_baseline,
            vram_peak_mib=max(poller.samples) if poller.samples else None,
        )
        if args_cli.cell and not args_cli.no_registry:
            registry = args_cli.registry or data_dir() / "results" / "registry.jsonl"
            try:
                n = update_registry(registry, args_cli.cell, summary, seed0=args_cli.seed0,
                                    checkpoint=health.get("checkpoint"), results_file=str(out))
                run["registry"] = {"path": str(registry), "rows_updated": n}
            except (LookupError, ValueError, FileNotFoundError) as e:
                run["registry"] = {"path": str(registry), "rows_updated": 0, "error": f"{type(e).__name__}: {e}"}
                print(f"[eval] registry NOT updated: {e}", flush=True)
        write_results(out, run, episodes, summary)
        # print inside the context: closing the app ends the process
        print(f"[eval] {summary.successes}/{summary.n} succeeded; reasons {summary.reasons}; "
              f"results {out}; wall {run['wall_s_total']} s; VRAM peak {run['vram_peak_mib']} MiB "
              f"(baseline {vram_baseline})", flush=True)
        print("RESULT_JSON " + json.dumps(summary.model_dump()), flush=True)


if __name__ == "__main__":
    main()
