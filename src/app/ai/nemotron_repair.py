"""Nemotron as SANT's repairer: a failed demo's facts in, concrete trajectory edits (demo_pipeline.edit_plan) out,
physics decides.

The prompt is text only: a step summary (reach/grasp/carry/place/release with times, from the replay), the verdict,
the signals (arm contact forces over time, grasp offset from the cube's centre, release height, regrasps, drops), the
scene geometry (demo_pipeline.scene_geometry and the scene's poses) and a path table. The model answers with a JSON
EditPlan. Code validates it and applies it with apply_edits (budget, workspace, smoothness); the injected verifier
replays the result (in production the Isaac replay and the unchanged check_success). An invalid reply or a failed
verification goes back to the model with the errors, or the new verdict and the new replay's signals, until
`max_rounds` model calls are spent. Every round's edits apply to the ORIGINAL demo, so its times never drift.

The hand-written ops (repair.py, release_above_bin in particular) and the rules' diagnosis are never shown to the
model: this repairer is the alternative to them.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Callable, Literal

import numpy as np
from pydantic import ValidationError

from demo_pipeline import scene_geometry as geo
from demo_pipeline.edit_plan import (
    EDIT_JERK_LIMIT,
    MAX_EDITS,
    RETIME_FACTOR,
    REPAIR_BUDGET_M,
    WORKSPACE,
    EditError,
    EditPlan,
    EditReport,
    apply_edits,
)
from demo_pipeline.repair import _regrid
from demo_pipeline.robota import phases
from demo_pipeline.schemas import Demo, Scene, SimSignals, Trajectory, VerificationResult
from demo_pipeline.success import COLLISION_FORCE_N
from nebius_llm import chat

TIER = "super"  # a text task (config.TIERS)
THINK = True  # measured on the human demos' signals (notes 2026-10-20): the reasoning is worth the tokens
MAX_TOKENS = 16000  # thinking + the answer
MAX_ROUNDS = 3  # model calls per demo; an invalid reply spends one
TABLE_STEP_S = 0.2  # the path table's spacing
HIGH_RELEASE_M = 0.18  # check_success's release_height_max (cube centre above the bin origin)
GRASPED_LIFT_M = 0.02  # the cube counts as lifted this far above where the scene put it

Verifier = Callable[[Trajectory], tuple[VerificationResult, SimSignals]]  # signals on the trajectory's steps

REASON_HELP = {
    "not_in_bin": "the cube did not end inside the bin",
    "gripper_closed": "the gripper was still closed at the end",
    "not_settled": "the cube was still moving at the end (it needs 0.5 s still)",
    "too_slow": "the demo is longer than 30 s",
    "collision": f"the arm or gripper pressed on the bin or the table with more than {COLLISION_FORCE_N:g} N",
    "dropped": "the cube slipped out of the closed fingers before it was over the bin",
    "high_release": f"the gripper let go with the cube's centre more than {HIGH_RELEASE_M} m above the bin's origin "
                    "(thrown, not placed)",
    "unreachable": "the arm could not follow the path (more than 2 cm off for over 1 s)",
}


# --- the prompt -----------------------------------------------------------------------------------

def _f(v: float, nd: int = 3) -> str:
    return f"{v:.{nd}f}"


def _xyz(p) -> str:
    return "(" + ", ".join(_f(float(c)) for c in p) + ")"


def system_prompt() -> str:
    b = REPAIR_BUDGET_M * 100
    ws = ", ".join(f"{k} {lo:.2f} to {hi:.2f}" for k, (lo, hi) in WORKSPACE.items())
    example = {"edits": [{"op": "shift_segment", "t0": 6.1, "t1": 7.4, "dx": 0.0, "dy": -0.01, "dz": 0.03},
                         {"op": "set_gripper", "t": 7.2, "state": "open"}],
               "why": "the gripper pressed on the bin floor at 6.6-7.3 s: carry it 3 cm higher, 1 cm off the wall, "
                      "and open before it reaches the bottom"}
    return f"""You repair robot demonstrations. A person teleoperated a simulated Franka arm to pick up a cube and place it
in a bin. Their recorded tool path was replayed in a physics simulator and failed the success check. You propose
concrete edits to the tool path; code applies them, and the simulator checks the edited demo again.

Frame: world, metres, seconds, z up; the table top is z = 0. The tool point is the centre between the fingertips; a
grasped cube's centre sits at about the tool point. Once the fingers close on the cube it moves with the tool, so
what makes a grasp is where the tool is as the fingers close: centred on the cube, near its centre height. The tool keeps its recorded orientation (you edit positions, the
gripper and timing). Times are on the ORIGINAL demo's timeline, t = 0 at its first step, 50 Hz.

The edits (JSON objects, field names exactly as shown):
- {{"op": "shift_segment", "t0", "t1", "dx", "dy", "dz"}}: move every step in [t0, t1] by (dx, dy, dz) m.
- {{"op": "move_point", "t", "x", "y", "z"}}: the tool passes through (x, y, z) at t.
- {{"op": "insert_waypoints", "t0", "t1", "points": [{{"t", "x", "y", "z"}}, ...]}}: re-route [t0, t1] so the tool passes
  through each point at its time (t0 < t < t1, increasing; at most 6 points); the path is unchanged at t0 and t1.
- {{"op": "set_gripper", "t", "state": "open" | "closed"}}: the gripper switches to that state at t. If it is not in
  that state at t, the next switch to it moves back to t (if there is none, one is added and held until the next
  switch); if it already is, the switch that put it there moves forward to t. So {{"t": 7.0, "state": "open"}}
  releases at 7.0 s whether the recorded release was earlier or later.
- {{"op": "retime", "t0", "t1", "factor"}}: [t0, t1] takes factor times as long ({RETIME_FACTOR[0]} to {RETIME_FACTOR[1]}; > 1 is slower).
- {{"op": "cut", "t0", "t1"}}: remove [t0, t1]. Only where the tool is nearly still, never over a gripper switch.

Rules, checked by code (a reply that breaks one is sent back to you with the problem):
- Repair budget: no step may end up more than {b:.0f} cm from where the original demo had the tool at that moment,
  all edits together. dx, dy, dz are each at most {REPAIR_BUDGET_M} m.
- Workspace: every moved step stays inside {ws} m.
- Smoothness: shift_segment and move_point blend in and out with min-jerk ramps that code sizes (0.25 s for a few mm,
  about 0.7 s for {b:.0f} cm), outside [t0, t1] or around t, so leave room for them. insert_waypoints blends between its
  points: give a few-cm change at least 0.5 s. The edits may add at most {EDIT_JERK_LIMIT:g} m/s^3 of jerk.
- At most {MAX_EDITS} edits. Path and gripper edits apply first, in your order, then retime and cut. Timing edits
  must not overlap.
- Each round, your edits are applied to the ORIGINAL demo, not on top of an earlier round: always send the complete set.

Reply with ONE JSON object only, no prose and no code fence:
{json.dumps(example)}
"why" says in one or two sentences what failed and how the edits fix it. A failed try costs only a replay, so when
unsure, send your best edits: the simulator decides. Reply {{"edits": [], "why": "..."}} only when no edits within
these rules can work, for example when the cube was knocked far from where any close of the fingers could reach it."""


SYSTEM_PROMPT = system_prompt()


def geometry_text(scene: Scene) -> str:
    bx, by, bz = scene.bin_pose.pos
    w, x, y, z = scene.bin_pose.quat_wxyz
    yaw = float(np.degrees(np.arctan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z))))
    hx, hy = geo.BIN_INNER[0] / 2, geo.BIN_INNER[1] / 2
    lines = [
        f"- cube: {geo.CUBE_SIZE} m edge, centre at {_xyz(scene.cube_pose.pos)} at the start.",
        f"- bin: open box, origin (centre of the floor's underside) at {_xyz(scene.bin_pose.pos)}, yaw {yaw:.0f} deg.",
        f"  Inside {geo.BIN_INNER[0]} x {geo.BIN_INNER[1]} m, walls and floor {geo.BIN_WALL} m thick. Inside floor at "
        f"z = {_f(bz + geo.BIN_WALL)}, rim top at z = {_f(bz + geo.BIN_RIM_HEIGHT)}.",
    ]
    if abs(yaw) < 0.5:
        lines.append(f"  Inside walls at x = {_f(bx - hx)} and {_f(bx + hx)}, y = {_f(by - hy)} and {_f(by + hy)}; "
                     f"outside at x = {_f(bx - geo.BIN_FOOTPRINT_HALF)} to {_f(bx + geo.BIN_FOOTPRINT_HALF)}, "
                     f"y = {_f(by - geo.BIN_FOOTPRINT_HALF)} to {_f(by + geo.BIN_FOOTPRINT_HALF)}.")
    lines.append(f"- The cube is in the bin when its centre ends inside the walls, between the floor and the rim, "
                 f"still. Releasing it with its centre above z = {_f(bz + HIGH_RELEASE_M)} is a throw (high_release).")
    lines.append("- The fingers open 0.04 m to each side of the tool point; the hand is about 0.11 m behind it.")
    return "\n".join(lines)


def _runs(labels: list[str], t: np.ndarray) -> list[tuple[str, float, float]]:
    out: list[tuple[str, float, float]] = []
    for i, name in enumerate(labels):
        if out and out[-1][0] == name:
            out[-1] = (name, out[-1][1], float(t[i]))
        else:
            out.append((name, float(t[i]), float(t[i])))
    return out


def _spans(t: np.ndarray, mask: np.ndarray) -> list[tuple[int, int]]:
    edges = np.diff(np.concatenate([[0], mask.astype(np.int8), [0]]))
    return list(zip(np.flatnonzero(edges == 1), np.flatnonzero(edges == -1) - 1))


def facts(traj: Trajectory, signals: SimSignals, scene: Scene, *, times: np.ndarray | None = None) -> dict[str, Any]:
    """The replay's facts the prompt shows, JSON-able. `times` relabels each step (the original-timeline time of an
    edited demo's step); default: the trajectory's own times."""
    t = np.asarray(traj.t) - traj.t[0] if times is None else np.asarray(times, dtype=float)
    if signals.n_steps != len(t):
        raise ValueError(f"signals have {signals.n_steps} steps; the trajectory has {len(t)}")
    p, g, cube = np.asarray(traj.ee_pos), np.asarray(traj.gripper), signals.cube_pos
    rest = np.asarray(scene.cube_pose.pos)
    bin_pos, bin_q = scene.bin_pose.pos, scene.bin_pose.quat_wxyz

    steps = [{"step": n, "t0": round(a, 2), "t1": round(b, 2)}
             for n, a, b in _runs(phases(g, cube, bin_pos, bin_q), t)]
    hit = (signals.contact_arm_bin | signals.contact_arm_table) & (signals.max_contact_force > COLLISION_FORCE_N)
    contacts = []
    for i0, i1 in _spans(t, hit):
        k = i0 + int(np.argmax(signals.max_contact_force[i0 : i1 + 1]))
        what = [n for n, m in (("bin", signals.contact_arm_bin), ("table", signals.contact_arm_table)) if m[i0 : i1 + 1].any()]
        contacts.append({"t0": round(float(t[i0]), 2), "t1": round(float(t[i1]), 2), "with": "+".join(what),
                         "peak_N": round(float(signals.max_contact_force[k]), 1), "peak_t": round(float(t[k]), 2),
                         "tool_at_peak": [round(float(c), 3) for c in p[k]], "gripper": "closed" if g[k] else "open"})
    closes = np.flatnonzero((g[1:] == 1) & (g[:-1] == 0)) + 1
    opens = np.flatnonzero((g[1:] == 0) & (g[:-1] == 1)) + 1
    grasps = []
    for k in closes:
        nxt = opens[opens > k]
        end = int(nxt[0]) if nxt.size else len(t)
        held = signals.contact_gripper_cube[k:end]
        off = p[k] - cube[k - 1]
        grasps.append({"t": round(float(t[k]), 2), "tool": [round(float(c), 3) for c in p[k]],
                       "cube": [round(float(c), 3) for c in cube[k - 1]],
                       "offset_mm": [round(float(c) * 1000, 1) for c in off],
                       "xy_offset_mm": round(float(np.linalg.norm(off[:2])) * 1000, 1),
                       "cube_lifted": bool(np.any(held & (cube[k:end, 2] > rest[2] + GRASPED_LIFT_M)))})
    releases = []
    for k in opens:
        holding = bool(signals.contact_gripper_cube[k - 1])
        c = cube[k - 1]
        releases.append({"t": round(float(t[k]), 2), "tool": [round(float(v), 3) for v in p[k]], "holding_cube": holding,
                         "cube": [round(float(v), 3) for v in c],
                         "cube_centre_above_bin_origin_m": round(float(c[2] - bin_pos[2]), 3),
                         "cube_over_bin_inside": _over_bin(c, scene)})
    lost = signals.contact_gripper_cube[:-1] & ~signals.contact_gripper_cube[1:] & (g[1:] == 1)
    drops = [{"t": round(float(t[k + 1]), 2), "cube": [round(float(v), 3) for v in cube[k + 1]],
              "over_bin_inside": _over_bin(cube[k + 1], scene)} for k in np.flatnonzero(lost)]
    return {"duration_s": round(float(t[-1] - t[0]), 2), "steps": steps, "contacts_over_limit": contacts,
            "grasps": grasps, "regrasps": max(len(closes) - 1, 0), "releases": releases,
            "lost_cube_while_closed": drops, "final_cube": [round(float(v), 3) for v in cube[-1]],
            "final_cube_over_bin_inside": _over_bin(cube[-1], scene)}


def _over_bin(c, scene: Scene) -> bool:
    w, x, y, z = scene.bin_pose.quat_wxyz
    yaw = np.arctan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z))
    d = np.asarray(c[:2], dtype=float) - np.asarray(scene.bin_pose.pos[:2])
    lx, ly = np.cos(yaw) * d[0] + np.sin(yaw) * d[1], -np.sin(yaw) * d[0] + np.cos(yaw) * d[1]
    return bool(abs(lx) <= geo.BIN_INNER[0] / 2 and abs(ly) <= geo.BIN_INNER[1] / 2)


def path_table(traj: Trajectory, signals: SimSignals, *, times: np.ndarray | None = None) -> str:
    """Every TABLE_STEP_S: time, tool xyz, gripper, cube xyz, finger-cube contact, peak arm force since the last row."""
    t = np.asarray(traj.t) - traj.t[0] if times is None else np.asarray(times, dtype=float)
    p, g = np.asarray(traj.ee_pos), np.asarray(traj.gripper)
    rows = ["t | tool x y z | grip | cube x y z | fingers on cube | arm force N (max since last row)"]
    every = max(1, int(round(TABLE_STEP_S / float(np.median(np.diff(np.asarray(traj.t)))))))
    idx = list(range(0, len(t), every))
    if idx[-1] != len(t) - 1:
        idx.append(len(t) - 1)
    prev = 0
    for k in idx:
        force = float(signals.max_contact_force[prev : k + 1].max())
        prev = k + 1
        c = signals.cube_pos[k]
        rows.append(f"{t[k]:.2f} | {p[k][0]:.3f} {p[k][1]:.3f} {p[k][2]:.3f} | {'closed' if g[k] else 'open'} | "
                    f"{c[0]:.3f} {c[1]:.3f} {c[2]:.3f} | {'yes' if signals.contact_gripper_cube[k] else 'no'} | "
                    f"{force:.0f}")
    return "\n".join(rows)


def facts_text(f: dict[str, Any]) -> str:
    """One line per fact, the value as compact JSON."""
    return "\n".join(f"{k}: {json.dumps(v, separators=(', ', ': '))}" for k, v in f.items())


def verdict_text(v: VerificationResult) -> str:
    if v.success:
        return "PASSED"
    return "FAILED: " + "; ".join(f"{r} ({REASON_HELP.get(r, r)})" for r in v.reasons)


@dataclass
class _Context:
    demo: Demo
    trajectory: Trajectory  # on the 50 Hz grid from t = 0 (the timeline every edit refers to)
    verdict: VerificationResult
    signals: SimSignals


def first_prompt(ctx: _Context) -> str:
    f = facts(ctx.trajectory, ctx.signals, ctx.demo.scene)
    return (f"Demo {ctx.demo.id}: {f['duration_s']:.2f} s.\n"
            f"Replay verdict: {verdict_text(ctx.verdict)}\n\n"
            f"Scene geometry:\n{geometry_text(ctx.demo.scene)}\n\n"
            f"What the replay did (times in s; positions in m; the step labels come from the gripper and the cube):\n"
            f"{facts_text(f)}\n\n"
            f"Path:\n{path_table(ctx.trajectory, ctx.signals)}")


def _round_text(r: dict) -> str:
    head = f"Round {r['round']}: your reply was\n{r['reply'].strip()}\n"
    if r.get("errors"):
        return head + "It was rejected:\n" + "\n".join(f"- {e}" for e in r["errors"])
    return (head + f"Applied to the original demo: {r['report_text']}.\n"
            f"Replay of the edited demo: {r['verdict_text']}\n"
            f"What that replay did (times mapped back to the ORIGINAL timeline):\n{facts_text(r['facts'])}\n"
            f"Its path (original-timeline times):\n{r['table']}")


def build_prompt(ctx: _Context, history: list[dict]) -> str:
    if not history:
        return first_prompt(ctx) + "\n\nPropose the edits."
    return (first_prompt(ctx) + "\n\n" + "\n\n".join(_round_text(r) for r in history)
            + "\n\nPropose the complete corrected set of edits (applied to the original demo).")


def parse_plan(text: str) -> EditPlan:
    """The EditPlan in a reply (its outermost {...}); EditError with readable lines otherwise."""
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        raise EditError(["the reply has no JSON object"])
    try:
        data = json.loads(text[start : end + 1])
    except json.JSONDecodeError as e:
        raise EditError([f"the JSON doesn't parse: {e}"]) from e
    try:
        return EditPlan.model_validate(data)
    except ValidationError as e:
        raise EditError([f"{'.'.join(str(p) for p in err['loc']) or 'reply'}: {err['msg']}"
                         for err in e.errors()]) from e


# --- the loop -------------------------------------------------------------------------------------

@dataclass
class RepairResult:
    # repaired = an edited demo passed the verifier; unverified = a dry run (no verifier) got a valid plan
    status: Literal["repaired", "gave_up", "failed", "unverified"]
    trajectory: Trajectory | None  # the verified edited demo
    plan: EditPlan | None  # the last valid plan
    report: EditReport | None  # its what-changed report
    verification: VerificationResult | None  # the last verification
    rounds: list[dict] = field(default_factory=list)
    calls: int = 0
    cost_usd: float = 0.0
    model: str | None = None

    def summary(self) -> dict:
        return {"status": self.status, "calls": self.calls, "cost_usd": round(self.cost_usd, 5), "model": self.model,
                "plan": None if self.plan is None else self.plan.model_dump(),
                "report": None if self.report is None else self.report.model_dump(),
                "verification": None if self.verification is None else self.verification.model_dump(),
                "rounds": [{k: v for k, v in r.items() if k not in ("facts", "table")} for r in self.rounds]}


def repair_with_nemotron(demo: Demo, verdict: VerificationResult, signals: SimSignals, verify: Verifier | None, *,
                         chat_fn: Callable = chat, tier: str = TIER, think: bool = THINK, max_tokens: int = MAX_TOKENS,
                         max_rounds: int = MAX_ROUNDS, before_call: Callable[[], None] | None = None) -> RepairResult:
    """Ask Nemotron for edits to `demo` (whose replay failed with `verdict` and `signals`, on its steps), verify each
    valid plan with `verify`, and feed errors or the new verdict back, for at most `max_rounds` model calls.
    verify=None is a dry run (no simulator): it stops at the first valid plan, status "unverified"."""
    traj = _regrid(demo.trajectory)
    if len(traj.t) != len(demo.trajectory.t):
        raise ValueError(f"demo {demo.id} is not on the 50 Hz grid; the signals would not line up with the edits")
    ctx = _Context(demo=demo, trajectory=traj, verdict=verdict, signals=signals)
    res = RepairResult(status="failed", trajectory=None, plan=None, report=None, verification=None)
    history: list[dict] = []
    for k in range(1, max_rounds + 1):
        if before_call is not None:
            before_call()
        reply = chat_fn(build_prompt(ctx, history), tier=tier, system=SYSTEM_PROMPT, max_tokens=max_tokens,
                        think=think)
        res.calls += 1
        res.cost_usd += float(getattr(reply, "est_cost_usd", 0.0) or 0.0)
        res.model = getattr(reply, "model", None) or res.model
        record: dict[str, Any] = {"round": k, "reply": reply.text}
        res.rounds.append(record)
        try:
            plan = parse_plan(reply.text)
            edited = apply_edits(traj, plan)
        except EditError as e:
            record["errors"] = e.errors
            history.append(record)
            continue
        record.update(plan=plan.model_dump(), report=edited.report.model_dump(), report_text=edited.report.text())
        res.plan, res.report = plan, edited.report
        if not plan.edits:
            res.status = "gave_up"
            return res
        if verify is None:
            res.status, res.trajectory = "unverified", edited.trajectory
            return res
        v, new_signals = verify(edited.trajectory)
        res.verification = v
        record.update(verification=v.model_dump(), verdict_text=verdict_text(v))
        if v.success:
            res.status, res.trajectory = "repaired", edited.trajectory
            return res
        times = np.asarray(edited.source_t)
        record.update(facts=facts(edited.trajectory, new_signals, demo.scene, times=times),
                      table=path_table(edited.trajectory, new_signals, times=times))
        history.append(record)
    return res
