r"""Teacher or DAgger rollouts in the eval env, cameras on, written as training episodes (sim_eval.distill).

    C:\isaac\env_isaaclab\Scripts\python.exe sim_eval\scripts\distill_rollouts.py --kind teacher --round 0 ^
        --seed0 4000 --n 600 --out data\distill\<run>\r0 --teacher <package.module:factory> ^
        --teacher-checkpoint <T3's policy> --start-state <SANT dataset root>
    ... --kind dagger --round 1 --seed0 5200 --n 40 --out data\distill\<run>\r1 ... --checkpoint <student
        pretrained_model> [--beta 0] [--binarize-gripper --n-action-steps N | --temporal-ensemble C]

Normally started by sim_eval/scripts/distill_round.py (which holds gpu.lock); this script itself only refuses to start
while another Isaac process runs (sim_eval.report.isaac_gate), as run_eval does.

teacher: the teacher drives; only rollouts passing check_success are written. dagger: this script starts the student's
policy server (lerobot venv, as eval_cells does) on --port, the student drives, the teacher labels every visited state.
The teacher is loaded in this process: load_teacher_for(--kind, --teacher, checkpoint=--teacher-checkpoint,
device=--device); DAgger adds cap_from_tool=True
(T3's make() takes checkpoint, device and cap_from_tool; load_teacher_for refuses a DAgger teacher without it on).
Writes <out>/episodes/<name>/ (episode_io + scene.json, distill.json, teacher.npz), one row per seed in
<out>/rollouts.jsonl, and <out>/rollouts_done.json when every seed has a row. Resumable: seeds with a row are skipped;
a seed's leftovers from an interrupted attempt are moved to <out>/_stale/ first (never deleted).
"""

import argparse
import importlib.util
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(REPO / "src"), str(REPO)]  # this worktree's demo_pipeline first (the Isaac env has another's)
from sim_worker.own_code import check_own_code  # noqa: E402

from isaaclab.app import add_launcher_args, launch_simulation  # noqa: E402

from lerobot_tools.inference import GripperBinarizer, InferenceOptions, add_inference_args  # noqa: E402

parser = argparse.ArgumentParser(description="Teacher or DAgger rollouts written as training episodes.")
parser.add_argument("--kind", choices=("teacher", "dagger"), required=True)
parser.add_argument("--round", type=int, required=True, help="0 for teacher rollouts, 1.. for DAgger")
parser.add_argument("--seed0", type=int, required=True)
parser.add_argument("--n", type=int, required=True)
parser.add_argument("--out", type=Path, required=True, help="the round folder (episodes/, rollouts.jsonl)")
parser.add_argument("--teacher", required=True, help="package.module:factory returning a sim_eval.teacher.Teacher")
parser.add_argument("--teacher-checkpoint", type=Path, required=True)
parser.add_argument("--start-state", type=Path, required=True, help="start_state.json or the dataset root with it")
parser.add_argument("--checkpoint", type=Path, default=None, help="dagger: the student's pretrained_model")
parser.add_argument("--beta", type=float, default=0.0, help="dagger: per-step chance of executing the teacher's action")
parser.add_argument("--port", type=int, default=8766, help="dagger: the student's policy server port")
parser.add_argument("--max-seconds", type=float, default=30.0)
parser.add_argument("--min-segment", type=int, default=25, help="shortest labelled run kept as an episode (steps)")
parser.add_argument("--teacher-execution", choices=("tracking", "held"), default="tracking",
                    help="how a teacher-executed step runs: its RL env's tracking, or one held 9-joint target as the "
                         "student's (sim_eval.distill.RolloutConfig)")
parser.add_argument("--num_envs", type=int, default=1, help="must be 1")
add_inference_args(parser)
add_launcher_args(parser)
args_cli = parser.parse_args()
if args_cli.num_envs != 1:
    parser.error("--num_envs must be 1")
if (args_cli.kind == "dagger") != (args_cli.checkpoint is not None):
    parser.error("--checkpoint (the student) goes with --kind dagger, and only with it")
if (args_cli.kind == "teacher") != (args_cli.round == 0):
    parser.error("round 0 is the teacher's; DAgger rounds are 1..")
try:
    inference = InferenceOptions.from_args(args_cli)
except ValueError as e:
    parser.error(str(e))
args_cli.enable_cameras = True  # the student is a camera policy: every episode needs its images

from lerobot_tools.policy_client import PolicyClient  # noqa: E402
from sim_eval.distill import (  # noqa: E402
    RolloutConfig, append_row, check_execution, done_summary, read_rows, rollout, rollout_row, rollout_scenes,
    set_aside_stale, write_rollout,
)
from sim_eval.distill_round import code_version  # noqa: E402
from sim_eval.report import gpu_pids, isaac_gate, python_processes, resolve_start  # noqa: E402
from sim_eval.retry import RetryingPolicy  # noqa: E402
from sim_eval.teacher import execution_mismatch, load_teacher_for  # noqa: E402
from sim_worker.replay import make_sim_cfg  # noqa: E402


def _eval_cells():
    """eval_cells' policy-server helpers (start_server / stop_server); it is a script, not a package module."""
    spec = importlib.util.spec_from_file_location("eval_cells", REPO / "sim_eval" / "scripts" / "eval_cells.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def log(msg: str) -> None:
    print(f"[distill {datetime.now():%H:%M:%S}] {msg}", flush=True)


def main() -> None:
    check_own_code()  # logs where demo_pipeline came from; stops if not this checkout
    from sim_worker.teleop_qos import full_speed

    full_speed()  # out of Windows power throttling (per process: a child does not inherit it)
    t0 = time.time()
    a = args_cli
    out = a.out.resolve()
    scenes = rollout_scenes(a.kind, a.seed0, a.n)  # the seed rules, before anything starts
    rows_path = out / "rollouts.jsonl"
    rows = read_rows(rows_path)
    try:
        check_execution(rows, a.teacher_execution)  # one folder, one teacher execution
    except ValueError as e:
        log(f"refusing to start: {e}")
        sys.exit(2)
    todo = [s for s in scenes if s.seed not in rows]
    log(f"{a.kind} round {a.round}: seeds {a.seed0}-{a.seed0 + a.n - 1}; {len(rows)} done, {len(todo)} to go -> {out}")
    start_pose, start_check = resolve_start("dataset", start_state=a.start_state)
    ec = _eval_cells()
    ok, gate = isaac_gate(python_processes(), own_pid=os.getpid(), free_mib=ec.free_mib(), gpu_pids=gpu_pids())
    if not ok:
        log(f"refusing to start: {gate['reason']}")
        sys.exit(3)
    log(f"start pose {start_check['chosen']}")
    cfg = RolloutConfig(driver="teacher" if a.kind == "teacher" else "student", beta=a.beta,
                        max_seconds=a.max_seconds, teacher_execution=a.teacher_execution)
    log(f"teacher execution: {a.teacher_execution}")
    server, policy = None, None
    if a.kind == "dagger" and todo:
        out.mkdir(parents=True, exist_ok=True)
        server = ec.start_server(str(a.checkpoint), a.port, out / "policy_server.log", inference)
        client = RetryingPolicy(PolicyClient(f"http://127.0.0.1:{a.port}", timeout=60))
        policy = GripperBinarizer(client) if inference.binarize_gripper else client
        log(f"student {a.checkpoint} served on :{a.port}; inference {inference.record()}; beta {a.beta}")
    if not todo:
        finish(out, rows, t0, rows[a.seed0]["teacher"])
        return
    # Everything, the server's stop included, happens inside the context: closing the app ends the process.
    with launch_simulation(make_sim_cfg(a.device), a):
        try:
            from sim_eval.isaac_distill_env import IsaacDistillEnv

            env = IsaacDistillEnv(cameras=True, device=a.device, start_joint_pos=start_pose)
            # after the app is up: the teacher may import Isaac Lab (rsl_rl and its wrappers)
            # DAgger: the teacher caps each label from the tool the student reached (load_teacher_for)
            teacher = load_teacher_for(a.kind, a.teacher, checkpoint=str(a.teacher_checkpoint), device=a.device)
            log(f"teacher {teacher.name!r} from {a.teacher} ({a.teacher_checkpoint})")
            mismatch = execution_mismatch(teacher, a.teacher_execution)
            if mismatch:
                log(f"refusing to roll out: {mismatch}; pass --teacher-execution {teacher.execution}")
                sys.exit(2)
            for i, scene in enumerate(todo):
                t1 = time.time()
                stale = set_aside_stale(out, kind=a.kind, round_id=a.round, seed=scene.seed)
                if stale:
                    log(f"seed {scene.seed}: moved an interrupted attempt aside ({len(stale)} folders)")
                r = rollout(env, scene, teacher, cfg, student=policy)
                eps = write_rollout(out, r, scene, kind=a.kind, round_id=a.round, teacher_name=teacher.name,
                                    student_checkpoint=str(a.checkpoint) if a.checkpoint else None,
                                    min_len=a.min_segment)
                row = {**rollout_row(r), "teacher": teacher.name, "episodes": [e["name"] for e in eps],
                       "frames": sum(e["n_steps"] for e in eps), "wall_s": round(time.time() - t1, 1)}
                append_row(rows_path, row)
                rows[scene.seed] = row
                log(f"{i + 1}/{len(todo)} seed={scene.seed} success={r.success} ended_by={r.ended_by} "
                    f"steps={row['steps']} episodes={len(eps)} frames={row['frames']} "
                    f"disagreement arm={row['arm_disagreement']:.4f} grip={row['gripper_disagreement']:.2f} "
                    f"wall={row['wall_s']} s" + (f" error={r.error}" if r.error else ""))
            finish(out, rows, t0, teacher.name)
        finally:
            if server is not None:
                ec.stop_server(server)


def finish(out: Path, rows: dict, t0: float, teacher_name: str) -> None:
    a = args_cli
    summary = done_summary(rows, kind=a.kind, round_id=a.round, seed0=a.seed0, n=a.n, teacher=teacher_name,
                           teacher_spec=a.teacher, teacher_checkpoint=str(a.teacher_checkpoint), code=code_version(REPO),
                           student_checkpoint=str(a.checkpoint) if a.checkpoint else None, beta=a.beta,
                           inference=inference.record(), teacher_execution=a.teacher_execution,
                           teacher_cap_from_tool=a.kind == "dagger",
                           wall_s=round(time.time() - t0, 1),
                           finished=datetime.now(timezone.utc).isoformat(timespec="seconds"))
    (out / "rollouts_done.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
    log(f"done: {summary['successes']}/{summary['attempted']} rollouts succeeded; {summary['episodes']} episodes, "
        f"{summary['frames']} frames; ended_by {summary['ended_by']}")
    print("RESULT_JSON " + json.dumps(summary), flush=True)


if __name__ == "__main__":
    main()
