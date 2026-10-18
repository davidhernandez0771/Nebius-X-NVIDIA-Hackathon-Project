"""Nemotron 3.5 Super VL as labeler and judge: what did the person do, and does the copy still do it.

Physics (Isaac Lab) decides whether a demo works. This module asks Nemotron the two questions
physics can't answer:

- `label_demo`: from up to 8 sampled front-camera frames plus the trajectory summary, the task
  label, the reach/grasp/carry/release frame ranges, the objects, and a confidence.
- `judge_pair`: from 4 frames of the human demo and 4 of a physics-checked copy (plus both
  summaries and the copy's claimed physics result), whether the copy still does what the human
  intended: the same object, the same goal, the same order, and visibly completed.

The prompts never name the task, the object or its colour: the model has to see them. Replies are
validated (`demo_pipeline.intent.parse_label` / `parse_verdict`); an invalid one is retried once with
the error appended. Every call is reported to `on_call` (tokens, estimated USD, latency), and a
`Budget` refuses a call that could pass its cap. Pre-registered test:
docs/superpowers/notes/2026-10-18-nemotron-judge.md.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from demo_pipeline.intent import (
    STEP_ORDER,
    IntentError,
    Label,
    Summary,
    Verdict,
    parse_label,
    parse_verdict,
)
from nebius_llm import chat_vision_images

INTENT_TIER = "nemotron-vl"
INTENT_MAX_TOKENS = 1024
MAX_IMAGES = 8  # Token Factory: "At most 8 image(s) may be provided in one prompt"
JUDGE_FRAMES_EACH = MAX_IMAGES // 2
INTENT_EXTRA_BODY = {"chat_template_kwargs": {"enable_thinking": False}}

OnCall = Callable[[dict], None]


class BudgetExceeded(RuntimeError):
    """The next call could pass the spend cap; nothing was sent."""


@dataclass
class Budget:
    """A spend cap in estimated USD. A call is refused if spent + the reserve would pass the cap."""

    cap_usd: float
    per_call_reserve_usd: float = 0.01
    spent_usd: float = 0.0

    def check(self) -> None:
        if self.spent_usd + self.per_call_reserve_usd > self.cap_usd:
            raise BudgetExceeded(
                f"spent ${self.spent_usd:.4f}; one more call (reserve ${self.per_call_reserve_usd:.4f}) "
                f"could pass the ${self.cap_usd:.2f} cap"
            )

    def charge(self, usd: float) -> None:
        self.spent_usd += usd


def _caption(n: int, frame: int, fps: float) -> str:
    return f"image {n} = frame {frame} ({frame / fps:.2f} s)"


_LABEL_SCHEMA = """{
  "task": "<one sentence: what the hand/robot does, naming the object, its colour and where it ends up>",
  "object": {"name": "<the object that is picked up and moved>", "color": "<its colour, one word>"},
  "destination": "bin" | "table" | "unknown",
  "objects": [{"name": "<object>", "color": "<colour>"}, ...],
  "steps": [
    {"name": "reach", "frames": [<first>, <last>]},
    {"name": "grasp", "frames": [<first>, <last>]},
    {"name": "carry", "frames": [<first>, <last>]},
    {"name": "release", "frames": [<first>, <last>]}
  ],
  "confidence": <0..1>
}"""


def build_label_prompt(s: Summary, frames: list[int]) -> str:
    captions = "\n".join(_caption(i + 1, f, s.fps) for i, f in enumerate(frames))
    return f"""You are watching one recorded manipulation demo from a fixed front camera. A gripper picks
something up, moves it and lets go of it. Say what was done, from the images and the motion log.

Images, in time order:
{captions}

Motion log of the gripper (from the recording; positions in metres):
{s.render()}

Answer from what you see:
- the object that is moved, and its colour;
- where that object ends up at the last image ("destination"): inside a container ("bin"), on the
  table ("table"), or "unknown" if it is not visible;
- every other object that matters;
- the steps {", ".join(STEP_ORDER)}, each as a range of frame numbers (0 to {s.n_frames - 1}), in
  that order. The motion log gives the exact frames where the gripper closes and opens.
- "confidence": how sure you are of the task, 0 to 1.

Reply with one JSON object only, no prose and no code fences, in this shape:
{_LABEL_SCHEMA}"""


_VERDICT_SCHEMA = """{
  "same_object": true | false,
  "same_goal": true | false,
  "same_order": true | false,
  "copy_completes": true | false,
  "matches": "yes" | "no",
  "reason": "<one or two sentences a person can check against the images>",
  "confidence": <0..1>
}"""


def build_judge_prompt(h: Summary, h_frames: list[int], c: Summary, c_frames: list[int], *, claimed: str) -> str:
    n = len(h_frames)
    h_caps = "\n".join(_caption(i + 1, f, h.fps) for i, f in enumerate(h_frames))
    c_caps = "\n".join(_caption(n + i + 1, f, c.fps) for i, f in enumerate(c_frames))
    return f"""A person recorded a manipulation demo (the HUMAN demo). A program then made a COPY of it for
training a robot: the copy may place the objects elsewhere on the table and move faster or slower,
but it must still do what the person intended. Decide whether it does.

HUMAN demo, images 1-{n}, in time order:
{h_caps}
Motion log:
{h.render()}

COPY, images {n + 1}-{2 * n}, in time order:
{c_caps}
Motion log:
{c.render()}
The copy is labelled "{claimed}". Check that label against the images; do not just trust it.

Decide from the images and the logs:
- same_object: the copy moves the same kind of object, with the same colour, as the human;
- same_goal: the moved object ends up in the same kind of place (for example inside the same
  container) as in the human demo;
- same_order: the copy does the steps in the same order (picks it up where the human picked it up
  and lets go where the human let go, not the reverse);
- copy_completes: at the copy's last image the object is visibly where the goal says;
- matches: "yes" only if all four are true, otherwise "no".

Reply with one JSON object only, no prose and no code fences, in this shape:
{_VERDICT_SCHEMA}"""


def _ask(
    role: str,
    prompt: str,
    images: list[bytes],
    parse: Callable[[str], Label | Verdict],
    *,
    max_attempts: int,
    budget: Budget | None,
    on_call: OnCall | None,
):
    if len(images) > MAX_IMAGES:
        raise ValueError(f"at most {MAX_IMAGES} images per prompt, got {len(images)}")
    attempt_prompt, error = prompt, None
    for attempt in range(1, max_attempts + 1):
        if budget is not None:
            budget.check()
        result = chat_vision_images(
            attempt_prompt, images, tier=INTENT_TIER, max_tokens=INTENT_MAX_TOKENS, extra_body=INTENT_EXTRA_BODY
        )
        if budget is not None:
            budget.charge(result.est_cost_usd)
        try:
            parsed = parse(result.text)
            error = None
        except IntentError as e:
            parsed, error = None, e
        if on_call is not None:
            on_call(
                {
                    "role": role,
                    "attempt": attempt,
                    "prompt_tokens": result.prompt_tokens,
                    "completion_tokens": result.completion_tokens,
                    "est_cost_usd": result.est_cost_usd,
                    "latency_s": result.latency_s,
                    "finish_reason": result.finish_reason,
                    "valid": parsed is not None,
                    "error": str(error) if error else None,
                }
            )
        if parsed is not None:
            return parsed
        attempt_prompt = f"{prompt}\n\nYour previous reply was rejected: {error}\nReply again with one corrected JSON object only."
    raise IntentError(f"no valid {role} reply after {max_attempts} attempts; last error: {error}")


def label_demo(
    frames: list[tuple[int, bytes]],
    summary: Summary,
    *,
    max_attempts: int = 2,
    budget: Budget | None = None,
    on_call: OnCall | None = None,
) -> Label:
    """frames: (episode frame index, PNG bytes), in time order, at most MAX_IMAGES."""
    prompt = build_label_prompt(summary, [f for f, _ in frames])
    return _ask(
        "labeler",
        prompt,
        [png for _, png in frames],
        lambda text: parse_label(text, summary.n_frames),
        max_attempts=max_attempts,
        budget=budget,
        on_call=on_call,
    )


def judge_pair(
    human_frames: list[tuple[int, bytes]],
    human_summary: Summary,
    copy_frames: list[tuple[int, bytes]],
    copy_summary: Summary,
    *,
    claimed: str = "physics check: passed",
    max_attempts: int = 2,
    budget: Budget | None = None,
    on_call: OnCall | None = None,
) -> Verdict:
    """Up to JUDGE_FRAMES_EACH frames of each clip, human first."""
    prompt = build_judge_prompt(
        human_summary, [f for f, _ in human_frames], copy_summary, [f for f, _ in copy_frames], claimed=claimed
    )
    return _ask(
        "judge",
        prompt,
        [png for _, png in human_frames] + [png for _, png in copy_frames],
        parse_verdict,
        max_attempts=max_attempts,
        budget=budget,
        on_call=on_call,
    )
