r"""The human demos re-executed held, cameras on, written as training episodes (sim_eval.held_human).

    C:\isaac\env_isaaclab\Scripts\python.exe sim_eval\scripts\held_human_rollouts.py --k 2 ^
        --grid C:\dev\pm-t6\data\human_exp\mouse20261020\grid.json --cell perfected_multiply_10 ^
        --start-state C:\dev\pm-t6\data\experiments\hx_mouse20261020_20261020_164411\datasets\raw_10 ^
        --out data\held_human\mouse20261020 [--grip-settle-m 0.005] [--no-lock] [--run-log <file>]

Every episode of the cell is replayed by sim_eval.held_human.HumanPathTeacher (its commanded path slowed by --k,
speed-capped) through sim_eval.distill.rollout with teacher_execution="held"; only check_success passes are written,
to <out>/episodes/held_<demo id>/. One row per source episode in <out>/rollouts.jsonl (its provenance: source,
success, reasons, steps, wall time); resumable (sources with a row are skipped, an interrupted attempt's folder is
moved to <out>/_stale/). Done: <out>/held_human_done.json ("kept" / "attempted", "frames", "k", "failures") and
<out>/grid.json (one cell, held_human_10, of the kept episodes) for T6's --human-grid / --human-cell held_human_10.

Takes C:\dev\gpu.lock for the run (--no-lock: the parent holds it), keeps the PC awake and runs at full speed.
"""

import argparse
import json
import os
import shutil
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(REPO / "src"), str(REPO)]  # this worktree's demo_pipeline first (the Isaac env has another's)
from sim_worker.own_code import check_own_code  # noqa: E402

from isaaclab.app import add_launcher_args, launch_simulation  # noqa: E402

parser = argparse.ArgumentParser(description="Human demos re-executed held, written as training episodes.")
parser.add_argument("--k", type=float, required=True, help="the path's slow-down (the lead's rule: k_table.json)")
parser.add_argument("--grid", type=Path, required=True, help="the SANT grid with the human-derived cell")
parser.add_argument("--cell", required=True, help="its label or <condition>_<n_human>")
parser.add_argument("--start-state", type=Path, required=True, help="start_state.json or the dataset root with it")
parser.add_argument("--out", type=Path, required=True)
parser.add_argument("--grip-settle-m", type=float, default=None,
                    help="grasp wait: at each gripper change the path waits until the tool is this close to the target "
                         "(HumanPathTeacher; default off)")
parser.add_argument("--grip-settle-max-s", type=float, default=1.0, help="the longest grasp wait per gripper change")
parser.add_argument("--pilot", type=int, default=0,
                    help="run the first N source episodes first; continue only if --pilot-min of them pass (0: off)")
parser.add_argument("--pilot-min", type=int, default=0)
parser.add_argument("--no-lock", action="store_true", help="don't take gpu.lock (a parent process holds it)")
parser.add_argument("--run-log", type=Path, default=None, help="append start/end lines with the code commit here")
parser.add_argument("--num_envs", type=int, default=1, help="must be 1")
add_launcher_args(parser)
args_cli = parser.parse_args()
if args_cli.num_envs != 1:
    parser.error("--num_envs must be 1")
if args_cli.pilot < 0 or not 0 <= args_cli.pilot_min <= args_cli.pilot:
    parser.error("--pilot-min must be between 0 and --pilot")
args_cli.enable_cameras = True  # the student is a camera policy: every episode needs its images

from demo_pipeline.schemas import Scene  # noqa: E402
from sim_eval.distill import RolloutConfig, append_row, rollout  # noqa: E402
from sim_eval.distill_round import code_version, human_episodes  # noqa: E402
from sim_eval.held_human import (  # noqa: E402
    LABEL, HumanPath, HumanPathTeacher, human_grid, max_seconds, pilot_decision, rollout_diagnostics,
    write_held_episode,
)
from sim_eval.report import gpu_pids, isaac_gate, python_processes, resolve_start  # noqa: E402
from sim_worker.gpulock import GpuLock  # noqa: E402
from sim_worker.keepawake import KeepAwake  # noqa: E402
from sim_worker.replay import make_sim_cfg  # noqa: E402


def log(msg: str) -> None:
    print(f"[held_human {datetime.now():%H:%M:%S}] {msg}", flush=True)


def run_log(msg: str) -> None:
    if args_cli.run_log is not None:
        args_cli.run_log.parent.mkdir(parents=True, exist_ok=True)
        with args_cli.run_log.open("a", encoding="utf-8") as f:
            f.write(f"{datetime.now().isoformat(timespec='seconds')} held_human {msg}\n")


def read_rows(path: Path) -> dict[str, dict]:
    rows = {}
    if path.is_file():
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                row = json.loads(line)
                rows[row["demo_id"]] = row
    return rows


def free_mib() -> float:
    import importlib.util

    spec = importlib.util.spec_from_file_location("eval_cells", REPO / "sim_eval" / "scripts" / "eval_cells.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.free_mib()


def main() -> int:
    check_own_code()  # logs where demo_pipeline came from; stops if not this checkout
    from sim_worker.teleop_qos import full_speed

    full_speed()  # out of Windows power throttling (per process: a child does not inherit it)
    a = args_cli
    t0 = time.time()
    out = a.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    sources, n_human = human_episodes(a.grid, a.cell)
    paths = {ep: HumanPath.from_episode(ep) for ep in sources}
    rows_path = out / "rollouts.jsonl"
    rows = read_rows(rows_path)
    todo = [ep for ep in sources if paths[ep].demo_id not in rows]
    code = code_version(REPO)
    log(f"{len(sources)} human episodes from {a.grid} [{a.cell}], k {a.k}; {len(rows)} done, {len(todo)} to go "
        f"-> {out}")
    run_log(f"start: code {code}; k {a.k}; grip_settle_m {a.grip_settle_m}; pilot {a.pilot} (min {a.pilot_min}); "
            f"{len(rows)} done, {len(todo)} to go; out {out}")

    def pilot() -> str | None:
        if not a.pilot:
            return None
        got = [rows[paths[ep].demo_id]["success"] if paths[ep].demo_id in rows else None for ep in sources[:a.pilot]]
        return pilot_decision(got, a.pilot_min)

    def pilot_line() -> str:
        kept = sum(rows[paths[ep].demo_id]["success"] for ep in sources[:a.pilot])
        return f"pilot: kept {kept}/{a.pilot} (min {a.pilot_min}) -> {pilot()}"

    decided = pilot()
    if decided == "stop":
        todo = []
    if todo:
        start_pose, start_check = resolve_start("dataset", start_state=a.start_state)
        ok, gate = isaac_gate(python_processes(), own_pid=os.getpid(), free_mib=free_mib(), gpu_pids=gpu_pids())
        if not ok:
            log(f"refusing to start: {gate['reason']}")
            return 3
        log(f"start pose {start_check['chosen']}")
        lock = None if a.no_lock else GpuLock(task="held_human", log=log)
        with KeepAwake():
            if lock is not None:
                lock.acquire()
            try:
                # Everything happens inside the context: closing the app ends the process.
                with launch_simulation(make_sim_cfg(a.device), a):
                    from sim_eval.isaac_distill_env import IsaacDistillEnv

                    env = IsaacDistillEnv(cameras=True, device=a.device, start_joint_pos=start_pose)
                    for i, ep in enumerate(todo):
                        if decided == "stop":
                            break
                        t1 = time.time()
                        path = paths[ep]
                        scene = Scene.model_validate_json((ep / "scene.json").read_text(encoding="utf-8"))
                        stale = out / "episodes" / f"held_{path.demo_id}"
                        if stale.exists():  # an interrupted attempt: set aside, never deleted
                            dest = out / "_stale" / f"{stale.name}_{datetime.now():%Y%m%d%H%M%S}"
                            dest.parent.mkdir(parents=True, exist_ok=True)
                            shutil.move(str(stale), str(dest))
                        teacher = HumanPathTeacher(path, a.k, grip_settle_m=a.grip_settle_m,
                                                   grip_settle_max_s=a.grip_settle_max_s)
                        settle_s = a.grip_settle_max_s if a.grip_settle_m is not None else 0.0
                        cfg = RolloutConfig(driver="teacher", teacher_execution="held",
                                            max_seconds=max_seconds(path, a.k, settle_s))
                        r = rollout(env, scene, teacher, cfg)
                        written = write_held_episode(out, r, scene, source=ep, k=a.k, teacher_name=teacher.name,
                                                     extra={"grip_settle_m": a.grip_settle_m,
                                                            "grip_settle_max_s": settle_s or None,
                                                            "grip_waits": list(teacher.waits)})
                        row = {"demo_id": path.demo_id, "source_episode": str(ep), "seed": scene.seed, "k": a.k,
                               "success": r.success, "ended_by": r.ended_by, "reasons": list(r.reasons),
                               "steps": len(r.records), "episode": written["name"] if written else None,
                               "frames": written["n_steps"] if written else 0,
                               "teacher": teacher.name, "grip_settle_m": a.grip_settle_m,
                               "grip_waits": list(teacher.waits), "diag": rollout_diagnostics(r), "error": r.error,
                               "wall_s": round(time.time() - t1, 1)}
                        append_row(rows_path, row)
                        rows[path.demo_id] = row
                        log(f"{i + 1}/{len(todo)} {path.demo_id} seed={scene.seed} success={r.success} "
                            f"ended_by={r.ended_by} reasons={row['reasons']} steps={row['steps']} "
                            f"frames={row['frames']} waits={row['grip_waits']} wall={row['wall_s']} s"
                            + (f" error={r.error}" if r.error else ""))
                        if decided is None and pilot() is not None:
                            decided = pilot()
                            log(pilot_line())
                            run_log(pilot_line())
                    finish(out, sources, paths, rows, n_human, code, t0, decided)
                    if lock is not None:  # before the app closes (closing it ends the process)
                        lock.release()
                        lock = None
            finally:
                if lock is not None:
                    lock.release()
    else:
        finish(out, sources, paths, rows, n_human, code, t0, decided)
    return 0


def finish(out: Path, sources, paths, rows, n_human: int, code: dict, t0: float, decided: str | None) -> None:
    """held_human_done.json; grid.json of the kept episodes unless the pilot stopped the run (then stage A uses the
    original set, and nothing here is trained on)."""
    a = args_cli
    ran = [rows[paths[ep].demo_id] for ep in sources if paths[ep].demo_id in rows]
    stopped = decided == "stop"
    kept = [] if stopped else [r for r in ran if r["success"]]
    failures: dict[str, int] = {}
    for row in ran:
        if not row["success"]:
            for reason in row["reasons"] or [row["ended_by"]]:
                failures[reason] = failures.get(reason, 0) + 1
    if kept:
        grid = human_grid([out / "episodes" / r["episode"] for r in kept], n_human=n_human,
                          name=f"held_human_{out.name}")
        (out / "grid.json").write_text(json.dumps(grid, indent=1), encoding="utf-8")
    summary = {"kept": len(kept), "attempted": len(ran), "passed": sum(r["success"] for r in ran),
               "stopped_after_pilot": stopped, "pilot": a.pilot or None, "pilot_min": a.pilot_min if a.pilot else None,
               "pilot_decision": decided, "frames": sum(r["frames"] for r in kept), "k": a.k,
               "grip_settle_m": a.grip_settle_m,
               "grip_settle_max_s": a.grip_settle_max_s if a.grip_settle_m is not None else None,
               "failures": failures, "cell": LABEL if kept else None, "source_grid": str(a.grid),
               "source_cell": a.cell, "execution": "held", "pairing": "after", "trajectory": "achieved",
               "code": code, "wall_s": round(time.time() - t0, 1),
               "rollout_wall_s": round(sum(r["wall_s"] for r in rows.values()), 1),
               "finished": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    (out / "held_human_done.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
    log(f"done: kept {summary['kept']}/{summary['attempted']} (passed {summary['passed']}; pilot {decided}), "
        f"{summary['frames']} frames, k {a.k}; failures {failures}; wall {summary['wall_s']} s")
    run_log(f"end: kept {summary['kept']}/{summary['attempted']} (passed {summary['passed']}; pilot {decided}), "
            f"frames {summary['frames']}, k {a.k}, failures {failures}, wall {summary['wall_s']} s")
    print("RESULT_JSON " + json.dumps(summary), flush=True)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except BaseException as exc:  # noqa: BLE001 - record any failure (Ctrl+C included) in the run log
        run_log(f"FAILED: {exc!r}")
        traceback.print_exc()
        raise
