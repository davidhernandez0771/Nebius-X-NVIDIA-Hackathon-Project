"""What the person did, and does the copy still do it: the pure half of Nemotron's labeler and judge.

Physics (Isaac Lab) judges whether a demo *works*. Nemotron 3.5 Super VL says what the person
*did*: a task label with steps and objects (`Label`), and whether a physics-checked copy still
does what the human intended (`Verdict`). The model calls live in `app.ai.intent`; this module has
everything that is code:

- the reply schemas and their validation (`parse_label`, `parse_verdict`);
- the trajectory summary the model reads next to the frames (`summarize`);
- the two deliberate perturbations used to build wrong pairs (`recolor_cube`, `reverse_trajectory`);
- the code baselines the model is measured against (`code_label`, `code_judge`), built from the
  same inputs the model gets (the sampled frames and the summary, no sim state);
- scoring (`truth_events`, `score_label`).

Pre-registered test: docs/superpowers/notes/2026-10-18-nemotron-judge.md.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Literal

import numpy as np
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from demo_pipeline.schemas import Trajectory

StepName = Literal["reach", "grasp", "carry", "release"]
STEP_ORDER: tuple[str, ...] = ("reach", "grasp", "carry", "release")
Destination = Literal["bin", "table", "unknown"]

# A step boundary within this of the truth counts as right (pre-registered).
STEP_TOLERANCE_S = 0.5
# How long "grasp" lasts after the gripper closes, for the code baseline's step ranges.
GRASP_S = 0.5


class IntentError(ValueError):
    """A reply that is not valid JSON for the schema, or breaks a rule the schema can't express."""


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Step(_Model):
    name: StepName
    frames: tuple[int, int]  # first and last episode frame, inclusive


class ObjectRef(_Model):
    name: str = Field(min_length=1)
    color: str | None = None


class Label(_Model):
    """What the person did (labeler output)."""

    task: str = Field(min_length=1)
    object: ObjectRef  # the object that is picked up and moved
    destination: Destination  # where that object ends up
    objects: list[ObjectRef]  # everything relevant in view
    steps: list[Step]
    confidence: float = Field(ge=0, le=1)


class Verdict(_Model):
    """Does the copy still do what the human intended (judge output)."""

    same_object: bool
    same_goal: bool
    same_order: bool
    copy_completes: bool
    matches: Literal["yes", "no"]
    reason: str = Field(min_length=1)
    confidence: float = Field(ge=0, le=1)


# --- frames and the trajectory summary ------------------------------------------------------------


def sample_indices(n: int, k: int) -> list[int]:
    """k frame indices spread evenly over n frames, first and last included (fewer if n < k)."""
    if n <= k:
        return list(range(n))
    return sorted({round(i * (n - 1) / (k - 1)) for i in range(k)})


def _events(gripper: list[int]) -> tuple[list[int], list[int]]:
    closes = [i for i in range(1, len(gripper)) if gripper[i] == 1 and gripper[i - 1] == 0]
    opens = [i for i in range(1, len(gripper)) if gripper[i] == 0 and gripper[i - 1] == 1]
    if gripper and gripper[0] == 1:
        closes.insert(0, 0)
    return closes, opens


@dataclass(frozen=True)
class Summary:
    fps: float
    n_frames: int
    duration: float
    close_frames: list[int]
    open_frames: list[int]
    ee_start: tuple[float, float, float]
    ee_end: tuple[float, float, float]
    z_at_close: float | None
    z_at_open: float | None
    z_min: float
    z_max: float
    path_length: float

    def render(self) -> str:
        """The summary as the prompt shows it: frames, times in seconds, positions in metres."""

        def at(f: int) -> str:
            return f"frame {f} ({f / self.fps:.2f} s)"

        def xyz(p: tuple[float, float, float]) -> str:
            return "(" + ", ".join(f"{v:.3f}" for v in p) + ")"

        lines = [
            f"- frames: {self.n_frames} at {self.fps:g} fps, {self.duration:.2f} s",
            f"- gripper closes at: {', '.join(at(f) for f in self.close_frames) or 'never'}",
            f"- gripper opens at: {', '.join(at(f) for f in self.open_frames) or 'never'}",
            f"- hand position start {xyz(self.ee_start)}, end {xyz(self.ee_end)} (x forward, y left, z up, metres)",
            f"- hand height: min {self.z_min:.3f} m, max {self.z_max:.3f} m"
            + (f", at the close {self.z_at_close:.3f} m" if self.z_at_close is not None else "")
            + (f", at the open {self.z_at_open:.3f} m" if self.z_at_open is not None else ""),
            f"- hand path length: {self.path_length:.2f} m",
        ]
        return "\n".join(lines)


def summarize(traj: Trajectory, fps: float) -> Summary:
    pos = np.asarray(traj.ee_pos, dtype=float)
    closes, opens = _events(list(traj.gripper))
    first_close = closes[0] if closes else None
    open_after = next((o for o in opens if first_close is not None and o > first_close), None)
    return Summary(
        fps=fps,
        n_frames=len(pos),
        duration=float(traj.t[-1] - traj.t[0]),
        close_frames=closes,
        open_frames=opens,
        ee_start=tuple(float(v) for v in pos[0]),
        ee_end=tuple(float(v) for v in pos[-1]),
        z_at_close=float(pos[first_close, 2]) if first_close is not None else None,
        z_at_open=float(pos[open_after, 2]) if open_after is not None else None,
        z_min=float(pos[:, 2].min()),
        z_max=float(pos[:, 2].max()),
        path_length=float(np.linalg.norm(np.diff(pos, axis=0), axis=1).sum()),
    )


def truth_events(traj: Trajectory) -> tuple[int, int]:
    """(first close, the open after it): the grasp and release boundaries the steps are scored on."""
    closes, opens = _events(list(traj.gripper))
    if not closes:
        raise IntentError("the gripper never closes")
    after = [o for o in opens if o > closes[0]]
    if not after:
        raise IntentError("the gripper never opens after closing")
    return closes[0], after[0]


# --- the deliberate perturbations ----------------------------------------------------------------


def reverse_trajectory(traj: Trajectory) -> Trajectory:
    """The same demo played backwards: the cube comes out of the bin and goes back where it started."""
    t_end = traj.t[-1]
    return Trajectory(
        t=[t_end - t for t in reversed(traj.t)],
        ee_pos=list(reversed(traj.ee_pos)),
        ee_quat=list(reversed(traj.ee_quat)),
        gripper=list(reversed(traj.gripper)),
    )


def _red(img: np.ndarray) -> np.ndarray:
    r, g, b = (img[..., i].astype(int) for i in range(3))
    return (r > 120) & (r > 1.6 * g) & (r > 1.6 * b)


def _green(img: np.ndarray) -> np.ndarray:
    r, g, b = (img[..., i].astype(int) for i in range(3))
    return (g > 120) & (g > 1.6 * r) & (g > 1.6 * b)


def _blue(img: np.ndarray) -> np.ndarray:
    r, g, b = (img[..., i].astype(int) for i in range(3))
    return (b > 150) & (b > r + 60) & (b > g + 30)


def recolor_cube(img: np.ndarray) -> np.ndarray:
    """The red cube turned green (red and green channels swapped on red pixels only): a different object."""
    out = img.copy()
    mask = _red(img)
    out[mask] = img[mask][:, [1, 0, 2]]
    return out


# --- the code baselines: same inputs as the model, no sim state ----------------------------------

MIN_CUBE_PIXELS = 4


def _cube_mask(img: np.ndarray) -> np.ndarray:
    return _red(img) | _green(img)


def cube_color(frames: list[np.ndarray]) -> str | None:
    """'red' or 'green', by pixel count over the frames; None if no cube is seen."""
    red = sum(int(_red(f).sum()) for f in frames)
    green = sum(int(_green(f).sum()) for f in frames)
    if max(red, green) < MIN_CUBE_PIXELS:
        return None
    return "red" if red >= green else "green"


def cube_in_bin(img: np.ndarray) -> bool | None:
    """Is the cube's centre inside the bin's box in this image? None if no cube is in view."""
    cube = np.argwhere(_cube_mask(img))
    if len(cube) < MIN_CUBE_PIXELS:
        return None
    blue = np.argwhere(_blue(img))
    if len(blue) == 0:
        return False
    cy, cx = cube.mean(axis=0)
    (y0, x0), (y1, x1) = blue.min(axis=0), blue.max(axis=0)
    return bool(y0 <= cy <= y1 and x0 <= cx <= x1)


def _destination(last: np.ndarray) -> Destination:
    where = cube_in_bin(last)
    return "unknown" if where is None else ("bin" if where else "table")


def code_steps(s: Summary) -> list[Step]:
    """Steps from the gripper events: reach to the close, a short grasp, carry to the open, release."""
    if not s.close_frames:
        return []
    c = s.close_frames[0]
    o = next((f for f in s.open_frames if f > c), s.n_frames - 1)
    g = min(c + round(GRASP_S * s.fps), o - 1)
    return [
        Step(name="reach", frames=(0, max(c - 1, 0))),
        Step(name="grasp", frames=(c, g)),
        Step(name="carry", frames=(min(g + 1, o - 1), o - 1)),
        Step(name="release", frames=(o, s.n_frames - 1)),
    ]


def code_label(frames: list[np.ndarray], s: Summary) -> Label:
    """The labeler's code baseline: cube colour and where it ends from pixels, steps from the gripper."""
    color = cube_color(frames)
    dest = _destination(frames[-1])
    where = {"bin": "in the blue bin", "table": "on the table", "unknown": "somewhere"}[dest]
    return Label(
        task=f"pick up the {color or 'unknown'} cube and put it {where}",
        object=ObjectRef(name="cube", color=color),
        destination=dest,
        objects=[ObjectRef(name="cube", color=color), ObjectRef(name="bin", color="blue")],
        steps=code_steps(s),
        confidence=1.0,
    )


def _grasp_below_release(s: Summary) -> bool | None:
    if s.z_at_close is None or s.z_at_open is None:
        return None
    return s.z_at_close < s.z_at_open


def code_judge(human: tuple[list[np.ndarray], Summary], copy: tuple[list[np.ndarray], Summary]) -> Verdict:
    """The judge's code baseline: same cube colour, same final place, grasp-low/release-high in both,
    and the copy's cube ends in the bin."""
    (h_frames, h_sum), (c_frames, c_sum) = human, copy
    same_object = cube_color(h_frames) == cube_color(c_frames)
    h_dest, c_dest = _destination(h_frames[-1]), _destination(c_frames[-1])
    same_goal = h_dest == c_dest and h_dest != "unknown"
    h_order, c_order = _grasp_below_release(h_sum), _grasp_below_release(c_sum)
    same_order = c_order is not None and h_order == c_order
    completes = c_dest == "bin"
    checks = {"same_object": same_object, "same_goal": same_goal, "same_order": same_order, "copy_completes": completes}
    failed = [k for k, v in checks.items() if not v]
    return Verdict(
        **checks,
        matches="no" if failed else "yes",
        reason=("failed checks: " + ", ".join(failed)) if failed else "all checks pass",
        confidence=1.0,
    )


# --- parsing the model's replies ------------------------------------------------------------------


def _json_object(text: str) -> dict:
    t = text.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", t, re.S)
    if fence:
        t = fence.group(1).strip()
    start, end = t.find("{"), t.rfind("}")
    if start < 0 or end <= start:
        raise IntentError("the reply has no JSON object")
    try:
        obj = json.loads(t[start : end + 1])
    except json.JSONDecodeError as e:
        raise IntentError(f"the reply is not valid JSON: {e}") from e
    if not isinstance(obj, dict):
        raise IntentError("the reply must be one JSON object")
    return obj


def parse_label(text: str, n_frames: int) -> Label:
    """A Label whose steps are reach, grasp, carry, release, in that order, inside the clip."""
    try:
        lab = Label.model_validate(_json_object(text))
    except ValidationError as e:
        raise IntentError(f"the label does not match the schema: {e.errors()[:3]}") from e
    if [s.name for s in lab.steps] != list(STEP_ORDER):
        raise IntentError(f"steps must be {', '.join(STEP_ORDER)} in that order, got {[s.name for s in lab.steps]}")
    for s in lab.steps:
        a, b = s.frames
        if not 0 <= a <= b <= n_frames - 1:
            raise IntentError(f"step {s.name} has frames {a}-{b}; frames run 0-{n_frames - 1}, first <= last")
    starts = [s.frames[0] for s in lab.steps]
    if starts != sorted(starts):
        raise IntentError(f"step start frames must follow the step order, got {starts}")
    return lab


def parse_verdict(text: str) -> Verdict:
    """A Verdict whose `matches` is "yes" exactly when all four checks pass."""
    try:
        v = Verdict.model_validate(_json_object(text))
    except ValidationError as e:
        raise IntentError(f"the verdict does not match the schema: {e.errors()[:3]}") from e
    all_pass = v.same_object and v.same_goal and v.same_order and v.copy_completes
    if (v.matches == "yes") != all_pass:
        raise IntentError('matches must be "yes" exactly when same_object, same_goal, same_order and copy_completes are all true')
    return v


# --- scoring ------------------------------------------------------------------------------------


def score_label(lab: Label, *, color: str, destination: str, events: tuple[int, int], fps: float) -> dict[str, bool]:
    """Pre-registered: colour and destination right (together: the task); grasp and release starts
    within STEP_TOLERANCE_S of the true close and open."""
    color_ok = (lab.object.color or "").strip().lower() == color
    dest_ok = lab.destination == destination
    by_name = {s.name: s for s in lab.steps}
    tol = STEP_TOLERANCE_S * fps
    steps_ok = (
        list(by_name) == list(STEP_ORDER)
        and abs(by_name["grasp"].frames[0] - events[0]) <= tol
        and abs(by_name["release"].frames[0] - events[1]) <= tol
    )
    return {"color": color_ok, "destination": dest_ok, "task": color_ok and dest_ok, "steps": steps_ok}
