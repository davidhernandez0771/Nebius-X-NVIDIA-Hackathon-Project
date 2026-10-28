"""What went wrong in one policy episode, measured from its step trace (sim_eval.recording.StepTracer). numpy only.

The failure analyst (app.ai.failure_analyst) reads these numbers, never pixels: every VLM/LLM role that measurably
helped a robot data pipeline was handed measured state (2026-10-22 research report), and Nemotron judging from frames
alone called centred grasps off-centre (sprint 6). Code also assigns each episode its failure class, by rules, so the
model's job is the pattern across episodes and scenes, not the label of one.

A trace is {field: (T, ...)}: tcp_pos, cube_pos, gripper (0 open / 1 closed, commanded), contact_gripper_cube,
contact_arm_bin, contact_arm_table, max_contact_force. Row k is the record after action k (50 Hz).

Failure classes, each an event with a time; an episode's primary class is its earliest event:
  missed_reach    the fingertips never came within REACH_TOL of the cube before the first close
  missed_grasp    reached, closed, but never held the cube (no contact while closed)
  no_lift         held the cube but never raised it LIFT_MIN off the table
  dropped         held and lifted, then lost it with the gripper still closed and the cube not over the bin
  collision_table arm or gripper pressed the table above the 5 N collision limit
  collision_bin   arm or gripper pressed the bin above the 5 N collision limit
  release_outside opened with the cube in the fingers, not over the bin
  high_release    opened over the bin with the cube more than 0.18 m above the bin origin (success.py)
  stuck           none of the above, and not in the bin: the policy stopped making progress
  collision       (result only) the eval reported a collision; without a trace, table or bin is unknown

Without a trace (an eval run without --trace), result_features builds the same record from the eval's own result
row: the scene, check_success's reasons and where the cube ended. The grasp and motion measurements are then None.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Literal

import numpy as np
from pydantic import BaseModel, ConfigDict

from .multiply import nearest_face_yaw, _yaw
from .schemas import Scene
from .success import COLLISION_FORCE_N, _to_bin_frame

FailureClass = Literal["missed_reach", "missed_grasp", "no_lift", "dropped", "collision_table", "collision_bin",
                       "release_outside", "high_release", "stuck", "collision"]
FAILURE_CLASSES: tuple[str, ...] = FailureClass.__args__  # type: ignore[attr-defined]
Phase = Literal["approach", "grasp", "carry", "place", "after_release"]

FPS = 50
REACH_TOL = 0.03  # m, fingertip centre to cube centre (xy) counted as reaching it
LIFT_MIN = 0.03  # m above its start height counted as lifted
RELEASE_HEIGHT_MAX = 0.18  # m above the bin origin, as success.check_success
BIN_INNER = (0.20, 0.20, 0.08)
EVAL_SEED_MIN = 5000  # sim_eval.scenes: unseen scenes start here
TEST_SEEDS = ((5020, 5059), (5400, 5439))  # the pre-registered tests: distill final, big test (sim_eval.distill_round)
TRACE_FIELDS = ("tcp_pos", "cube_pos", "gripper", "contact_gripper_cube", "contact_arm_bin", "contact_arm_table",
                "max_contact_force")


class SceneFeatures(BaseModel):
    model_config = ConfigDict(extra="forbid")

    cube_x: float
    cube_y: float
    cube_yaw_deg: float  # turned to the nearest face, [-45, 45]: what the grasp has to match
    bin_x: float
    bin_y: float
    carry_dist: float  # m, cube to bin centre (xy)
    carry_dir_deg: float  # heading from cube to bin, 0 = +x (away from the robot), 90 = +y (robot's left)

    @classmethod
    def of(cls, scene: Scene) -> "SceneFeatures":
        c, b = scene.cube_pose.pos, scene.bin_pose.pos
        dx, dy = b[0] - c[0], b[1] - c[1]
        return cls(cube_x=c[0], cube_y=c[1], cube_yaw_deg=math.degrees(nearest_face_yaw(_yaw(scene.cube_pose.quat_wxyz))),
                   bin_x=b[0], bin_y=b[1], carry_dist=math.hypot(dx, dy), carry_dir_deg=math.degrees(math.atan2(dy, dx)))


class FailureEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: FailureClass
    t: float  # s into the episode
    phase: Phase
    detail: dict[str, float]  # numbers that describe it (heights, forces, offsets), m / N / s


class EpisodeFeatures(BaseModel):
    """One episode, measured. Distances in m, times in s, forces in N. From a result row only (source "result"),
    every trace measurement is None."""

    model_config = ConfigDict(extra="forbid")

    seed: int
    success: bool
    duration: float
    scene: SceneFeatures
    source: Literal["trace", "result"] = "trace"
    reasons: list[str] = []  # the eval's check_success reason codes, when known
    min_reach_dist: float | None  # closest fingertip-to-cube (xy) before the first close
    t_first_close: float | None
    grasp_offset_xy: float | None  # fingertip to cube centre (xy) at the first close
    grasp_height: float | None  # fingertip z minus cube z at the first close
    held: bool | None  # cube in the fingers while closed at some point
    max_lift: float | None  # highest cube rise above its start while held
    gripper_toggles: int | None  # open/close changes of the command
    n_closes: int | None  # times the gripper was commanded closed (1 for a clean grasp; more is regrasping)
    carry_speed_median: float | None  # m/s, fingertips while holding the lifted cube; None if never lifted
    carry_speed_max: float | None
    held_s: float | None  # seconds the cube was in the closed fingers
    max_force_table: float | None  # largest force on steps the arm touched the table (0 if never)
    max_force_bin: float | None
    final_cube_to_bin_xy: float | None
    final_in_bin: bool
    idle_end_s: float | None  # seconds at the end with the fingertips moving < 1 cm/s
    events: list[FailureEvent]
    primary: FailureClass | None  # the earliest event; None for a success

    def row(self) -> dict:
        """A flat dict for a table (the prompt, a CSV)."""
        out = {"seed": self.seed, "success": self.success, "primary": self.primary,
               **{k: round(v, 3) for k, v in self.scene.model_dump().items()}}
        for k in ("min_reach_dist", "grasp_offset_xy", "grasp_height", "max_lift", "carry_speed_median",
                  "carry_speed_max", "held_s", "max_force_table", "max_force_bin", "final_cube_to_bin_xy",
                  "idle_end_s", "duration"):
            v = getattr(self, k)
            out[k] = None if v is None else round(v, 3)
        out["held"], out["closes"] = self.held, self.n_closes
        if self.reasons:
            out["reasons"] = self.reasons
        out["events"] = [f"{e.kind}@{e.t:.1f}s/{e.phase}" for e in self.events]
        return out


def _check_trace(trace: dict[str, np.ndarray]) -> int:
    missing = [f for f in TRACE_FIELDS if f not in trace]
    if missing:
        raise ValueError(f"the trace has no {', '.join(missing)} (record it with sim_eval.recording.StepTracer)")
    n = len(trace["gripper"])
    if n < 2:
        raise ValueError(f"the trace has {n} steps; at least 2 are needed")
    bad = [f for f in TRACE_FIELDS if len(trace[f]) != n]
    if bad:
        raise ValueError(f"trace fields {', '.join(bad)} don't have {n} steps like gripper")
    return n


def _phase(k: int, i_close: int | None, i_lift: int | None, i_release: int | None, near_bin: np.ndarray) -> Phase:
    if i_release is not None and k >= i_release:
        return "after_release"
    if i_close is None or k < i_close:
        return "approach"
    if i_lift is None or k < i_lift:
        return "grasp"
    return "place" if near_bin[k] else "carry"


def episode_features(trace: dict[str, np.ndarray], scene: Scene, *, success: bool, fps: int = FPS,
                     bin_inner: tuple[float, float, float] = BIN_INNER) -> EpisodeFeatures:
    n = _check_trace(trace)
    t = np.arange(n) / fps
    tcp = np.asarray(trace["tcp_pos"], dtype=np.float64)
    cube = np.asarray(trace["cube_pos"], dtype=np.float64)
    grip = np.asarray(trace["gripper"]).astype(np.int8)
    touch = np.asarray(trace["contact_gripper_cube"], dtype=bool)
    on_bin = np.asarray(trace["contact_arm_bin"], dtype=bool)
    on_table = np.asarray(trace["contact_arm_table"], dtype=bool)
    force = np.asarray(trace["max_contact_force"], dtype=np.float64)

    cube_b = _to_bin_frame(cube, scene.bin_pose)
    half_x, half_y, height = bin_inner[0] / 2, bin_inner[1] / 2, bin_inner[2]
    over_bin = (np.abs(cube_b[:, 0]) <= half_x) & (np.abs(cube_b[:, 1]) <= half_y)
    tcp_b = _to_bin_frame(tcp, scene.bin_pose)
    near_bin = (np.abs(tcp_b[:, 0]) <= half_x + 0.05) & (np.abs(tcp_b[:, 1]) <= half_y + 0.05)

    closed = np.flatnonzero(grip == 1)
    i_close = int(closed[0]) if closed.size else None
    held_mask = touch & (grip == 1)
    held = bool(held_mask.any())
    rise = cube[:, 2] - cube[0, 2]
    lifted_mask = held_mask & (rise > LIFT_MIN)
    i_lift = int(np.flatnonzero(lifted_mask)[0]) if lifted_mask.any() else None
    opens = np.flatnonzero((grip[:-1] == 1) & (grip[1:] == 0) & touch[:-1])  # opened with the cube in the fingers
    i_release = int(opens[0]) + 1 if opens.size else None

    pre = slice(0, max(1, i_close if i_close is not None else n))
    reach = np.linalg.norm(tcp[pre, :2] - cube[pre, :2], axis=1)
    min_reach = float(reach.min()) if reach.size else float("inf")

    def ph(k: int) -> Phase:
        return _phase(k, i_close, i_lift, i_release, near_bin)

    events: list[FailureEvent] = []
    if not success:
        if min_reach > REACH_TOL:
            k = i_close if i_close is not None else n - 1
            events.append(FailureEvent(kind="missed_reach", t=float(t[k]), phase=ph(k),
                                       detail={"min_reach_dist": min_reach}))
        elif i_close is not None and not held:
            events.append(FailureEvent(kind="missed_grasp", t=float(t[i_close]), phase="grasp",
                                       detail={"grasp_offset_xy": float(np.linalg.norm(tcp[i_close, :2] - cube[i_close, :2]))}))
        elif held and i_lift is None:
            k = int(np.flatnonzero(held_mask)[0])
            events.append(FailureEvent(kind="no_lift", t=float(t[k]), phase="grasp",
                                       detail={"max_rise": float(rise[held_mask].max())}))
        lost = held_mask[:-1] & ~touch[1:] & (grip[1:] == 1) & ~over_bin[1:]
        if i_lift is not None:
            lost[:i_lift] = False
        if lost.any():
            k = int(np.flatnonzero(lost)[0]) + 1
            speed = float(np.linalg.norm(tcp[k] - tcp[k - 1]) * fps)
            events.append(FailureEvent(kind="dropped", t=float(t[k]), phase=ph(k - 1),
                                       detail={"cube_height": float(rise[k]), "tcp_speed": speed,
                                               "dist_to_bin_xy": float(np.hypot(*cube_b[k, :2]))}))
        for kind, mask in (("collision_table", on_table), ("collision_bin", on_bin)):
            hit = mask & (force > COLLISION_FORCE_N)
            if hit.any():
                k = int(np.flatnonzero(hit)[0])
                events.append(FailureEvent(kind=kind, t=float(t[k]), phase=ph(k),
                                           detail={"force": float(force[hit].max()), "tcp_z": float(tcp[k, 2]),
                                                   "steps_over_limit": float(hit.sum())}))
        for j in opens:
            if not over_bin[j]:
                events.append(FailureEvent(kind="release_outside", t=float(t[j + 1]), phase="place",
                                           detail={"dist_to_bin_xy": float(np.hypot(*cube_b[j, :2]))}))
                break
            if cube_b[j, 2] > RELEASE_HEIGHT_MAX:
                events.append(FailureEvent(kind="high_release", t=float(t[j + 1]), phase="place",
                                           detail={"cube_height_over_bin": float(cube_b[j, 2])}))
                break
        if not events:
            events.append(FailureEvent(kind="stuck", t=float(t[-1]), phase=ph(n - 1),
                                       detail={"final_cube_to_bin_xy": float(np.hypot(*cube_b[-1, :2]))}))
        events.sort(key=lambda e: e.t)

    tcp_speed = np.linalg.norm(np.diff(tcp, axis=0), axis=1) * fps
    moving = np.flatnonzero(tcp_speed >= 0.01)
    idle_end = float(t[-1] - t[moving[-1] + 1]) if moving.size else float(t[-1])

    def max_force(mask: np.ndarray) -> float:
        return float(force[mask].max()) if mask.any() else 0.0

    carrying = lifted_mask[1:]  # step k+1's speed over the step into it, while the lifted cube is held
    carry_speeds = tcp_speed[carrying]

    return EpisodeFeatures(
        seed=scene.seed, success=success, duration=float(t[-1]), scene=SceneFeatures.of(scene),
        min_reach_dist=min_reach,
        t_first_close=None if i_close is None else float(t[i_close]),
        grasp_offset_xy=None if i_close is None else float(np.linalg.norm(tcp[i_close, :2] - cube[i_close, :2])),
        grasp_height=None if i_close is None else float(tcp[i_close, 2] - cube[i_close, 2]),
        held=held, max_lift=float(rise[held_mask].max()) if held else 0.0,
        gripper_toggles=int(np.count_nonzero(np.diff(grip))),
        n_closes=int(grip[0] == 1) + int(np.count_nonzero((grip[:-1] == 0) & (grip[1:] == 1))),
        carry_speed_median=float(np.median(carry_speeds)) if carry_speeds.size else None,
        carry_speed_max=float(carry_speeds.max()) if carry_speeds.size else None,
        held_s=float(held_mask.sum()) / fps,
        max_force_table=max_force(on_table), max_force_bin=max_force(on_bin),
        final_cube_to_bin_xy=float(np.hypot(*cube_b[-1, :2])),
        final_in_bin=bool(over_bin[-1] and 0.0 <= cube_b[-1, 2] <= height),
        idle_end_s=idle_end, events=events, primary=events[0].kind if events else None,
    )


# check_success reason -> failure class, most specific first, for an episode with no trace (no event times)
REASON_CLASSES = (("dropped", "dropped"), ("high_release", "high_release"), ("collision", "collision"))


def read_episode_log(path: Path) -> list[dict]:
    """An eval's episode log (<name>.episodes.jsonl): a header line, then {"episode": {...}} per line. The last row
    per seed wins, as a resume reads it; rows come back in seed order."""
    latest: dict[int, dict] = {}
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        rec = json.loads(line) if line.strip() else {}
        if "episode" in rec:
            latest[int(rec["episode"]["seed"])] = rec["episode"]
    return [latest[s] for s in sorted(latest)]


def result_features(row: dict, scene: Scene, *, bin_inner: tuple[float, float, float] = BIN_INNER) -> EpisodeFeatures:
    """An eval result row ({seed, success, reasons, sim_s, final_cube_pos}, sim_eval run_eval) -> the episode's record
    without a trace: the scene, the reasons, where the cube ended. Its class comes from the reasons, so it is coarser
    than a traced one (no times, no grasp or motion measurements)."""
    success = bool(row["success"])
    reasons = [str(r) for r in row.get("reasons") or []]
    primary = None
    if not success:
        primary = next((c for r, c in REASON_CLASSES if r in reasons), "stuck")
    final = row.get("final_cube_pos")
    to_bin, in_bin = None, success
    if final is not None:
        fb = _to_bin_frame(np.asarray([final], dtype=np.float64), scene.bin_pose)[0]
        to_bin = float(np.hypot(fb[0], fb[1]))
        in_bin = bool(abs(fb[0]) <= bin_inner[0] / 2 and abs(fb[1]) <= bin_inner[1] / 2 and 0.0 <= fb[2] <= bin_inner[2])
    duration = float(row.get("sim_s") or 0.0)
    events = [] if primary is None else [FailureEvent(kind=primary, t=duration, phase="after_release" if in_bin
                                                      else "carry", detail={"final_cube_to_bin_xy": to_bin})]
    return EpisodeFeatures(
        seed=int(row["seed"]), success=success, duration=duration, scene=SceneFeatures.of(scene), source="result",
        reasons=reasons, min_reach_dist=None, t_first_close=None, grasp_offset_xy=None, grasp_height=None, held=None,
        max_lift=None, gripper_toggles=None, n_closes=None, carry_speed_median=None, carry_speed_max=None, held_s=None,
        max_force_table=None, max_force_bin=None, final_cube_to_bin_xy=to_bin, final_in_bin=in_bin, idle_end_s=None,
        events=events, primary=primary,
    )
