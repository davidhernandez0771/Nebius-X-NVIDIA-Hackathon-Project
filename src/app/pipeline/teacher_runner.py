"""The teacher recipe's runner (scripts/run_teacher_pipeline.py): the real approach's training, as the site starts it.

    teacher      T3's RL teacher (scripts/rl_train.py, Isaac Lab's rsl_rl PPO on SANT's env; it takes gpu.lock itself)
    gate_eval    T3's step 1 (scripts/rl_eval_teacher.py, Isaac's python): the teacher plays the gate seeds; this
                 runner holds gpu.lock around it (the script doesn't take it)
    gate_verify  T3's step 2 (scripts/rl_verify_teacher.py): its trajectories replayed in SANT's eval env with
                 check_success (it takes gpu.lock itself); the gate: successes / n >= gate_min (0.9) or the run is refused
    distill_r0   T6's round 0 (sim_eval/scripts/distill_round.py --round 0): teacher rollouts -> grid -> ACT -> select
    dagger_r1    T6's round 1 (DAgger), only when asked; T6's stop rule may end it early (decision.json)
    results      results.json: the gate, each round's teacher gate, mix and selection
The gate runs on practice seeds (5300 on): the test seeds 5020-5059 stay untouched for the pre-registered final test,
which is not part of this recipe (T6's note: once, after pre-registering the arm).

Like scripts/run_human_demo_experiment.py: one subprocess per stage, a marker per finished stage
(DATA_DIR/teacher/<name>/stages/<stage>.json, with its seconds and items for the time estimates), a re-run resumes
(training continues from its last model_<i>.pt with the iterations left), and <run>/STOP stops it before the next
stage. T3's and T6's scripts write under <repo>/data (their convention), so this runner reads their outputs there.
Exit: 0 done, 1 refused (missing scripts or inputs, or the gate not met), 2 stopped (a stage failed, or STOP).
"""
from __future__ import annotations

import json
import re
import sys
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

STAGES = ("teacher", "gate_eval", "gate_verify", "distill_r0", "dagger_r1", "results")
STOP_FILE = "STOP"
ISAAC_PY = Path(r"C:\isaac\env_isaaclab\Scripts\python.exe")
TEACHER_FACTORY = "sim_worker.rl_policy:make"  # T3's adapter for T6's teacher contract
RL_EXPERIMENT = "sant_rl_teacher"
GATE_SEED0, GATE_N, GATE_MIN = 5300, 50, 0.9
# T6's smoke flags (distill-dagger note), and T3's (--smoke: 64 envs x 20 iterations)
DISTILL_SMOKE = ["--teacher-n", "4", "--min-teacher", "1", "--steps", "200", "--save-freq", "100", "--candidates", "100",
                 "200", "--select-n", "2"]
SMOKE_ITERATIONS = 20
SCRIPTS = {
    "scripts/rl_train.py": "pm/rl-teacher", "scripts/rl_eval_teacher.py": "pm/rl-teacher",
    "scripts/rl_verify_teacher.py": "pm/rl-teacher", "sim_worker/rl_policy.py": "pm/rl-teacher",
    "sim_eval/scripts/distill_round.py": "pm/distill-dagger",
}
_MODEL = re.compile(r"model_(\d+)\.pt$")


class Refused(ValueError):
    """Nothing to run: a missing script or input, or the teacher gate not met."""


class Stop(RuntimeError):
    """A stage failed or a stop was requested; what finished is kept, and a re-run resumes."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _read(path: Path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _write(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(data, indent=1, default=str), encoding="utf-8")
    tmp.replace(path)


def resolve_human(data: Path, human_run: str) -> tuple[Path, str, Path]:
    """The SANT data a student starts from: a human-demo experiment's grid, its multiplied cell, and the start state
    (the raw cell's dataset, as every eval uses; the multiplied one's when the run had no raw arm)."""
    root = Path(data) / "human_exp" / human_run
    grid, train = _read(root / "grid.json"), _read(root / "stages" / "train.json")
    if not grid or not train or not train.get("ok"):
        raise Refused(f"no human run {human_run!r} with a trained grid in {root} (it needs grid.json and stages/train.json)")
    cells = {c["condition"]: c["name"] for c in grid.get("cells", [])}
    cell = cells.get("perfected_multiply")
    if not cell:
        raise Refused(f"human run {human_run!r} has no perfected_multiply cell")
    datasets = {c: Path(v["dataset"]) for c, v in (train.get("cells") or {}).items() if v.get("dataset")}
    raw = next((p for c, p in datasets.items() if c.startswith("raw_")), None)
    start = raw or datasets.get(cell)
    if start is None:
        raise Refused(f"human run {human_run!r} has no dataset to take the start state from")
    return root / "grid.json", cell, start


@dataclass
class TeacherConfig:
    name: str
    data: Path  # DATA_DIR: this run's folder, and the human run
    repo: Path  # where T3's and T6's scripts are (and their data/)
    human_run: str
    rl_iterations: int = 1500
    teacher_n: int = 300
    dagger: bool = False
    smoke: bool = False
    gate_min: float = GATE_MIN
    gate_seed0: int = GATE_SEED0
    gate_n: int = GATE_N
    isaac_py: Path = ISAAC_PY
    python: str = sys.executable

    def __post_init__(self) -> None:
        self.data, self.repo = Path(self.data), Path(self.repo)
        if self.smoke:
            self.rl_iterations, self.gate_n, self.gate_min, self.teacher_n = SMOKE_ITERATIONS, 5, 0.0, 4


@dataclass
class TeacherDeps:
    run: Callable[[list[str], Path], int]  # (command, log file) -> exit code
    gpu_lock: Callable[[str], object]  # (task) -> context manager: gpu.lock + KeepAwake
    log: Callable[[str], None] = print
    clock: Callable[[], float] = field(default=time.monotonic)


class TeacherRun:
    def __init__(self, cfg: TeacherConfig, deps: TeacherDeps):
        self.cfg, self.deps = cfg, deps
        self.root = cfg.data / "teacher" / cfg.name
        self.stages = self.root / "stages"
        self.logs = self.root / "logs"

    # --- helpers -----------------------------------------------------------------------------------------
    def log(self, msg: str) -> None:
        line = f"[teacher {datetime.now():%H:%M:%S}] {msg}"
        self.deps.log(line)
        self.root.mkdir(parents=True, exist_ok=True)
        with (self.root / "run.log").open("a", encoding="utf-8") as f:
            f.write(line + "\n")

    def marker(self, stage: str) -> Path:
        return self.stages / f"{stage}.json"

    def check_stop(self, next_stage: str) -> None:
        if (self.root / STOP_FILE).is_file():
            self.log(f"stop requested: stopping before {next_stage}")
            raise Stop(f"stop requested before {next_stage}; delete {self.root / STOP_FILE} and re-run to resume")

    def rl_runs(self) -> list[Path]:
        base = self.cfg.repo / "data" / "rl" / "logs" / "rsl_rl" / RL_EXPERIMENT
        own = re.compile(r"\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d_" + re.escape(self.cfg.name))  # not another run's *_<name>
        return sorted(p for p in base.glob(f"*_{self.cfg.name}") if own.fullmatch(p.name))

    def latest_model(self) -> tuple[Path, int] | None:
        found = [(p, int(m.group(1))) for run in self.rl_runs() for p in run.glob("model_*.pt") if (m := _MODEL.search(p.name))]
        return max(found, key=lambda x: x[1]) if found else None

    @property
    def gate_dir(self) -> Path:
        return self.cfg.repo / "data" / "rl" / "eval" / f"{self.cfg.name}_gate"

    def round_dir(self, r: int) -> Path:
        return self.cfg.repo / "data" / "distill" / self.cfg.name / f"r{r}"

    def tag(self, r: int) -> str:
        """T6's round 0 files are per teacher set (sim_eval/distill_round.py RoundConfig.tag): "_t300"."""
        return f"_t{self.cfg.teacher_n}" if r == 0 else ""

    def round_file(self, r: int) -> Path:
        return self.round_dir(r) / f"round{self.tag(r)}.json"

    def train_run(self, r: int) -> Path | None:
        """Round r's ACT training run (T6: DATA/experiments/<run>_r<k><tag>_<YYYYMMDD_HHMMSS>), the newest."""
        grid = f"{self.cfg.name}_r{r}{self.tag(r)}"
        pat = re.compile(re.escape(grid) + r"_\d{8}_\d{6}")
        found = sorted(p for p in (self.cfg.repo / "data" / "experiments").glob(f"{grid}_*") if pat.fullmatch(p.name))
        return found[-1] if found else None

    def _child(self, stage: str, cmd: list[str]) -> None:
        self.log(f"{stage}: {' '.join(cmd)}")
        rc = self.deps.run(cmd, self.logs / f"{stage}.log")
        if rc != 0:
            raise Stop(f"{stage}: exit {rc}; see {self.logs / f'{stage}.log'}; re-run to resume")

    def _done(self, stage: str, started: float, items: int, **extra) -> None:
        _write(self.marker(stage), {"at": _now(), "seconds": round(self.deps.clock() - started, 1), "items": items, **extra})

    # --- the stages ----------------------------------------------------------------------------------------
    def preflight(self) -> tuple[Path, str, Path]:
        missing = [f"{f} ({branch})" for f, branch in SCRIPTS.items() if not (self.cfg.repo / f).is_file()]
        if missing:
            raise Refused(f"the teacher recipe needs {', '.join(missing)} merged into {self.cfg.repo}")
        bank = self.cfg.repo / "data" / "rl" / "bank_mouse20261020.npz"
        if not bank.is_file():
            raise Refused(f"no RL demo-start bank at {bank}: T3's scripts/rl_demo_bank.py builds it (see T3's note)")
        return resolve_human(self.cfg.data, self.cfg.human_run)

    def teacher(self) -> None:
        if self.marker("teacher").is_file():
            return
        started = self.deps.clock()
        target = self.cfg.rl_iterations
        last = self.latest_model()
        # model_<i>.pt is saved after iteration index i (i + 1 done); a resume restarts AT index i (rsl_rl loads
        # "iter" = i), so target - i more iterations end at model_<target - 1>
        if last is None or last[1] + 1 < target:
            cmd = [self.cfg.python, str(self.cfg.repo / "scripts" / "rl_train.py"), "--run-name", self.cfg.name,
                   "--max-iterations", str(target - last[1] if last else target)]
            if self.cfg.smoke and not last:
                cmd.append("--smoke")
            if last:
                cmd += ["--checkpoint", str(last[0])]
            self._child("teacher", cmd)
            last = self.latest_model()
        if last is None or last[1] + 1 < target:
            got = 0 if last is None else last[1] + 1
            raise Stop(f"teacher: training ended at iteration {got} of {target}; re-run to continue from the last checkpoint")
        self._done("teacher", started, target, checkpoint=str(last[0]), run_dir=str(last[0].parent), iterations=target)
        self.log(f"teacher: {target} iterations, checkpoint {last[0].name}")

    def gate_eval(self) -> None:
        if self.marker("gate_eval").is_file():
            return
        started = self.deps.clock()
        ck = (_read(self.marker("teacher")) or {})["checkpoint"]
        cmd = [str(self.cfg.isaac_py), str(self.cfg.repo / "scripts" / "rl_eval_teacher.py"), "--checkpoint", ck,
               "--out", str(self.gate_dir), "--seed0", str(self.cfg.gate_seed0), "--n", str(self.cfg.gate_n)]
        with self.deps.gpu_lock(f"teacher:{self.cfg.name}:gate"):  # the script doesn't take the lock itself
            self._child("gate_eval", cmd)
        policy = Path(ck).parent / "exported" / "policy.pt"
        if not (self.gate_dir / "in_env.json").is_file() or not policy.is_file():
            raise Stop(f"gate_eval wrote no in_env.json or {policy}")
        self._done("gate_eval", started, self.cfg.gate_n, policy=str(policy))

    def gate_verify(self) -> None:
        if not self.marker("gate_verify").is_file():
            started = self.deps.clock()
            self._child("gate_verify", [self.cfg.python, str(self.cfg.repo / "scripts" / "rl_verify_teacher.py"), "--runs",
                                        str(self.gate_dir)])
            report = _read(self.gate_dir / "verify.json")
            if not report:
                raise Stop("gate_verify wrote no verify.json")
            s = report["summary"]
            self._done("gate_verify", started, s["n"], successes=s["successes"], n=s["n"], ci95=s.get("ci95"),
                       agree_with_in_env=report.get("agree_with_in_env"))
        g = _read(self.marker("gate_verify"))
        rate = g["successes"] / g["n"] if g["n"] else 0.0
        self.log(f"gate: the teacher {g['successes']}/{g['n']} in SANT's eval env (practice seeds {self.cfg.gate_seed0}-"
                 f"{self.cfg.gate_seed0 + self.cfg.gate_n - 1}); the gate is {self.cfg.gate_min:.0%}")
        if rate < self.cfg.gate_min:
            raise Refused(f"the teacher gate: {g['successes']}/{g['n']} ({rate:.0%}) in SANT's eval env, under "
                          f"{self.cfg.gate_min:.0%}; a better teacher is needed (T3's note: shaping, curriculum, more "
                          f"iterations) before distilling")

    def distill(self, r: int, human: tuple[Path, str, Path]) -> None:
        stage = "distill_r0" if r == 0 else f"dagger_r{r}"
        if self.marker(stage).is_file():
            return
        started = self.deps.clock()
        grid, cell, start = human
        policy = (_read(self.marker("gate_eval")) or {})["policy"]
        cmd = [str(self.cfg.isaac_py), str(self.cfg.repo / "sim_eval" / "scripts" / "distill_round.py"), "--round", str(r),
               "--run-id", self.cfg.name, "--teacher", TEACHER_FACTORY, "--teacher-checkpoint", policy,
               "--human-grid", str(grid), "--human-cell", cell, "--start-state", str(start)]
        cmd += DISTILL_SMOKE if self.cfg.smoke else ["--teacher-n", str(self.cfg.teacher_n)]
        self._child(stage, cmd)  # distill_round takes gpu.lock for the whole round itself
        rdir = self.round_dir(r)
        decision = _read(rdir / "decision.json") or {}
        selection = _read(rdir / "selection.json")
        if selection is None and not decision.get("stop"):
            raise Stop(f"{stage}: no selection.json in {rdir}; re-run to resume")
        n = self.cfg.teacher_n if r == 0 else 40
        self._done(stage, started, n, round_dir=str(rdir), selection=selection, decision=decision or None)
        self.log(f"{stage}: " + (f"chose step {selection.get('chosen_step')} ({selection.get('checkpoint')})" if selection
                                 else f"stopped by the DAgger stop rule: {decision.get('reason')}"))

    def results(self) -> dict:
        rounds = []
        for r in (0, 1):
            rdir = self.round_dir(r)
            if self.round_file(r).is_file() or (rdir / "selection.json").is_file():
                rounds.append({"round": r, "round_json": _read(self.round_file(r)), "selection": _read(rdir / "selection.json"),
                               "decision": _read(rdir / "decision.json"), "rollouts": _read(rdir / "rollouts_done.json")})
        g = _read(self.marker("gate_verify")) or {}
        final = next((x["selection"] for x in reversed(rounds) if x["selection"]), None)
        out = {"kind": "teacher", "name": self.cfg.name, "smoke": self.cfg.smoke, "human_run": self.cfg.human_run,
               "teacher": _read(self.marker("teacher")),
               "teacher_gate": {"successes": g.get("successes"), "n": g.get("n"), "ci95": g.get("ci95"),
                                "seeds": [self.cfg.gate_seed0, self.cfg.gate_seed0 + self.cfg.gate_n - 1],
                                "gate": self.cfg.gate_min, "agree_with_in_env": g.get("agree_with_in_env")},
               "rounds": rounds, "student": final,
               "note": ("SMOKE TEST: proves every stage runs; not a result. " if self.cfg.smoke else "")
               + "The final test on seeds 5020-5059 is not part of this recipe: it runs once, after pre-registering the arm."}
        _write(self.root / "results.json", out)
        _write(self.marker("results"), {"at": _now()})
        return out

    # --- the run ------------------------------------------------------------------------------------------------
    def run(self, until: str = "results") -> None:
        human = self.preflight()
        _write(self.root / "config.json", {**{k: (str(v) if isinstance(v, Path) else v) for k, v in vars(self.cfg).items()},
                                           "human_grid": str(human[0]), "human_cell": human[1], "start_state": str(human[2])})
        if until == "plan":
            self.log("done through 'plan'")
            return
        steps = [("teacher", self.teacher), ("gate_eval", self.gate_eval), ("gate_verify", self.gate_verify),
                 ("distill_r0", lambda: self.distill(0, human))]
        if self.cfg.dagger:
            steps.append(("dagger_r1", lambda: self.distill(1, human)))
        steps.append(("results", self.results))
        for stage, fn in steps:
            self.check_stop(stage)
            fn()
            if stage == until:
                break
        self.log(f"done through '{until}'")


@contextmanager
def real_gpu_lock(task: str, log: Callable[[str], None] = print):
    """gpu.lock (waits while another live process holds it) and KeepAwake, for a stage that doesn't take them itself."""
    from sim_worker.gpu_lock import GpuLock
    from sim_worker.keepawake import KeepAwake

    with GpuLock(task=task, owner="T5", log=log), KeepAwake():
        yield
