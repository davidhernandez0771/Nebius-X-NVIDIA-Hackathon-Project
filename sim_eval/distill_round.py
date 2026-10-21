"""Teacher -> student distillation rounds (sim_eval.distill) as resumable phases, one GPU command per round. Pure parts.

    C:\\isaac\\env_isaaclab\\Scripts\\python.exe sim_eval\\scripts\\distill_round.py --round 0|1|2 --run-id <id> ^
        --teacher <package.module:factory> --teacher-checkpoint <T3's trained policy> ^
        --human-grid <SANT experiment grid.json> --human-cell <its cell> --start-state <its dataset root>

Round 0 (behaviour cloning on the teacher):
  preflight  inputs exist, enough disk
  teacher    the teacher drives in our eval env, cameras on, on training-side seeds 4000-4999; only rollouts that
             pass the unchanged check_success become episodes (sim_eval/scripts/distill_rollouts.py --kind teacher)
  grid       SANT's human-derived episodes + the teacher's, mixed by frame share (mix_cell), one "distill" cell.
             Refuses if fewer than --min-teacher teacher rollouts passed. round.json records the teacher gate (the
             research note's day-4 gate: >= 90% of the teacher's rollouts pass in our env)
  train      lerobot_tools.experiments on that grid (ACT, the usual recipe + --train-args)
  select     each candidate checkpoint on selection seeds 5300-5329 (never the test seeds 5020-5059, never the DAgger
             seeds); the most successes wins, a tie goes to the later step (overnight.pick_step)
Round r = 1, 2 (DAgger):
  preflight  round r-1's selected checkpoint exists (the student that visits the states)
  dagger     that student drives on its own practice seeds (round 1: 5200-5239, round 2: 5240-5279 by default); the
             teacher labels every visited state (relabel, not replace) (distill_rollouts.py --kind dagger)
  decide     the stop rule (stop_decision) on the student's own rollout successes and the new labelled frames;
             a stop skips the rest of the round
  grid       human + teacher + every DAgger round so far, mixed by frame share
  train      as round 0, from scratch on the aggregate (DAgger's "aggregate and retrain")
  select     as round 0
Each round writes data/distill/<run>/r<r>/round.json: sources, mix, gate or decision, selection. The final test on
5020-5059 is not part of any round (pre-register the arm first; the note has the command).
"""

from __future__ import annotations

import json
import os
import shutil
from collections.abc import Callable
from dataclasses import dataclass, field, replace
from pathlib import Path

from demo_pipeline.episode_io import EpisodeMeta
from lerobot_tools.assemble import source_of
from sim_eval.overnight import (
    PRACTICE_SEEDS, TEST_SEEDS, Phase, PhaseFailed, Runner, checkpoint_of, count_successes, find_train_run,
    pick_step, results_complete, subprocess_runner,
)

SOURCES = ("human", "teacher", "dagger")
TEACHER_SEEDS = range(4000, 5000)  # training side (< 5000), clear of the homeset sources/variants (3000-3999)
SELECT_SEEDS = range(5300, 5400)  # eval_cells' own practice-selection seeds; neither test nor DAgger seeds
MAX_ROUND = 2
DEFAULT_WEIGHTS = {"human": 0.25, "teacher": 0.5, "dagger": 0.25}


# --- mixing ------------------------------------------------------------------------------------------------------------

def mix_repeats(frames: dict[str, int], weights: dict[str, float], max_repeat: int = 10
                ) -> tuple[dict[str, int], dict[str, float]]:
    """Integer copies per source so each source's share of the frames is close to its weight's share.

    LeRobot samples frames uniformly, so a weight can only be realised by repeating episodes: the source with the
    most frames per unit weight is used once, the others are repeated (rounded, at most max_repeat). Weight 0 drops a
    source. Returns (repeats, achieved frame shares)."""
    if any(w < 0 for w in weights.values()):
        raise ValueError(f"weights must be >= 0, got {weights}")
    live = {s: w for s, w in weights.items() if w > 0 and s in frames}
    if not live:
        raise ValueError(f"no source has a positive weight: {weights}")
    empty = [s for s in live if frames[s] <= 0]
    if empty:
        raise ValueError(f"sources {empty} have a weight but no frames")
    per_frame = {s: w / frames[s] for s, w in live.items()}
    base = min(per_frame.values())
    reps = {s: (min(max_repeat, max(1, round(per_frame[s] / base))) if s in live else 0) for s in frames}
    total = sum(frames[s] * reps[s] for s in frames)
    shares = {s: round(frames[s] * reps[s] / total, 4) for s in frames}
    return reps, shares


def _episode_info(ep: Path) -> tuple[int, str]:
    meta = EpisodeMeta.model_validate_json((Path(ep) / "episode.json").read_text(encoding="utf-8"))
    root = meta.passport.lineage[0] if meta.passport else meta.demo_id
    return meta.n_steps, source_of(root)


def mix_cell(sources: dict[str, list[Path]], weights: dict[str, float], *, label: str, n_human: int,
             max_repeat: int = 10) -> tuple[dict, dict]:
    """One "distill" grid cell from {source: episode dirs} (human = SANT's verified human-derived episodes, teacher,
    dagger) and the per-source frame-share weights. Every episode's lineage must match the source it is listed under.
    Returns (cell, report {source: episodes, frames, weight, repeat, share})."""
    unknown = sorted(set(sources) - set(SOURCES))
    if unknown:
        raise ValueError(f"unknown sources {unknown}; expected some of {SOURCES}")
    if not sources.get("human") or weights.get("human", 0) <= 0:
        raise ValueError("a distill cell needs the human-derived (SANT) episodes with a positive weight")
    frames, dirs = {}, {}
    for src, eps in sources.items():
        if not eps:
            continue
        total = 0
        for ep in eps:
            n, actual = _episode_info(ep)
            if actual not in (src, "recovery" if src == "human" else src):
                raise ValueError(f"{ep} is a {actual} episode, listed under {src}")
            total += n
        frames[src], dirs[src] = total, [Path(e) for e in eps]
    reps, shares = mix_repeats(frames, {s: weights.get(s, 0.0) for s in frames}, max_repeat)
    episode_dirs = [str(d) for s in frames for _ in range(reps[s]) for d in dirs[s]]
    report = {s: {"episodes": len(dirs[s]), "frames": frames[s], "weight": weights.get(s, 0.0), "repeat": reps[s],
                  "share": shares[s]} for s in frames}
    return {"condition": "distill", "n_human": n_human, "label": label, "episode_dirs": episode_dirs}, report


# --- the stop rule -----------------------------------------------------------------------------------------------------

def stop_decision(history: list[dict], *, max_rounds: int = MAX_ROUND, target_rate: float = 0.9,
                  min_gain: float = 0.05, min_new_frames: int = 5000) -> dict:
    """Whether to stop after the latest DAgger round's rollouts, before training on them. history: one entry per
    DAgger round so far, {"round", "rollouts": {"successes", "n"}, "new_frames"}; each round's rollouts measure the
    student trained in the round before it, on seeds it never trained on.
    Stop when: the student already succeeds on >= target_rate of them (nothing left to correct); or the last round
    gained < min_gain over the one before (plateau: the previous aggregate did not help); or the round produced fewer
    than min_new_frames labelled frames."""
    if not history or history[-1]["round"] > max_rounds:
        raise ValueError(f"DAgger rounds are 1..{max_rounds}, got {[h['round'] for h in history]}")
    cur = history[-1]
    rate = cur["rollouts"]["successes"] / cur["rollouts"]["n"]
    out = {"round": cur["round"], "student_rate": round(rate, 4), "new_frames": cur["new_frames"],
           "rules": {"target_rate": target_rate, "min_gain": min_gain, "min_new_frames": min_new_frames}}
    if rate >= target_rate:
        return {**out, "stop": True, "reason": f"student near the teacher: {rate:.0%} >= {target_rate:.0%}"}
    if len(history) >= 2:
        prev = history[-2]["rollouts"]["successes"] / history[-2]["rollouts"]["n"]
        if rate - prev < min_gain:
            return {**out, "stop": True,
                    "reason": f"plateau: {rate:.0%} after {prev:.0%} (< +{min_gain:.0%}); the last aggregate did not help"}
    if cur["new_frames"] < min_new_frames:
        return {**out, "stop": True, "reason": f"only {cur['new_frames']} new labelled frames (< {min_new_frames})"}
    return {**out, "stop": False, "reason": "continue"}


# --- the rounds --------------------------------------------------------------------------------------------------------

@dataclass(frozen=True)
class RoundConfig:
    repo: Path
    run_id: str
    round_id: int
    isaac_py: Path
    lerobot_py: Path
    teacher: str  # "package.module:factory" (sim_eval.teacher.load_teacher); T3's RL teacher adapter
    teacher_checkpoint: Path
    human_grid: Path  # the SANT experiment grid holding the human-derived cell
    human_cell: str  # its label, or <condition>_<n_human>
    start_state: Path  # the dataset root whose start_state.json the evals (and the rollouts) start from
    weights: dict = field(default_factory=lambda: dict(DEFAULT_WEIGHTS))
    max_repeat: int = 10
    teacher_seed0: int = 4000
    teacher_n: int = 600
    dagger_seed0: int | None = None  # default: round r takes the r-th block of dagger_n practice seeds from 5200
    dagger_n: int = 40
    beta: float = 0.0
    select_seed0: int = 5300
    select_n: int = 30
    steps: int = 60000
    save_freq: int = 10000
    candidates: tuple[int, ...] = (40000, 60000)
    min_teacher: int = 100
    teacher_gate: float = 0.9
    target_rate: float = 0.9
    min_gain: float = 0.05
    min_new_frames: int = 5000
    inference_args: tuple[str, ...] = ()  # lerobot_tools.inference flags, for the DAgger student and the selection
    train_args: tuple[str, ...] = ()  # lerobot_tools.experiments options, e.g. ("--augment", "shift")
    port: int = 8766
    min_free_gb: float = 40.0

    def __post_init__(self):
        if not 0 <= self.round_id <= MAX_ROUND:
            raise ValueError(f"round must be 0..{MAX_ROUND}, got {self.round_id}")
        if any(s not in SOURCES for s in self.weights):
            raise ValueError(f"weights name unknown sources: {self.weights}")

    def with_(self, **kw) -> "RoundConfig":
        return replace(self, **kw)

    @property
    def data(self) -> Path:
        return self.repo / "data"

    @property
    def dir(self) -> Path:
        return self.data / "distill" / self.run_id

    def round_dir(self, r: int | None = None) -> Path:
        return self.dir / f"r{self.round_id if r is None else r}"

    def done_file(self, r: int | None = None) -> Path:
        return self.round_dir(r) / "rollouts_done.json"

    def selection_path(self, r: int) -> Path:
        """Round r's latest selection: what the next round starts from."""
        return self.round_dir(r) / "selection.json"

    @property
    def tag(self) -> str:
        """Round 0's grid, training run, evals, round record and selection are per teacher set ("_t300"): re-running
        round 0 with a larger --teacher-n keeps the rollouts done, adds the new seeds, and then mixes, trains and
        selects again from scratch instead of finding the smaller set's files and skipping."""
        return f"_t{self.teacher_n}" if self.round_id == 0 else ""

    @property
    def round_file(self) -> Path:
        return self.round_dir() / f"round{self.tag}.json"

    @property
    def decision_file(self) -> Path:
        return self.round_dir() / "decision.json"

    @property
    def selection_file(self) -> Path:
        return self.round_dir() / f"selection{self.tag}.json"

    @property
    def grid_name(self) -> str:
        return f"{self.run_id}_r{self.round_id}{self.tag}"

    @property
    def label(self) -> str:
        return f"distill_r{self.round_id}"

    @property
    def grid_file(self) -> Path:
        return self.data / "experiments" / "grids" / f"{self.grid_name}.json"

    @property
    def evals_dir(self) -> Path:
        return self.data / "evals" / self.grid_name

    @property
    def dagger_seed0_effective(self) -> int:
        if self.dagger_seed0 is not None:
            return self.dagger_seed0
        return PRACTICE_SEEDS.start + (self.round_id - 1) * self.dagger_n


def _within(seed0: int, n: int, allowed: range, what: str) -> None:
    seeds = range(seed0, seed0 + n)
    if n <= 0 or not set(seeds) <= set(allowed):
        raise ValueError(f"{what} use seeds {allowed.start}-{allowed.stop - 1} only, not {seed0}-{seed0 + n - 1}")
    if set(seeds) & set(TEST_SEEDS):
        raise ValueError(f"{what}: seeds {seed0}-{seed0 + n - 1} touch the test seeds")


def _rollouts_cmd(c: RoundConfig, kind: str, seed0: int, n: int) -> list[str]:
    return [str(c.isaac_py), str(c.repo / "sim_eval" / "scripts" / "distill_rollouts.py"), "--kind", kind,
            "--round", str(c.round_id), "--seed0", str(seed0), "--n", str(n), "--out", str(c.round_dir()),
            "--teacher", c.teacher, "--teacher-checkpoint", str(c.teacher_checkpoint),
            "--start-state", str(c.start_state)]


def teacher_cmd(c: RoundConfig) -> list[str]:
    _within(c.teacher_seed0, c.teacher_n, TEACHER_SEEDS, "teacher rollouts (training-side)")
    return _rollouts_cmd(c, "teacher", c.teacher_seed0, c.teacher_n)


def dagger_cmd(c: RoundConfig, student: Path) -> list[str]:
    _within(c.dagger_seed0_effective, c.dagger_n, PRACTICE_SEEDS, "DAgger student rollouts (practice)")
    return [*_rollouts_cmd(c, "dagger", c.dagger_seed0_effective, c.dagger_n), "--checkpoint", str(student),
            "--beta", str(float(c.beta)), "--port", str(c.port), *c.inference_args]


def select_cmd(c: RoundConfig, cell: str, checkpoint: Path) -> list[str]:
    _within(c.select_seed0, c.select_n, SELECT_SEEDS, "checkpoint selection")
    return [str(c.isaac_py), str(c.repo / "sim_eval" / "scripts" / "eval_cells.py"), "--run-id", c.grid_name,
            "--checkpoint", f"{cell}={checkpoint}", "--seed0", str(c.select_seed0), "--n", str(c.select_n),
            "--start-state", str(c.start_state), "--start-pose", "dataset", "--port", str(c.port), *c.inference_args]


def train_cmd(c: RoundConfig) -> list[str]:
    return [str(c.lerobot_py), "-m", "lerobot_tools.experiments", "--grid", str(c.grid_file), "--steps", str(c.steps),
            "--save-freq", str(c.save_freq), *c.train_args]


def human_episodes(grid_path: Path, cell: str) -> tuple[list[Path], int]:
    """The SANT cell's episode dirs (relative ones resolve against the grid's folder) and its n_human."""
    grid = json.loads(Path(grid_path).read_text(encoding="utf-8"))
    for x in grid["cells"]:
        if (x.get("label") or f"{x['condition']}_{x['n_human']}") == cell:
            return [(Path(grid_path).parent / d).resolve() for d in x["episode_dirs"]], int(x["n_human"])
    raise ValueError(f"{grid_path} has no cell {cell!r}")


def _round_episodes(c: RoundConfig, r: int) -> list[Path]:
    root = c.round_dir(r) / "episodes"
    return sorted(p for p in root.iterdir() if (p / "episode.json").exists()) if root.is_dir() else []


def _episode_seed(ep: Path) -> int:
    """teacher_r0_<seed> / dagger_r<k>_<seed>_<i> (sim_eval.distill.write_rollout's names)."""
    return int(Path(ep).name.split("_")[2])


def _read(path: Path) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def plan_round(c: RoundConfig, log: Callable[[str], None], runner: Runner | None = None,
               stop_after: str | None = None) -> list[Phase]:
    """stop_after: the last phase to run (e.g. "rollouts" to check the teacher gate on a few seeds first)."""
    if runner is None:
        def runner(cmd, env, log_file):
            rc = subprocess_runner(cmd, env, log_file, cwd=c.repo)
            log(f"[distill]   exit {rc}: {' '.join(cmd[:3])} ... (log {log_file.name})")
            return rc
    logs = c.round_dir() / "logs"
    flags: dict = {}
    r = c.round_id

    def env() -> dict:
        return dict(os.environ, PYTHONPATH=f"{c.repo / 'src'}{os.pathsep}{c.repo}", DATA_DIR=str(c.data))

    def student() -> Path:
        return Path(_read(c.selection_path(r - 1))["checkpoint"])

    def stopped() -> bool:
        return c.decision_file.exists() and _read(c.decision_file)["stop"]

    def preflight() -> None:
        need = [c.isaac_py, c.lerobot_py, c.teacher_checkpoint, c.human_grid, c.start_state / "start_state.json"]
        problems = [f"missing {p}" for p in need if not Path(p).exists()]
        if r >= 1:
            if not c.selection_path(r - 1).exists():
                problems.append(f"round {r - 1} has no selected checkpoint ({c.selection_path(r - 1)}); run it first")
            elif not student().exists():
                problems.append(f"round {r - 1}'s selected checkpoint {student()} is missing")
        if r == 0:
            teacher_cmd(c)
        free_gb = shutil.disk_usage(c.data).free / 1e9 if c.data.exists() else 0.0
        if free_gb < c.min_free_gb:
            problems.append(f"only {free_gb:.0f} GB free on the data disk, need {c.min_free_gb:.0f}")
        if problems:
            raise PhaseFailed("preflight: " + "; ".join(problems))
        if r >= 1:
            dagger_cmd(c, student())
        human_episodes(c.human_grid, c.human_cell)
        flags["preflight"] = True

    def rollouts() -> None:
        c.round_dir().mkdir(parents=True, exist_ok=True)
        cmd = teacher_cmd(c) if r == 0 else dagger_cmd(c, student())
        if runner(cmd, env(), logs / "rollouts.log") != 0:
            raise PhaseFailed("rollouts: distill_rollouts failed; see logs/rollouts.log")

    def rollouts_done() -> bool:
        """Done for exactly this round's seeds: a larger --teacher-n / --dagger-n later resumes the same folder."""
        if not c.done_file().exists():
            return False
        seed0, n = (c.teacher_seed0, c.teacher_n) if r == 0 else (c.dagger_seed0_effective, c.dagger_n)
        return _read(c.done_file())["seeds"] == [seed0, seed0 + n - 1]

    def history() -> list[dict]:
        out = []
        for k in range(1, r + 1):
            d = _read(c.done_file(k))
            out.append({"round": k, "rollouts": {"successes": d["successes"], "n": d["attempted"]},
                        "new_frames": d["frames"]})
        return out

    def decide() -> None:
        dec = stop_decision(history(), target_rate=c.target_rate, min_gain=c.min_gain,
                            min_new_frames=c.min_new_frames)
        d = _read(c.done_file(r))
        c.round_file.write_text(json.dumps({
            "run_id": c.run_id, "round": r, "teacher": c.teacher, "teacher_checkpoint": str(c.teacher_checkpoint),
            "student_checkpoint": str(student()), "rollouts": {"successes": d["successes"], "n": d["attempted"]},
            "dagger_seeds": d["seeds"], "beta": c.beta, "decision": dec}, indent=1), encoding="utf-8")
        c.decision_file.write_text(json.dumps(dec, indent=1), encoding="utf-8")  # last: marks the phase done
        log(f"[distill]   round {r}: student {dec['student_rate']:.0%} on its rollouts; "
            f"{'STOP: ' if dec['stop'] else ''}{dec['reason']}")

    def grid() -> None:
        human, n_human = human_episodes(c.human_grid, c.human_cell)
        done0 = _read(c.done_file(0))
        gate = {"verified": done0["successes"], "attempted": done0["attempted"],
                "rate": round(done0["successes"] / done0["attempted"], 4), "threshold": c.teacher_gate}
        gate["passes"] = gate["rate"] >= c.teacher_gate
        t0, t1 = teacher_seeds()
        teacher_eps = [ep for ep in _round_episodes(c, 0) if t0 <= _episode_seed(ep) <= t1]
        if len(teacher_eps) < c.min_teacher:
            raise PhaseFailed(f"grid: only {len(teacher_eps)} teacher rollouts passed check_success in our env "
                              f"(need {c.min_teacher}); the teacher is not ready")
        sources = {"human": human, "teacher": teacher_eps}
        dagger = [ep for k in range(1, r + 1) for ep in _round_episodes(c, k)]
        if dagger:
            sources["dagger"] = dagger
        cell, report = mix_cell(sources, c.weights, label=c.label, n_human=n_human, max_repeat=c.max_repeat)
        c.grid_file.parent.mkdir(parents=True, exist_ok=True)
        c.grid_file.write_text(json.dumps({"name": c.grid_name, "cells": [cell]}, indent=1), encoding="utf-8")
        info = _read(c.round_file) if r >= 1 else {"run_id": c.run_id, "round": r, "teacher": c.teacher,
                                                   "teacher_checkpoint": str(c.teacher_checkpoint)}
        info.update(human={"grid": str(c.human_grid), "cell": c.human_cell, "n_human": n_human}, teacher_gate=gate,
                    teacher_seeds=[t0, t1], mix=report, grid=str(c.grid_file), dagger_rounds=list(range(1, r + 1)))
        c.round_file.write_text(json.dumps(info, indent=1), encoding="utf-8")
        log(f"[distill]   cell {c.label}: " + ", ".join(f"{s} {v['frames']} frames x{v['repeat']} ({v['share']:.0%})"
                                                     for s, v in report.items()))

    def teacher_seeds() -> tuple[int, int]:
        """Round 0: this run's teacher seeds. DAgger rounds: the teacher set round 0's latest selection trained on."""
        if r == 0:
            return c.teacher_seed0, c.teacher_seed0 + c.teacher_n - 1
        s0, s1 = _read(c.selection_path(0))["teacher_seeds"]
        return int(s0), int(s1)

    def run_dir() -> Path | None:
        return find_train_run(c.data / "experiments", c.grid_name, c.label, c.steps)

    def train() -> None:
        if runner(train_cmd(c), env(), logs / "train.log") != 0:
            raise PhaseFailed("train: lerobot_tools.experiments failed; see logs/train.log")

    def select() -> None:
        run = run_dir()
        counts = {}
        for step in c.candidates:
            cell = f"{c.label}_s{step}"
            res = c.evals_dir / f"{cell}.json"
            if not results_complete(res, c.select_seed0, c.select_n):
                runner(select_cmd(c, cell, checkpoint_of(run, c.label, step)), env(), logs / f"select_{step}.log")
            counts[step] = count_successes(res, c.select_seed0, c.select_n)
            log(f"[distill]   {cell}: {counts[step][0]}/{counts[step][1]} on selection seeds")
        chosen = pick_step(counts)
        sel = {"counts": {str(k): list(v) for k, v in counts.items()}, "chosen_step": chosen,
               "checkpoint": str(checkpoint_of(run, c.label, chosen)), "train_run": str(run),
               "seeds": [c.select_seed0, c.select_seed0 + c.select_n - 1], "inference_args": list(c.inference_args),
               "grid": str(c.grid_file), "teacher_seeds": list(teacher_seeds())}
        c.selection_file.write_text(json.dumps(sel, indent=1), encoding="utf-8")
        if c.selection_file != c.selection_path(r):  # round 0: the latest selection is the one the next round uses
            c.selection_path(r).write_text(json.dumps(sel, indent=1), encoding="utf-8")
        info = _read(c.round_file)
        info["selection"] = sel
        c.round_file.write_text(json.dumps(info, indent=1), encoding="utf-8")

    def skip_if_stopped(done: Callable[[], bool]) -> Callable[[], bool]:
        return lambda: (r >= 1 and stopped()) or done()

    kind = "teacher" if r == 0 else "DAgger student"
    seeds = (f"{c.teacher_seed0}-{c.teacher_seed0 + c.teacher_n - 1}" if r == 0 else
             f"{c.dagger_seed0_effective}-{c.dagger_seed0_effective + c.dagger_n - 1}")
    phases = [
        Phase("preflight", lambda: flags.get("preflight", False), preflight, "inputs, the previous round, disk"),
        Phase("rollouts", rollouts_done, rollouts, f"{kind} rollouts on seeds {seeds}, cameras on"),
    ]
    if r >= 1:
        phases.append(Phase("decide", c.decision_file.exists, decide, "the DAgger stop rule"))
    phases += [
        Phase("grid", skip_if_stopped(c.grid_file.exists), grid, "human + teacher (+ DAgger) mixed by frame share"),
        Phase("train", skip_if_stopped(lambda: run_dir() is not None), train, f"ACT, {c.steps} steps"),
        Phase("select", skip_if_stopped(c.selection_file.exists), select,
              f"candidates {list(c.candidates)} on seeds {c.select_seed0}-{c.select_seed0 + c.select_n - 1}"),
    ]
    if stop_after is not None:
        names = [ph.name for ph in phases]
        if stop_after not in names:
            raise ValueError(f"stop_after {stop_after!r}: round {r} has phases {names}")
        phases = phases[: names.index(stop_after) + 1]
    return phases
