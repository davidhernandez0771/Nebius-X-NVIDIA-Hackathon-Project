"""One command for the whole human-demo experiment: saved demos in, a results JSON the Results page reads out.

    uv run --with pillow python scripts/run_human_demo_experiment.py --name <name> --tag "human_2026*" ^
        [--data-dir <DATA_DIR>] [--ids a,b,c] [--smoke] [--until <stage>] [--sim-until <step>] ^
        [--replay-path achieved|commanded] [--no-nemotron] [--publish-results]

Stages, in order. Each writes a done-marker under DATA_DIR/human_exp/<name>/stages/ and a re-run resumes:
  select    the demos (--ids, or --tag: an fnmatch pattern over human demo ids), frozen with each demo.json's
            SHA-256 in config.json together with every setting; preregistration.md is written from it, before
            anything is trained. Only demo.json is copied into the experiment's own DemoStore (<exp>/store):
            the user's store, its live episodes and diagnoses are never written.
            --replay-path achieved (the default; commanded with --smoke): the copy replays the tool pose the
            arm reached (the live episode's steps.npz, 50 Hz), with the hand targets kept as Demo.commanded and
            a replay_path.json saying why. Demos recorded before Demo.commanded hold the targets, which the arm
            lagged: replaying them was another motion (live test #10: 0/10 in the bin on replay, 10/10 live).
            A demo without a live episode is refused; stand-ins need --replay-path commanded.
  sim       one sim worker (Isaac, cameras, Franka), started and stopped here, under the GPU lock:
              physics   replay every demo as recorded: Isaac's verdict on what the person did;
              repair    perfect it with the rules (app.jobs.perfect_stored_demo -> "<id>_rules", verified);
              align     start every training episode at home (sim_worker.human_exp.align_home): "<id>_home"
                        (raw arm, no repairs) and "<id>_rules_home" (the repaired one);
              multiply  --variants new scenes per repaired demo, rehomed like sprint 6's home-start variants,
                        each replayed and kept only if it verifies ("<id>_rules_home_m<seed>").
            --sim-until physics|repair|align stops after that step (the stages after sim don't run either);
            a later run without it carries on from the markers.
  grid      raw_<n> and perfected_multiply_<n> for lerobot_tools.experiments (checked with build_manifest).
  nemotron  T3's labeler and judge (app.ai.intent, demo_pipeline.intent.review_verdict): a label per human
            demo, a match for --judge-copies verified copies each; a ReviewVerdict card next to each passport in
            the experiment store. Billed, capped at --max-cost-usd. Physics decides; a failed call is
            "unavailable" and the run goes on.
  train     ACT on both cells, --steps each (lerobot venv, lerobot_tools.experiments), under the GPU lock.
  eval      the serial eval (sim_eval/scripts/eval_cells.py) of both cells on seeds --eval-seed0 ..
            + --eval-n - 1, both from the raw dataset's start state (--start-pose dataset), under the GPU lock.
  results   success on the registered seeds only, Wilson 95% CIs, the two-sided Fisher exact p, written to
            <exp>/results.json in the shape web/src/pm/results/results.ts reads (plus an "experiment" block).
            --publish-results also copies it to DATA_DIR/results/results.json (the old one is kept as .bak).

--smoke: 2000 ACT steps and 5 eval seeds unless given, and "sample": true in the results, so the page shows it as
sample data: a smoke run proves the stages work, it measures nothing.

GPU lock (C:\\dev\\gpu.lock): before the sim, train and eval stages; a live PID in it is re-checked every 5 min,
and it is deleted when the stage ends, also on failure. Every GPU stage also holds sim_worker.keepawake.KeepAwake.
Exit: 0 done (or stopped at --until), 1 refused, 2 stopped (a worker or child process failed; re-run to resume).
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import shutil
import subprocess
import sys
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterator

import numpy as np

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))  # sim_worker, lerobot_tools

from app.jobs import _copy_episode, is_infrastructure, perfect_stored_demo, record_raw, stored_raw  # noqa: E402
from app.sim_client import SimWorkerClient, SimWorkerError  # noqa: E402
from demo_pipeline import PIPELINE_VERSION  # noqa: E402
from demo_pipeline.multiply import sample_scene  # noqa: E402
from demo_pipeline.results import build_results  # noqa: E402
from demo_pipeline.schemas import Demo, Passport, Trajectory, VerificationResult  # noqa: E402
from demo_pipeline.sim_protocol import ReplayRequest  # noqa: E402
from demo_pipeline.store import DemoStore, write_atomic  # noqa: E402
from sim_worker.human_exp import (MULT_CONDITION, RAW_CONDITION, achieved_demo, align_home, cells,  # noqa: E402
                                  compare, config_diff, demo_sha256, headline, select_ids, variant_seed,
                                  variant_trajectory)

ISAAC_PY = Path(r"C:\isaac\env_isaaclab\Scripts\python.exe")
LEROBOT_PY = Path(r"C:\venvs\lerobot\Scripts\python.exe")
STAGES = ("select", "sim", "grid", "nemotron", "train", "eval", "results")
ROBOT = "franka"
BATCH = 8
DEFAULTS = {"variants": 10, "steps": 30_000, "save_freq": 2500, "eval_n": 40, "eval_seed0": 5020}
SIM_STEPS = ("physics", "repair", "align", "multiply")
REPLAY_PATHS = ("achieved", "commanded")
SMOKE = {"steps": 2000, "save_freq": 2000, "eval_n": 5}
LABEL_FRAMES, JUDGE_FRAMES, MODEL_SIZE = 8, 4, 256  # as T3's pre-registered test (scripts/intent_eval.py)


class Refused(ValueError):
    """Nothing was run: bad arguments, a changed config, a missing prerequisite."""


class Stop(RuntimeError):
    """A worker or child process failed mid-stage; what finished is kept, and a re-run resumes."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _write_json(path: Path, data: Any) -> None:
    write_atomic(Path(path), json.dumps(data, indent=1, default=str))


def _read_json(path: Path) -> Any | None:
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


@dataclass
class Deps:
    """Everything with a side effect outside the experiment folder, so the tests can fake it."""

    user_store: DemoStore
    sim_session: Callable[[], Any]  # () -> context manager yielding a SimWorkerClient-like object
    gpu_stage: Callable[[str], Any]  # (task) -> context manager: GPU lock + KeepAwake (+ Isaac free)
    run: Callable[[list[str], Path], int]  # (command, log file) -> exit code; DATA_DIR/PYTHONPATH set by the impl
    judge: Any = None  # .label(frames, summary) / .judge(h_frames, h_summary, c_frames, c_summary); None: off
    clip: Callable[[Path, int], tuple[list, Any]] | None = None  # (episode dir, k frames) -> (frames, Summary)
    log: Callable[[str], None] = print


@dataclass
class Experiment:
    data: Path
    name: str
    deps: Deps
    config: dict = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.data = Path(self.data)
        self.root = self.data / "human_exp" / self.name
        self.stages = self.root / "stages"
        self.store = DemoStore(self.root / "store")

    # --- helpers ------------------------------------------------------------------------------------

    def log(self, msg: str) -> None:
        line = f"[human-exp {datetime.now():%H:%M:%S}] {msg}"
        self.deps.log(line)
        self.root.mkdir(parents=True, exist_ok=True)
        with (self.root / "run.log").open("a", encoding="utf-8") as f:
            f.write(line + "\n")

    def marker(self, *parts: str) -> Path:
        return self.stages.joinpath(*parts[:-1], parts[-1] + ".json")

    @property
    def ids(self) -> list[str]:
        return self.config["ids"]

    @property
    def grid_name(self) -> str:
        return f"hx_{self.name}"

    def cell_names(self) -> tuple[str, str]:
        n = self.config["n_human"]
        return f"{RAW_CONDITION}_{n}", f"{MULT_CONDITION}_{n}"

    def has_episode(self, id: str) -> bool:
        return self.store.has_demo(id) and (self.store.episode_dir(id) / "episode.json").is_file()

    def stored_verification(self, id: str) -> VerificationResult | None:
        pp = self.store.get_passport(id) if self.store.has_demo(id) else None
        return None if pp is None else pp.verification

    # --- select -------------------------------------------------------------------------------------

    def select(self, *, ids: list[str] | None, tag: str | None, settings: dict, force_config: bool = False) -> None:
        path = self.root / "config.json"
        old = _read_json(path)
        if old is not None and ids is None and tag is None:  # a resume: the frozen selection
            chosen, tag = old["ids"], old.get("tag")
        else:
            chosen = select_ids(self.deps.user_store, ids=ids, tag=tag)
        config = {
            "name": self.name, "ids": chosen, "n_human": len(chosen), "tag": tag,
            "demo_sha256": {id: demo_sha256(self.deps.user_store, id) for id in chosen},
            "robot": ROBOT, "repair": "rules", "batch_size": BATCH, "policy": "act",
            "start_alignment": "every training episode starts at home: sim_worker.human_exp.align_home",
            "eval_start": "both cells from the raw dataset's start_state.json, --start-pose dataset",
            "variant_seeds": "3100 + 100 * source index + variant index",
            "test": "fisher_exact_two_sided", "alpha": 0.05, "ci": "wilson_95",
            "pipeline_version": PIPELINE_VERSION, **settings,
        }
        config["replay_path"] = settings.get("replay_path", "achieved")
        if config["replay_path"] not in REPLAY_PATHS:
            raise Refused(f"replay_path must be one of {REPLAY_PATHS}, got {config['replay_path']!r}")
        # The achieved path is where the arm was at the end of each step: commanding pose k at step k reaches it a
        # step late (~0.5 cm at a grasp in live test #10, enough to turn edge grasps into misses), so command k+1.
        config["replay_lookahead"] = int(settings.get("replay_lookahead",
                                                      1 if config["replay_path"] == "achieved" else 0))
        if config["replay_lookahead"] < 0:
            raise Refused(f"replay_lookahead must be >= 0, got {config['replay_lookahead']}")
        if config["replay_path"] == "achieved":
            config["steps_sha256"] = {id: self._live_steps_sha256(id) for id in chosen}
        if old is not None:
            diff = [k for k in config_diff(old, config) if k != "frozen_at"]
            if diff and not force_config:
                raise Refused(f"{path} was frozen with other settings ({', '.join(diff)}); use a new --name, "
                              f"or --force-config to overwrite it (the stage markers stay)")
            config["frozen_at"] = old.get("frozen_at", _now()) if not diff else _now()
        else:
            config["frozen_at"] = _now()
        self.config = config
        _write_json(path, config)
        (self.root / "preregistration.md").write_text(preregistration(config), encoding="utf-8")
        for id in chosen:  # demo.json only: the user's episode, passport and diagnosis stay where they are
            dst = self.root / "store" / "demos" / id / "demo.json"
            if dst.is_file():
                continue
            dst.parent.mkdir(parents=True, exist_ok=True)
            if config["replay_path"] == "commanded":
                shutil.copyfile(self.deps.user_store.root / "demos" / id / "demo.json", dst)
                continue
            user_demo = self.deps.user_store.get_demo(id)
            with np.load(self._live_steps(id)) as steps:
                demo = achieved_demo(user_demo, steps["ee_pos"], steps["ee_quat"])
            self.store.save_demo(demo)
            _write_json(dst.parent / "replay_path.json", {
                "replay_path": "achieved",
                "why": ("the user's demo.json holds the hand targets the arm lagged (2.5-5 cm in live test #10), and "
                        "replaying them was another motion (0/10 in the bin on replay, 10/10 live); this copy "
                        "replays the tool pose the arm reached, and keeps the targets as `commanded`"
                        if user_demo.commanded is None else "the user's demo.json already holds the achieved path"),
                "from": str(self._live_steps(id)), "steps_sha256": config["steps_sha256"][id],
                "user_demo_sha256": config["demo_sha256"][id], "at": _now()})
        _write_json(self.marker("select"), {"ids": chosen, "at": _now()})
        self.log(f"select: {len(chosen)} demos: {', '.join(chosen)} (replaying the {config['replay_path']} path)")

    def _live_steps(self, id: str) -> Path:
        return self.deps.user_store.episode_dir(id) / "steps.npz"

    def _live_steps_sha256(self, id: str) -> str:
        path = self._live_steps(id)
        if not path.is_file():
            raise Refused(f"{id}: no live episode ({path}) to take the achieved path from; a demo without one "
                          f"(a stand-in) needs --replay-path commanded")
        return hashlib.sha256(path.read_bytes()).hexdigest()

    # --- sim: physics, repair, align, multiply --------------------------------------------------------

    def sim(self, until: str = "multiply") -> bool:
        """physics, repair, align, multiply, stopping after `until`. True once all four are done."""
        if self.marker("sim").is_file():
            self.log("sim: done earlier")
            return True
        steps = (self.physics, self.repair, self.align, self.multiply)
        with self.deps.sim_session() as client:
            health = client.health()
            if not (health.ok and health.cameras and ROBOT in health.robots):
                raise Stop(f"the sim worker can't record {ROBOT} camera episodes: {health}")
            for step in steps[: SIM_STEPS.index(until) + 1]:
                try:
                    step(client)
                except SimWorkerError as e:
                    raise Stop(f"{step.__name__}: the sim worker failed ({e}); re-run to resume") from e
        if until != SIM_STEPS[-1]:
            self.log(f"sim: stopped after {until} (--sim-until); nothing after it ran")
            return False
        _write_json(self.marker("sim"), {"at": _now(), **self.sim_summary()})
        return True

    def physics(self, client) -> None:
        for id in self.ids:
            if self.marker("physics", id).is_file():
                continue
            demo = self.store.get_demo(id)
            raw = stored_raw(self.store, id, need_cameras=True) or record_raw(self.store, client, demo,
                                                                              record_cameras=True)
            v = raw.verification
            _write_json(self.marker("physics", id), {"id": id, "success": v.success, "reasons": v.reasons,
                                                     "steps": raw.n_steps, "duration": v.duration})
            self.log(f"physics {id}: {'verified' if v.success else 'failed ' + ','.join(v.reasons)}")

    def repair(self, client) -> None:
        for id in self.ids:
            if self.marker("repair", id).is_file():
                continue
            raw = stored_raw(self.store, id, need_cameras=True)
            summary = perfect_stored_demo(self.store, client, id, "rules", raw=raw, record_cameras=True)
            _write_json(self.marker("repair", id), summary)
            self.log(f"repair {id}: {summary['status']} ({len(summary['repairs'])} repairs, "
                     f"{summary['attempts']} verification(s))")

    def _replay_into_store(self, client, new_id: str, parent_id: str, traj: Trajectory, scene, *, source: str,
                           variant_seed: int | None = None) -> VerificationResult:
        resp = client.replay(ReplayRequest(trajectory=traj, scene=scene, record_cameras=True, out_name=new_id))
        parent_pp = self.store.get_passport(parent_id)
        self.store.save_demo(Demo(id=new_id, source=source, parent_id=parent_id, trajectory=traj, scene=scene,
                                  human_seconds=0.0))
        passport = Passport(demo_id=new_id, lineage=self.store.lineage(new_id),
                            repairs_applied=parent_pp.repairs_applied if parent_pp else [],
                            diagnosis_source=parent_pp.diagnosis_source if parent_pp else "none",
                            model_id=parent_pp.model_id if parent_pp else None, variant_seed=variant_seed,
                            robot=scene.robot, verification=resp.verification, pipeline_version=PIPELINE_VERSION)
        self.store.save_passport(new_id, passport)
        notes: list[str] = []
        if not _copy_episode(resp.ep_dir, self.store.episode_dir(new_id), notes, passport):
            raise Stop(f"{new_id}: {'; '.join(notes)} (the sim worker must share this disk)")
        return resp.verification

    def _align_one(self, client, id: str, parent: str, new_id: str) -> dict:
        demo = self.store.get_demo(parent)
        try:
            aligned, k = align_home(demo.trajectory)
        except ValueError as e:
            return {"id": new_id, "success": False, "reasons": ["not_aligned"], "error": str(e), "k": None}
        if self.has_episode(new_id):
            v = self.stored_verification(new_id)
        else:
            try:
                v = self._replay_into_store(client, new_id, parent, aligned, demo.scene, source="repaired")
            except SimWorkerError as e:
                if is_infrastructure(e):
                    raise
                return {"id": new_id, "success": False, "reasons": ["sim_error"], "error": str(e), "k": k}
        return {"id": new_id, "success": v.success, "reasons": v.reasons, "k": k}

    def align(self, client) -> None:
        for id in self.ids:
            if self.marker("align", id).is_file():
                continue
            row = {"raw": self._align_one(client, id, id, f"{id}_home"), "neat": None}
            rep = _read_json(self.marker("repair", id)) or {}
            if rep.get("status") in ("perfected", "kept"):
                row["neat"] = self._align_one(client, id, rep["output_demo_id"], f"{rep['output_demo_id']}_home")
            _write_json(self.marker("align", id), row)
            self.log(f"align {id}: raw {row['raw']['success']}, repaired "
                     f"{None if row['neat'] is None else row['neat']['success']}")

    def multiply(self, client) -> None:
        n_var = self.config["variants"]
        for i, id in enumerate(self.ids):
            path = self.marker("multiply", id)
            mark = _read_json(path) or {"source": None, "attempts": [], "error": None}
            if mark.get("done"):
                continue
            neat = (_read_json(self.marker("align", id)) or {}).get("neat")
            if not neat or not neat["success"]:
                mark.update(done=True, error="no verified repaired demo to multiply")
                _write_json(path, mark)
                continue
            src_id, k = neat["id"], neat["k"]
            src = self.store.get_demo(src_id)
            mark["source"] = src_id
            done = {a["seed"] for a in mark["attempts"]}
            for j in range(n_var):
                seed = variant_seed(i, j)
                if seed in done:
                    continue
                dst = sample_scene(np.random.default_rng(seed), ROBOT, seed)
                vid = f"{src_id}_m{seed:04d}"
                try:
                    vt = variant_trajectory(src.trajectory, k, src.scene, dst)
                except ValueError as e:
                    mark["error"] = str(e)
                    break
                try:
                    v = self._replay_into_store(client, vid, src_id, vt, dst, source="variant", variant_seed=seed)
                    row = {"seed": seed, "id": vid if v.success else None, "success": v.success,
                           "reasons": v.reasons}
                except SimWorkerError as e:
                    if is_infrastructure(e):
                        _write_json(path, mark)
                        raise
                    row = {"seed": seed, "id": None, "success": False, "reasons": ["sim_error"]}
                mark["attempts"].append(row)
                _write_json(path, mark)  # after every variant: a crash loses at most one replay
            mark["done"] = True
            _write_json(path, mark)
            ok = sum(a["success"] for a in mark["attempts"])
            self.log(f"multiply {id}: {ok}/{len(mark['attempts'])} variants verified"
                     + (f" (stopped: {mark['error']})" if mark["error"] else ""))

    def sim_summary(self) -> dict:
        rows = {id: {"physics": _read_json(self.marker("physics", id)),
                     "repair": (_read_json(self.marker("repair", id)) or {}).get("status"),
                     "align": _read_json(self.marker("align", id)),
                     "multiply": _read_json(self.marker("multiply", id))} for id in self.ids}
        attempts = [a for r in rows.values() if r["multiply"] for a in r["multiply"]["attempts"]]
        ok = sum(a["success"] for a in attempts)
        return {
            "physics_verified": sum(bool(r["physics"] and r["physics"]["success"]) for r in rows.values()),
            "repair": {s: sum(r["repair"] == s for r in rows.values()) for s in ("perfected", "kept", "discarded")},
            "multiply": {"robot": ROBOT, "attempts": len(attempts), "successes": ok,
                         "yield": ok / len(attempts) if attempts else None},
            "demos": rows,
        }

    # --- grid ----------------------------------------------------------------------------------------

    def grid(self) -> Path:
        path = self.root / "grid.json"
        raw_dirs, mult_dirs, notes = [], [], []
        for id in self.ids:
            phys = _read_json(self.marker("physics", id)) or {}
            al = _read_json(self.marker("align", id)) or {}
            raw = al.get("raw") or {}
            if self.config["raw_arm"] == "verified" and not phys.get("success"):
                notes.append(f"{id}: raw arm leaves it out (physics check failed)")
            elif self.has_episode(raw.get("id", "")):
                raw_dirs.append(str(self.store.episode_dir(raw["id"])))
            else:
                notes.append(f"{id}: no start-aligned raw episode ({raw.get('error') or raw.get('reasons')})")
            neat = al.get("neat")
            if neat and neat["success"] and self.has_episode(neat["id"]):
                mult_dirs.append(str(self.store.episode_dir(neat["id"])))
                mark = _read_json(self.marker("multiply", id)) or {"attempts": []}
                mult_dirs += [str(self.store.episode_dir(a["id"])) for a in mark["attempts"] if a["success"]]
            else:
                notes.append(f"{id}: nothing in the multiplied arm (repair {((_read_json(self.marker('repair', id)) or {}).get('status'))})")
        grid = {"name": self.grid_name, "cells": cells(raw_dirs, mult_dirs, self.config["n_human"])}
        from lerobot_tools.assemble import Cell, build_manifest

        manifests = {}
        for c in grid["cells"]:
            m = build_manifest(Cell.model_validate(c))  # the integrity check training will run: fail here, not there
            manifests[c["condition"]] = {k: m[k] for k in ("n_episodes", "n_frames", "human_roots")}
        _write_json(path, grid)
        _write_json(self.marker("grid"), {"grid": str(path), "cells": manifests, "notes": notes, "at": _now()})
        self.log(f"grid: raw {manifests[RAW_CONDITION]['n_episodes']} episodes, multiplied "
                 f"{manifests[MULT_CONDITION]['n_episodes']} episodes" + (f"; {len(notes)} notes" if notes else ""))
        return path

    # --- nemotron ------------------------------------------------------------------------------------

    def nemotron(self) -> None:
        if self.marker("nemotron").is_file():
            self.log("nemotron: done earlier")
            return
        from demo_pipeline.intent import review_verdict

        if self.deps.judge is None:
            _write_json(self.marker("nemotron"), {"skipped": "--no-nemotron", "at": _now()})
            self.log("nemotron: skipped")
            return
        cards = {}
        for i, id in enumerate(self.ids):
            path = self.marker("nemotron", id)
            if path.is_file():
                cards[id] = _read_json(path)
                continue
            physics = self.stored_verification(id)
            label = label_error = None
            try:
                h_frames, h_sum = self.deps.clip(self.store.episode_dir(id), LABEL_FRAMES)
                label = self.deps.judge.label(h_frames, h_sum)
            except Exception as e:  # BudgetExceeded, IntentError, an API error: the card says unavailable
                label_error = f"{type(e).__name__}: {e}"
            human_card = review_verdict(physics, label=label, verdict=None, label_error=label_error)
            write_atomic(self.store.root / "demos" / id / "review_verdict.json", human_card.model_dump_json(indent=1))
            row = {"id": id, "card": human_card.model_dump(), "copies": []}
            for copy_id in self.copies_to_judge(id):
                verdict = verdict_error = None
                try:
                    h_frames, h_sum = self.deps.clip(self.store.episode_dir(id), JUDGE_FRAMES)
                    c_frames, c_sum = self.deps.clip(self.store.episode_dir(copy_id), JUDGE_FRAMES)
                    verdict = self.deps.judge.judge(h_frames, h_sum, c_frames, c_sum)
                except Exception as e:
                    verdict_error = f"{type(e).__name__}: {e}"
                card = review_verdict(self.stored_verification(copy_id), label=label, verdict=verdict,
                                      label_error=label_error, verdict_error=verdict_error)
                write_atomic(self.store.root / "demos" / copy_id / "review_verdict.json", card.model_dump_json(indent=1))
                row["copies"].append({"id": copy_id, "card": card.model_dump()})
            _write_json(path, row)
            cards[id] = row
            self.log(f"nemotron {id}: label {human_card.label.status}; "
                     + ", ".join(f"{c['id']} match {c['card']['match']['status']}" for c in row["copies"]))
        _write_json(self.marker("nemotron"), {"at": _now(), **nemotron_summary(cards)})

    def copies_to_judge(self, id: str) -> list[str]:
        """The first --judge-copies verified variants of this demo, or its repaired demo if none verified."""
        mark = _read_json(self.marker("multiply", id)) or {"attempts": []}
        out = [a["id"] for a in mark["attempts"] if a["success"]][: self.config["judge_copies"]]
        neat = ((_read_json(self.marker("align", id)) or {}).get("neat") or {})
        if not out and neat.get("success") and self.config["judge_copies"] > 0:
            out = [neat["id"]]
        return out

    # --- train, eval ---------------------------------------------------------------------------------

    def train(self) -> dict:
        path = self.marker("train")
        done = _read_json(path)
        if done and done.get("ok"):
            self.log(f"train: done earlier (run {done['run_id']})")
            return done
        started = _now()
        cmd = [str(LEROBOT_PY), "-m", "lerobot_tools.experiments", "--grid", str(self.root / "grid.json"),
               "--steps", str(self.config["steps"]), "--batch-size", str(BATCH),
               "--save-freq", str(min(self.config["save_freq"], self.config["steps"]))]
        self.log(f"train: {' '.join(cmd)}")
        with self.deps.gpu_stage(f"human-exp:{self.name}:train"):
            rc = self.deps.run(cmd, self.root / "logs" / "train.log")
        rows = [r for r in _jsonl(self.data / "results" / "registry.jsonl")
                if r.get("grid") == self.grid_name and (r.get("created") or "") >= started[:19]]
        run_ids = sorted({r["run_id"] for r in rows})
        if not run_ids:
            raise Stop(f"training wrote no registry row (exit {rc}); see {self.root / 'logs' / 'train.log'}")
        run_id = run_ids[-1]
        rows = {r["cell"]["name"]: r for r in rows if r["run_id"] == run_id}
        ok = rc == 0 and all(rows.get(c, {}).get("status") == "ok" for c in self.cell_names())
        done = {"run_id": run_id, "exit": rc, "ok": ok, "at": _now(),
                "cells": {c: {k: r.get(k) for k in ("status", "checkpoint", "dataset", "n_episodes", "n_frames",
                                                    "final_loss", "train_time_s", "error")} for c, r in rows.items()}}
        _write_json(path, done)
        if not ok:
            raise Stop(f"training failed (exit {rc}): {done['cells']}")
        self.log(f"train: run {run_id}: " + ", ".join(f"{c} loss {r['final_loss']}" for c, r in done["cells"].items()))
        return done

    def eval(self) -> dict:
        train = _read_json(self.marker("train"))
        raw_cell, _ = self.cell_names()
        run_id, seed0, n = train["run_id"], self.config["eval_seed0"], self.config["eval_n"]
        start_state = train["cells"][raw_cell]["dataset"]
        evals = self.data / "evals" / run_id
        if all(self._eval_headline(evals, c)["complete"] for c in self.cell_names()):
            self.log("eval: done earlier")
        else:
            cmd = [str(ISAAC_PY), str(REPO / "sim_eval" / "scripts" / "eval_cells.py"), "--run-id", run_id,
                   "--n", str(n), "--seed0", str(seed0), "--start-state", str(start_state), "--start-pose", "dataset",
                   "--registry", str(self.data / "results" / "registry.jsonl")]
            self.log(f"eval: {' '.join(cmd)}")
            with self.deps.gpu_stage(f"human-exp:{self.name}:eval"):
                rc = self.deps.run(cmd, self.root / "logs" / "eval.log")
            if rc != 0:
                self.log(f"eval: eval_cells exit {rc}; see {self.root / 'logs' / 'eval.log'}")
        heads = {c: self._eval_headline(evals, c) for c in self.cell_names()}
        out = {"run_id": run_id, "seed0": seed0, "n": n, "start_state": str(start_state), "cells": heads, "at": _now()}
        _write_json(self.marker("eval"), out)
        if not all(h["complete"] for h in heads.values()):
            raise Stop(f"eval incomplete: {({c: h['missing_seeds'] for c, h in heads.items()})}; re-run to resume")
        self.log("eval: " + ", ".join(f"{c} {h['successes']}/{h['n']}" for c, h in heads.items()))
        return out

    def _eval_headline(self, evals: Path, cell: str) -> dict:
        data = _read_json(evals / f"{cell}.json") or {"episodes": []}
        return headline(data["episodes"], self.config["eval_seed0"], self.config["eval_n"]) | {
            "file": str(evals / f"{cell}.json")}

    # --- results -------------------------------------------------------------------------------------

    def results(self, publish: bool = False) -> dict:
        ev = _read_json(self.marker("eval"))
        train = _read_json(self.marker("train"))
        sim = _read_json(self.marker("sim")) or {}
        raw_cell, mult_cell = self.cell_names()
        cmp = compare(ev["cells"][raw_cell], ev["cells"][mult_cell])
        registry = [(f"{self.data / 'results' / 'registry.jsonl'}#L{i + 1}", r)
                    for i, r in enumerate(_jsonl(self.data / "results" / "registry.jsonl"))
                    if r.get("run_id") == train["run_id"]]
        evals = [(str(p), d) for p in sorted((self.data / "evals" / train["run_id"]).glob("*.json"))
                 if p.name != "gate_checks.json" and isinstance(d := _read_json(p), dict) and "summary" in d]
        y = sim.get("multiply") or {}
        yields = [(str(self.marker("sim")), y)] if y.get("attempts") else []
        out = build_results(registry, evals, yields, [], demos=[self.config["n_human"]], robot=ROBOT,
                            comparisons=[(raw_cell, mult_cell)])
        # build_results' ablation compares rules-only with rules + Nemotron *repair*; here the repair is the rules
        # alone and Nemotron only labels and judges, so the one honest bar is this run's multiplied cell
        mult = next(s["success"][0] for s in out["series"] if s["key"] == "ours")
        out["ablation"] = {"demos": self.config["n_human"],
                           "bars": [{"key": "rules", "label": "Rules repair + multiply (this run)", "success": mult}]}
        out["pending"] = [k for k in out["pending"] if not k.startswith("ablation.")]
        smoke = self.config["smoke"]
        out["sample"] = smoke  # a smoke run measures nothing: the page shows it under "SAMPLE DATA"
        out["note"] = (("SMOKE TEST: proves every stage runs; not a result. " if smoke else "")
                       + f"Human-demo experiment {self.name!r}: raw vs perfected+multiplied, pre-registered seeds "
                       f"{ev['seed0']}-{ev['seed0'] + ev['n'] - 1}. " + out["note"])
        out["experiment"] = {
            "name": self.name, "smoke": smoke, "config": self.config, "run_id": train["run_id"],
            "headline": {**cmp, "raw": {**ev["cells"][raw_cell], **cmp["raw"]},
                         "multiplied": {**ev["cells"][mult_cell], **cmp["multiplied"]}},
            "data": {k: sim.get(k) for k in ("physics_verified", "repair", "multiply")},
            "grid": _read_json(self.marker("grid")),
            "nemotron": _read_json(self.marker("nemotron")),
            "preregistration": str(self.root / "preregistration.md"),
        }
        _write_json(self.root / "results.json", out)
        self.log(f"results: {raw_cell} {cmp['raw']['successes']}/{cmp['raw']['n']} vs {mult_cell} "
                 f"{cmp['multiplied']['successes']}/{cmp['multiplied']['n']}, Fisher p = {cmp['fisher_p']}"
                 + (" (SMOKE: not a result)" if smoke else "") + f" -> {self.root / 'results.json'}")
        if publish:
            if smoke:
                raise Refused("--publish-results refuses a smoke run: it would put a non-result on the Results page")
            dst = self.data / "results" / "results.json"
            if dst.is_file():
                shutil.copyfile(dst, dst.with_name(f"results.json.bak-{datetime.now():%Y%m%d_%H%M%S}"))
            _write_json(dst, out)
            self.log(f"results: published to {dst}")
        return out

    # --- the run -------------------------------------------------------------------------------------

    def run(self, *, until: str = "results", publish: bool = False, sim_until: str = "multiply") -> None:
        steps = {"grid": self.grid, "nemotron": self.nemotron, "train": self.train,
                 "eval": self.eval, "results": lambda: self.results(publish)}
        for stage in STAGES[1: STAGES.index(until) + 1]:
            if stage == "sim":
                if not self.sim(sim_until):
                    return
            else:
                steps[stage]()


def _jsonl(path: Path) -> list[dict]:
    try:
        return [json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line.strip()]
    except OSError:
        return []


def nemotron_summary(cards: dict) -> dict:
    labels = [r["card"]["label"]["status"] for r in cards.values()]
    matches = [c["card"]["match"]["status"] for r in cards.values() for c in r["copies"]]
    conflicts = [c["id"] for r in cards.values() for c in r["copies"] if c["card"]["conflict"]]
    return {"labels": {s: labels.count(s) for s in sorted(set(labels))},
            "matches": {s: matches.count(s) for s in sorted(set(matches))}, "conflicts": conflicts,
            "cards": cards}


def preregistration(config: dict) -> str:
    """The pre-registration, filled from the frozen config. Written at select, before any training."""
    n, s0, ne = config["n_human"], config["eval_seed0"], config["eval_n"]
    ids = "\n".join(f"  - `{id}` sha256 `{config['demo_sha256'][id]}`" for id in config["ids"])
    return f"""# Pre-registration: human-demo experiment `{config['name']}`

Frozen at {config['frozen_at']} (UTC), before any training or evaluation, from `config.json`.{'''

**SMOKE TEST.** This run proves that every stage works. It measures nothing, and no number from it is a result.''' if config['smoke'] else ''}

**Question.** Does a policy trained on the {n} human demos perfected and multiplied succeed more often than one
trained on the same {n} demos as recorded?

**Demos** ({n}, frozen by content hash):
{ids}

**What is replayed** (`replay_path = {config.get('replay_path', 'commanded')}`): {"the tool pose the arm reached each step, from each demo's live episode (steps.npz, 50 Hz, hashes in config.json); the hand targets the arm lagged are kept as `commanded`, for diagnostics only." if config.get('replay_path') == 'achieved' else "each demo's stored trajectory, as is."} Every replay in this experiment (physics, repair, alignment, variants) tracks with lookahead {config.get('replay_lookahead', 0)} (the sim worker's `--lookahead`).

**Arms.** Both arms use ACT, {config['steps']} steps, batch {config['batch_size']}, the same recipe and seed.
- **raw_{n}:** every demo as recorded, start-aligned
  (`raw_arm = {config['raw_arm']}`{': all demos, whether or not physics verified them' if config['raw_arm'] == 'all' else ': only the demos physics verified'}).
- **perfected_multiply_{n}:** each demo
  - rules-repaired, then verified in Isaac;
  - start-aligned;
  - plus {config['variants']} variants in new scenes, each kept only if it verifies.

  A demo whose repair does not verify contributes nothing to this arm.
- **Start alignment** (both arms): a min-jerk move from the home pose to the demo's first pose is put in front
  of every training episode.

**Primary endpoint.** Success, as the eval's physics check decides it, on the unseen scenes with seeds
**{s0}–{s0 + ne - 1}** (n = {ne} per arm).
- Serial eval (`eval_cells.py`).
- Both cells start from the raw dataset's start state.
- 30 s limit, front and wrist cameras.

**Test.** Two-sided Fisher exact test, α = {config['alpha']}, with a Wilson 95% CI for each arm.
- **One test.** There are no interim looks and no other endpoints.
- **Stopping:** n is fixed in advance. It is not extended or cut on the result.
- An episode that ends in `sim_error` / `policy_error` is re-run (`eval_cells` resume). It is never counted as a
  failure.

**Reported whatever it says:**
- the counts, rates, CIs and p;
- the physics verdicts and repair outcomes;
- the multiply yield;
- Nemotron's labels and matches (shown, never deciding).
"""


# --- the real side effects ------------------------------------------------------------------------


def child_env(data: Path) -> dict:
    env = {k: v for k, v in os.environ.items() if k != "VIRTUAL_ENV"}
    env.update(DATA_DIR=str(data), PYTHONPATH=f"{REPO};{REPO / 'src'}", PYTHONUNBUFFERED="1")
    return env


def make_runner(data: Path, log: Callable[[str], None]) -> Callable[[list[str], Path], int]:
    def run(cmd: list[str], log_path: Path) -> int:
        log_path.parent.mkdir(parents=True, exist_ok=True)
        with log_path.open("a", encoding="utf-8") as f:
            f.write(f"\n=== {_now()} {' '.join(cmd)}\n")
            f.flush()
            return subprocess.run(cmd, cwd=REPO, env=child_env(data), stdout=f, stderr=subprocess.STDOUT).returncode
    return run


def _free_mib() -> int | None:
    try:
        out = subprocess.run(["nvidia-smi", "--query-gpu=memory.free", "--format=csv,noheader,nounits"],
                             capture_output=True, text=True, timeout=10).stdout
        return int(out.split()[0])
    except (OSError, ValueError, IndexError, subprocess.SubprocessError):
        return None


def make_gpu_stage(log: Callable[[str], None], *, poll_s: float = 300, max_wait_s: float = 8 * 3600):
    from sim_worker.gpu_lock import GpuLock
    from sim_worker.keepawake import KeepAwake

    @contextmanager
    def stage(task: str) -> Iterator[None]:
        with GpuLock(task=task, log=log, max_wait_s=max_wait_s), KeepAwake():
            if not task.endswith(":train"):  # Isaac stages: no other Isaac python, >= 8 GB free (sim_eval's gate)
                from sim_eval.report import gpu_pids, isaac_gate, python_processes

                waited = 0.0
                while True:
                    ok, rec = isaac_gate(python_processes(), own_pid=os.getpid(), free_mib=_free_mib(),
                                         gpu_pids=gpu_pids())
                    if ok:
                        break
                    if waited >= max_wait_s:
                        raise Stop(f"Isaac never became free: {rec['reason']}")
                    log(f"[gpu] waiting {poll_s:.0f} s: {rec['reason']}")
                    time.sleep(poll_s)
                    waited += poll_s
            yield
    return stage


def sim_worker_cmd(port: int, *, lookahead: int) -> list[str]:
    """The sim worker for this experiment: Franka, cameras, tracking with the frozen replay_lookahead."""
    return [str(ISAAC_PY), "-m", "sim_worker.server", "--port", str(port), "--robot", ROBOT, "--cameras",
            "--lookahead", str(lookahead)]


def make_sim_session(data: Path, name: str, gpu_stage, log: Callable[[str], None], port: int, logs: Path, *,
                     lookahead: int):
    @contextmanager
    def session() -> Iterator[SimWorkerClient]:
        with gpu_stage(f"human-exp:{name}:sim"):
            client = SimWorkerClient(f"http://127.0.0.1:{port}", replay_timeout=900.0)
            try:
                client.health()
                raise Refused(f"a sim worker already answers on port {port}: stop it first (it may write episodes "
                              f"under another DATA_DIR)")
            except SimWorkerError:
                pass
            logs.mkdir(parents=True, exist_ok=True)
            f = (logs / "sim_worker.log").open("a", encoding="utf-8")
            cmd = sim_worker_cmd(port, lookahead=lookahead)
            log(f"sim: starting {' '.join(cmd)} (DATA_DIR={data})")
            proc = subprocess.Popen(cmd, cwd=REPO, env=child_env(data), stdout=f, stderr=subprocess.STDOUT)
            try:
                deadline = time.time() + 900
                while True:
                    if proc.poll() is not None:
                        raise Stop(f"the sim worker exited with {proc.returncode}; see {logs / 'sim_worker.log'}")
                    try:
                        if client.health().ok:
                            break
                    except SimWorkerError:
                        pass
                    if time.time() > deadline:
                        raise Stop(f"the sim worker was not healthy after 900 s; see {logs / 'sim_worker.log'}")
                    time.sleep(5)
                log(f"sim: worker pid {proc.pid} healthy")
                yield client
            finally:
                client.close()
                subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True)
                try:
                    proc.wait(timeout=60)
                except subprocess.TimeoutExpired:
                    pass
                f.close()
                log("sim: worker stopped")
    return session


def episode_clip(ep_dir: Path, k: int):
    """k front frames (first and last included) as 256 px PNGs, with the trajectory summary: what T3's test sent."""
    from PIL import Image

    from demo_pipeline.intent import sample_indices, summarize

    ep_dir = Path(ep_dir)
    traj = Trajectory.model_validate_json((ep_dir / "trajectory.json").read_text(encoding="utf-8"))
    fps = json.loads((ep_dir / "episode.json").read_text(encoding="utf-8"))["fps"]
    files = sorted((ep_dir / "front").glob("*.png"))
    if len(files) != len(traj.t):
        raise ValueError(f"{ep_dir.name}: {len(files)} front frames but {len(traj.t)} trajectory steps")
    out = []
    for i in sample_indices(len(files), k):
        buf = io.BytesIO()
        with Image.open(files[i]) as im:
            im.convert("RGB").resize((MODEL_SIZE, MODEL_SIZE), Image.LANCZOS).save(buf, format="PNG")
        out.append((i, buf.getvalue()))
    return out, summarize(traj, fps)


class NemotronJudge:
    """T3's two calls (app.ai.intent) with one spend cap for the run; every call logged to calls.jsonl."""

    def __init__(self, cap_usd: float, calls_log: Path) -> None:
        from app.ai.intent import Budget

        self.budget, self.calls_log = Budget(cap_usd=cap_usd), Path(calls_log)

    def _on_call(self, entry: dict) -> None:
        self.calls_log.parent.mkdir(parents=True, exist_ok=True)
        with self.calls_log.open("a", encoding="utf-8") as f:
            f.write(json.dumps({"at": _now(), **entry}) + "\n")

    def label(self, frames, summary):
        from app.ai.intent import label_demo

        return label_demo(frames, summary, budget=self.budget, on_call=self._on_call)

    def judge(self, h_frames, h_summary, c_frames, c_summary):
        from app.ai.intent import judge_pair

        return judge_pair(h_frames, h_summary, c_frames, c_summary, budget=self.budget, on_call=self._on_call)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--name", required=True, help="experiment name: DATA_DIR/human_exp/<name>")
    p.add_argument("--ids", help="comma-separated human demo ids (in this order)")
    p.add_argument("--tag", help='fnmatch pattern over human demo ids, e.g. "human_20261019*"')
    p.add_argument("--data-dir", type=Path, default=None, help="DATA_DIR (default: the DATA_DIR env var, or data/)")
    p.add_argument("--smoke", action="store_true", help="2000 steps, 5 eval seeds, results marked sample")
    p.add_argument("--variants", type=int)
    p.add_argument("--steps", type=int)
    p.add_argument("--save-freq", type=int)
    p.add_argument("--eval-n", type=int)
    p.add_argument("--eval-seed0", type=int)
    p.add_argument("--raw-arm", choices=("all", "verified"), default="all")
    p.add_argument("--judge-copies", type=int, default=1)
    p.add_argument("--max-cost-usd", type=float, default=0.10, help="Nemotron spend cap for this run")
    p.add_argument("--no-nemotron", action="store_true")
    p.add_argument("--until", choices=STAGES, default="results", help="stop after this stage")
    p.add_argument("--sim-until", choices=SIM_STEPS, default="multiply",
                   help="stop the sim stage after this step (and the run with it)")
    p.add_argument("--replay-path", choices=REPLAY_PATHS, default=None,
                   help="achieved: the pose the arm reached (live episode); commanded: demo.json as stored "
                        "(default: achieved, or commanded with --smoke)")
    p.add_argument("--replay-lookahead", type=int, default=None,
                   help="the sim worker's --lookahead for every replay (default: 1 for the achieved path, else 0)")
    p.add_argument("--publish-results", action="store_true", help="also write DATA_DIR/results/results.json")
    p.add_argument("--force-config", action="store_true", help="accept changed settings for an existing --name")
    p.add_argument("--sim-port", type=int, default=8770)
    args = p.parse_args(argv)
    if args.ids and args.tag:
        p.error("give --ids or --tag, not both")
    settings = {k: getattr(args, k) if getattr(args, k) is not None else (SMOKE if args.smoke else {}).get(k, v)
                for k, v in DEFAULTS.items()}
    settings.update(smoke=args.smoke, raw_arm=args.raw_arm, judge_copies=args.judge_copies,
                    nemotron=not args.no_nemotron, max_cost_usd=args.max_cost_usd,
                    replay_path=args.replay_path or ("commanded" if args.smoke else "achieved"))
    settings["replay_lookahead"] = (args.replay_lookahead if args.replay_lookahead is not None
                                    else 1 if settings["replay_path"] == "achieved" else 0)
    if not (1 <= settings["variants"] <= 99 and 0 < settings["steps"] <= 30_000 and settings["eval_n"] > 0
            and settings["eval_seed0"] >= 5000):
        p.error("need 1-99 variants, 1-30000 steps, eval n > 0 and eval seeds >= 5000")

    if args.data_dir is not None:
        os.environ["DATA_DIR"] = str(args.data_dir)
    from demo_pipeline.paths import data_dir

    data = Path(data_dir()).resolve()
    run_log = data / "human_exp" / args.name / "run.log"

    def log(msg: str) -> None:  # child-process, lock and gate messages: to the console and run.log
        line = msg if msg.startswith("[human-exp") else f"[human-exp {datetime.now():%H:%M:%S}] {msg}"
        print(line, flush=True)
        if not msg.startswith("[human-exp"):  # Experiment.log writes its own lines to run.log
            run_log.parent.mkdir(parents=True, exist_ok=True)
            with run_log.open("a", encoding="utf-8") as f:
                f.write(line + "\n")

    gpu_stage = make_gpu_stage(log)
    judge = clip = None
    if settings["nemotron"]:
        try:
            import PIL  # noqa: F401
        except ImportError:
            p.error("the nemotron stage needs Pillow: run with `uv run --with pillow python ...`, or --no-nemotron")
        from dotenv import load_dotenv

        load_dotenv(REPO / ".env")  # NEBIUS_API_KEY; never printed
        judge = NemotronJudge(settings["max_cost_usd"], data / "human_exp" / args.name / "stages" / "nemotron" / "calls.jsonl")
        clip = episode_clip
    exp = Experiment(data, args.name, Deps(
        user_store=DemoStore(data), gpu_stage=gpu_stage, run=make_runner(data, log), judge=judge, clip=clip, log=log,
        sim_session=make_sim_session(data, args.name, gpu_stage, log, args.sim_port, data / "human_exp" / args.name / "logs",
                                     lookahead=settings["replay_lookahead"])))
    try:
        try:
            exp.select(ids=args.ids.split(",") if args.ids else None, tag=args.tag, settings=settings,
                       force_config=args.force_config)
        except ValueError as e:  # select_ids: a missing, derived or unmatched demo
            raise Refused(str(e)) from e
        exp.run(until=args.until, publish=args.publish_results, sim_until=args.sim_until)
    except Refused as e:
        exp.log(f"REFUSED: {e}")
        return 1
    except Stop as e:
        exp.log(f"STOPPED: {e}")
        return 2
    exp.log(f"done through '{args.until}'")
    return 0


if __name__ == "__main__":
    sys.exit(main())
