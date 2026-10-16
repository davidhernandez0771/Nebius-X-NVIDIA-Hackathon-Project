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
from typing import get_args

from pydantic import ValidationError

from demo_pipeline.rules import JITTER_MIN_JERK, MIN_STILL_S, STILL_SPEED
from demo_pipeline.schemas import Diagnosis, IssueType, MetricsWindow, RepairOp, SegmentName
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
) -> str:
    """The full instruction text that precedes the images in the request."""
    captions = [f"Image {i}: front camera at t={t:.2f} s" for i, t in enumerate(frame_times, start=1)]
    if has_wrist_frame:
        captions.append(f"Image {len(frame_times) + 1}: wrist camera at the first gripper close")

    issue_lines = [f"- {name}: {_ISSUE_HELP[name]}" for name in get_args(IssueType)]
    segment_names = ", ".join(get_args(SegmentName))

    parts = [
        "You are reviewing one robot demonstration recorded by a human teleoperating a robot arm in simulation.",
        f'Task: "{task_text}"',
        f"Replaying the demo in simulation {'SUCCEEDED' if replay_success else 'FAILED'}.",
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


def diagnose(
    frames: list[tuple[float, bytes]],
    wrist_frame: bytes | None,
    windows: list[MetricsWindow],
    task_text: str,
    replay_success: bool,
    duration: float,
    *,
    max_attempts: int = 2,
) -> Diagnosis:
    """Ask Nemotron VL for a Diagnosis; retry with the validation error until max_attempts.

    frames are (t, PNG bytes) front-camera images in time order; they are
    subsampled with select_frames() if they would exceed MAX_IMAGES.

    Raises: DiagnosisError after max_attempts invalid replies; nebius_llm errors
    (AuthError, RateLimitError, ...) propagate unchanged.
    """
    frames = select_frames(frames, wrist_frame is not None)
    prompt = build_diagnosis_prompt(
        task_text, windows, [t for t, _ in frames], wrist_frame is not None, replay_success
    )
    images = [png for _, png in frames] + ([wrist_frame] if wrist_frame is not None else [])

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
