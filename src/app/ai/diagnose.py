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

from demo_pipeline.schemas import Diagnosis, IssueType, MetricsWindow, RepairOp, SegmentName
from nebius_llm import chat_vision_images

DIAGNOSE_TIER = "nemotron-vl"
DIAGNOSE_MAX_TOKENS = 2048
# Thinking off: verified for Nemotron 3.5 text models (nebius_llm.client.chat);
# the plan asks for the same switch on the VL model.
DIAGNOSE_EXTRA_BODY = {"chat_template_kwargs": {"enable_thinking": False}}

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
        "Find what makes this demo a poor training example and choose repairs.",
        "All times are times in seconds from demo start; never go past the last window's end.",
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
        '"issues": [{"type": "jitter", "t0": 2.0, "t1": 2.5, "evidence": "jerk_rms 5x the others"}], '
        '"repairs": [{"op": "smooth", "t0": 2.0, "t1": 2.5, "strength": "med"}], '
        f'"decision": "repair", "label": "{task_text}"}}',
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

    frames are (t, PNG bytes) front-camera images in time order.

    Raises: DiagnosisError after max_attempts invalid replies; nebius_llm errors
    (AuthError, RateLimitError, ...) propagate unchanged.
    """
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
