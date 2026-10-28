"""The data recipe's fixes (data_recipe.Fix), applied to one multiplied variant's trajectory before its physics replay.

The failure analyst diagnoses why a trained policy fails; these are the levers that change the next round's data:
  recenter_grasp   the repair's own recenter op (repair._recenter_grasp): the close lands over the cube centre
  slow_carry       a time-warp of the held part (first close to the following open): segments faster than the cap
                   take longer, the path itself is the same, the close and the open stay at their steps' places
  filter_training  measure the variant's commanded path (training_features) and keep it only if the feature is on
                   the recipe's side of the threshold; a dropped variant is never replayed or trained on

They run in that order, so a filter sees the trajectory that will be replayed. Every variant still goes through the
same physics replay as before, and only a verified one is trained on: a fix can cost yield, never let an unverified
demo through.

training_features measures the commanded path (the trajectory the replay follows), with failure_features' names and
definitions where the path shows them. The cube doesn't move before the close, so the grasp numbers use the scene's
cube pose. "Lifted" is the tool raised LIFT_MIN above its height at the close. max_lift and held_s need the cube in
the simulator, so they can't be filtered on (data_recipe.TRAINING_FEATURES).
"""

from __future__ import annotations

import math

import numpy as np

from .data_recipe import CARRY_SPEED_RANGE, CONTRAST_FEATURES, TRAINING_FEATURES, Fix, unmeasurable_text
from .failure_features import LIFT_MIN
from .repair import DT, _recenter_grasp, _regrid, _sample, _splice
from .schemas import Scene, Trajectory

RECENTER_MIN_MM = 0.5  # a grasp closer to the centre than this is left alone
ORDER = ("recenter_grasp", "slow_carry", "filter_training")

__all__ = ["TRAINING_FEATURES", "apply_fixes", "fix_errors", "keeps", "recenter_grasp", "slow_carry",
           "training_features"]


def fix_errors(fixes: list[Fix]) -> list[str]:
    """Settings the pipeline can't apply, as readable lines. [] means every fix can run."""
    errors = []
    lo, hi = CARRY_SPEED_RANGE
    for i, f in enumerate(fixes):
        where = f"fix {i + 1} ({f.lever})"
        if f.lever == "slow_carry":
            v = f.max_speed_mps
            if v is None or not math.isfinite(v) or not lo <= v <= hi:
                errors.append(f"{where} needs max_speed_mps between {lo} and {hi}, got {v}")
        elif f.lever == "filter_training":
            if f.feature not in CONTRAST_FEATURES:
                errors.append(f"{where}: unknown feature {f.feature!r}; use one of {list(TRAINING_FEATURES)}")
            elif f.feature not in TRAINING_FEATURES:
                errors.append(unmeasurable_text(where, f.feature))
            if f.keep is None:
                errors.append(f"{where} needs keep (below or above)")
            if f.threshold is None or not math.isfinite(f.threshold):
                errors.append(f"{where} needs a finite threshold, got {f.threshold}")
    return errors


def _closed_span(g: np.ndarray) -> tuple[int, int] | None:
    """(first closed step, last closed step before the following open), or None without a close followed by an open."""
    closed = np.flatnonzero(g == 1)
    if closed.size == 0:
        return None
    i0 = int(closed[0])
    opens = np.flatnonzero((g[1:] == 0) & (g[:-1] == 1)) + 1
    opens = opens[opens > i0]
    if opens.size == 0:
        return None
    return i0, int(opens[0]) - 1


def _speeds(pos: np.ndarray) -> np.ndarray:
    return np.linalg.norm(np.diff(pos, axis=0), axis=1) / DT


def slow_carry(traj: Trajectory, max_speed_mps: float) -> tuple[Trajectory, dict]:
    """The held part retimed so the tool moves at most max_speed_mps between any two steps; the rest unchanged."""
    lo, hi = CARRY_SPEED_RANGE
    if not math.isfinite(max_speed_mps) or not lo <= max_speed_mps <= hi:
        raise ValueError(f"slow_carry: max_speed_mps must be between {lo} and {hi}, got {max_speed_mps}")
    traj = _regrid(traj)
    a = traj.to_arrays()
    span = _closed_span(a["gripper"])
    report = {"lever": "slow_carry", "max_speed_mps": max_speed_mps, "applied": False}
    if span is None:
        return traj, {**report, "why": "no close followed by an open"}
    i0, i1 = span
    seg = np.linalg.norm(np.diff(a["ee_pos"][i0:i1 + 1], axis=0), axis=1)
    before = float(seg.max() / DT) if seg.size else 0.0
    report.update(carry_s_before=round((i1 - i0) * DT, 4), speed_max_before=round(before, 4))
    if before <= max_speed_mps + 1e-9:
        return traj, {**report, "carry_s_after": report["carry_s_before"], "speed_max_after": report["speed_max_before"],
                      "why": "already under the cap"}
    # each recorded step takes as long as it needs to stay under the cap (never less than it took); the step count is
    # rounded up, which only slows it further
    new_t = np.concatenate([[0.0], np.cumsum(np.maximum(DT, seg / max_speed_mps))])
    n = math.ceil(new_t[-1] / DT - 1e-9)
    new_t *= n * DT / new_t[-1]
    src_t = np.interp(np.arange(n + 1) * DT, new_t, a["t"][i0:i1 + 1])
    new = _sample(a, src_t)
    new["ee_pos"][[0, -1]] = a["ee_pos"][[i0, i1]]  # the ends exactly as recorded
    out, _ = _splice(traj, i0, i1, new)
    after = float(_speeds(np.asarray(out.ee_pos)[i0:i0 + n + 1]).max())
    return out, {**report, "applied": True, "carry_s_after": round(n * DT, 4), "speed_max_after": round(after, 4)}


def recenter_grasp(traj: Trajectory, scene: Scene) -> tuple[Trajectory, dict]:
    """The close moved over the cube centre (xy) with the repair's ramps (in over 1 s, held 1 s, out over 1 s)."""
    traj = _regrid(traj)
    a = traj.to_arrays()
    report = {"lever": "recenter_grasp", "applied": False}
    closed = np.flatnonzero(a["gripper"] == 1)
    if closed.size == 0:
        return traj, {**report, "why": "the gripper never closes", "shift_mm": None}
    i0 = int(closed[0])
    shift = float(np.hypot(*(np.asarray(scene.cube_pose.pos[:2]) - a["ee_pos"][i0, :2])))
    report["shift_mm"] = round(shift * 1000, 3)
    if shift * 1000 < RECENTER_MIN_MM:
        return traj, {**report, "why": "already centred"}
    out, _ = _recenter_grasp(traj, float(a["t"][i0]), scene.cube_pose.pos)
    return out, {**report, "applied": True}


def training_features(traj: Trajectory, scene: Scene) -> dict[str, float | int | None]:
    """TRAINING_FEATURES of the commanded path (see the module docstring); None where the path has no such part."""
    traj = _regrid(traj)
    a = traj.to_arrays()
    pos, g = a["ee_pos"], a["gripper"]
    cube = np.asarray(scene.cube_pose.pos, dtype=np.float64)
    closed = np.flatnonzero(g == 1)
    i_close = int(closed[0]) if closed.size else None
    pre = slice(0, max(1, i_close if i_close is not None else len(g)))
    out: dict[str, float | int | None] = {
        "min_reach_dist": float(np.linalg.norm(pos[pre, :2] - cube[:2], axis=1).min()),
        "t_first_close": None if i_close is None else float(a["t"][i_close]),
        "grasp_offset_xy": None if i_close is None else float(np.linalg.norm(pos[i_close, :2] - cube[:2])),
        "grasp_height": None if i_close is None else float(pos[i_close, 2] - cube[2]),
        "n_closes": int(g[0] == 1) + int(np.count_nonzero((g[:-1] == 0) & (g[1:] == 1))),
        "carry_speed_median": None, "carry_speed_max": None,
    }
    span = _closed_span(g)
    if span is not None:
        i0, i1 = span
        lifted = pos[i0 + 1:i1 + 1, 2] - pos[i0, 2] > LIFT_MIN  # step k+1's speed, as failure_features
        v = _speeds(pos[i0:i1 + 1])[lifted]
        if v.size:
            out["carry_speed_median"], out["carry_speed_max"] = float(np.median(v)), float(v.max())
    return out


def keeps(fix: Fix, features: dict) -> bool:
    """Whether a filter_training fix keeps a variant with these training_features. A variant whose path has no
    such part (value None) is kept: there is nothing to judge."""
    v = features.get(fix.feature)
    if v is None:
        return True
    return v < fix.threshold if fix.keep == "below" else v > fix.threshold


def apply_fixes(traj: Trajectory, scene: Scene, fixes: list[Fix]) -> tuple[Trajectory, list[dict], bool]:
    """(the fixed trajectory, one report per fix in the order run, whether every filter keeps it)."""
    if not fixes:
        return traj, [], True
    errors = fix_errors(fixes)
    if errors:
        raise ValueError("; ".join(errors))
    reports, kept = [], True
    for f in sorted(fixes, key=lambda f: ORDER.index(f.lever)):
        if f.lever == "recenter_grasp":
            traj, rep = recenter_grasp(traj, scene)
        elif f.lever == "slow_carry":
            traj, rep = slow_carry(traj, f.max_speed_mps)
        else:
            value = training_features(traj, scene)[f.feature]
            ok = keeps(f, {f.feature: value})
            kept = kept and ok
            rep = {"lever": "filter_training", "feature": f.feature, "keep": f.keep, "threshold": f.threshold,
                   "value": None if value is None else round(float(value), 4), "kept": ok}
        reports.append(rep)
    return traj, reports, kept
