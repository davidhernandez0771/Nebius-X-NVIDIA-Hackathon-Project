"""Grasp-fix run 2 (recovery copies + longer training) as phases for one unattended overnight command. Pure parts.

    C:\\isaac\\env_isaaclab\\Scripts\\python.exe sim_eval\\scripts\\overnight_recovery.py [--smoke] [--dry-run]

Phases (each resumable; a finished one is skipped on a re-run):
  preflight  inputs exist, enough disk
  collect    centered_10x10 on practice seeds 5200-5249, serial, traced (eval_cells --trace)
  states     recovery states from those traces (sim_worker.recovery.find_recovery_states)
  recovery   the expert's way out of each state, replayed with cameras and physics-verified (recovery_dataset.py)
  grid       centered 10x10 (110 episodes) + every verified recovery copy, one raw_multiply cell, n_human 10
  train      ACT, the usual recipe, 60k steps, a checkpoint every 5k (lerobot_tools.experiments)
  select     checkpoints 30k/40k/50k/60k on practice seeds 5250-5279; most successes wins, ties to more steps
  final      the chosen checkpoint on the official seeds 5020-5059, ONCE (serial, traced)
  summary    the pre-registered comparisons (T3 grasp-fix note, run 2)
Building and tuning never touch 5020-5059: eval_cmd refuses them unless final=True, and then only exactly them.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import datetime
from pathlib import Path

from demo_pipeline.stats import fisher_exact, wilson_ci
from sim_eval.recording import load_trace
from sim_eval.scenes import eval_scenes
from sim_worker.recovery import RecoveryState, find_recovery_states

PRACTICE_SEEDS = range(5200, 5280)
TEST_SEEDS = range(5020, 5060)
BASELINES = {"centered_10x10": (20, 40), "raw_multiply_10_30k": (17, 40)}  # seeds 5020-5059, serial
ALPHA = 0.05
_ERRORS = ("sim_error", "policy_error")


@dataclass(frozen=True)
class Config:
    repo: Path
    run_id: str
    isaac_py: Path
    lerobot_py: Path
    centered_checkpoint: Path
    centered_grid: Path
    start_state: Path
    recovery_data: Path
    source_cell: str = "centered_10x10"
    label: str = "recovery_10x10"
    collect_seed0: int = 5200
    collect_n: int = 50
    select_seed0: int = 5250
    select_n: int = 30
    test_seed0: int = TEST_SEEDS.start
    test_n: int = len(TEST_SEEDS)
    steps: int = 60000
    save_freq: int = 5000
    candidates: tuple[int, ...] = (30000, 40000, 50000, 60000)
    min_recovery: int = 10
    max_states: int | None = None
    min_free_gb: float = 30.0
    smoke: bool = False

    @classmethod
    def default(cls, repo: Path, smoke: bool = False) -> "Config":
        data = Path(repo) / "data"
        c = cls(
            repo=Path(repo), run_id="recovery_run2",
            isaac_py=Path(r"C:\isaac\env_isaaclab\Scripts\python.exe"),
            lerobot_py=Path(r"C:\venvs\lerobot\Scripts\python.exe"),
            centered_checkpoint=data / "experiments" / "grasp_fix_centered_20261018_141822" / "train"
            / "centered_10x10" / "checkpoints" / "030000" / "pretrained_model",
            centered_grid=data / "experiments" / "grids" / "grasp_fix_centered.json",
            start_state=data / "experiments" / "sprint6_home_a_20261016_205725" / "datasets" / "raw_10",
            recovery_data=data / "recovery_run2",
        )
        if smoke:  # a few minutes end to end, to shake out the GPU parts; never runs the final test
            c = replace(c, run_id="recovery_run2_smoke", recovery_data=data / "recovery_run2_smoke", collect_n=2,
                        select_n=2, steps=200, save_freq=100, candidates=(100, 200), min_recovery=1, max_states=3,
                        min_free_gb=5.0, smoke=True)
        return c

    @property
    def data(self) -> Path:
        return self.repo / "data"

    @property
    def evals_dir(self) -> Path:
        return self.data / "evals" / self.run_id

    @property
    def collect_results(self) -> Path:
        return self.evals_dir / f"{self.source_cell}_practice.json"

    @property
    def traces_dir(self) -> Path:
        return self.evals_dir / f"{self.source_cell}_practice_traces"

    @property
    def states_file(self) -> Path:
        return self.evals_dir / "recovery_states.json"

    @property
    def recovery_manifest(self) -> Path:
        return self.evals_dir / "recovery_manifest.json"

    @property
    def grid_file(self) -> Path:
        return self.data / "experiments" / "grids" / f"{self.run_id}.json"

    @property
    def selection_file(self) -> Path:
        return self.evals_dir / "selection.json"

    @property
    def final_results(self) -> Path:
        return self.evals_dir / f"{self.label}_final.json"

    @property
    def summary_file(self) -> Path:
        return self.evals_dir / "summary.json"


# --- commands --------------------------------------------------------------------------------------------------------

def eval_cmd(c: Config, cell: str, checkpoint: Path, *, seed0: int, n: int, trace: bool = False,
             final: bool = False) -> list[str]:
    seeds = range(seed0, seed0 + n)
    if final:
        if (seed0, n) != (c.test_seed0, c.test_n):
            raise ValueError(f"the final eval is exactly seeds {c.test_seed0}-{c.test_seed0 + c.test_n - 1}")
    elif not set(seeds) <= set(PRACTICE_SEEDS):
        raise ValueError(f"building and tuning use practice seeds {PRACTICE_SEEDS.start}-{PRACTICE_SEEDS.stop - 1} "
                         f"only, not {seed0}-{seed0 + n - 1}")
    cmd = [str(c.isaac_py), str(c.repo / "sim_eval" / "scripts" / "eval_cells.py"), "--run-id", c.run_id,
           "--checkpoint", f"{cell}={checkpoint}", "--seed0", str(seed0), "--n", str(n),
           "--start-state", str(c.start_state), "--start-pose", "dataset"]
    return cmd + (["--trace"] if trace else [])


def train_cmd(c: Config, grid: Path) -> list[str]:
    return [str(c.lerobot_py), "-m", "lerobot_tools.experiments", "--grid", str(grid), "--steps", str(c.steps),
            "--save-freq", str(c.save_freq)]


def recovery_cmd(c: Config) -> list[str]:
    return [str(c.isaac_py), str(c.repo / "sim_worker" / "scripts" / "recovery_dataset.py"), "--states",
            str(c.states_file), "--manifest", str(c.recovery_manifest)]


# --- results -----------------------------------------------------------------------------------------------------

def _episodes(path: Path) -> dict[int, dict]:
    try:
        eps = json.loads(Path(path).read_text(encoding="utf-8"))["episodes"]
    except (OSError, ValueError, KeyError):
        return {}
    return {e["seed"]: e for e in eps}  # a resumed run lists a re-run seed once, its last result


def results_complete(path: Path, seed0: int, n: int) -> bool:
    eps = _episodes(path)
    return all(s in eps and eps[s]["ended_by"] not in _ERRORS for s in range(seed0, seed0 + n))


def count_successes(path: Path, seed0: int, n: int) -> tuple[int, int]:
    if not results_complete(path, seed0, n):
        raise ValueError(f"{path} lacks a valid episode for some of seeds {seed0}-{seed0 + n - 1}")
    eps = _episodes(path)
    return sum(bool(eps[s]["success"]) for s in range(seed0, seed0 + n)), n


def collect_states(traces_dir: Path, *, source: str) -> list[RecoveryState]:
    states = []
    for f in sorted(Path(traces_dir).glob("seed_*.npz")):
        seed = int(f.stem.split("_")[1])
        if seed not in PRACTICE_SEEDS:
            raise ValueError(f"{f}: recovery states come from practice seeds only, not {seed}")
        states += find_recovery_states(load_trace(f), eval_scenes(1, seed)[0], source=source)
    return states


def build_grid(centered_grid: Path, manifest: dict, *, name: str, label: str, min_recovery: int = 10) -> dict:
    (cell,) = json.loads(Path(centered_grid).read_text(encoding="utf-8"))["cells"]
    rec = list(manifest["verified_dirs"])
    if len(rec) < min_recovery:
        raise ValueError(f"only {len(rec)} verified recovery copies (the run needs >= {min_recovery})")
    return {"name": name, "cells": [{"condition": cell["condition"], "n_human": cell["n_human"], "label": label,
                                     "episode_dirs": list(cell["episode_dirs"]) + rec}]}


def find_train_run(experiments: Path, grid_name: str, label: str, steps: int) -> Path | None:
    pat = re.compile(rf"^{re.escape(grid_name)}_\d{{8}}_\d{{6}}$")
    runs = sorted((p for p in Path(experiments).glob(f"{grid_name}_*") if pat.match(p.name)), reverse=True)
    for run in runs:
        if (run / "train" / label / "checkpoints" / f"{steps:06d}" / "pretrained_model").is_dir():
            return run
    return None


def checkpoint_of(run: Path, label: str, step: int) -> Path:
    return run / "train" / label / "checkpoints" / f"{step:06d}" / "pretrained_model"


def pick_step(counts: dict[int, tuple[int, int]]) -> int:
    """Pre-registered: the candidate with the most practice successes; a tie goes to the later checkpoint."""
    if len({n for _, n in counts.values()}) != 1:
        raise ValueError(f"every candidate needs the same n, got {counts}")
    return max(counts, key=lambda step: (counts[step][0], step))


def _norm(p) -> str:
    return os.path.normcase(os.path.abspath(str(p)))


def guard_final(results: Path, checkpoint) -> None:
    """The official seeds run once: a final results log made with another checkpoint stops the run. The same
    checkpoint may finish seeds that crashed (as eval_cells' resume always has)."""
    log = Path(results).with_suffix(".episodes.jsonl")
    if not log.exists():
        return
    header = json.loads(log.read_text(encoding="utf-8").splitlines()[0])["header"]
    if _norm(header.get("checkpoint")) != _norm(checkpoint):
        raise RuntimeError(f"the official test runs once: {log} was made with {header.get('checkpoint')}, "
                           f"not {checkpoint}")


def summarize(k: int, n: int, *, chosen_step: int, baselines: dict = BASELINES) -> dict:
    vs = {}
    for name, (bk, bn) in baselines.items():
        p = fisher_exact(k, n, bk, bn)
        better = k / n > bk / bn
        verdict = "improved" if better and p < ALPHA else ("no detectable difference" if better else "no improvement")
        vs[name] = {"baseline": [bk, bn], "p": p, "verdict": verdict}
    return {"successes": k, "n": n, "rate": k / n, "wilson_95": list(wilson_ci(k, n)), "chosen_step": chosen_step,
            "test": "two-sided Fisher exact", "alpha": ALPHA, "vs": vs}


def summary_markdown(s: dict) -> str:
    lo, hi = s["wilson_95"]
    lines = [f"**recovery_10x10 ({s['chosen_step']} steps): {s['successes']}/{s['n']} = {s['rate']:.1%} "
             f"(Wilson 95% {lo:.1%}-{hi:.1%})**, seeds 5020-5059, serial.", "",
             "| Baseline | Successes | Fisher p (two-sided) | Pre-registered verdict |", "|---|---|---|---|"]
    for name, v in s["vs"].items():
        lines.append(f"| {name} | {v['baseline'][0]}/{v['baseline'][1]} | {v['p']:.4g} | {v['verdict']} |")
    return "\n".join(lines) + "\n"


# --- phases ------------------------------------------------------------------------------------------------------

class PhaseFailed(RuntimeError):
    pass


@dataclass
class Phase:
    name: str
    done: Callable[[], bool]
    run: Callable[[], None]
    describe: str = ""


def run_phases(phases: list[Phase], log: Callable[[str], None]) -> None:
    for p in phases:
        if p.done():
            log(f"[overnight] skip {p.name} (already done)")
            continue
        log(f"[overnight] start {p.name}: {p.describe}")
        p.run()
        if not p.done():
            raise PhaseFailed(f"phase {p.name} ran but did not finish; see its log in the run's logs/ folder")
        log(f"[overnight] done {p.name}")


Runner = Callable[[list[str], dict, Path], int]


def subprocess_runner(cmd: list[str], env: dict, log_file: Path, cwd: Path | None = None) -> int:
    log_file.parent.mkdir(parents=True, exist_ok=True)
    with log_file.open("a", encoding="utf-8") as f:
        f.write(f"\n[{datetime.now():%Y-%m-%d %H:%M:%S}] $ {' '.join(cmd)}\n")
        f.flush()
        return subprocess.run(cmd, cwd=cwd, env=env, stdout=f, stderr=subprocess.STDOUT).returncode


def plan(c: Config, log: Callable[[str], None], runner: Runner | None = None) -> list[Phase]:
    if runner is None:
        def runner(cmd, env, log_file):
            rc = subprocess_runner(cmd, env, log_file, cwd=c.repo)
            log(f"[overnight]   exit {rc}: {' '.join(cmd[:3])} ... (log {log_file.name})")
            return rc
    logs = c.evals_dir / "logs"

    def env(data_dir: Path) -> dict:
        return dict(os.environ, PYTHONPATH=f"{c.repo / 'src'}{os.pathsep}{c.repo}", DATA_DIR=str(data_dir))

    flags: dict = {}

    def preflight() -> None:
        problems = [f"missing {p}" for p in (c.isaac_py, c.lerobot_py, c.centered_checkpoint, c.centered_grid,
                                              c.start_state / "start_state.json") if not Path(p).exists()]
        if c.centered_grid.exists():
            (cell,) = json.loads(c.centered_grid.read_text(encoding="utf-8"))["cells"]
            gone = [d for d in cell["episode_dirs"] if not Path(d, "verification.json").exists()]
            problems += [f"{len(gone)} centered episodes missing, e.g. {gone[0]}"] if gone else []
        free_gb = shutil.disk_usage(c.data).free / 1e9 if c.data.exists() else 0.0
        if free_gb < c.min_free_gb:
            problems.append(f"only {free_gb:.0f} GB free on the data disk, need {c.min_free_gb:.0f}")
        if problems:
            raise PhaseFailed("preflight: " + "; ".join(problems))
        flags["preflight"] = True

    def states() -> None:
        found = collect_states(c.traces_dir, source=c.source_cell)
        if c.max_states is not None:
            found = found[: c.max_states]
        c.states_file.parent.mkdir(parents=True, exist_ok=True)
        c.states_file.write_text(json.dumps({"source": c.source_cell, "states": [s.model_dump() for s in found]},
                                            indent=1), encoding="utf-8")
        log(f"[overnight]   {len(found)} recovery states from {c.traces_dir.name}")

    def grid() -> None:
        g = build_grid(c.centered_grid, json.loads(c.recovery_manifest.read_text(encoding="utf-8")),
                       name=c.run_id, label=c.label, min_recovery=c.min_recovery)
        c.grid_file.parent.mkdir(parents=True, exist_ok=True)
        c.grid_file.write_text(json.dumps(g, indent=1), encoding="utf-8")

    def run_dir() -> Path | None:
        return find_train_run(c.data / "experiments", c.run_id, c.label, c.steps)

    def select() -> None:
        run = run_dir()
        counts = {}
        for step in c.candidates:
            cell = f"{c.label}_s{step}"
            res = c.evals_dir / f"{cell}.json"
            if not results_complete(res, c.select_seed0, c.select_n):
                runner(eval_cmd(c, cell, checkpoint_of(run, c.label, step), seed0=c.select_seed0, n=c.select_n),
                       env(c.data), logs / f"select_{step}.log")
            counts[step] = count_successes(res, c.select_seed0, c.select_n)
            log(f"[overnight]   {cell}: {counts[step][0]}/{counts[step][1]} on practice seeds")
        chosen = pick_step(counts)
        c.selection_file.write_text(json.dumps({
            "counts": {str(k): list(v) for k, v in counts.items()}, "chosen_step": chosen,
            "checkpoint": str(checkpoint_of(run, c.label, chosen)), "train_run": str(run),
            "seeds": [c.select_seed0, c.select_seed0 + c.select_n - 1]}, indent=1), encoding="utf-8")

    def final() -> None:
        sel = json.loads(c.selection_file.read_text(encoding="utf-8"))
        guard_final(c.final_results, sel["checkpoint"])
        runner(eval_cmd(c, f"{c.label}_final", Path(sel["checkpoint"]), seed0=c.test_seed0, n=c.test_n, final=True,
                        trace=True), env(c.data), logs / "final.log")

    def summary() -> None:
        sel = json.loads(c.selection_file.read_text(encoding="utf-8"))
        k, n = count_successes(c.final_results, c.test_seed0, c.test_n)
        s = summarize(k, n, chosen_step=sel["chosen_step"])
        s.update(selection=sel, recovery={k2: v for k2, v in json.loads(
            c.recovery_manifest.read_text(encoding="utf-8")).items() if k2 != "rows"})
        c.summary_file.write_text(json.dumps(s, indent=1), encoding="utf-8")
        c.summary_file.with_suffix(".md").write_text(summary_markdown(s), encoding="utf-8")
        log("[overnight] RESULT " + summary_markdown(s).splitlines()[0])

    phases = [
        Phase("preflight", lambda: flags.get("preflight", False), preflight, "inputs exist, enough disk"),
        Phase("collect", lambda: results_complete(c.collect_results, c.collect_seed0, c.collect_n),
              lambda: runner(eval_cmd(c, f"{c.source_cell}_practice", c.centered_checkpoint, seed0=c.collect_seed0,
                                      n=c.collect_n, trace=True), env(c.data), logs / "collect.log"),
              f"{c.source_cell} on practice seeds {c.collect_seed0}-{c.collect_seed0 + c.collect_n - 1}, traced"),
        Phase("states", c.states_file.exists, states, "recovery states from the traces"),
        Phase("recovery", c.recovery_manifest.exists,
              lambda: runner(recovery_cmd(c), env(c.recovery_data), logs / "recovery.log"),
              f"replay + verify every recovery copy into {c.recovery_data}"),
        Phase("grid", c.grid_file.exists, grid, f"centered 10x10 + verified recovery copies -> {c.grid_file.name}"),
        Phase("train", lambda: run_dir() is not None,
              lambda: runner(train_cmd(c, c.grid_file), env(c.data), logs / "train.log"),
              f"ACT {c.steps} steps, save every {c.save_freq}"),
        Phase("select", c.selection_file.exists, select,
              f"checkpoints {list(c.candidates)} on practice seeds {c.select_seed0}-{c.select_seed0 + c.select_n - 1}"),
    ]
    if not c.smoke:
        phases += [
            Phase("final", lambda: results_complete(c.final_results, c.test_seed0, c.test_n), final,
                  f"the chosen checkpoint on seeds {c.test_seed0}-{c.test_seed0 + c.test_n - 1}, once"),
            Phase("summary", c.summary_file.exists, summary, "the pre-registered comparisons"),
        ]
    return phases
