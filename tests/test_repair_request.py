"""app.ai.repair_request (R6 prototype): plain-language repair request -> intents -> RepairOps. Model faked."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from app.ai.repair_request import (
    DemoContext,
    RequestError,
    parse_intents,
    resolve,
)
from demo_pipeline.repair import apply_repairs
from demo_pipeline.schemas import (
    Discard,
    Pose,
    RecenterGrasp,
    RemovePause,
    ReplanTransit,
    Retime,
    Scene,
    Smooth,
    Trajectory,
    Trim,
)

DATA = Path(__file__).resolve().parent / "data"
CTX = DemoContext.from_dict(json.loads((DATA / "repair_requests_context.json").read_text()))
DT = 0.02
IDENTITY = (1.0, 0.0, 0.0, 0.0)
SCENE = Scene(cube_pose=Pose(pos=(0.5, 0.0, 0.025), quat_wxyz=IDENTITY),
              bin_pose=Pose(pos=(0.5, 0.3, 0.0), quat_wxyz=IDENTITY), robot="franka", seed=0)


def _demo_traj() -> Trajectory:
    """Idle 1 s, approach, close, carry with a 1 s pause, open, retreat, idle 1 s."""
    pts = [np.array(p) for p in [(0.35, -0.1, 0.25), (0.5, 0.0, 0.025), (0.5, 0.15, 0.25),
                                 (0.5, 0.3, 0.18), (0.5, 0.3, 0.33)]]
    plan = [("hold", 0, 1.0), ("move", 1, 2.0), ("hold", 1, 0.5), ("move", 2, 1.5), ("hold", 1, 1.0),
            ("move", 3, 1.5), ("hold", 0, 0.5), ("move", 4, 1.0), ("hold", 0, 1.0)]
    pos, grip, cur, g = [pts[0]], [0], pts[0], 0
    for kind, arg, secs in plan:
        n = int(round(secs / DT))
        if kind == "move":
            s = np.arange(1, n + 1) / n
            b = 10 * s**3 - 15 * s**4 + 6 * s**5
            pos += list(cur + (pts[arg] - cur) * b[:, None])
            grip += [g] * n
            cur = pts[arg]
        else:
            pos += [cur] * n
            if arg != g and kind == "hold":
                grip += [g] * (n // 2) + [arg] * (n - n // 2)
                g = arg
            else:
                grip += [g] * n
    n = len(pos)
    return Trajectory.from_arrays(np.arange(n) * DT, np.array(pos), np.tile(IDENTITY, (n, 1)), np.array(grip))


# --- parse_intents: the model's JSON, checked against the intent menu -----------------

def test_parse_intents_reads_a_json_object_with_an_ops_list():
    intents = parse_intents('{"ops": [{"op": "trim", "end": "start"}, {"op": "recenter_grasp"}]}')
    assert [i.op for i in intents] == ["trim", "recenter_grasp"]
    assert intents[0].end == "start"


def test_parse_intents_tolerates_prose_around_the_json():
    intents = parse_intents('Sure! ```json\n{"ops": [{"op": "discard"}]}\n``` done')
    assert [i.op for i in intents] == ["discard"]


def test_parse_intents_accepts_an_empty_ops_list():
    assert parse_intents('{"ops": []}') == []


@pytest.mark.parametrize("raw", [
    "no json here",
    '{"ops": [{"op": "teleport"}]}',                       # not on the menu
    '{"ops": [{"op": "smooth", "span": "carry", "strength": "extreme"}]}',
    '{"ops": [{"op": "retime", "span": "carry"}]}',        # speed_factor missing
    '{"ops": [{"op": "retime", "span": "carry", "speed_factor": 0}]}',
    '{"ops": [{"op": "remove_pause", "pause": 0}]}',
    '{"ops": [{"op": "smooth", "span": [5.0, 3.0]}]}',     # backwards range
    '{"ops": [{"op": "smooth", "span": "lift"}]}',         # not a span code knows
    '{"actions": []}',
])
def test_parse_intents_rejects_anything_off_the_menu(raw):
    with pytest.raises(RequestError):
        parse_intents(raw)


# --- DemoContext ----------------------------------------------------------------------

def test_context_from_the_eval_file_has_its_spans():
    assert CTX.spans() == {"approach": (0.0, 2.48), "carry": (2.48, 10.96),
                           "retreat": (10.96, 14.04), "whole": (0.0, 14.04)}
    assert CTX.pauses == ((5.47, 6.32), (8.2, 9.05))


def test_context_from_a_trajectory_uses_the_rules_detector():
    ctx = DemoContext.from_trajectory(_demo_traj())
    assert ctx.duration == pytest.approx(10.0)
    assert ctx.t_close == pytest.approx(3.25, abs=0.03)
    assert ctx.idle_start is not None and ctx.idle_start[1] == pytest.approx(1.0, abs=0.15)
    assert ctx.idle_end is not None and ctx.idle_end[0] == pytest.approx(9.0, abs=0.15)
    assert len(ctx.pauses) == 1 and ctx.pauses[0][0] == pytest.approx(5.0, abs=0.15)
    assert ctx.speeds["approach"] > 0 and ctx.speeds["carry"] > 0


def test_context_describe_lists_spans_and_pauses_for_the_prompt():
    text = CTX.describe()
    assert "carry: 2.48-10.96 s" in text
    assert "pause 2: 8.20-9.05 s" in text
    assert "idle at the start: 0.00-1.20 s" in text


# --- resolve: intents -> RepairOps (validated by the pydantic union) ------------------

def _resolve(ops):
    return resolve(parse_intents(json.dumps({"ops": ops})), CTX)


def test_trim_start_keeps_from_the_end_of_the_start_idle():
    assert _resolve([{"op": "trim", "end": "start"}]) == [Trim(op="trim", t0=1.2, t1=14.04)]


def test_two_trims_merge_into_one_keep_range():
    got = _resolve([{"op": "trim", "end": "start"}, {"op": "trim", "end": "end"}])
    assert got == [Trim(op="trim", t0=1.2, t1=12.86)]
    assert _resolve([{"op": "trim", "end": "both"}]) == got


def test_trim_an_end_with_no_idle_is_a_no_op():
    ctx = DemoContext(duration=5.0, t_close=1.0, t_open=4.0, idle_start=None, idle_end=None,
                      pauses=(), speeds={"approach": 0.1, "carry": 0.1, "retreat": 0.1, "whole": 0.1})
    assert resolve(parse_intents('{"ops": [{"op": "trim", "end": "both"}]}'), ctx) == []


def test_remove_pause_by_index_and_all():
    assert _resolve([{"op": "remove_pause", "pause": 2}]) == [RemovePause(op="remove_pause", t0=8.2, t1=9.05)]
    assert _resolve([{"op": "remove_pause", "pause": "all"}, {"op": "remove_pause", "pause": 1}]) == [
        RemovePause(op="remove_pause", t0=5.47, t1=6.32), RemovePause(op="remove_pause", t0=8.2, t1=9.05)]


def test_remove_a_pause_that_does_not_exist_is_an_error():
    with pytest.raises(RequestError, match="pause 3"):
        _resolve([{"op": "remove_pause", "pause": 3}])


def test_smooth_a_named_span_and_a_time_span():
    assert _resolve([{"op": "smooth", "span": "carry", "strength": "high"}]) == [
        Smooth(op="smooth", t0=2.48, t1=10.96, strength="high")]
    assert _resolve([{"op": "smooth", "span": [3, 5]}]) == [Smooth(op="smooth", t0=3.0, t1=5.0, strength="med")]


def test_a_time_span_past_the_demo_is_an_error():
    with pytest.raises(RequestError, match="past the demo"):
        _resolve([{"op": "smooth", "span": [3, 20]}])


def test_retime_scales_the_span_speed():
    (op,) = _resolve([{"op": "retime", "span": "approach", "speed_factor": 2.0}])
    assert isinstance(op, Retime) and (op.t0, op.t1) == (0.0, 2.48)
    assert op.target_speed == pytest.approx(0.24)


def test_grasp_transit_and_discard_take_their_times_from_the_context():
    assert _resolve([{"op": "recenter_grasp"}]) == [RecenterGrasp(op="recenter_grasp", t=2.48)]
    assert _resolve([{"op": "replan_transit"}]) == [ReplanTransit(op="replan_transit", t0=2.48, t1=10.96)]
    assert _resolve([{"op": "discard"}]) == [Discard(op="discard")]


def test_grasp_ops_need_a_grasp():
    ctx = DemoContext(duration=5.0, t_close=None, t_open=None, idle_start=None, idle_end=None,
                      pauses=(), speeds={"whole": 0.1})
    with pytest.raises(RequestError, match="grasp"):
        resolve(parse_intents('{"ops": [{"op": "recenter_grasp"}]}'), ctx)


def test_resolved_ops_run_through_apply_repairs():
    traj = _demo_traj()
    ctx = DemoContext.from_trajectory(traj)
    ops = resolve(parse_intents(json.dumps({"ops": [
        {"op": "trim", "end": "both"}, {"op": "remove_pause", "pause": "all"},
        {"op": "smooth", "span": "carry"}, {"op": "retime", "span": "retreat", "speed_factor": 1.5}]})), ctx)
    out = apply_repairs(traj, ops, SCENE, bin_rim_z=0.08)
    assert out.t[-1] < traj.t[-1] - 2.5  # 2 s of idle and a 1 s pause gone, retreat faster
