"""Pure helpers for scripts/run_eval.py: check the policy server fits the sim before launching Isaac, and write
the results file. No Isaac imports."""

from __future__ import annotations

import json
import subprocess
from datetime import datetime
from pathlib import Path

from sim_eval.eval_policy import ACTION_DIM
from sim_eval.registry import find_row
from sim_eval.results import EpisodeResult, EvalSummary
from sim_eval.start_state import START_STATE_FILE, check_start, load_starts

SIM_CAMERAS = ("front", "wrist")  # what sim_worker.scene_cfg renders


def preflight(health: dict, *, cameras: bool, image_size: int, sim_cameras=SIM_CAMERAS) -> list[str]:
    """Problems that would make every episode a policy_error. Empty list = good to go."""
    problems = []
    if health.get("state_dim") != ACTION_DIM:
        problems.append(f"policy state_dim is {health.get('state_dim')}, the Franka sim gives {ACTION_DIM}")
    wanted = health.get("cameras") or {}
    if wanted and not cameras:
        problems.append(f"the policy needs cameras {sorted(wanted)}; pass --cameras")
    for cam, hw in wanted.items():
        if cam not in sim_cameras:
            problems.append(f"the policy needs camera {cam!r}; the sim renders {list(sim_cameras)}")
        elif list(hw) != [image_size, image_size]:
            problems.append(f"the policy expects {cam} at {hw[0]}x{hw[1]}; the sim renders {image_size}x{image_size}")
    return problems


MIN_FREE_MIB = 8192  # sprint-3 rule: T3 evaluates only with >= 8 GB of GPU memory free


def _ancestors(processes: list[tuple[int, int, str]], pid: int) -> set[int]:
    parent = {p: pp for p, pp, _ in processes}
    chain = {pid}
    while parent.get(pid) is not None and parent[pid] not in chain:
        pid = parent[pid]
        chain.add(pid)
    return chain


def _executable(cmd: str) -> str:
    """The program a command line runs: its first token, quoted or not."""
    cmd = (cmd or "").strip()
    if cmd.startswith('"'):
        return cmd[1:].split('"', 1)[0]
    return cmd.split(" ", 1)[0]


def _subtree(processes: list[tuple[int, int, str]], pid: int) -> set[int]:
    children: dict[int, list[int]] = {}
    for p, pp, _ in processes:
        children.setdefault(pp, []).append(p)
    seen, todo = set(), [pid]
    while todo:
        p = todo.pop()
        if p not in seen:
            seen.add(p)
            todo += children.get(p, [])
    return seen


def isaac_gate(processes: list[tuple[int, int, str]], *, own_pid: int, free_mib: int | None,
               min_free_mib: int = MIN_FREE_MIB, gpu_pids: set[int] | None = None) -> tuple[bool, dict]:
    """May this eval run? Only if no *other* python process runs from Isaac (its executable's path contains
    'isaac') and nvidia-smi reports enough free memory. `processes` is [(pid, parent pid, command line)] of
    python.exe processes; this process and its ancestors (venv launchers, the eval_cells driver) don't count as
    other. Only the executable counts: a C:\dev\gpu.lock wrapper from another venv that waits with an Isaac
    command in its arguments is not Isaac (counting it deadlocked the lock holder, 2026-10-18); its Isaac child is.
    gpu_pids (nvidia-smi's process list, gpu_pids()): an Isaac python then counts only if it or a process under it
    holds a GPU context, so a lock wrapper run from Isaac's own python that is still waiting for the lock is
    listed as idle_isaac, not as a reason to wait. None keeps the plain rule."""
    mine = _ancestors(processes, own_pid)
    isaac = [(pid, cmd) for pid, _, cmd in processes if pid not in mine and "isaac" in _executable(cmd).lower()]
    idle = []
    if gpu_pids is not None:
        idle = [(pid, cmd) for pid, cmd in isaac if not _subtree(processes, pid) & set(gpu_pids)]
    others = [{"pid": pid, "cmd": cmd[:200]} for pid, cmd in isaac if (pid, cmd) not in idle]
    reasons = []
    if others:
        reasons.append("another Isaac process is running: " + "; ".join(f"{o['pid']} {o['cmd']}" for o in others))
    if free_mib is None:
        reasons.append("nvidia-smi gave no free-memory reading")
    elif free_mib < min_free_mib:
        reasons.append(f"GPU has {free_mib} MiB free, need >= {min_free_mib}")
    return not reasons, {"other_isaac": others, "idle_isaac": [{"pid": pid, "cmd": cmd[:200]} for pid, cmd in idle],
                         "free_mib": free_mib, "min_free_mib": min_free_mib, "ok": not reasons,
                         "reason": " | ".join(reasons) or None}


def gpu_pids() -> set[int] | None:
    """PIDs with a GPU context (nvidia-smi --query-compute-apps; on Windows that includes graphics contexts), or
    None when nvidia-smi gives no answer."""
    try:
        out = subprocess.run(["nvidia-smi", "--query-compute-apps=pid", "--format=csv,noheader"],
                             capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        return None
    if out.returncode != 0:
        return None
    return {int(t) for t in out.stdout.split() if t.strip().isdigit()}


def python_processes() -> list[tuple[int, int, str]]:
    """(pid, parent pid, command line) of every python.exe, via CIM (what the sprint rule says to check)."""
    cmd = ("Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | "
           "Select-Object ProcessId, ParentProcessId, CommandLine | ConvertTo-Json -Compress")
    out = subprocess.run(["powershell", "-NoProfile", "-Command", cmd], capture_output=True, text=True,
                         timeout=60).stdout.strip()
    rows = json.loads(out) if out else []
    rows = [rows] if isinstance(rows, dict) else rows
    return [(int(r["ProcessId"]), int(r.get("ParentProcessId") or 0), r.get("CommandLine") or "") for r in rows]


def resolve_start(mode: str, *, start_state: Path | None = None, registry: Path | None = None,
                  cell: str | None = None, checkpoint: str | None = None) -> tuple[list[float] | None, dict]:
    """Choose the eval reset pose (Review Focus 4). Returns (pose, record); pose None = the robot's default pose.

    The start states come from `start_state` (a start_state.json or the dataset root holding one), else from the
    dataset of the cell's registry row. Without any, "auto" and "default" fall back to the default pose and record
    why; "dataset" raises FileNotFoundError."""
    source, reason = start_state, None
    if source is None and registry is not None and cell is not None:
        try:
            source = find_row(registry, cell, checkpoint).get("dataset")
            if source is None:
                reason = f"registry row for {cell!r} has no dataset"
        except (OSError, LookupError, ValueError) as e:
            reason = f"registry lookup failed: {type(e).__name__}: {e}"
    starts = None
    if source is not None:
        try:
            starts = load_starts(Path(source))
        except (OSError, ValueError, KeyError) as e:
            reason = f"cannot read {START_STATE_FILE} from {source}: {type(e).__name__}: {e}"
    if starts is None:
        reason = reason or f"no {START_STATE_FILE} given (--start-state) and no --cell registry row to find one"
        if mode == "dataset":
            raise FileNotFoundError(reason)
        return None, {"available": False, "mode": mode, "chosen": "default", "reason": reason}
    check = check_start(starts, mode=mode)
    record = {"available": True, "mode": mode, "source": str(source), **check.model_dump()}
    return (check.reset_pose if check.chosen == "dataset_mean" else None), record


def default_results_path(data_root: Path, cell: str | None) -> Path:
    return Path(data_root) / "evals" / f"{cell or 'adhoc'}_{datetime.now():%Y%m%d_%H%M%S}.json"


def episode_log_path(results: Path) -> Path:
    """The per-episode log (sim_eval.progress) of the run whose final results go to `results`."""
    results = Path(results)
    return results.with_name(results.stem + ".episodes.jsonl")


def infra_failures(results: Path) -> int | None:
    """Episodes in a results file that ended in sim_error or policy_error (None if there is no results file).
    These say nothing about the policy (e.g. CUDA died when Windows slept), so the run should be resumed."""
    results = Path(results)
    if not results.is_file():
        return None
    episodes = json.loads(results.read_text(encoding="utf-8"))["episodes"]
    return sum(e["ended_by"] in ("sim_error", "policy_error") for e in episodes)


def group_summaries(episodes: list[EpisodeResult], groups: dict[str, list[int]]) -> dict[str, dict]:
    """One aggregate per seed group (e.g. "train" scenes vs "unseen" scenes) of a mixed run."""
    from sim_eval.results import aggregate

    out = {}
    for name, seeds in groups.items():
        eps = [e for e in episodes if e.seed in set(seeds)]
        if eps:
            out[name] = aggregate(eps).model_dump()
    return out


def write_results(path: Path, run: dict, episodes: list[EpisodeResult], summary: EvalSummary) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    data = {"run": run, "summary": summary.model_dump(), "episodes": [e.model_dump() for e in episodes]}
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    return path
