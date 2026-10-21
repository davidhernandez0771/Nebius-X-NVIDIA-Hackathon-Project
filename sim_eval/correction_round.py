"""The practice-and-correct round (sim_worker.corrections) as resumable phases for one GPU command. Pure parts.

    C:\\isaac\\env_isaaclab\\Scripts\\python.exe sim_eval\\scripts\\correction_round.py --run-id <id> ^
        --checkpoint <policy pretrained_model> --source-cell <its cell label> --base-grid <its experiment grid.json> ^
        --start-state <its dataset root> [--practice-seed0 5200 --practice-n 60] [--retake scripted|human|both]

Phases (a finished one is skipped on a re-run):
  preflight   inputs exist, enough disk
  practice    the policy on practice seeds (5200-5279 only; never the test seeds), serial, traced: every rollout
              saved step by step (DATA_DIR/evals/<run>/practice_<cell>_traces/seed_<s>.npz), each step a checkpoint
              recovery.py can restore
  candidates  each rollout's failure moments and the restorable state ~1 s before each (sim_worker.corrections):
              candidates.json; the scripted retakes' states (correction_states.json); with --retake human|both, a
              "retake from here" per candidate in DATA_DIR/corrections/queue/ (GET /corrections/queue)
  corrections the scripted expert finishing from each state, replayed with cameras in a fresh DATA_DIR
              (data/corrections_<run>), verified by the unchanged check, passport lineage "recovery-<cell>"
              (sim_worker/scripts/recovery_dataset.py)
  provenance  per correction: failure, rewind, rollout, checkpoint, verdict (provenance.json)
  grid        the base cell + every verified correction, cell "corrections_<k>" (data/experiments/grids/<run>.json),
              ready for lerobot_tools.experiments
Training and the test are separate commands (the note prints them): a correction arm is pre-registered first.
"""

from __future__ import annotations

import json
import os
import shutil
from collections.abc import Callable
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Literal


from sim_eval.overnight import PRACTICE_SEEDS, Phase, PhaseFailed, Runner, results_complete, subprocess_runner
from sim_eval.recording import load_trace
from sim_eval.scenes import eval_scenes
from sim_worker.corrections import (
    CorrectionCandidate, RetakeQueue, correction_candidates, corrections_grid, provenance_rows, retake_item,
)

Retake = Literal["scripted", "human", "both"]


@dataclass(frozen=True)
class RoundConfig:
    repo: Path
    run_id: str
    isaac_py: Path
    lerobot_py: Path
    checkpoint: Path  # the policy's pretrained_model
    source_cell: str  # its cell label in base_grid
    base_grid: Path  # the experiment grid the policy was trained from
    start_state: Path  # the dataset root whose start_state.json the evals use
    practice_seed0: int = 5200
    practice_n: int = 60
    retake: Retake = "both"
    rewind_s: float = 1.0
    max_back_s: float = 3.0
    min_corrections: int = 10
    min_free_gb: float = 20.0

    def with_(self, **kw) -> "RoundConfig":
        return replace(self, **kw)

    @property
    def data(self) -> Path:
        return self.repo / "data"

    @property
    def evals_dir(self) -> Path:
        return self.data / "evals" / self.run_id

    @property
    def practice_cell(self) -> str:
        return f"practice_{self.source_cell}"

    @property
    def practice_results(self) -> Path:
        return self.evals_dir / f"{self.practice_cell}.json"

    @property
    def traces_dir(self) -> Path:
        return self.evals_dir / f"{self.practice_cell}_traces"

    @property
    def candidates_file(self) -> Path:
        return self.evals_dir / "candidates.json"

    @property
    def states_file(self) -> Path:
        return self.evals_dir / "correction_states.json"

    @property
    def manifest_file(self) -> Path:
        return self.evals_dir / "correction_manifest.json"

    @property
    def provenance_file(self) -> Path:
        return self.evals_dir / "provenance.json"

    @property
    def round_data(self) -> Path:
        return self.data / f"corrections_{self.run_id}"  # a fresh DATA_DIR for the replayed corrections

    @property
    def grid_file(self) -> Path:
        return self.data / "experiments" / "grids" / f"{self.run_id}.json"

    @property
    def scripted(self) -> bool:
        return self.retake in ("scripted", "both")


def practice_cmd(c: RoundConfig) -> list[str]:
    seeds = range(c.practice_seed0, c.practice_seed0 + c.practice_n)
    if not set(seeds) <= set(PRACTICE_SEEDS):
        raise ValueError(f"the correction round uses practice seeds {PRACTICE_SEEDS.start}-{PRACTICE_SEEDS.stop - 1} "
                         f"only, not {seeds.start}-{seeds.stop - 1}")
    return [str(c.isaac_py), str(c.repo / "sim_eval" / "scripts" / "eval_cells.py"), "--run-id", c.run_id,
            "--checkpoint", f"{c.practice_cell}={c.checkpoint}", "--seed0", str(c.practice_seed0), "--n",
            str(c.practice_n), "--start-state", str(c.start_state), "--start-pose", "dataset", "--trace"]


def corrections_cmd(c: RoundConfig) -> list[str]:
    return [str(c.isaac_py), str(c.repo / "sim_worker" / "scripts" / "recovery_dataset.py"), "--states",
            str(c.states_file), "--manifest", str(c.manifest_file)]


def round_candidates(c: RoundConfig) -> tuple[list[CorrectionCandidate], dict[int, object]]:
    """Every practice rollout's correction candidates, and each seed's scene."""
    cands, scenes = [], {}
    for f in sorted(c.traces_dir.glob("seed_*.npz")):
        seed = int(f.stem.split("_")[1])
        if seed not in PRACTICE_SEEDS:
            raise ValueError(f"{f}: corrections come from practice seeds only, not {seed}")
        scene = eval_scenes(1, seed)[0]
        scenes[seed] = scene
        cands += correction_candidates(load_trace(f), scene, source=c.source_cell, rewind_s=c.rewind_s,
                                       max_back_s=c.max_back_s)
    return cands, scenes


def plan_round(c: RoundConfig, log: Callable[[str], None], runner: Runner | None = None) -> list[Phase]:
    if runner is None:
        def runner(cmd, env, log_file):
            rc = subprocess_runner(cmd, env, log_file, cwd=c.repo)
            log(f"[corrections]   exit {rc}: {' '.join(cmd[:3])} ... (log {log_file.name})")
            return rc
    logs = c.evals_dir / "logs"
    flags: dict = {}

    def env(data_dir: Path) -> dict:
        return dict(os.environ, PYTHONPATH=f"{c.repo / 'src'}{os.pathsep}{c.repo}", DATA_DIR=str(data_dir))

    def preflight() -> None:
        problems = [f"missing {p}" for p in (c.isaac_py, c.lerobot_py, c.checkpoint, c.base_grid,
                                              c.start_state / "start_state.json") if not Path(p).exists()]
        free_gb = shutil.disk_usage(c.data).free / 1e9 if c.data.exists() else 0.0
        if free_gb < c.min_free_gb:
            problems.append(f"only {free_gb:.0f} GB free on the data disk, need {c.min_free_gb:.0f}")
        if problems:
            raise PhaseFailed("preflight: " + "; ".join(problems))
        practice_cmd(c)  # the seed rule, before anything runs
        flags["preflight"] = True

    def practice() -> None:
        if runner(practice_cmd(c), env(c.data), logs / "practice.log") != 0:
            raise PhaseFailed("practice: eval_cells failed; see logs/practice.log")

    def candidates() -> None:
        cands, scenes = round_candidates(c)
        kept = [x for x in cands if x.state is not None]
        c.candidates_file.parent.mkdir(parents=True, exist_ok=True)
        c.candidates_file.write_text(json.dumps({"run_id": c.run_id, "checkpoint": str(c.checkpoint),
                                                 "candidates": [x.model_dump(mode="json") for x in cands]}, indent=1),
                                     encoding="utf-8")
        c.states_file.write_text(json.dumps({"source": c.source_cell, "states": [
            x.state.model_dump() for x in kept] if c.scripted else []}, indent=1), encoding="utf-8")
        if c.retake in ("human", "both"):
            queue = RetakeQueue(c.data)
            for x in kept:
                queue.add(retake_item(x, scenes[x.state.seed], checkpoint=str(c.checkpoint),
                                      trace_path=(c.traces_dir / f"seed_{x.state.seed}.npz").as_posix(),
                                      round_id=c.run_id))
        kinds: dict[str, int] = {}
        for x in cands:
            kinds[x.moment.kind] = kinds.get(x.moment.kind, 0) + 1
        log(f"[corrections]   {len(cands)} failure moments {kinds}; {len(kept)} restorable")

    def corrections() -> None:
        c.round_data.mkdir(parents=True, exist_ok=True)
        if runner(corrections_cmd(c), env(c.round_data), logs / "corrections.log") != 0:
            raise PhaseFailed("corrections: recovery_dataset failed; see logs/corrections.log")

    def provenance() -> None:
        cands = [CorrectionCandidate.model_validate(x) for x in
                 json.loads(c.candidates_file.read_text(encoding="utf-8"))["candidates"]]
        rows = json.loads(c.manifest_file.read_text(encoding="utf-8"))["rows"]
        prov = provenance_rows(rows, cands, checkpoint=str(c.checkpoint), traces_dir=c.traces_dir.as_posix(),
                               round_id=c.run_id)
        for p in prov:
            if p["ep_dir"] and Path(p["ep_dir"]).is_dir():
                (Path(p["ep_dir"]) / "correction.json").write_text(json.dumps(p, indent=1), encoding="utf-8")
        c.provenance_file.write_text(json.dumps({
            "run_id": c.run_id, "checkpoint": str(c.checkpoint), "source_cell": c.source_cell,
            "practice_seeds": [c.practice_seed0, c.practice_seed0 + c.practice_n - 1], "rewind_s": c.rewind_s,
            "corrections": prov}, indent=1), encoding="utf-8")

    def grid() -> None:
        rows = json.loads(c.manifest_file.read_text(encoding="utf-8"))["rows"]
        g = corrections_grid(json.loads(c.base_grid.read_text(encoding="utf-8")), rows, name=c.run_id,
                             min_corrections=c.min_corrections, cell_label=c.source_cell)
        c.grid_file.parent.mkdir(parents=True, exist_ok=True)
        c.grid_file.write_text(json.dumps(g, indent=1), encoding="utf-8")

    phases = [
        Phase("preflight", lambda: flags.get("preflight", False), preflight, "inputs and disk"),
        Phase("practice", lambda: results_complete(c.practice_results, c.practice_seed0, c.practice_n), practice,
              f"{c.source_cell} on practice seeds {c.practice_seed0}-{c.practice_seed0 + c.practice_n - 1}, traced"),
        Phase("candidates", lambda: c.candidates_file.exists() and c.states_file.exists(), candidates,
              f"failure moments and the state {c.rewind_s:g} s before each"),
    ]
    if c.scripted:
        phases += [
            Phase("corrections", lambda: c.manifest_file.exists(), corrections,
                  "the scripted expert finishing from each state, replayed and verified"),
            Phase("provenance", lambda: c.provenance_file.exists(), provenance, "where each correction came from"),
            Phase("grid", lambda: c.grid_file.exists(), grid, "the base cell + every verified correction"),
        ]
    return phases
