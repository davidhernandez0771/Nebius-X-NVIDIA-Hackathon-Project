"""Human demos re-executed through the held executor, so their labels have the held teacher's command habit (the
big test, 2026-10-23). Pure: no Isaac (sim_eval/scripts/held_human_rollouts.py runs it).

Yesterday's check: a SANT human episode's label leads the observed joints by 0.0023 rad (replay's tracking IK: the
last substep's target, the tool nearly there), the held teacher's by 0.038 rad (one held DLS target per step): two
aiming habits in one training mix. Here each human episode's commanded tool path (its trajectory.json) becomes a
teacher behind sim_eval.teacher.Teacher (HumanPathTeacher) and runs through sim_eval.distill.rollout with
teacher_execution="held", exactly as the held RL teacher's round-0 rollouts: one DLS solve per control step, held for
both substeps, zero-velocity target.

- **The command** is the human path slowed by one factor k for every demo (time t of the human path at control step j
  is j * STEP_S / k), capped as the RL teacher's env caps it (rl_teacher.cap_speed: 0.5 m/s and 2.5 rad/s from the
  previous target, then within DELTA_M of the tool), the orientation SANT's pointing-down tool turned by the capped
  yaw (the human paths are within 1.5 deg of that). After the path's end it holds the last point.
- **k** (the lead's rule): the smallest of K_CHOICES for which the LAG_QUANTILE-th percentile, over the episodes, of
  each episode's largest lag |capped target - commanded| is at most LAG_LIMIT_M (cap_lag: the speed cap alone, from
  the episode's first observed tool position; the tool clamp needs the sim).
- **Kept** only rollouts passing check_success, written as the teacher's round-0 episodes are (write_rollout's "after"
  pairing: the observation after step k with step k's label; teacher.npz) under the source demo's own lineage, so
  lerobot_tools.assemble.source_of still calls them human. trajectory.json is the ACHIEVED tool path (the tool after
  each step with that step's gripper command, as Amendment 5 records a held teacher's), distill.json the
  provenance (kind "held_human": source demo, k, the caps).
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from demo_pipeline import rl_teacher as rt
from demo_pipeline.episode_io import EpisodeMeta, image_path, save_episode
from demo_pipeline.rules import TASK_TEXT
from demo_pipeline.schemas import Scene, Trajectory
from sim_eval.distill import Rollout, _disagreement, _rows, _save_png, label_segments
from sim_eval.teacher import TeacherAction
from sim_worker.homeset import passport
from sim_worker.jobs import episodes_dir

STEP_S = rt.STEP_S  # one control step (50 Hz)
K_CHOICES = (1.0, 1.25, 1.5, 2.0)
LAG_LIMIT_M = 0.02
LAG_QUANTILE = 95
SETTLE_S = 4.0  # rollout time after the slowed path ends (the cap catching up, the drop, check_success's settle)
HELD_PREFIX = "held_"  # episode names: held_<source demo id>
LABEL = "held_human_10"


@dataclass(frozen=True)
class HumanPath:
    """One SANT human episode's commanded tool path: trajectory.json at 50 Hz (t from 0), yaw unwrapped."""

    demo_id: str
    t: np.ndarray  # (T,)
    pos: np.ndarray  # (T, 3)
    yaw: np.ndarray  # (T,) the pointing-down tool's heading, unwrapped
    gripper: np.ndarray  # (T,) 0 open / 1 closed
    tilt_deg: float  # the largest angle between a commanded quaternion and pointing-down-turned-by-its-yaw

    @classmethod
    def from_trajectory(cls, demo_id: str, traj: Trajectory) -> "HumanPath":
        q = np.asarray(traj.ee_quat, dtype=np.float64)
        yaw = rt.tool_yaw(q)
        dot = np.abs((q * rt._down_turned(yaw)).sum(axis=1)).clip(0.0, 1.0)
        return cls(demo_id=demo_id, t=np.asarray(traj.t, dtype=np.float64) - traj.t[0],
                   pos=np.asarray(traj.ee_pos, dtype=np.float64), yaw=np.unwrap(yaw),
                   gripper=np.asarray(traj.gripper, dtype=int), tilt_deg=float(np.degrees(2 * np.arccos(dot)).max()))

    @classmethod
    def from_episode(cls, ep: Path) -> "HumanPath":
        ep = Path(ep)
        meta = EpisodeMeta.model_validate_json((ep / "episode.json").read_text(encoding="utf-8"))
        traj = Trajectory.model_validate_json((ep / "trajectory.json").read_text(encoding="utf-8"))
        return cls.from_trajectory(meta.demo_id, traj)

    def steps(self, k: float) -> int:
        """Control steps until the slowed path's last point is commanded."""
        return int(math.ceil(round(self.t[-1] * k / STEP_S, 9))) + 1

    def at(self, j: int, k: float) -> tuple[np.ndarray, float, int]:
        """The commanded (position, yaw, gripper) at control step j of the path slowed by k: position and yaw
        interpolated at human time j * STEP_S / k, the gripper the last human command at or before it; the last
        point after the end."""
        s = min(j * STEP_S / k, self.t[-1])
        pos = np.array([np.interp(s, self.t, self.pos[:, i]) for i in range(3)])
        i = int(np.searchsorted(self.t, s + 1e-9, side="right")) - 1
        return pos, float(np.interp(s, self.t, self.yaw)), int(self.gripper[max(i, 0)])


def cap_lag(path: HumanPath, k: float, start_pos, start_yaw: float, *, v_max: float = rt.V_MAX,
            yaw_rate_max: float = rt.YAW_RATE_MAX) -> dict:
    """The speed cap alone on the slowed path, from the start tool pose: per step |capped - commanded| (metres) and
    the yaw lag (radians). The tool clamp (DELTA_M from the tool) needs the sim: the tool is put at the previous
    capped target, where one capped step (v_max * STEP_S = 1 cm) never reaches the clamp."""
    prev_pos = np.asarray(start_pos, dtype=np.float64).reshape(1, 3)
    prev_yaw = np.array([float(start_yaw)])
    lag, ylag = [], []
    for j in range(path.steps(k)):
        pos, yaw, _ = path.at(j, k)
        cpos, cyaw = rt.cap_speed(pos.reshape(1, 3), np.array([yaw]), prev_pos, prev_yaw, prev_pos, v_max,
                                  yaw_rate_max)
        lag.append(float(np.linalg.norm(cpos[0] - pos)))
        ylag.append(abs(float(np.arctan2(np.sin(cyaw[0] - yaw), np.cos(cyaw[0] - yaw)))))
        prev_pos, prev_yaw = cpos, cyaw
    lag, ylag = np.asarray(lag), np.asarray(ylag)
    return {"max_lag_m": float(lag.max()), "max_yaw_lag_rad": float(ylag.max()), "lag_m": lag}


def choose_k(max_lags: dict[float, list[float]], *, limit: float = LAG_LIMIT_M, quantile: float = LAG_QUANTILE,
             choices=K_CHOICES) -> float | None:
    """The lead's rule: the smallest k (of choices) whose quantile, over the episodes, of the per-episode largest lag
    is at most limit; None if none is."""
    for k in sorted(choices):
        if k in max_lags and float(np.percentile(max_lags[k], quantile)) <= limit:
            return k
    return None


class HumanPathTeacher:
    """sim_eval.teacher.Teacher replaying one human path, slowed by k and capped as the RL teacher's env caps it.
    Its first step caps from the observed tool (after a reset, as RLTeacher), every later one from its own previous
    target. Never abstains: after the path it holds the last point until the rollout ends.

    grip_settle_m (off by default): at each change of the human's gripper command, the path's clock stops at the
    point where it changes, and the teacher keeps commanding that point (capped as always) with the previous gripper,
    until the tool is within grip_settle_m of it, at most grip_settle_max_s; then the change runs. A held step leaves
    the tool short of its target (the held RL teacher's episodes: 24 mm at its close), and the cap's target lags a fast
    descent, so without it the fingers close above where the human closed them."""

    execution = "held"  # sim_eval.teacher.execution_mismatch: only a held rollout may run it

    def __init__(self, path: HumanPath, k: float, *, v_max: float = rt.V_MAX, yaw_rate_max: float = rt.YAW_RATE_MAX,
                 grip_settle_m: float | None = None, grip_settle_max_s: float = 1.0):
        self.path, self.k, self.v_max, self.yaw_rate_max = path, float(k), v_max, yaw_rate_max
        self.grip_settle_m, self.grip_settle_max = grip_settle_m, int(round(grip_settle_max_s / STEP_S))
        self.name = f"held-human-k{self.k:g}" + (f"-settle{grip_settle_m * 1000:g}mm" if grip_settle_m else "")
        self.waits: list[int] = []  # steps waited at each gripper change (this rollout)
        self.reset(None)

    def reset(self, scene: Scene | None) -> None:
        self._prev: tuple[np.ndarray, np.ndarray] | None = None
        self._j = 0  # the path's clock (control steps); state.k when nothing waits
        self._grip: int | None = None  # the gripper last commanded
        self._wait = 0
        self.waits = []

    def act(self, state) -> TeacherAction:
        tcp = np.asarray(state.tcp_pos, dtype=np.float64).reshape(1, 3)
        if self._prev is None:
            self._prev = (tcp, rt.tool_yaw(np.asarray(state.tcp_quat_wxyz, dtype=np.float64).reshape(1, 4)))
        pos, yaw, grip = self.path.at(self._j, self.k)
        change = self.grip_settle_m is not None and self._grip is not None and grip != self._grip
        if (change and self._wait < self.grip_settle_max
                and float(np.linalg.norm(tcp[0] - pos)) > self.grip_settle_m):
            self._wait += 1  # the path's clock waits at the change; its point, the previous gripper
            return self._command(pos, yaw, tcp, self._grip)
        if change:
            self.waits.append(self._wait)
        self._wait = 0
        self._j += 1
        return self._command(pos, yaw, tcp, grip)

    def _command(self, pos, yaw, tcp, grip) -> TeacherAction:
        cpos, cyaw = rt.cap_speed(pos.reshape(1, 3), np.array([yaw]), *self._prev, tcp, self.v_max,
                                  self.yaw_rate_max)
        self._prev, self._grip = (cpos, cyaw), grip
        return TeacherAction(ee_pos=cpos[0], ee_quat_wxyz=rt._down_turned(cyaw)[0], gripper=grip)


def max_seconds(path: HumanPath, k: float, grip_settle_max_s: float = 0.0) -> float:
    """The rollout's time limit: the slowed path plus SETTLE_S, plus the longest wait at each gripper change."""
    return path.t[-1] * k + SETTLE_S + grip_settle_max_s * int(np.count_nonzero(np.diff(path.gripper)))


def rollout_diagnostics(r: Rollout) -> dict:
    """Where a rollout went wrong, for its row (diagnostics only, nothing reads them back): the first step of each
    arm contact (bin, table) and how many, the gripper-cube contact steps, the cube's start and highest z, the tool's
    lowest z, and at each change of the commanded gripper the tool after that step against its target (mm)."""
    recs = r.records
    if not recs:
        return {}

    def first(flags):
        idx = [i for i, f in enumerate(flags) if f]
        return (idx[0] if idx else None), len(idx)

    first_bin, n_bin = first(x.contact_arm_bin for x in recs)
    first_table, n_table = first(x.contact_arm_table for x in recs)
    first_grasp, n_grasp = first(x.contact_gripper_cube for x in recs)
    cube_z = [float(x.cube_pos[2]) for x in recs]
    grip = r.teacher_ee[:, 7]
    changes = []
    for k in np.flatnonzero(np.diff(grip) != 0) + 1:
        if k < len(recs):
            d = np.asarray(recs[k].tcp_pos, dtype=np.float64) - r.teacher_ee[k, :3]
            changes.append({"step": int(k), "to": int(grip[k]),
                            "tool_target_mm": round(float(np.linalg.norm(d)) * 1000, 1),
                            "tool_minus_target_z_mm": round(float(d[2]) * 1000, 1)})
    return {"first_arm_bin": first_bin, "arm_bin_steps": n_bin, "first_arm_table": first_table,
            "arm_table_steps": n_table, "first_grip_cube_contact": first_grasp, "grip_cube_contact_steps": n_grasp,
            "cube_z_start": round(cube_z[0], 4), "cube_z_max": round(max(cube_z), 4),
            "tool_z_min": round(min(float(x.tcp_pos[2]) for x in recs), 4), "grip_changes": changes}


def pilot_decision(successes: list[bool | None], pilot_min: int) -> str | None:
    """The pilot rule (Amendment 1): the pilot episodes' outcomes in order (None: not run yet). None until all have
    run; then "continue" if at least pilot_min passed, else "stop"."""
    if any(s is None for s in successes):
        return None
    return "continue" if sum(bool(s) for s in successes) >= pilot_min else "stop"


def write_held_episode(root: Path, r: Rollout, scene: Scene, *, source: Path, k: float, teacher_name: str,
                       v_max: float = rt.V_MAX, yaw_rate_max: float = rt.YAW_RATE_MAX, robot: str = "franka",
                       extra: dict | None = None, save_image=_save_png) -> dict | None:
    """The rollout as one training episode in <root>/episodes/held_<source demo id>/, if it passed check_success
    (else None): write_rollout's teacher episode ("after" pairing) under the source's lineage + this name, with the
    achieved tool path as trajectory.json and distill.json (provenance: kind "held_human", source, k, the caps, and
    extra: the grasp wait's settings and waits)."""
    if not r.success or r.verdict is None or r.driver != "teacher" or r.teacher_execution != "held":
        return None
    src = EpisodeMeta.model_validate_json((Path(source) / "episode.json").read_text(encoding="utf-8"))
    segs = label_segments(r)
    if len(segs) != 1 or segs[0] != (0, len(r.records)):
        raise ValueError(f"{src.demo_id}: a human-path teacher labels every step, got segments {segs}")
    obs, lab = _rows(segs[0], len(r.records), "after")
    name = f"{HELD_PREFIX}{src.demo_id}"
    lineage = (list(src.passport.lineage) if src.passport else [src.demo_id]) + [name]
    ep = episodes_dir(Path(root)) / name
    meta = EpisodeMeta(demo_id=name, robot=robot, task_text=TASK_TEXT, fps=src.fps, n_steps=len(lab),
                       cameras=sorted(r.images),
                       passport=passport(name, lineage, r.verdict, robot=robot,
                                         variant_seed=src.passport.variant_seed if src.passport else None))
    grip = r.teacher_ee[lab, 7].astype(np.int8)
    save_episode(ep, meta, {
        "joint_pos": r.joint_pos[obs].astype(np.float32),
        "action": r.label[lab].astype(np.float32),
        "ee_pos": r.tcp_pos[obs].astype(np.float32),
        "ee_quat": r.tcp_quat_wxyz[obs].astype(np.float32),
        "gripper": grip,
    })
    for cam, imgs in r.images.items():
        for j, i in enumerate(obs):
            save_image(image_path(ep, cam, j), imgs[i])
    np.savez_compressed(ep / "teacher.npz", teacher_ee=r.teacher_ee[lab], executed=r.executed[lab],
                        by_teacher=r.by_teacher[lab], label_first=r.label_first[lab], label_last=r.label_last[lab],
                        obs_step=obs, label_step=lab)
    (ep / "scene.json").write_text(scene.model_dump_json(indent=1), encoding="utf-8")
    achieved = Trajectory.from_arrays(np.arange(len(obs)) * STEP_S, r.tcp_pos[obs], r.tcp_quat_wxyz[obs], grip)
    (ep / "trajectory.json").write_text(achieved.model_dump_json(), encoding="utf-8")
    arm, gdis = _disagreement(r)
    prov = {
        "kind": "held_human", "source_demo_id": src.demo_id, "source_episode": str(Path(source)), "k": k,
        "v_max": v_max, "yaw_rate_max": yaw_rate_max, "delta_m": rt.DELTA_M, "teacher": teacher_name, "seed": r.seed,
        "n_steps": len(lab), "pairing": "after", "teacher_execution": "held",
        "label": "held target (one DLS step, as executed)", "trajectory": "achieved",
        "rollout": {"success": r.success, "ended_by": r.ended_by, "reasons": list(r.reasons),
                    "steps": len(r.records), "arm_disagreement": arm, "gripper_disagreement": gdis},
        "created": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        **(extra or {}),
    }
    (ep / "distill.json").write_text(json.dumps(prov, indent=1), encoding="utf-8")
    return {"name": name, "ep_dir": str(ep), "n_steps": len(lab)}


def human_grid(episode_dirs: list[Path], *, n_human: int, name: str, label: str = LABEL) -> dict:
    """The one-cell SANT grid (lerobot_tools.experiments.Grid) T6's distill round reads with --human-grid /
    --human-cell <label>. Grid forbids extra keys: k and the caps are in each episode's distill.json."""
    if not episode_dirs:
        raise ValueError("no held human episode passed: nothing to put in the grid")
    return {"name": name, "cells": [{"condition": "perfected_multiply", "n_human": n_human, "label": label,
                       "episode_dirs": [str(Path(d)) for d in episode_dirs]}]}
