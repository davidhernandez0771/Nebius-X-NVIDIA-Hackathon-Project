"""Evaluate a policy on N seeded test scenes with several envs in one Isaac process (sprint 7 T2 prototype).

Start a policy pool first (lerobot venv; one session per env), then run this with the Isaac Python, headless:
    set PYTHONPATH=C:\\dev\\pm-t2\\src;C:\\dev\\pm-t2
    C:\\venvs\\lerobot\\Scripts\\python.exe -m sim_eval.parallel.pool --checkpoint <run dir> --n 4 --base-port 8770
    C:\\isaac\\env_isaaclab\\Scripts\\python.exe sim_eval\\parallel\\scripts\\run_parallel_eval.py --num-envs 4 ^
        --base-port 8770 --n 8 --seed0 5000 --cameras --reset-pose-from <serial results .json> ^
        --compare-with <serial results .json> --out data\\evals_parallel\\smoke.json

Same scenes (sim_eval.scenes.eval_scenes), same scoring (sim_eval.eval_policy) and same results format
(sim_eval.report.write_results) as sim_eval/scripts/run_eval.py. It never touches the registry. With --compare-with,
<out stem>.compare.json holds the per-seed serial vs parallel outcomes and the speedup.
The last stdout line is "RESULT_JSON {...summary...}".
"""

import argparse
import json
import os
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path[:0] = [str(REPO / "src"), str(REPO)]  # this worktree's code first (as run_eval.py)

from isaaclab.app import add_launcher_args, launch_simulation  # noqa: E402

parser = argparse.ArgumentParser(description="Evaluate a served policy with N envs in one Isaac process.")
parser.add_argument("--num-envs", type=int, required=True, help="envs stepped together (= policy sessions)")
parser.add_argument("--base-port", type=int, default=8770, help="policy pool: session i on base-port + i")
parser.add_argument("--n", type=int, default=20, help="number of unseen test scenes")
parser.add_argument("--seed0", type=int, default=5000, help="first test-scene seed (>= 5000)")
parser.add_argument("--cameras", action="store_true", help="render front + wrist 128x128 (needed by image policies)")
parser.add_argument("--max-seconds", type=float, default=30.0, help="per-episode time limit")
parser.add_argument("--reset-pose-from", type=Path, default=None,
                    help="a serial results JSON: reset to the pose that run chose (run.start_check.reset_pose)")
parser.add_argument("--compare-with", type=Path, default=None, help="a serial results JSON to compare against")
parser.add_argument("--out", type=Path, required=True, help="results JSON")
add_launcher_args(parser)
args_cli = parser.parse_args()
if args_cli.cameras:
    args_cli.enable_cameras = True

from lerobot_tools.policy_client import PolicyClient, PolicyServerError  # noqa: E402
from sim_eval.parallel.compare import compare_runs, load_episodes  # noqa: E402
from sim_eval.parallel.pool import check_pool, pool_urls  # noqa: E402
from sim_eval.parallel.vec_loop import evaluate_parallel, threaded_act_map  # noqa: E402
from sim_eval.report import isaac_gate, preflight, python_processes, write_results  # noqa: E402
from sim_eval.retry import RetryingPolicy  # noqa: E402
from sim_eval.scenes import eval_scenes  # noqa: E402
from sim_worker.keepawake import KeepAwake  # noqa: E402
from sim_worker.replay import make_sim_cfg  # noqa: E402
from sim_worker.scene_cfg import IMAGE_SIZE  # noqa: E402


def gpu_mib(field: str = "memory.used"):
    try:
        out = subprocess.run(["nvidia-smi", f"--query-gpu={field}", "--format=csv,noheader,nounits"],
                             capture_output=True, text=True, timeout=10).stdout
        return int(out.strip().splitlines()[0])
    except (OSError, ValueError, IndexError, subprocess.SubprocessError):
        return None


def main() -> None:
    t0 = time.time()
    urls = pool_urls(args_cli.num_envs, args_cli.base_port)
    clients = [PolicyClient(u, timeout=60) for u in urls]
    try:
        healths = [c.health() for c in clients]
    except PolicyServerError as e:
        print(f"[peval] policy pool not reachable: {e}", flush=True)
        sys.exit(2)
    problems = check_pool(healths) + preflight(healths[0], cameras=args_cli.cameras, image_size=IMAGE_SIZE)
    if problems:
        print("[peval] refusing to start:\n  " + "\n  ".join(problems), flush=True)
        sys.exit(2)
    reset_pose, reset_from = None, "asset default"
    if args_cli.reset_pose_from:
        serial_run = json.loads(args_cli.reset_pose_from.read_text(encoding="utf-8"))["run"]
        reset_pose = serial_run["start_check"]["reset_pose"]
        reset_from = f"{args_cli.reset_pose_from} ({serial_run['start_check'].get('chosen')})"
        if serial_run.get("checkpoint") != healths[0].get("checkpoint"):
            print(f"[peval] note: serial run used {serial_run.get('checkpoint')}, pool serves "
                  f"{healths[0].get('checkpoint')}", flush=True)
    free = gpu_mib("memory.free")
    gate_ok, gate = isaac_gate(python_processes(), own_pid=os.getpid(), free_mib=free)
    print(f"[peval] Isaac gate: {'ok' if gate_ok else 'REFUSED'}; GPU free {free} MiB", flush=True)
    if not gate_ok:
        print(f"[peval] refusing to start: {gate['reason']}", flush=True)
        sys.exit(3)
    scenes = eval_scenes(args_cli.n, args_cli.seed0)
    out = args_cli.out
    out.parent.mkdir(parents=True, exist_ok=True)
    log_path = out.with_name(out.stem + ".episodes.jsonl")
    log_path.write_text("", encoding="utf-8")
    run = {"mode": "parallel", "num_envs": args_cli.num_envs, "policy_urls": urls,
           "checkpoint": healths[0].get("checkpoint"), "policy_type": healths[0].get("policy_type"),
           "n": args_cli.n, "seed0": args_cli.seed0, "max_seconds": args_cli.max_seconds,
           "cameras": args_cli.cameras, "reset_pose": reset_pose, "reset_pose_from": reset_from, "gate": gate,
           "started": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    print(f"[peval] {args_cli.num_envs} envs, {len(scenes)} scenes from seed {args_cli.seed0}; policy "
          f"{run['checkpoint']}; reset pose from {reset_from}", flush=True)

    samples, halt = [], threading.Event()

    def poll():
        while not halt.is_set():
            if (v := gpu_mib()) is not None:
                samples.append(v)
            halt.wait(1.0)

    vram_baseline = gpu_mib()
    threading.Thread(target=poll, daemon=True).start()
    with KeepAwake(), launch_simulation(make_sim_cfg(args_cli.device), args_cli):
        from sim_eval.parallel.isaac_vec_env import IsaacVecEvalEnv

        t_build = time.time()
        env = IsaacVecEvalEnv(args_cli.num_envs, cameras=args_cli.cameras, device=args_cli.device,
                              start_joint_pos=reset_pose)
        build_s = time.time() - t_build
        print(f"[peval] scene with {args_cli.num_envs} envs built in {build_s:.1f} s", flush=True)
        policies = [RetryingPolicy(c) for c in clients]
        act_map, pool = threaded_act_map(args_cli.num_envs)
        done = []

        def progress(i, ep):
            with log_path.open("a", encoding="utf-8") as f:
                f.write(json.dumps({"episode": ep.model_dump()}) + "\n")
            done.append(ep)
            print(f"[peval] {len(done)}/{len(scenes)} seed={ep.seed} success={ep.success} ended_by={ep.ended_by} "
                  f"steps={ep.steps} wall_s={ep.wall_s:.1f} reasons={ep.reasons} t={time.time() - t_loop:.0f}s"
                  + (f" error={ep.error}" if ep.error else ""), flush=True)

        t_loop = time.time()
        episodes, summary = evaluate_parallel(env, policies, scenes, on_episode=progress, act_map=act_map,
                                              max_seconds=args_cli.max_seconds)
        loop_s = time.time() - t_loop
        pool.shutdown()
        halt.set()
        run.update(scene_build_s=round(build_s, 1), eval_loop_s=round(loop_s, 1),
                   wall_s_total=round(time.time() - t0, 1), episodes_per_hour=round(len(episodes) / loop_s * 3600, 1),
                   sim_steps_per_s=round(sum(e.steps for e in episodes) / loop_s, 1),
                   connection_retries=sum(p.retries for p in policies),
                   vram_baseline_mib=vram_baseline, vram_peak_mib=max(samples) if samples else None)
        write_results(out, run, episodes, summary)
        print(f"[peval] {summary.successes}/{summary.n} succeeded; reasons {summary.reasons}; loop {loop_s:.0f} s "
              f"({run['episodes_per_hour']} episodes/h, {run['sim_steps_per_s']} episode-steps/s); VRAM peak "
              f"{run['vram_peak_mib']} MiB (baseline {vram_baseline}); results {out}", flush=True)
        if args_cli.compare_with:
            cmp = compare_runs(load_episodes(args_cli.compare_with), episodes, parallel_wall_s=loop_s)
            cmp["serial_results"] = str(args_cli.compare_with)
            cmp_path = out.with_name(out.stem + ".compare.json")
            cmp_path.write_text(json.dumps(cmp, indent=2), encoding="utf-8")
            print(f"[peval] vs serial: successes {cmp['serial_successes']} -> {cmp['parallel_successes']} of "
                  f"{cmp['n']}; outcome agree {cmp['outcome_agree']}/{cmp['n']} (differ: {cmp['disagree_seeds']}); "
                  f"serial {cmp['serial_wall_s']:.0f} s vs parallel {loop_s:.0f} s = {cmp['speedup']:.2f}x; "
                  f"{cmp_path}", flush=True)
        print("RESULT_JSON " + json.dumps(summary.model_dump()), flush=True)


if __name__ == "__main__":
    main()
