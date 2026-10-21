"""Diagnose one recorded demo with Nemotron 3.5 Super VL (spec 8.3).

Input: evenly spaced front-camera frames (each captioned with its time), an
optional wrist frame at the first gripper close, the code-computed metrics
table, the task text and the replay success flag. Output: a validated
`Diagnosis` (spec 7) whose times all lie inside the demo.

Invalid replies are retried once with the validation error appended to the
prompt; after that `DiagnosisError` is raised and the caller falls back to the
rules detector (wired by the lead, not here).

The repair menu, issue types and segment names in the prompt are generated from
the `Literal`s and op models in `demo_pipeline.schemas`, so the prompt and the
validator cannot drift apart.
"""
from __future__ import annotations

import json
import math
import statistics
from dataclasses import dataclass
from typing import get_args

import numpy as np
from pydantic import ValidationError

from demo_pipeline import scene_geometry
from demo_pipeline.rules import JITTER_MIN_JERK, MIN_STILL_S, STILL_SPEED, detect_rules
from demo_pipeline.schemas import (
    Diagnosis,
    Issue,
    IssueType,
    MetricsWindow,
    Pose,
    RepairOp,
    SegmentName,
    SimSignals,
    Trajectory,
)
from nebius_llm import chat_vision_images

DIAGNOSE_TIER = "nemotron-vl"
DIAGNOSE_MAX_TOKENS = 2048
# Token Factory rejects more: "At most 8 image(s) may be provided in one prompt"
# (HTTP 400, live call 2026-10-15). Spec 8.3's 10 front + 1 wrist frames do not fit.
MAX_IMAGES = 8
# Thinking off: verified for Nemotron 3.5 text models (nebius_llm.client.chat);
# the plan asks for the same switch on the VL model.
DIAGNOSE_EXTRA_BODY = {"chat_template_kwargs": {"enable_thinking": False}}

# Calibration (2026-10-16). On T2's clean scripted episode (pm-t2 data/smoke_cam) the model
# reported 5 false issues. Measured there: moving 0.5 s windows run at 0.07-0.26 m/s (median
# 0.135); single windows dip to 0.03-0.04 m/s at the grasp hold, the top of the lift and the
# release; jerk_rms is 0.5-6, highest at the grasp.
CLEAN_MOVING_SPEED = (0.07, 0.26)  # m/s
# "slow" = median window speed over the span below this. 5x the rules' STILL_SPEED, about a third
# of the clean expert's median: human teleop is naturally slower than the scripted expert, so only
# a span ~3x slower than it is worth retiming. Above STILL_SPEED, so a pause also counts as slow.
SLOW_SPEED = 5 * STILL_SPEED  # m/s

# The rules emit these from the replay's contacts and cube track; the model's menu (and so its prompt) leaves them
# out, so earlier Nemotron runs and their pre-registrations keep the prompt they were run with.
RULES_ONLY_OPS = ("release_above_bin", "retime_grasp")
RULES_ONLY_ISSUES = ("swoop_grasp",)

# What each repair op does; its fields come from the schema model itself.
_OP_HELP = {
    "trim": "keep only [t0, t1]; cut idle time at the start and end",
    "remove_pause": "cut out the pause [t0, t1] and stitch the motion together",
    "smooth": "smooth jittery motion in [t0, t1]; strength is low, med or high",
    "retime": "replay the path in [t0, t1] at constant target_speed (m/s)",
    "recenter_grasp": "shift the approach so the gripper closes at the cube center; t is the grasp (close) time",
    "replan_transit": "replace [t0, t1] by a lift over the bin rim with 0.10 m clearance, then a descent",
    "discard": "the demo cannot be repaired; drop it",
}

_ISSUE_HELP = {
    "pause": "the hand stops mid-task",
    "jitter": "shaky, high-jerk motion",
    "slow": "much slower than needed",
    "grasp_off_center": "the gripper closes away from the cube center",
    "wrong_object": "the gripper goes for something other than the red cube",
    "rim_contact": "the arm or cube hits the bin rim",
    "bad_release": "the cube is released outside the bin or dropped from too high",
    "drop": "the cube falls out of the gripper before the bin",
    "idle_start_end": "no motion at the start or the end",
    "other": "anything else; explain in evidence",
}


class DiagnosisError(Exception):
    """The model's reply was not one valid Diagnosis for this demo."""


def _op_models() -> tuple[type, ...]:
    union = get_args(RepairOp)[0]
    return get_args(union)


def _repair_menu() -> list[str]:
    lines = []
    for model in _op_models():
        (op,) = get_args(model.model_fields["op"].annotation)
        if op in RULES_ONLY_OPS:
            continue
        fields = ", ".join(['"op": "%s"' % op, *(f'"{name}"' for name in model.model_fields if name != "op")])
        lines.append(f"- {op} {{{fields}}}: {_OP_HELP[op]}")
    return lines


def select_frames(frames: list[tuple[float, bytes]], has_wrist_frame: bool) -> list[tuple[float, bytes]]:
    """Evenly subsample front frames, keeping the first and last, so that all images fit in MAX_IMAGES."""
    limit = MAX_IMAGES - (1 if has_wrist_frame else 0)
    if len(frames) <= limit:
        return list(frames)
    if limit == 1:
        return [frames[0]]
    return [frames[round(i * (len(frames) - 1) / (limit - 1))] for i in range(limit)]


def _metrics_table(windows: list[MetricsWindow]) -> list[str]:
    def flag(on: bool, letter: str) -> str:
        return letter if on else "-"

    lines = ["t0-t1 speed_m_s jerk_rms gripper dist_ee_cube_m cube_height_m contacts(G=gripper-cube,B=arm-bin,T=arm-table)"]
    for w in windows:
        contacts = flag(w.contact_gripper_cube, "G") + flag(w.contact_arm_bin, "B") + flag(w.contact_arm_table, "T")
        lines.append(
            f"{w.t0:.2f}-{w.t1:.2f} {w.speed:.3f} {w.jerk_rms:.3g} {w.gripper} "
            f"{w.dist_ee_cube:.3f} {w.cube_height:.3f} {contacts}"
        )
    return lines


def build_diagnosis_prompt(
    task_text: str,
    windows: list[MetricsWindow],
    frame_times: list[float],
    has_wrist_frame: bool,
    replay_success: bool,
    failure_reasons: list[str] | None = None,
) -> str:
    """The full instruction text that precedes the images in the request. failure_reasons: why the previous
    repair of this demo failed verification (a re-diagnosis); the frames and metrics are of that failed replay."""
    captions = [f"Image {i}: front camera at t={t:.2f} s" for i, t in enumerate(frame_times, start=1)]
    if has_wrist_frame:
        captions.append(f"Image {len(frame_times) + 1}: wrist camera at the first gripper close")

    issue_lines = [f"- {name}: {_ISSUE_HELP[name]}" for name in get_args(IssueType) if name not in RULES_ONLY_ISSUES]
    segment_names = ", ".join(get_args(SegmentName))

    parts = [
        "You are reviewing one robot demonstration recorded by a human teleoperating a robot arm in simulation.",
        f'Task: "{task_text}"',
        f"Replaying the demo in simulation {'SUCCEEDED' if replay_success else 'FAILED'}.",
        *([f"This is a re-diagnosis: the previous repair failed verification because: {', '.join(failure_reasons)}. "
           "The images and metrics below are of that failed replay; choose repairs that fix those reasons."]
          if failure_reasons else []),
        "",
        "Images, in order:",
        *captions,
        "",
        "Metrics per window, computed by code (gripper 0 = open, 1 = closed):",
        *_metrics_table(windows),
        "",
        "Decide whether this demo is a good training example as recorded. If it has problems, list them and "
        "choose repairs.",
        'A clean demo is common: then decision is "keep" with no issues, "issues": [] and "repairs": [].',
        "Report an issue only with clear evidence in the metrics or the images; when in doubt, leave it out.",
        "All times are times in seconds from demo start; never go past the last window's end.",
        "",
        "What normal looks like (use these numbers):",
        f"- speed: below {STILL_SPEED:g} m/s the hand is still; a pause is still for at least {MIN_STILL_S:g} s. "
        f"Normal motion is {CLEAN_MOVING_SPEED[0]:g}-{CLEAN_MOVING_SPEED[1]:g} m/s, and single windows dip to "
        "about 0.03 m/s at the grasp, the top of the lift and the release: those dips are normal.",
        f"- slow: report slow only when the median speed over the span is below {SLOW_SPEED:g} m/s.",
        f"- jitter: jerk_rms below {JITTER_MIN_JERK:g} is smooth motion, never jitter (a clean demo shows 0.5-6, "
        f"highest at the grasp); report jitter only for windows with jerk_rms of {JITTER_MIN_JERK:g} or more.",
        "- contacts: the G, B and T columns are ground truth from the simulator.",
        "  - never report rim_contact unless a window in its span has B (arm-bin contact); "
        "no B means no contact or force on the bin.",
        "  - never report drop unless G (gripper-cube contact) ends in a window where gripper is still 1.",
        "  - cube_height falling while the cube is lowered into the bin is a normal release, not a contact.",
        "",
        f"Segment names (ordered, non-overlapping, each with t0 < t1): {segment_names}.",
        "",
        "Issue types (each issue has either a point time t, or a range t0 and t1, plus short evidence):",
        *issue_lines,
        "",
        "Repair menu (use only these ops with exactly these fields):",
        *_repair_menu(),
        "",
        'decision is "keep" (no issues), "repair" (issues fixed by the repairs), or "discard" (unfixable; '
        'then repairs is [{"op": "discard"}]). label is the task sentence.',
        "",
        "Reply with exactly one JSON object and nothing else: no prose, no markdown fences. Shape:",
        '{"segments": [{"name": "approach", "t0": 0.0, "t1": 1.2}], '
        '"issues": [{"type": "jitter", "t0": 2.0, "t1": 2.5, "evidence": "jerk_rms 85 vs about 2 elsewhere"}], '
        '"repairs": [{"op": "smooth", "t0": 2.0, "t1": 2.5, "strength": "med"}], '
        f'"decision": "repair", "label": "{task_text}"}}',
        "A clean demo has the same shape with nothing to fix:",
        '{"segments": [{"name": "approach", "t0": 0.0, "t1": 1.2}], '
        f'"issues": [], "repairs": [], "decision": "keep", "label": "{task_text}"}}',
    ]
    return "\n".join(parts)


def parse_diagnosis(text: str, duration: float) -> Diagnosis:
    """Extract the outermost {...} from a reply, validate it, and check its times against the demo."""
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end < start:
        raise DiagnosisError("no JSON object found in the reply")
    try:
        data = json.loads(text[start : end + 1])
    except json.JSONDecodeError as e:
        raise DiagnosisError(f"invalid JSON: {e}") from e
    try:
        diagnosis = Diagnosis.model_validate(data)
        diagnosis.check_times(duration)
    except (ValidationError, ValueError) as e:
        raise DiagnosisError(str(e)) from e
    return diagnosis


def _span(item) -> tuple[float, float] | None:
    """(t0, t1) of an issue or repair; (t, t) for a point time; None for one without times (discard)."""
    if getattr(item, "t", None) is not None:
        return item.t, item.t
    if getattr(item, "t0", None) is not None:
        return item.t0, item.t1
    return None


def _overlaps(a: tuple[float, float], b: tuple[float, float]) -> bool:
    """Ranges must share more than an endpoint; a point counts if it lies in the other span."""
    lo, hi = max(a[0], b[0]), min(a[1], b[1])
    return lo <= hi if (a[0] == a[1] or b[0] == b[1]) else lo < hi


def _fmt(span: tuple[float, float]) -> str:
    return f"t={span[0]:.2f}" if span[0] == span[1] else f"{span[0]:.2f}-{span[1]:.2f}"


def _gate_reason(issue, windows: list[MetricsWindow]) -> str | None:
    """Why the metrics contradict this issue, or None to keep it. Only kinematic and contact
    issues are gated; the rest (pause, grasp_off_center, wrong_object, drop, ...) pass."""
    if issue.type not in ("rim_contact", "jitter", "slow"):
        return None
    span = _span(issue)
    ws = [w for w in windows if _overlaps(span, (w.t0, w.t1))]
    if not ws:
        return "no metrics window overlaps it"
    if issue.type == "rim_contact" and not any(w.contact_arm_bin for w in ws):
        return "no arm-bin contact (B) in any overlapping window"
    if issue.type == "jitter" and all(w.jerk_rms < JITTER_MIN_JERK for w in ws):
        return f"jerk_rms max {max(w.jerk_rms for w in ws):.3g} is below the jitter floor {JITTER_MIN_JERK:g}"
    if issue.type == "slow":
        speed = statistics.median(w.speed for w in ws)
        if speed >= SLOW_SPEED:
            return f"median speed {speed:.3f} m/s is not below the slow threshold {SLOW_SPEED:g} m/s"
    return None


def gate_diagnosis(diag: Diagnosis, windows: list[MetricsWindow]) -> tuple[Diagnosis, list[str]]:
    """Drop model issues the measured windows contradict, and the repairs that only served them.

    rim_contact needs contact_arm_bin, jitter needs a window at or above JITTER_MIN_JERK, and slow
    needs a median window speed below SLOW_SPEED, in the windows overlapping the issue. A repair
    is dropped when it overlaps a dropped issue and no kept one. If that leaves no issues, the
    decision becomes "keep" and any remaining repairs go too. Returns the gated diagnosis and one
    line per dropped item (empty when nothing changed).
    """
    kept, dropped, gated = [], [], []
    for issue in diag.issues:
        reason = _gate_reason(issue, windows)
        if reason is None:
            kept.append(issue)
        else:
            dropped.append(issue)
            gated.append(f"dropped issue {issue.type} {_fmt(_span(issue))}: {reason}")
    if not dropped:
        return diag, []

    repairs = []
    for repair in diag.repairs:
        span = _span(repair)
        def tied(issues) -> bool:
            return span is not None and any(_overlaps(span, _span(i)) for i in issues)
        if tied(dropped) and not tied(kept):
            gated.append(f"dropped repair {repair.op} {_fmt(span)}: it only served dropped issues")
        else:
            repairs.append(repair)

    decision = diag.decision
    if not kept:
        for repair in repairs:
            span = _span(repair)
            gated.append(f"dropped repair {repair.op}{' ' + _fmt(span) if span else ''}: no issues remain")
        repairs = []
        if decision != "keep":
            gated.append(f"decision {decision} -> keep: no issues remain")
            decision = "keep"
    return diag.model_copy(update={"issues": kept, "repairs": repairs, "decision": decision}), gated


def diagnose(
    frames: list[tuple[float, bytes]],
    wrist_frame: bytes | None,
    windows: list[MetricsWindow],
    task_text: str,
    replay_success: bool,
    duration: float,
    *,
    max_attempts: int = 2,
    failure_reasons: list[str] | None = None,
) -> Diagnosis:
    """diagnose_gated() without the list of gated items."""
    return diagnose_gated(
        frames, wrist_frame, windows, task_text, replay_success, duration, max_attempts=max_attempts,
        failure_reasons=failure_reasons,
    )[0]


def diagnose_gated(
    frames: list[tuple[float, bytes]],
    wrist_frame: bytes | None,
    windows: list[MetricsWindow],
    task_text: str,
    replay_success: bool,
    duration: float,
    *,
    max_attempts: int = 2,
    failure_reasons: list[str] | None = None,
) -> tuple[Diagnosis, list[str]]:
    """Ask Nemotron VL for a Diagnosis; retry with the validation error until max_attempts; then
    gate it against the windows (gate_diagnosis). Returns (diagnosis, what the gate dropped).

    frames are (t, PNG bytes) front-camera images in time order; they are
    subsampled with select_frames() if they would exceed MAX_IMAGES. failure_reasons, on a re-diagnosis,
    are the reasons the previous repair failed verification; the prompt states them.

    Raises: DiagnosisError after max_attempts invalid replies; nebius_llm errors
    (AuthError, RateLimitError, ...) propagate unchanged.
    """
    frames = select_frames(frames, wrist_frame is not None)
    prompt = build_diagnosis_prompt(
        task_text, windows, [t for t, _ in frames], wrist_frame is not None, replay_success, failure_reasons
    )
    images = [png for _, png in frames] + ([wrist_frame] if wrist_frame is not None else [])
    return gate_diagnosis(_ask_model(prompt, images, duration, max_attempts), windows)


def _ask_model(prompt: str, images: list[bytes], duration: float, max_attempts: int) -> Diagnosis:
    """One validated Diagnosis from Nemotron VL; an invalid reply is retried with the error appended."""
    attempt_prompt = prompt
    error: DiagnosisError | None = None
    for _ in range(max_attempts):
        result = chat_vision_images(
            attempt_prompt,
            images,
            tier=DIAGNOSE_TIER,
            max_tokens=DIAGNOSE_MAX_TOKENS,
            extra_body=DIAGNOSE_EXTRA_BODY,
        )
        try:
            return parse_diagnosis(result.text, duration)
        except DiagnosisError as e:
            error = e
            attempt_prompt = (
                f"{prompt}\n\nYour previous reply was rejected: {e}\n"
                "Reply again with one corrected JSON object only."
            )
    raise DiagnosisError(f"no valid diagnosis after {max_attempts} attempts; last error: {error}")


# --- hybrid: the rules own timing, the model adds what they never name (sprint 4) -------------------

RULES_TYPES = ("pause", "jitter", "idle_start_end")  # rules F1 0.97-0.99 under tremor (spec Changes)
MODEL_TYPES = ("grasp_off_center", "bad_release", "drop", "wrong_object", "rim_contact")
_TIMING_OPS = ("trim", "remove_pause", "smooth", "retime")
MODEL_OPS = ("recenter_grasp", "replan_transit", "discard")
# An off-center claim needs the measured offset at the close to exceed the IK tracking error there (3.3 mm
# after the joint-velocity feedforward fix, spec Changes 2026-10-16): below it, "off-center" is noise.
GRASP_CENTERED_MM = 3.3
# Bin geometry (demo_pipeline.scene_geometry, which the Isaac scene is built from): footprint half-size 0.11 m
# (inner 0.20 + 2 walls of 0.01), rim 0.09 m above the bin origin; the cube rests with its center 0.025 m up.
BIN_FOOTPRINT_HALF = scene_geometry.BIN_FOOTPRINT_HALF
BIN_RIM_HEIGHT = scene_geometry.BIN_RIM_HEIGHT
CUBE_HALF = scene_geometry.CUBE_HALF
# Sprint 5 (pre-registered, T4 note): a verified replay contradicts these claims (spec 8.5: the cube ends in
# the bin and does not leave the gripper before it is above the bin).
RELEASE_TYPES = ("bad_release", "drop")
_HYBRID_ISSUE_HELP = {**_ISSUE_HELP, "drop": "the cube leaves the gripper before the bin, whether it slips or the "
                                             "gripper opens"}


@dataclass(frozen=True)
class ReleaseFacts:
    """Measured at the release: the last closed step before the first open after the grasp."""

    t: float  # time of the first open
    outside_m: float  # cube center's horizontal distance outside the bin footprint (0 = over the bin)
    above_rim_m: float  # cube bottom above the bin rim
    hand_over_bin_after: bool  # the hand passes over the footprint after the open (it carries on to the bin)


def _bin_xy(points: np.ndarray, bin_pose: Pose) -> np.ndarray:
    w, x, y, z = bin_pose.quat_wxyz
    yaw = math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z))
    d = np.asarray(points, dtype=float)[..., :2] - np.asarray(bin_pose.pos[:2])
    c, s_ = math.cos(-yaw), math.sin(-yaw)
    return np.stack([c * d[..., 0] - s_ * d[..., 1], s_ * d[..., 0] + c * d[..., 1]], axis=-1)


def release_facts(traj: Trajectory, signals: SimSignals | None, bin_pose: Pose | None) -> ReleaseFacts | None:
    """Where the cube was let go, from the replay's signals; None without signals on the trajectory's steps,
    without a bin pose, or without an open after the first close."""
    if signals is None or bin_pose is None or signals.n_steps != len(traj.t):
        return None
    g = np.asarray(traj.gripper)
    closed = np.flatnonzero(g == 1)
    if closed.size == 0:
        return None
    opens = np.flatnonzero(g[closed[0]:] == 0)
    if opens.size == 0:
        return None
    k_open = int(closed[0] + opens[0])
    held = signals.cube_pos[k_open - 1]
    local = _bin_xy(held, bin_pose)
    outside = float(np.hypot(*np.maximum(np.abs(local) - BIN_FOOTPRINT_HALF, 0.0)))
    above_rim = float(held[2] - CUBE_HALF - (bin_pose.pos[2] + BIN_RIM_HEIGHT))
    hand_after = _bin_xy(np.asarray(traj.ee_pos)[k_open:], bin_pose)
    over = bool(np.any(np.all(np.abs(hand_after) <= BIN_FOOTPRINT_HALF, axis=1)))
    return ReleaseFacts(t=float(traj.t[k_open]), outside_m=outside, above_rim_m=above_rim, hand_over_bin_after=over)


def first_close(traj: Trajectory) -> float | None:
    """Time of the first gripper close, or None if it never closes."""
    k = next((i for i, g in enumerate(traj.gripper) if g == 1), None)
    return None if k is None else float(traj.t[k])


def grasp_offset_mm(traj: Trajectory, signals: SimSignals | None) -> float | None:
    """Horizontal distance (mm) from the gripper to the cube center at the first close; None without signals
    on the trajectory's steps or without a close."""
    if signals is None or signals.n_steps != len(traj.t):
        return None
    k = next((i for i, g in enumerate(traj.gripper) if g == 1), None)
    if k is None:
        return None
    d = np.asarray(traj.ee_pos[k], dtype=float) - signals.cube_pos[k]
    return float(np.hypot(d[0], d[1]) * 1000.0)


def _fmt_item(item) -> str:
    """An issue's or repair's time as text: a point "1.30" or a range "1.20-2.00"."""
    if getattr(item, "t0", None) is None:
        return f"{item.t:.2f}"
    return _fmt((item.t0, item.t1))


def build_hybrid_prompt(
    task_text: str,
    windows: list[MetricsWindow],
    frame_times: list[float],
    has_wrist_frame: bool,
    replay_success: bool,
    rules: Diagnosis,
    t_close: float | None,
    *,
    offset_mm: float | None = None,
    failure_reasons: list[str] | None = None,
    release: ReleaseFacts | None = None,
) -> str:
    """The hybrid prompt: the code's timing findings are stated as done; the model looks only for what the
    rules never name. No "leave it out" bias; contacts stay ground truth. offset_mm=None (the blind arm)
    states no grasp measurement; `release` adds the measured release facts."""
    captions = [f"Image {i}: front camera at t={t:.2f} s" for i, t in enumerate(frame_times, start=1)]
    if has_wrist_frame:
        captions.append(f"Image {len(frame_times) + 1}: wrist camera at the first gripper close")
    found = [f"- {i.type} {_fmt_item(i)} s: {i.evidence}" for i in rules.issues]
    if t_close is None:
        grasp_fact = "The gripper never closes."
    else:
        grasp_fact = f"Measured by code: first gripper close at t={t_close:.2f} s"
        if offset_mm is not None:
            grasp_fact += (f"; the gripper center was {offset_mm:.1f} mm (horizontally) from the cube center. "
                           f"Offsets up to {GRASP_CENTERED_MM:g} mm are within the arm's tracking error")
        grasp_fact += "."
    release_fact = []
    if release is not None:
        release_fact = [
            f"Measured by code: the first gripper open after the grasp is at t={release.t:.2f} s; the cube center "
            f"was {release.outside_m * 100:.1f} cm outside the bin footprint (0 = over the bin) and its bottom "
            f"{release.above_rim_m * 100:.1f} cm above the bin rim; "
            + ("the hand later passes over the bin." if release.hand_over_bin_after
               else "the hand does not pass over the bin afterwards."), ""]
    issue_lines = [f"- {name}: {_HYBRID_ISSUE_HELP[name]}" for name in MODEL_TYPES]
    menu = [line for line in _repair_menu() if line.split()[1] in MODEL_OPS]
    parts = [
        "You are reviewing one robot demonstration recorded by a human teleoperating a robot arm in simulation.",
        f'Task: "{task_text}"',
        f"Replaying the demo in simulation {'SUCCEEDED' if replay_success else 'FAILED'}.",
        *([f"This is a re-diagnosis: the previous repair failed verification because: {', '.join(failure_reasons)}. "
           "The images and metrics below are of that failed replay; choose repairs that fix those reasons."]
          if failure_reasons else []),
        "",
        "Timing issues are already handled by code; do not report pause, jitter, idle_start_end or slow.",
        *(["The code found these, and will repair them:", *found] if found else ["the code found no timing issues."]),
        "",
        "Images, in order:",
        *captions,
        "",
        grasp_fact,
        "",
        *release_fact,
        "Metrics per window, computed by code (gripper 0 = open, 1 = closed):",
        *_metrics_table(windows),
        "",
        "Your job: look for the problems code cannot name, and report every one you see evidence for. "
        "A missed problem spoils the training data as much as a false alarm.",
        "- grasp_off_center: in the wrist image, is the cube centered between the fingers?"
        + (" Use the measured offset." if offset_mm is not None else "")
        + " Report it as a point issue at the close time, with a recenter_grasp repair at that time.",
        "- bad_release: is the cube released outside the bin, or dropped from too high?",
        "- drop: does the cube leave the gripper before the bin, whether it slips or the gripper opens?",
        "- wrong_object: does the gripper go for something other than the red cube?",
        "- segments: split the demo into its phases.",
        "Contacts: the G, B and T columns are ground truth from the simulator.",
        "  - never report rim_contact unless a window in its span has B (arm-bin contact).",
        "  - never report drop unless G ends before the cube is over the bin (the gripper slipped or was opened "
        "mid-carry).",
        "",
        f"Segment names (ordered, non-overlapping, each with t0 < t1): {', '.join(get_args(SegmentName))}.",
        "",
        "Issue types you may report (each issue has a point time t, or a range t0 and t1, plus short evidence):",
        *issue_lines,
        "",
        "Repair menu (use only these ops with exactly these fields):",
        *menu,
        "",
        'decision is "keep" (no issues of yours), "repair" (fixed by your repairs), or "discard" (unfixable, e.g. the '
        'wrong object; then repairs is [{"op": "discard"}]). label is the task sentence.',
        "",
        "Reply with exactly one JSON object and nothing else: no prose, no markdown fences. Shape:",
        '{"segments": [{"name": "approach", "t0": 0.0, "t1": 1.2}, {"name": "grasp", "t0": 1.2, "t1": 1.6}], '
        '"issues": [{"type": "grasp_off_center", "t": 1.3, "evidence": "cube against the left finger"}], '
        '"repairs": [{"op": "recenter_grasp", "t": 1.3}], '
        f'"decision": "repair", "label": "{task_text}"}}',
    ]
    return "\n".join(parts)


def _overlap_any(a, others) -> bool:
    sa = _span(a)
    return sa is not None and any((sb := _span(b)) is not None and _overlaps(sa, sb) for b in others)


def merge_hybrid(rules: Diagnosis, model: Diagnosis, *, t_close: float | None, offset_mm: float | None,
                 replay_success: bool | None = None) -> tuple[Diagnosis, list[str]]:
    """Rules issues and repairs, plus the model's issues and repairs of the types it owns. Returns the merged
    diagnosis and one line per model item left out. The decision follows from the merged repairs."""
    dropped: list[str] = []
    issues = list(rules.issues)
    repairs = list(rules.repairs)
    grasp_noise = offset_mm is not None and offset_mm < GRASP_CENTERED_MM
    for issue in model.issues:
        where = f"model issue {issue.type} {_fmt_item(issue)}"
        if issue.type not in MODEL_TYPES:
            dropped.append(f"dropped {where}: the rules own timing ({', '.join(RULES_TYPES)}, slow) and the hybrid "
                           f"prompt asks only for {', '.join(MODEL_TYPES)}")
            continue
        if issue.type in RELEASE_TYPES and replay_success:
            dropped.append(f"dropped {where}: the replay verified success (the cube ended in the bin)")
            continue
        if issue.type == "grasp_off_center":
            if grasp_noise:
                dropped.append(f"dropped {where}: measured offset {offset_mm:.1f} mm is within the "
                               f"{GRASP_CENTERED_MM:g} mm tracking error")
                continue
            if t_close is not None:
                issue = Issue(type=issue.type, t=t_close, evidence=issue.evidence)
        issues.append(issue)
    for rep in model.repairs:
        where = f"model repair {rep.op}" + (f" {_fmt_item(rep)}" if _span(rep) else "")
        if rep.op not in MODEL_OPS:
            dropped.append(f"dropped {where}: the rules own timing repairs ({', '.join(_TIMING_OPS)})")
            continue
        if rep.op == "recenter_grasp":
            if grasp_noise:
                dropped.append(f"dropped {where}: measured offset {offset_mm:.1f} mm is within tracking error")
                continue
            if t_close is not None:
                rep = rep.model_copy(update={"t": t_close})
        if _overlap_any(rep, [r for r in repairs if r.op == rep.op]):
            dropped.append(f"dropped {where}: overlaps the rules' {rep.op}")
            continue
        repairs.append(rep)
    if any(r.op == "discard" for r in repairs):
        decision, repairs = "discard", [r for r in repairs if r.op == "discard"][:1]
    else:
        decision = "repair" if repairs else "keep"
    segments = model.segments or rules.segments
    merged = Diagnosis(segments=segments, issues=issues, repairs=repairs, decision=decision, label=rules.label)
    return merged, dropped


def diagnose_hybrid(
    frames: list[tuple[float, bytes]],
    wrist_frame: bytes | None,
    windows: list[MetricsWindow],
    traj: Trajectory,
    task_text: str,
    replay_success: bool,
    duration: float,
    *,
    signals: SimSignals | None = None,
    bin_pose: Pose | None = None,
    blind: bool = False,
    max_attempts: int = 2,
    failure_reasons: list[str] | None = None,
) -> tuple[Diagnosis, list[str]]:
    """Rules + Nemotron. blind=True (the hybrid_blind arm) neither states nor gates by the measured grasp
    offset, so a grasp claim is the model's own reading of the wrist frame. With `bin_pose`, the measured
    release facts are stated. detect_rules finds the timing issues; Nemotron, told what the rules found, looks only for
    MODEL_TYPES and the segments; its reply is gated with the metrics (gate_diagnosis, plus the measured grasp
    offset) and merged (merge_hybrid). Returns (diagnosis, what was left out of the model's reply).

    Raises DiagnosisError after max_attempts invalid replies; nebius_llm errors propagate. The caller falls back
    to the rules alone."""
    rules = detect_rules(traj, windows, task_text)
    t_close = first_close(traj)
    offset = None if blind else grasp_offset_mm(traj, signals)
    release = release_facts(traj, signals, bin_pose)
    frames = select_frames(frames, wrist_frame is not None)
    prompt = build_hybrid_prompt(task_text, windows, [t for t, _ in frames], wrist_frame is not None, replay_success,
                                 rules, t_close, offset_mm=offset, failure_reasons=failure_reasons,
                                 release=release)
    images = [png for _, png in frames] + ([wrist_frame] if wrist_frame is not None else [])
    model, gated = gate_diagnosis(_ask_model(prompt, images, duration, max_attempts), windows)
    merged, dropped = merge_hybrid(rules, model, t_close=t_close, offset_mm=offset, replay_success=replay_success)
    return merged, gated + dropped
