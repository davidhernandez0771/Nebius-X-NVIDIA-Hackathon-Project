"""How long each stage's items take: learned from earlier runs' run.log (DATA_DIR/human_exp/*/run.log, written by
scripts/run_human_demo_experiment.py), the median of every measurement, and a default where there is none yet.

Each run.log line starts "[human-exp HH:MM:SS]"; a stage's per-item time is the gap between its lines:
- sim_start_s: "sim: starting" -> "sim: worker ... healthy";
- physics_s, repair_s, align_s (per demo): from the previous work line of the sim session to this demo's line;
- multiply_s (per variant): that gap over the demo's variant count ("multiply <id>: k/n variants verified");
- train_s_per_10k (per cell): the train lock (not the wait for it) to "train: run ...", over cells x steps / 10k;
- eval_s (per episode): the eval lock (or its start) to "eval: <cell> k/n, ...", over the episodes.
A clock that runs past midnight wraps; a gap that is negative or over 2 h (a resumed run) is dropped.
Every finished run adds its lines, so the estimates keep learning.

The teacher recipe (app.pipeline.teacher_runner) learns from its stage markers (DATA_DIR/teacher/*/stages/<stage>.json:
seconds and items): rl_iter_s from "teacher" (full-size runs only: a smoke run's 64 envs are far faster), gate_eval_s
and gate_verify_s per gate episode; and from T6's rollout rows (<repo>/data/distill/<run>/r<k>/rollouts.jsonl,
wall_s per seed): rollout_s (round 0, the teacher) and dagger_rollout_s (later rounds, the student). The defaults
are T3's and T6's estimates in their notes until today's runs measure them.
"""
from __future__ import annotations

import json
import re
import statistics
from dataclasses import dataclass, field
from pathlib import Path

DEFAULTS: dict[str, float] = {
    "sim_start_s": 20.0,  # the sim worker's start (Isaac + cameras)
    "physics_s": 20.0,  # per demo: one replay (13-30 s measured)
    "repair_s": 45.0,  # per demo: diagnose, repair, verify (30-60 s)
    "align_s": 20.0,  # per demo: two start-aligned replays
    "multiply_s": 15.0,  # per variant
    "grid_s": 5.0,
    "nemotron_s": 20.0,  # per demo: a label and a judged copy
    "train_s_per_10k": 550.0,  # per cell, per 10k ACT steps (batch 8)
    "eval_s": 70.0,  # per eval episode
    "results_s": 2.0,
    "export_s": 120.0,  # zips of the datasets and the Robota export
    # the teacher recipe (estimates from T3's and T6's notes, 2026-10-20)
    "rl_iter_s": 2.0,  # per RL iteration at 4,096 envs: the stock lift's ~0.8-1.5 s, SANT's env is heavier
    "gate_eval_s": 30.0,  # per gate episode: the teacher in Isaac (rl_eval_teacher)
    "gate_verify_s": 20.0,  # per gate episode: its replay in SANT's eval env (a physics replay)
    "rollout_s": 24.0,  # per teacher rollout (T6: 21-27 s per seed)
    "grid_s_per_1k_frames": 21.0,  # T6: assembling the mixed grid
    "frames_per_rollout": 500.0,  # a teacher episode's frames (estimate: ~10 s at 50 fps)
    "dagger_rollout_s": 70.0,  # per DAgger rollout: the student, with the teacher labelling (T6: 40 x ~70 s)
}
_LINE = re.compile(r"\[human-exp (\d\d):(\d\d):(\d\d)\] (.*)")
_PER_DEMO = re.compile(r"(physics|repair|align|multiply) (\S+): (.*)")
_VARIANTS = re.compile(r"(\d+)/(\d+) variants verified")
_EVAL_DONE = re.compile(r"eval: ((?:\S+ \d+/\d+)(?:, \S+ \d+/\d+)*)$")
MAX_GAP_S = 2 * 3600


def samples_from_log(lines: list[str], *, steps: int | None) -> dict[str, list[float]]:
    """Every per-item time in one run.log (see the module doc). `steps`: the run's training steps (config.json)."""
    out: dict[str, list[float]] = {k: [] for k in DEFAULTS}
    day = 0
    prev_clock = None
    last_work = sim_start = train_t = eval_t = None

    def gap(a: float | None, b: float) -> float | None:
        if a is None:
            return None
        d = b - a
        return d if 0 <= d <= MAX_GAP_S else None

    for raw in lines:
        m = _LINE.match(raw.strip())
        if not m:
            continue
        clock = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + int(m.group(3))
        if prev_clock is not None and clock < prev_clock - 6 * 3600:
            day += 1  # past midnight
        prev_clock = clock
        t = day * 86400 + clock
        body = m.group(4)
        if body.startswith("select:") or body.startswith("sim: starting"):
            last_work = None
            sim_start = t if body.startswith("sim: starting") else None
        elif re.match(r"sim: worker pid \d+ healthy", body):
            if (d := gap(sim_start, t)) is not None:
                out["sim_start_s"].append(d)
            last_work = t
        elif (p := _PER_DEMO.match(body)) is not None:
            kind = p.group(1)
            d = gap(last_work, t)
            last_work = t
            if d is None:
                continue
            if kind == "multiply":
                v = _VARIANTS.match(p.group(3))
                if v and int(v.group(2)) > 0:
                    out["multiply_s"].append(d / int(v.group(2)))
            else:
                out[f"{kind}_s"].append(d)
        elif body.startswith("train: ") and ".exe" in body:
            train_t = t
        elif "[gpu.lock] acquired" in body and body.split()[-2].endswith(":train"):
            train_t = t  # the training itself starts once the lock is ours
        elif (r := re.match(r"train: run \S+: (.*)", body)) is not None:
            cells = len(r.group(1).split(", "))
            if (d := gap(train_t, t)) is not None and steps:
                out["train_s_per_10k"].append(d / cells / (steps / 10_000))
            train_t = None
        elif body.startswith("eval: ") and ".exe" in body:
            eval_t = t
        elif "[gpu.lock] acquired" in body and body.split()[-2].endswith(":eval"):
            eval_t = t
        elif (e := _EVAL_DONE.match(body)) is not None:
            n = sum(int(c.split("/")[1]) for c in e.group(1).split(", "))
            if (d := gap(eval_t, t)) is not None and n:
                out["eval_s"].append(d / n)
            eval_t = None
    return out


@dataclass
class Timings:
    samples: dict[str, list[float]] = field(default_factory=dict)

    def per(self, key: str) -> float:
        s = self.samples.get(key) or []
        return float(statistics.median(s)) if s else DEFAULTS[key]

    def source(self, key: str) -> str:
        n = len(self.samples.get(key) or [])
        return f"measured: median of {n}" if n else "default"

    def to_dict(self) -> dict:
        return {k: {"seconds": round(self.per(k), 2), "n": len(self.samples.get(k) or []), "source": self.source(k)}
                for k in DEFAULTS}


def teacher_samples(data: Path) -> dict[str, list[float]]:
    """The teacher recipe's measured times (see the module doc), from every run under DATA_DIR/teacher."""
    out: dict[str, list[float]] = {k: [] for k in ("rl_iter_s", "gate_eval_s", "gate_verify_s", "rollout_s",
                                                   "dagger_rollout_s", "frames_per_rollout")}

    def read(path: Path):
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None

    for root in sorted(Path(data).glob("teacher/*")):
        config = read(root / "config.json") or {}
        for stage, key in (("teacher", "rl_iter_s"), ("gate_eval", "gate_eval_s"), ("gate_verify", "gate_verify_s")):
            m = read(root / "stages" / f"{stage}.json") or {}
            if m.get("seconds") and m.get("items") and not (stage == "teacher" and config.get("smoke")):
                out[key].append(m["seconds"] / m["items"])
        repo = Path(config["repo"]) if config.get("repo") else None
        if repo is None:
            continue
        for rdir in sorted((repo / "data" / "distill" / root.name).glob("r[0-9]")):
            key = "rollout_s" if rdir.name == "r0" else "dagger_rollout_s"
            try:
                rows = [json.loads(x) for x in (rdir / "rollouts.jsonl").read_text(encoding="utf-8").splitlines() if x.strip()]
            except (OSError, ValueError):
                continue
            out[key] += [float(r["wall_s"]) for r in rows if r.get("wall_s")]
            if rdir.name == "r0":
                out["frames_per_rollout"] += [float(r["frames"]) for r in rows if r.get("frames")]
    return out


def learn(data: Path) -> Timings:
    """Every run.log under DATA_DIR/human_exp (the site's runs are there too) and every teacher run, as Timings."""
    samples: dict[str, list[float]] = {k: [] for k in DEFAULTS}
    for k, v in teacher_samples(data).items():
        samples[k].extend(v)
    for log in sorted(Path(data).glob("human_exp/*/run.log")):
        try:
            config = json.loads((log.parent / "config.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            config = {}
        try:
            lines = log.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            continue
        for k, v in samples_from_log(lines, steps=config.get("steps")).items():
            samples[k].extend(v)
    return Timings(samples)
