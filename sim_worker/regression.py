"""The replay regression check: replayed episode folders compared run to run, so a change to replay() can be judged
against PhysX's own run-to-run noise. Pure (numpy); the GPU smoke test (scripts/scene_smoke.py) produces the runs
with scripts/replay_regression.py and writes this module's report.

Per episode there are the stored episode, the base code's runs and this branch's runs (two each). Run to run within
the same code is the noise; base against branch is the regression. An episode is:
- "identical": every run of both codes the same, bit for bit, with the same reasons;
- "within noise": base-vs-branch differences no larger than base-vs-base or branch-vs-branch, and every set of
  reasons the branch gave also came out of a base run;
- "DIFFERS": otherwise, naming the metrics that broke.
The stored episode (recorded earlier, with cameras, by older code) is compared too, for the record; it doesn't
decide the verdict.
"""

from __future__ import annotations

import itertools
import json
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from demo_pipeline.episode_io import load_signals

METRICS = ("cube_max_m", "cube_final_m", "tcp_max_m", "joint_max_rad", "contact_steps", "arm_contact_steps", "force_max_n")
TOL = 1e-9  # float equality for the "within noise" test


@dataclass
class Run:
    path: Path
    reasons: list[str]
    cube: np.ndarray
    contact: np.ndarray
    arm: np.ndarray
    force: np.ndarray
    tcp: np.ndarray
    joints: np.ndarray

    @property
    def n(self) -> int:
        return len(self.cube)


def load_run(ep_dir: Path) -> Run:
    ep_dir = Path(ep_dir)
    v = json.loads((ep_dir / "verification.json").read_text(encoding="utf-8"))
    sig = load_signals(ep_dir)
    if sig is None:
        raise FileNotFoundError(f"{ep_dir} has no signals.npz")
    with np.load(ep_dir / "steps.npz") as s:
        tcp, joints = s["ee_pos"].astype(np.float64), s["joint_pos"].astype(np.float64)
    return Run(ep_dir, sorted(v["reasons"]), sig.cube_pos.astype(np.float64), sig.contact_gripper_cube,
               sig.contact_arm_bin | sig.contact_arm_table, sig.max_contact_force.astype(np.float64), tcp, joints)


def _max_norm(a: np.ndarray, b: np.ndarray) -> float:
    m = min(len(a), len(b))
    return float(np.linalg.norm(a[:m] - b[:m], axis=-1).max(initial=0.0)) if a.ndim > 1 else float(np.abs(a[:m] - b[:m]).max(initial=0.0))


def compare(a: Run, b: Run) -> dict:
    """Exact differences between two runs of one episode, over their common steps."""
    m = min(a.n, b.n)
    joints = _max_norm(a.joints, b.joints) if a.joints.shape[1:] == b.joints.shape[1:] else math.nan
    return {
        "same_reasons": a.reasons == b.reasons,
        "reasons": (a.reasons, b.reasons),
        "n_steps": (a.n, b.n),
        "cube_max_m": _max_norm(a.cube, b.cube),
        "cube_final_m": float(np.linalg.norm(a.cube[-1] - b.cube[-1])),
        "tcp_max_m": _max_norm(a.tcp, b.tcp),
        "joint_max_rad": joints,
        "contact_steps": int((a.contact[:m] != b.contact[:m]).sum()),
        "arm_contact_steps": int((a.arm[:m] != b.arm[:m]).sum()),
        "force_max_n": _max_norm(a.force, b.force),
    }


def _worst(diffs: list[dict]) -> dict:
    out = {}
    for k in METRICS:
        vals = [d[k] for d in diffs if not (isinstance(d[k], float) and math.isnan(d[k]))]
        out[k] = max(vals) if vals else 0.0
    return out


def episode_verdict(base: list[Run], branch: list[Run]) -> dict:
    within = [compare(a, b) for runs in (base, branch) for a, b in itertools.combinations(runs, 2)]
    cross = [compare(a, b) for a, b in itertools.product(base, branch)]
    noise, reg = _worst(within), _worst(cross)
    base_sets = {tuple(r.reasons) for r in base}
    branch_sets = {tuple(r.reasons) for r in branch}
    lengths_noisy = any(d["n_steps"][0] != d["n_steps"][1] for d in within)
    why = []
    if not branch_sets <= base_sets:
        why.append(f"reasons: base {sorted(base_sets)}, branch {sorted(branch_sets)}")
    if any(d["n_steps"][0] != d["n_steps"][1] for d in cross) and not lengths_noisy:
        why.append(f"n_steps: base {[r.n for r in base]}, branch {[r.n for r in branch]}")
    for k in METRICS:
        if reg[k] > noise[k] + TOL:
            why.append(f"{k}: {reg[k]:.6g} > noise {noise[k]:.6g}")
    all_same = all(d["same_reasons"] and d["n_steps"][0] == d["n_steps"][1] and all(d[k] == 0 for k in METRICS
                                                                                     if not (isinstance(d[k], float) and math.isnan(d[k])))
                   for d in within + cross)
    verdict = "DIFFERS" if why else "identical" if all_same else "within noise"
    return {"verdict": verdict, "why": why, "noise": noise, "regression": reg,
            "base_reasons": [r.reasons for r in base], "branch_reasons": [r.reasons for r in branch]}


def _fmt(x) -> str:
    if isinstance(x, int):
        return str(x)
    return "0" if x == 0 else f"{x:.3g}"


def report_markdown(rows: list[dict]) -> str:
    """rows: {"episode", "stored": Run | None, "base": [Run], "branch": [Run]} -> a markdown report."""
    lines = ["| Episode | Stored reasons | Base runs | Branch runs | Verdict | Base vs branch (noise): cube / TCP / contact steps / force |",
             "|---|---|---|---|---|---|"]
    details = []
    for row in rows:
        v = episode_verdict(row["base"], row["branch"])
        stored = row.get("stored")
        cols = " / ".join(f"{_fmt(v['regression'][k])} ({_fmt(v['noise'][k])})" for k in ("cube_max_m", "tcp_max_m", "contact_steps", "force_max_n"))
        lines.append(f"| {row['episode']} | {', '.join(stored.reasons) if stored and stored.reasons else ('success' if stored else '-')} | "
                     f"{v['base_reasons']} | {v['branch_reasons']} | {v['verdict']} | {cols} |")
        if v["why"]:
            details.append(f"- **{row['episode']}**: " + "; ".join(v["why"]))
        if stored is not None:
            d = compare(stored, row["branch"][0])
            details.append(f"- {row['episode']}, stored vs branch run 1: reasons {d['reasons'][0]} -> {d['reasons'][1]}, steps "
                           f"{d['n_steps'][0]} -> {d['n_steps'][1]}, cube max {_fmt(d['cube_max_m'])} m, final "
                           f"{_fmt(d['cube_final_m'])} m, TCP max {_fmt(d['tcp_max_m'])} m, contact steps {d['contact_steps']}, "
                           f"arm contact steps {d['arm_contact_steps']}, force max {_fmt(d['force_max_n'])} N")
    return "\n".join(lines + [""] + details) + "\n"
