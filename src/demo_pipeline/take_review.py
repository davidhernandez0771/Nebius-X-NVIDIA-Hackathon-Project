"""The take review: right after a take is saved, what happened in it (facts from the recorded episode) and 2-4 short
coaching lines for the Record page. Rules first, so it always works; Nemotron may rephrase the lines, but every
number in its text must be one of the facts' numbers (as shown) or the check's own limits, or its text is rejected
and the rules' lines are used (phrase_review).

Facts (take_facts), all from what the sim saved (demo.json + episode/signals.npz):
  - the live success check, recomputed exactly as sim_worker.teleop_session.make_store_saver ran it at save time
    (the achieved path, the live signals, and the reached-vs-commanded residual as the reach signal);
  - the peak arm force on the bin or table, when, and against which;
  - the soft floor (Demo.assist): on or off, and how many recorded steps it held the target up;
  - each gripper close: the tool point's horizontal offset from the cube centre, and whether it caught the cube
    (still closed and holding it half a second later);
  - each release of the held cube: the cube's bottom over the bin rim (negative: under the rim) and whether over the bin;
  - regrasps (closes after the first), and the take's duration.
Pure numpy + pydantic: no Isaac, no network (the phrasing is injected).
"""

from __future__ import annotations

import json
import re
from typing import Callable, Literal

import numpy as np
from pydantic import BaseModel, ConfigDict

from .schemas import Demo, SimSignals
from .scene_geometry import BIN_INNER, BIN_RIM_HEIGHT, CUBE_HALF
from .soft_floor import _rotation
from .success import COLLISION_FORCE_N, check_success

TOUCH_N = 0.5  # below this a contact is a graze (web/src/twin/contact.ts TOUCH_N)
GRAB_OFF_MM = 8  # a grab further off the cube centre than this gets a line-up tip (the cube is 50 mm wide)
HIGH_RELEASE_MM = 50  # a release with the cube's bottom more than this over the rim gets a lower-it-first tip
TIME_LIMIT_S = 30  # check_success's time_limit
MAX_LINES = 4
MAX_LINE_CHARS = 120

REASON_TEXT = {
    "not_in_bin": "the cube didn't end in the bin",
    "gripper_closed": "the gripper was still closed at the end",
    "not_settled": "the cube was still moving at the end",
    "too_slow": f"it took over {TIME_LIMIT_S} s",
    "collision": f"the arm pushed over {COLLISION_FORCE_N:g} N",
    "dropped": "the cube slipped out on the way",
    "high_release": "it let go too high over the bin",
    "unreachable": "the arm couldn't follow for over 1 s",
}


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Grab(_Model):
    t: float  # s, the close
    offset_mm: int  # the tool point's horizontal distance from the cube centre at the close
    caught: bool  # the fingers held the cube within half a second


class Release(_Model):
    t: float  # s, the opening
    over_rim_mm: int  # the held cube's bottom over the bin rim (negative: under it)
    over_bin: bool


class TakeFacts(_Model):
    demo_id: str
    success: bool
    reasons: list[str]
    duration_s: float
    peak_force_n: float  # largest arm force on the bin or table (0 if none)
    peak_force_t: float | None  # s, when; None if nothing touched
    peak_force_against: Literal["bin", "table"] | None
    soft_floor: bool | None  # None: the demo has no assist record (older, or not teleop)
    soft_floor_steps: int
    grabs: list[Grab]
    releases: list[Release]
    regrasps: int
    input: str | None


class TakeReview(_Model):
    demo_id: str
    verdict: Literal["PASS", "FAIL"]
    lines: list[str]
    source: Literal["rules", "nemotron"]
    rejected: str | None = None  # why Nemotron's phrasing was not used
    facts: TakeFacts


# --- facts ----------------------------------------------------------------------------------------

CATCH_WINDOW_S = 0.5


def take_facts(demo: Demo, sim: SimSignals, reached: np.ndarray | None = None) -> TakeFacts:
    """reached: the tool point the arm reached each step (episode steps.npz ee_pos), for the grab offsets. Demos from
    before 2026-10-20 stored the hand targets as their trajectory, up to 12 cm from the arm; newer ones store the
    reached path, so without `reached` the trajectory is used."""
    traj = demo.trajectory
    arr = traj.to_arrays()
    t, ee, grip = arr["t"], arr["ee_pos"], np.asarray(arr["gripper"], dtype=int)
    if sim.n_steps != len(t):
        raise ValueError(f"the signals have {sim.n_steps} steps but the trajectory has {len(t)}")
    target = demo.commanded if demo.commanded is not None else traj
    residual = np.linalg.norm(ee - np.asarray(target.ee_pos), axis=1)
    result = check_success(traj, sim, demo.scene.bin_pose, bin_inner=BIN_INNER, tcp_error=residual)

    force = np.asarray(sim.max_contact_force, dtype=float)
    arm = np.asarray(sim.contact_arm_bin) | np.asarray(sim.contact_arm_table)
    touching = np.where(arm | (force >= TOUCH_N), force, 0.0)
    i = int(touching.argmax()) if len(touching) else 0
    peak = float(touching[i]) if len(touching) else 0.0
    against = None
    if peak >= TOUCH_N:
        against = "bin" if sim.contact_arm_bin[i] else "table" if sim.contact_arm_table[i] else None

    held = np.asarray(sim.contact_gripper_cube, dtype=bool)
    dt = float(np.median(np.diff(t))) if len(t) > 1 else 0.02
    window = max(1, round(CATCH_WINDOW_S / dt))
    tool = ee if reached is None else np.asarray(reached, dtype=float)
    if tool.shape != ee.shape:
        raise ValueError(f"reached has shape {tool.shape} but the trajectory is {ee.shape}")
    grabs = []
    for k in np.flatnonzero((grip[:-1] == 0) & (grip[1:] == 1)) + 1:
        off = np.linalg.norm(tool[k, :2] - sim.cube_pos[k, :2])
        grabs.append(Grab(t=round(float(t[k]), 2), offset_mm=round(off * 1000), caught=_caught(held, grip, k, window)))

    bin_pose = demo.scene.bin_pose
    rot = _rotation(bin_pose.quat_wxyz)
    origin = np.asarray(bin_pose.pos, dtype=float)
    rim_z = float((origin + rot @ np.array([0.0, 0.0, BIN_RIM_HEIGHT]))[2])
    half_x, half_y = BIN_INNER[0] / 2, BIN_INNER[1] / 2
    releases = []
    for k in np.flatnonzero((grip[:-1] == 1) & (grip[1:] == 0) & held[:-1]):  # the step before each opening, cube held
        cube = sim.cube_pos[k]
        local = (cube - origin) @ rot
        releases.append(Release(
            t=round(float(t[k + 1]), 2),
            over_rim_mm=round((cube[2] - CUBE_HALF - rim_z) * 1000),
            over_bin=bool(abs(local[0]) <= half_x and abs(local[1]) <= half_y),
        ))

    assist = demo.assist
    return TakeFacts(
        demo_id=demo.id,
        success=result.success,
        reasons=list(result.reasons),
        duration_s=round(traj.duration, 1),
        peak_force_n=_force(peak),
        peak_force_t=round(float(t[i]), 1) if peak >= TOUCH_N else None,
        peak_force_against=against,
        soft_floor=assist.soft_floor if assist is not None else None,
        soft_floor_steps=assist.soft_floor_steps if assist is not None else 0,
        grabs=grabs,
        releases=releases,
        regrasps=max(0, len(grabs) - 1),
        input=demo.input,
    )


def _force(n: float) -> float:
    """As shown: whole newtons from 10 N, one decimal below."""
    return float(round(n)) if n >= 10 else round(n, 1)


def _num(x: float) -> str:
    return f"{x:g}" if float(x).is_integer() else f"{x:.1f}"


# --- the rules' lines -------------------------------------------------------------------------------

def coach_lines(f: TakeFacts) -> list[str]:
    """2-4 short lines: the verdict, the pushing (and the floor), the grab, the release."""
    lines = []
    if f.success:
        lines.append(f"Clean take: the cube is in the bin ({_num(f.duration_s)} s).")
    else:
        why = "; ".join(REASON_TEXT.get(r, r.replace("_", " ")) for r in f.reasons)
        lines.append(f"Not verified: {why}.")

    floor = f"the floor held you {f.soft_floor_steps} times" if f.soft_floor_steps else None
    if f.peak_force_n < TOUCH_N:
        push = "No pushing"
    elif f.peak_force_n <= COLLISION_FORCE_N:
        push = f"Light touch only ({_num(f.peak_force_n)} N on the {f.peak_force_against or 'table'})"
    else:
        push = (f"Pushed {_num(f.peak_force_n)} N into the {f.peak_force_against or 'table'} at {_num(f.peak_force_t or 0)} s"
                f" (the limit is {COLLISION_FORCE_N:g} N): ease off when it touches")
    lines.append(f"{push}; {floor}." if floor else f"{push}.")

    if f.grabs:
        first = next((g for g in f.grabs if g.caught), f.grabs[0])
        grab = f"Grab {first.offset_mm} mm off-centre"
        if first.offset_mm > GRAB_OFF_MM:
            grab += ": line up over the cube before you close"
        missed = sum(not g.caught for g in f.grabs)
        extra = []
        if f.regrasps:
            extra.append(f"{f.regrasps} regrasp{'s' if f.regrasps > 1 else ''}")
        if missed:
            extra.append(f"{missed} didn't hold")
        lines.append(f"{grab}" + (f" ({', '.join(extra)})." if extra else "."))

    if f.releases and len(lines) < MAX_LINES:
        r = f.releases[-1]
        where = f"{abs(r.over_rim_mm)} mm {'above' if r.over_rim_mm >= 0 else 'below'} the rim"
        if not r.over_bin:
            lines.append(f"Let go {where}, outside the bin.")
        elif r.over_rim_mm > HIGH_RELEASE_MM:
            lines.append(f"Let go {where}: lower it first.")
        else:
            lines.append(f"Let go {where}.")
    return lines[:MAX_LINES]


# --- Nemotron's phrasing, checked ------------------------------------------------------------------

_NUMBER = re.compile(r"\d+(?:\.\d+)?")


def allowed_numbers(f: TakeFacts) -> set[float]:
    """Every number a line may say: the facts as shown (and rounded to whole), the check's limits."""
    vals: list[float] = [f.duration_s, f.peak_force_n, f.soft_floor_steps, f.regrasps, len(f.grabs), len(f.releases),
                         sum(not g.caught for g in f.grabs), COLLISION_FORCE_N, TIME_LIMIT_S, 1]
    if f.peak_force_t is not None:
        vals.append(f.peak_force_t)
    vals += [g.offset_mm for g in f.grabs] + [abs(r.over_rim_mm) for r in f.releases]
    out = set()
    for v in vals:
        out.add(round(abs(float(v)), 1))
        out.add(float(round(abs(float(v)))))
    return out


def check_numbers(lines: list[str], f: TakeFacts) -> str | None:
    """None if every number in the lines is a fact's; else what's wrong."""
    ok = allowed_numbers(f)
    for line in lines:
        for m in _NUMBER.findall(line):
            if round(float(m), 1) not in ok:
                return f"{m} in {line!r} is not one of the take's numbers"
    return None


SYSTEM = (
    "You coach a person recording robot demonstrations by remote control (pick a cube, put it in a bin). "
    "Rewrite the given coaching lines so they read naturally and kindly, in plain words. Keep them short "
    "(2 to 4 lines, under 110 characters each). Use only numbers that appear in the facts or the lines; never "
    "invent, convert or round numbers. Answer with a JSON array of strings and nothing else."
)


def phrase_review(facts: TakeFacts, chat_fn: Callable[..., object]) -> tuple[list[str], str | None]:
    """Nemotron's lines if they pass the checks, else (the rules' lines, why not). chat_fn(prompt, system=...) returns
    an object with .text (nebius_llm.chat); any error falls back."""
    rules = coach_lines(facts)
    prompt = json.dumps({"facts": facts.model_dump(mode="json"), "lines": rules}, indent=1)
    try:
        reply = chat_fn(prompt, system=SYSTEM)
        text = str(getattr(reply, "text", reply)).strip()
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text)
        lines = json.loads(text)
    except Exception as e:  # the model or the network: the rules always work
        return rules, f"{type(e).__name__}: {e}"
    if not isinstance(lines, list) or not all(isinstance(x, str) and x.strip() for x in lines):
        return rules, "the reply is not a list of lines"
    lines = [x.strip() for x in lines]
    if not 2 <= len(lines) <= MAX_LINES:
        return rules, f"{len(lines)} lines (2-{MAX_LINES} wanted)"
    if any(len(x) > MAX_LINE_CHARS for x in lines):
        return rules, f"a line is over {MAX_LINE_CHARS} characters"
    wrong = check_numbers(lines, facts)
    if wrong:
        return rules, wrong
    return lines, None


def review_take(demo: Demo, sim: SimSignals, chat_fn: Callable[..., object] | None = None,
                reached: np.ndarray | None = None) -> TakeReview:
    facts = take_facts(demo, sim, reached)
    if chat_fn is None:
        lines, source, rejected = coach_lines(facts), "rules", None
    else:
        lines, rejected = phrase_review(facts, chat_fn)
        source = "rules" if rejected else "nemotron"
    return TakeReview(demo_id=demo.id, verdict="PASS" if facts.success else "FAIL", lines=lines, source=source,
                      rejected=rejected, facts=facts)


__all__ = ["Grab", "Release", "TakeFacts", "TakeReview", "allowed_numbers", "check_numbers", "coach_lines",
           "phrase_review", "review_take", "take_facts"]


def _caught(held: np.ndarray, grip: np.ndarray, k: int, window: int) -> bool:
    """The close at step k caught the cube: half a second later the gripper is still closed and holds it (a finger
    brushing the cube while closing, or a grab let go at once, is not a catch)."""
    end = min(k + window, len(held) - 1)
    return bool(grip[end] == 1 and held[max(k, end - 4):end + 1].any())
