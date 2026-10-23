"""The 2026-10-23 big test as one restartable chain (T7's prereg: docs/superpowers/notes/2026-10-23-bigtest-prereg.md
on pm/live-13). Pure parts; sim_eval/scripts/bigtest.py runs it under C:\\dev\\gpu.lock with the PC kept awake.

Recipe v2, one combined arm, the same task:
  human    T3's held re-execution of round 0's human demos (pm/held-human, its own command and lock). The chain starts
           after its done marker. kept >= 80 of 110: Stage A uses its cell held_human_10; below that the ORIGINAL
           perfected_multiply_10 (change 2 dropped, disclosed). Decided once (human_choice.json).
  teacher  the @600 teacher rollouts REUSED: 565 held episodes on 4300-4899 (demo_v6h model_2697, sha256 checked),
           copied into this run's round 0 and verified file by file. No new teacher seeds.
  A        distill round 0 on human + teacher (1/3 : 2/3 by frame share), 180k steps at batch 8 from scratch,
           candidates 60k / 120k / 180k on selection seeds 5500-5528
  B        distill round 1: Stage A's best (beta 0, the teacher's labels capped from the student's tool) drives on
           5210-5249; human 0.25 / teacher 0.5 / DAgger 0.25, 180k from scratch, candidates on 5529-5557; the stop
           rule is recorded but never applied (Stage B always runs)
  test     the final model: A-best vs B-best on their own selection counts, a tie to B (final_choice.json); 40
           seeds 5400-5439, ONCE (overnight.guard_final: a results log made with another checkpoint stops the run)
Every student action (DAgger, both selections, the test) goes through --gripper-deadband 0.25. Selection: the most
successes on the stage's 29 seeds, a tie to the later checkpoint (overnight.pick_step). Times go to run_log.txt.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import shutil
from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import datetime
from pathlib import Path

from sim_eval.distill_round import BIGTEST_TEST_SEEDS, RoundConfig, plan_round
from sim_eval.overnight import (
    Phase, PhaseFailed, Runner, count_successes, find_train_run, guard_final, results_complete, run_phases,
    subprocess_runner,
)

RUN_ID = "bigtest"
INFERENCE_ARGS = ("--gripper-deadband", "0.25")
HELD_FLOOR = 80  # of 110 (the lead, 2026-10-23)


@dataclass(frozen=True)
class BigTest:
    repo: Path
    isaac_py: Path = Path(r"C:\isaac\env_isaaclab\Scripts\python.exe")
    lerobot_py: Path = Path(r"C:\venvs\lerobot\Scripts\python.exe")
    teacher: str = "sim_worker.rl_policy:make"
    teacher_checkpoint: Path = Path(r"C:\dev\pm-t3\data\rl\logs\rsl_rl\sant_rl_teacher\2026-10-21_21-33-14_demo_v6h"
                                    r"\exported\policy.pt")
    teacher_sha256: str = "811382A33F9E5593E54602B622BEA1796AFAF30732E6C66957750DDA52177AA2"
    teacher_source: Path = Path(r"C:\dev\pm-t6\data\distill\distill_mouse_held\r0")  # the @600 round 0 (10-22)
    teacher_seeds: tuple[int, int] = (4300, 4899)
    teacher_episodes: int = 565
    min_teacher: int = 100  # round 0's grid refuses fewer teacher episodes
    start_state: Path = Path(r"C:\dev\pm-t6\data\experiments\hx_mouse20261020_20261020_164411\datasets\raw_10")
    original_human: tuple[Path, str] = (Path(r"C:\dev\pm-t6\data\human_exp\mouse20261020\grid.json"),
                                        "perfected_multiply_10")
    held_human_dir: Path = Path(r"C:\dev\pm-t3-hh\data\held_human\mouse20261020")
    held_human_cell: str = "held_human_10"
    held_floor: int = HELD_FLOOR
    steps: int = 180_000
    save_freq: int = 10_000
    candidates: tuple[int, ...] = (60_000, 120_000, 180_000)
    select_a: tuple[int, int] = (5500, 29)
    select_b: tuple[int, int] = (5529, 29)
    dagger: tuple[int, int] = (5210, 40)
    test: tuple[int, int] = (5400, 40)
    inference_args: tuple[str, ...] = INFERENCE_ARGS
    trace: bool = True  # per-step traces on the test, as the 10-22 final test (passive)
    port: int = 8766
    run_id: str = RUN_ID

    def with_(self, **kw) -> "BigTest":
        return replace(self, **kw)

    @property
    def dir(self) -> Path:
        return self.repo / "data" / "distill" / self.run_id

    @property
    def run_log(self) -> Path:
        return self.dir / "run_log.txt"

    @property
    def held_done(self) -> Path:
        return self.held_human_dir / "held_human_done.json"

    @property
    def test_run_id(self) -> str:
        return f"{self.run_id}_test"

    @property
    def test_results(self) -> Path:
        return self.repo / "data" / "evals" / self.test_run_id / "bigtest_final.json"


def _read(path: Path) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _write(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=1), encoding="utf-8")


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest().upper()


# --- human: T3's held re-execution, or the original set below the floor -----------------------------------------------

def human_choice(bt: BigTest) -> dict:
    """Decided once, from T3's done marker: {grid, cell, kept, attempted, held}. Raises PhaseFailed without it."""
    path = bt.dir / "human_choice.json"
    if path.exists():
        return _read(path)
    if not bt.held_done.exists():
        raise PhaseFailed(f"human: T3's held-human run has no done marker yet ({bt.held_done})")
    done = _read(bt.held_done)
    kept, attempted = int(done["kept"]), int(done["attempted"])
    held = kept >= bt.held_floor and (bt.held_human_dir / "grid.json").exists()
    grid, cell = ((bt.held_human_dir / "grid.json", bt.held_human_cell) if held else bt.original_human)
    choice = {"held": held, "grid": str(grid), "cell": cell, "kept": kept, "attempted": attempted,
              "frames": done.get("frames"), "k": done.get("k"), "floor": bt.held_floor,
              "reason": (f"held re-execution kept {kept}/{attempted} >= {bt.held_floor}" if held else
                         f"held re-execution kept {kept}/{attempted} < {bt.held_floor}: the ORIGINAL human set "
                         f"(change 2 dropped, disclosed)"),
              "decided": datetime.now().isoformat(timespec="seconds")}
    _write(path, choice)
    return choice


# --- teacher: the @600 rollouts, copied into this run's round 0 ---------------------------------------------------------

def _tree(root: Path) -> dict[str, int]:
    return {str(p.relative_to(root)): p.stat().st_size for p in Path(root).rglob("*") if p.is_file()}


def copy_teacher(bt: BigTest, log: Callable[[str], None] = print) -> dict:
    """Copy the reused teacher episodes (and the round's rollouts_done.json / rollouts.jsonl) into round 0 of this
    run; verify every file's size. Refuses a source that is not the 565 held episodes on 4300-4899."""
    r0 = bt.dir / "r0"
    marker = r0 / "teacher_copy.json"
    if marker.exists():
        return _read(marker)
    done = _read(bt.teacher_source / "rollouts_done.json")
    want = {"kind": "teacher", "seeds": list(bt.teacher_seeds), "successes": bt.teacher_episodes,
            "teacher_execution": "held"}
    got = {k: done.get(k) for k in want}
    if got != want:
        raise PhaseFailed(f"teacher: {bt.teacher_source} is not the pre-registered teacher set: {got} != {want}")
    if os.path.normcase(str(Path(done["teacher_checkpoint"]))) != os.path.normcase(str(bt.teacher_checkpoint)):
        raise PhaseFailed(f"teacher: those rollouts came from {done['teacher_checkpoint']}")
    src_eps = sorted(p for p in (bt.teacher_source / "episodes").iterdir() if (p / "episode.json").exists())
    if len(src_eps) != bt.teacher_episodes:
        raise PhaseFailed(f"teacher: {len(src_eps)} episodes in {bt.teacher_source}, expected {bt.teacher_episodes}")
    dst = r0 / "episodes"
    files = size = 0
    for i, ep in enumerate(src_eps):
        shutil.copytree(ep, dst / ep.name, dirs_exist_ok=True)
        a, b = _tree(ep), _tree(dst / ep.name)
        if a != b:
            raise PhaseFailed(f"teacher: the copy of {ep.name} differs from its source")
        files, size = files + len(a), size + sum(a.values())
        if (i + 1) % 100 == 0:
            log(f"[bigtest]   copied {i + 1}/{len(src_eps)} teacher episodes")
    for name in ("rollouts.jsonl", "rollouts_done.json"):
        shutil.copy2(bt.teacher_source / name, r0 / name)
    info = {"source": str(bt.teacher_source), "episodes": len(src_eps), "files": files, "bytes": size,
            "seeds": list(bt.teacher_seeds), "rollouts_code": done.get("code"),
            "copied": datetime.now().isoformat(timespec="seconds")}
    _write(marker, info)  # last: marks the copy done
    return info


# --- the two stages -----------------------------------------------------------------------------------------------------

def stage_config(bt: BigTest, stage: str, human: dict) -> RoundConfig:
    base = RoundConfig(repo=bt.repo, run_id=bt.run_id, round_id=0, isaac_py=bt.isaac_py, lerobot_py=bt.lerobot_py,
                       teacher=bt.teacher, teacher_checkpoint=bt.teacher_checkpoint, human_grid=Path(human["grid"]),
                       human_cell=human["cell"], start_state=bt.start_state, teacher_seed0=bt.teacher_seeds[0],
                       teacher_n=bt.teacher_seeds[1] - bt.teacher_seeds[0] + 1, teacher_execution="held",
                       steps=bt.steps, save_freq=bt.save_freq, candidates=bt.candidates,
                       inference_args=bt.inference_args, port=bt.port, min_teacher=bt.min_teacher)
    if stage == "A":
        return base.with_(select_seed0=bt.select_a[0], select_n=bt.select_a[1])
    if stage == "B":
        return base.with_(round_id=1, dagger_seed0=bt.dagger[0], dagger_n=bt.dagger[1], beta=0.0,
                          select_seed0=bt.select_b[0], select_n=bt.select_b[1], stop_rule=False)
    raise ValueError(f"stage A or B, not {stage!r}")


def stage_times(c: RoundConfig) -> dict:
    """When the export and the training of a finished stage ended (file times: the export's manifest.json is written
    last; each checkpoint folder when it was saved)."""
    run = find_train_run(c.data / "experiments", c.grid_name, c.label, c.steps)
    if run is None:
        return {}
    def stamp(p: Path) -> str | None:
        return datetime.fromtimestamp(p.stat().st_mtime).isoformat(timespec="seconds") if p.exists() else None

    ckpts = run / "train" / c.label / "checkpoints"
    return {"train_run": str(run), "export_done": stamp(run / "datasets" / c.label / "manifest.json"),
            **{f"checkpoint_{s}": stamp(ckpts / f"{s:06d}") for s in c.candidates if (ckpts / f"{s:06d}").exists()}}


# --- the final model and the test ---------------------------------------------------------------------------------------

def final_choice(bt: BigTest, a: RoundConfig, b: RoundConfig) -> dict:
    """A-best vs B-best on their own selection counts; a tie goes to B. Decided once (final_choice.json)."""
    path = bt.dir / "final_choice.json"
    if path.exists():
        return _read(path)
    sa, sb = _read(a.selection_file), _read(b.selection_file)
    ka, na = sa["counts"][str(sa["chosen_step"])]
    kb, nb = sb["counts"][str(sb["chosen_step"])]
    pick = ("B", sb) if kb >= ka else ("A", sa)
    choice = {"stage": pick[0], "checkpoint": pick[1]["checkpoint"], "chosen_step": pick[1]["chosen_step"],
              "A": {"count": [ka, na], "step": sa["chosen_step"], "seeds": sa["seeds"]},
              "B": {"count": [kb, nb], "step": sb["chosen_step"], "seeds": sb["seeds"]},
              "rule": "A-best vs B-best on their own selection counts; a tie goes to B",
              "decided": datetime.now().isoformat(timespec="seconds")}
    _write(path, choice)
    return choice


def test_cmd(bt: BigTest, checkpoint: str) -> list[str]:
    seed0, n = bt.test
    if not set(range(seed0, seed0 + n)) <= set(BIGTEST_TEST_SEEDS):
        raise ValueError(f"the big test runs on {BIGTEST_TEST_SEEDS.start}-{BIGTEST_TEST_SEEDS.stop - 1} only")
    return [str(bt.isaac_py), str(bt.repo / "sim_eval" / "scripts" / "eval_cells.py"), "--run-id", bt.test_run_id,
            "--checkpoint", f"bigtest_final={checkpoint}", "--seed0", str(seed0), "--n", str(n),
            "--start-state", str(bt.start_state), "--start-pose", "dataset", "--port", str(bt.port),
            *bt.inference_args, *(["--trace"] if bt.trace else [])]


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    p = k / n
    c = (p + z * z / (2 * n)) / (1 + z * z / n)
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n)
    return round(c - h, 3), round(c + h, 3)


# --- the chain ----------------------------------------------------------------------------------------------------------

def plan(bt: BigTest, log: Callable[[str], None], runner: Runner | None = None,
         gpu_sampler: Callable[[Path], object] | None = None, stop_after: str | None = None) -> list[Phase]:
    """The chain's stages as phases (each restartable: a finished stage is skipped). runner / gpu_sampler: tests'."""
    state: dict = {}

    def human() -> dict:
        if "human" not in state:
            state["human"] = human_choice(bt)
        return state["human"]

    def cfg(stage: str) -> RoundConfig:
        return stage_config(bt, stage, human())

    def run_stage(stage: str) -> Callable[[], None]:
        def go() -> None:
            c = cfg(stage)
            run_phases(plan_round(c, lambda m: log(f"[{stage}] {m}"), runner=runner, gpu_sampler=gpu_sampler),
                       lambda m: log(f"[{stage}] {m}"))
            times = stage_times(c)
            sel = _read(c.selection_file)
            log(f"[bigtest] stage {stage}: selection {sel['counts']} on {sel['seeds']}, chose {sel['chosen_step']}; "
                f"times {times}")
        return go

    def stage_done(stage: str) -> Callable[[], bool]:
        return lambda: (bt.dir / "human_choice.json").exists() and cfg(stage).selection_file.exists()

    def check_teacher() -> None:
        got = sha256(bt.teacher_checkpoint)
        if got != bt.teacher_sha256.upper():
            raise PhaseFailed(f"teacher checkpoint {bt.teacher_checkpoint} sha256 {got} != {bt.teacher_sha256}")
        h = human()
        log(f"[bigtest] human: {h['reason']} -> {h['cell']} ({h['grid']})")
        info = copy_teacher(bt, log)
        log(f"[bigtest] teacher: {info['episodes']} episodes, {info['files']} files, {info['bytes']} bytes reused "
            f"from {info['source']}; teacher sha256 {got[:8]}...{got[-3:]} as on 10-22")

    def run_test() -> None:
        a, b = cfg("A"), cfg("B")
        choice = final_choice(bt, a, b)
        log(f"[bigtest] final model: stage {choice['stage']} step {choice['chosen_step']} (A {choice['A']['count']}, "
            f"B {choice['B']['count']}; a tie goes to B): {choice['checkpoint']}")
        try:
            guard_final(bt.test_results, choice["checkpoint"])
        except RuntimeError as e:
            raise PhaseFailed(str(e)) from e
        cmd = test_cmd(bt, choice["checkpoint"])
        log("[bigtest] test command: " + " ".join(cmd))
        run = runner or (lambda c, env, f: subprocess_runner(c, env, f, cwd=bt.repo))
        env = dict(os.environ, PYTHONPATH=f"{bt.repo / 'src'}{os.pathsep}{bt.repo}", DATA_DIR=str(bt.repo / "data"))
        rc = run(cmd, env, bt.dir / "test" / "test.log")
        if not results_complete(bt.test_results, *bt.test):
            raise PhaseFailed(f"test: eval_cells exit {rc}, results incomplete ({bt.test_results})")
        k, n = count_successes(bt.test_results, *bt.test)
        lo, hi = wilson(k, n)
        _write(bt.dir / "test_result.json", {"successes": k, "n": n, "seeds": [bt.test[0], bt.test[0] + n - 1],
                                              "wilson95": [lo, hi], "final": choice,
                                              "finished": datetime.now().isoformat(timespec="seconds")})
        log(f"[bigtest] RESULT {k}/{n} on {bt.test[0]}-{bt.test[0] + n - 1}; Wilson 95% {lo}-{hi}")

    phases = [
        Phase("human+teacher", lambda: (bt.dir / "human_choice.json").exists() and
              (bt.dir / "r0" / "teacher_copy.json").exists(), check_teacher,
              "T3's held-human verdict (floor 80/110) and the reused @600 teacher rollouts"),
        Phase("A", stage_done("A"), run_stage("A"),
              f"round 0: export, train {bt.steps}, select {list(bt.candidates)} on "
              f"{bt.select_a[0]}-{sum(bt.select_a) - 1}"),
        Phase("B", stage_done("B"), run_stage("B"),
              f"round 1: DAgger on {bt.dagger[0]}-{sum(bt.dagger) - 1}, export, train {bt.steps}, select on "
              f"{bt.select_b[0]}-{sum(bt.select_b) - 1}"),
        Phase("test", (bt.dir / "test_result.json").exists, run_test,
              f"the final model on {bt.test[0]}-{sum(bt.test) - 1}, once"),
    ]
    if stop_after is not None:
        names = [p.name for p in phases]
        if stop_after not in names:
            raise ValueError(f"stop_after {stop_after!r}: the chain has {names}")
        phases = phases[: names.index(stop_after) + 1]
    return phases

