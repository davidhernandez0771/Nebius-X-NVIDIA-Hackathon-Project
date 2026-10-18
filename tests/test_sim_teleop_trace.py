"""sim_worker.teleop_trace: the teleop latency trace (pure; off unless the sink is started with --latency)."""

from __future__ import annotations

import json

import pytest

from sim_worker.teleop_trace import LatencyTrace, Sections, coalesce_hands, split_trace


def test_split_trace_strips_the_trace_and_leaves_the_hand_message():
    data = {"t_ms": 1.0, "tracking_ok": True, "trace": {"cap": 10.0, "send": 12.5}}
    rest, trace = split_trace(data)
    assert rest == {"t_ms": 1.0, "tracking_ok": True}
    assert trace == {"cap": 10.0, "send": 12.5}
    assert "trace" in data  # the input is not modified


def test_split_trace_without_a_trace():
    assert split_trace({"t_ms": 1.0}) == ({"t_ms": 1.0}, None)


def test_a_malformed_trace_is_dropped_not_fatal():
    assert split_trace({"t_ms": 1.0, "trace": "soon"}) == ({"t_ms": 1.0}, None)
    assert split_trace({"t_ms": 1.0, "trace": {"cap": "x", "send": 2}}) == ({"t_ms": 1.0}, {"send": 2.0})


H = "hand"


def _is_hand(item) -> bool:
    return item[0] == H


def test_only_the_newest_hand_is_kept():
    kept, dropped = coalesce_hands([(H, 1), (H, 2), (H, 3)], _is_hand)
    assert kept == [(H, 3)] and dropped == 2


def test_controls_keep_their_order_and_the_hand_just_before_each():
    items = [(H, 1), (H, 2), ("control", "record_start"), (H, 3), (H, 4), ("control", "record_stop"), (H, 5)]
    kept, dropped = coalesce_hands(items, _is_hand)
    assert kept == [(H, 2), ("control", "record_start"), (H, 4), ("control", "record_stop"), (H, 5)]
    assert dropped == 2


def test_nothing_to_coalesce():
    assert coalesce_hands([], _is_hand) == ([], 0)
    assert coalesce_hands([("control", "x")], _is_hand) == ([("control", "x")], 0)


class Clock:
    def __init__(self, t: float = 1_000_000.0) -> None:
        self.t = t

    def __call__(self) -> float:
        return self.t


def test_sections_add_up_per_step_and_reset():
    s = Sections(clock=Clock())
    s.add("physics", 3.0)
    s.add("physics", 2.0)  # two physics substeps
    s.add("render", 10.0)
    assert s.take() == {"physics": 5.0, "render": 10.0}
    assert s.take() == {}


def test_sections_time_a_block_with_the_clock():
    clock = Clock()
    s = Sections(clock=clock)
    with s.time("read"):
        clock.t += 0.004
    assert s.take() == {"read": pytest.approx(4.0)}


def _msg(cap, send, relay_in, relay_out, recv):
    return {"cap": cap, "send": send, "relay_in": relay_in, "relay_out": relay_out, "recv": recv}


def test_a_message_is_split_into_stages_from_webcam_to_finished_step():
    lines = []
    trace = LatencyTrace(report_every_s=1.0, log=lines.append, clock=Clock(0.0))
    trace.hand_applied(_msg(cap=100.0, send=112.0, relay_in=113.0, relay_out=113.5, recv=114.0), applied=120.0)
    trace.step_done(start=120.0, end=135.0, sections={"physics": 4.0, "render": 9.0}, sleep_ms=5.0)
    summary = trace.summary(now_s=1.0)
    st = summary["stages_ms"]
    assert st["browser"]["p50"] == 12.0  # cap -> send
    assert st["to_relay"]["p50"] == 1.0
    assert st["relay"]["p50"] == 0.5
    assert st["to_sink"]["p50"] == 0.5
    assert st["wait"]["p50"] == 6.0  # recv -> the control step that applied it
    assert st["step"]["p50"] == 15.0  # applied -> step finished (physics + render + read)
    assert st["total"]["p50"] == 35.0  # cap -> step finished
    assert summary["messages"] == {"applied": 1, "stale_dropped": 0}


def test_a_message_without_browser_stamps_still_times_the_sink_side():
    trace = LatencyTrace(clock=Clock(0.0))
    trace.hand_applied({"recv": 10.0}, applied=14.0)
    trace.step_done(start=14.0, end=30.0, sections={}, sleep_ms=0.0)
    st = trace.summary(now_s=1.0)["stages_ms"]
    assert st["wait"]["p50"] == 4.0 and st["step"]["p50"] == 16.0
    assert "browser" not in st and "total" not in st


def test_only_steps_that_applied_a_new_hand_time_a_message():
    trace = LatencyTrace(clock=Clock(0.0))
    trace.hand_applied({"recv": 0.0}, applied=1.0)
    trace.step_done(start=1.0, end=11.0, sections={}, sleep_ms=0.0)
    trace.step_done(start=21.0, end=31.0, sections={}, sleep_ms=0.0)  # no new hand: a hold step
    s = trace.summary(now_s=1.0)
    assert s["stages_ms"]["step"]["n"] == 1 and s["steps"]["n"] == 2


def test_steps_report_rate_real_time_factor_and_sections():
    trace = LatencyTrace(clock=Clock(0.0))
    for k in range(25):  # 25 steps of 40 ms wall each in a 1 s window: half real time at 50 Hz
        t = 40.0 * k
        trace.step_done(start=t, end=t + 30.0, sections={"physics": 5.0, "render": 20.0, "read": 3.0},
                        sleep_ms=0.0)
    steps = trace.summary(now_s=1.0)["steps"]
    assert steps["n"] == 25
    assert steps["per_s"] == pytest.approx(25.0)
    assert steps["rtf"] == pytest.approx(0.5)  # 25 x 20 ms of sim time in 1 s of wall time
    assert steps["wall_ms"]["p50"] == 30.0
    assert steps["sections_ms"]["render"]["p50"] == 20.0
    assert steps["sections_ms"]["other"]["p50"] == 2.0  # step wall minus the timed sections


def test_stale_hands_are_counted():
    trace = LatencyTrace(clock=Clock(0.0))
    trace.stale(3)
    trace.stale(0)
    assert trace.summary(now_s=1.0)["messages"]["stale_dropped"] == 3


def test_report_logs_a_line_every_window_and_appends_jsonl(tmp_path):
    clock, lines = Clock(0.0), []
    path = tmp_path / "latency.jsonl"
    trace = LatencyTrace(report_every_s=2.0, log=lines.append, clock=clock, path=path)
    trace.hand_applied({"recv": 0.0}, applied=1.0)
    trace.step_done(start=1.0, end=11.0, sections={"render": 6.0}, sleep_ms=9.0)
    clock.t = 1.0
    trace.maybe_report()
    assert lines == []  # the window is not over yet
    clock.t = 2.5
    trace.maybe_report()
    assert len(lines) == 1 and lines[0].startswith("[latency]") and "render" in lines[0]
    rows = [json.loads(r) for r in path.read_text(encoding="utf-8").splitlines()]
    assert len(rows) == 1 and rows[0]["steps"]["n"] == 1
    clock.t = 5.0
    trace.maybe_report()  # a new, empty window: nothing more to say
    assert len(lines) == 1


def test_the_probes_messages_are_valid_hands_with_a_trace():
    from demo_pipeline.teleop import HandPoseMsg
    from sim_worker.teleop_probe import circle_message

    for t in (0.0, 1.0, 2.5):
        data = circle_message(t, t_ms=t * 1000.0, sent_ms=5.0)
        rest, stamps = split_trace(data)
        HandPoseMsg.model_validate(rest)
        assert stamps == {"cap": 5.0, "send": 5.0}
    a, b = circle_message(0.0, t_ms=0, sent_ms=0), circle_message(1.0, t_ms=0, sent_ms=0)
    assert a["wrist_uv"] != b["wrist_uv"]  # it moves
