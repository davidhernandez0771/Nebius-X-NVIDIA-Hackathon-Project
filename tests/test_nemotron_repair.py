"""app.ai.nemotron_repair: prompt facts, parsing, and the edit -> verify -> feedback loop, with a scripted model and a
toy replay whose verdict comes from the real check_success."""
from __future__ import annotations

import json
from types import SimpleNamespace as NS

import numpy as np
import pytest

from app.ai import nemotron_repair as nr
from demo_pipeline.edit_plan import EditError
from demo_pipeline.schemas import Demo, Pose, Scene, SimSignals, Trajectory
from demo_pipeline.success import check_success

DT = 0.02
IDENTITY = (1.0, 0.0, 0.0, 0.0)
CUBE = (0.50, 0.00, 0.025)
BIN = (0.50, 0.30, 0.0)
FLOOR_TOP = 0.01
# Pick the cube, carry it over the bin, then press it into the floor (tool z 0.03: the cube's bottom 5 mm under the
# floor's top) and open there.
KNOTS = [
    (0.0, (0.35, -0.10, 0.25)),
    (2.0, (0.50, 0.00, 0.025)),
    (2.5, (0.50, 0.00, 0.025)),
    (3.5, (0.50, 0.00, 0.25)),
    (5.5, (0.50, 0.30, 0.25)),
    (6.5, (0.50, 0.30, 0.03)),
    (7.0, (0.50, 0.30, 0.03)),
    (8.0, (0.50, 0.30, 0.30)),
    (9.0, (0.50, 0.30, 0.30)),
]
T_CLOSE, T_OPEN = 2.2, 6.8
GOOD = {"edits": [{"op": "shift_segment", "t0": 6.2, "t1": 7.0, "dx": 0, "dy": 0, "dz": 0.025}],
        "why": "the cube was pressed into the bin floor; place it 2.5 cm higher"}


def _traj() -> Trajectory:
    t = np.arange(round(KNOTS[-1][0] / DT) + 1) * DT
    pos = np.zeros((len(t), 3))
    for (ta, pa), (tb, pb) in zip(KNOTS, KNOTS[1:]):
        m = (t >= ta - 1e-9) & (t <= tb + 1e-9)
        u = (t[m] - ta) / (tb - ta)
        pos[m] = np.asarray(pa) + (u ** 3 * (10 - 15 * u + 6 * u ** 2))[:, None] * (np.asarray(pb) - np.asarray(pa))
    grip = ((t >= T_CLOSE - 1e-9) & (t < T_OPEN - 1e-9)).astype(int)
    return Trajectory.from_arrays(t, pos, np.tile(IDENTITY, (len(t), 1)), grip)


SCENE = Scene(cube_pose=Pose(pos=CUBE, quat_wxyz=IDENTITY), bin_pose=Pose(pos=BIN, quat_wxyz=IDENTITY),
              robot="franka", seed=0)


def _demo() -> Demo:
    return Demo(id="human_test", source="human", trajectory=_traj(), scene=SCENE, human_seconds=9.0)


def toy_replay(traj: Trajectory):
    """A cube that sticks to closed fingers placed on it and drops straight down when they open. Holding it lower
    than the bin floor allows presses the gripper on the floor with 200 N."""
    p, g = np.asarray(traj.ee_pos), np.asarray(traj.gripper)
    n = len(p)
    cube, held = np.array(CUBE, dtype=float), False
    cube_pos, touch = np.zeros((n, 3)), np.zeros(n, bool)
    on_bin, force = np.zeros(n, bool), np.zeros(n)
    for i in range(n):
        over_bin = abs(p[i, 0] - BIN[0]) <= 0.1 and abs(p[i, 1] - BIN[1]) <= 0.1
        if g[i] and not held and np.linalg.norm(p[i] - cube) < 0.01:
            held = True
        elif not g[i] and held:
            held = False
            cube = np.array([p[i, 0], p[i, 1], FLOOR_TOP + 0.025 if over_bin else 0.025])
        if held:
            cube = p[i].copy()
            if over_bin and p[i, 2] - 0.025 < FLOOR_TOP:
                on_bin[i], force[i] = True, 200.0
        cube_pos[i], touch[i] = cube, held
    sig = SimSignals(cube_pos=cube_pos, contact_gripper_cube=touch, contact_arm_bin=on_bin,
                     contact_arm_table=np.zeros(n, bool), max_contact_force=force)
    return check_success(traj, sig, SCENE.bin_pose), sig


class Model:
    """Scripted replies; keeps every prompt."""

    def __init__(self, *replies):
        self.replies, self.prompts, self.systems = list(replies), [], []

    def __call__(self, prompt, *, tier, system, max_tokens, think):
        self.prompts.append(prompt)
        self.systems.append(system)
        r = self.replies.pop(0)
        return NS(text=r if isinstance(r, str) else json.dumps(r), est_cost_usd=0.001, model="fake-nemotron")


class Verifier:
    def __init__(self):
        self.calls = []

    def __call__(self, traj):
        self.calls.append(traj)
        return toy_replay(traj)


def _raw():
    demo = _demo()
    verdict, sig = toy_replay(demo.trajectory)
    return demo, verdict, sig


def test_the_toy_demo_fails_with_a_collision():
    _, verdict, _ = _raw()
    assert verdict.reasons == ["collision"]


def test_a_pressed_into_the_bin_demo_is_fixed_by_a_correct_edit():
    demo, verdict, sig = _raw()
    model, verify = Model(GOOD), Verifier()
    res = nr.repair_with_nemotron(demo, verdict, sig, verify, chat_fn=model)
    assert res.status == "repaired" and res.calls == 1 and len(verify.calls) == 1
    assert res.verification.success
    z = np.asarray(res.trajectory.ee_pos)[:, 2]
    assert z[int(round(6.8 / DT))] == pytest.approx(0.055)
    assert res.report.max_moved_cm == pytest.approx(2.5)
    assert res.summary()["plan"]["edits"][0]["op"] == "shift_segment"
    assert res.cost_usd == pytest.approx(0.001) and res.model == "fake-nemotron"


def test_an_over_budget_edit_is_rejected_and_the_error_goes_back():
    demo, verdict, sig = _raw()
    too_far = {"edits": [{"op": "move_point", "t": 6.8, "x": 0.5, "y": 0.3, "z": 0.15}], "why": "lift it 12 cm"}
    model, verify = Model(too_far, GOOD), Verifier()
    res = nr.repair_with_nemotron(demo, verdict, sig, verify, chat_fn=model)
    assert res.status == "repaired" and res.calls == 2
    assert len(verify.calls) == 1  # the rejected plan never reached the simulator
    assert "over the repair budget: a step moves 12.0 cm" in res.rounds[0]["errors"][0]
    assert "It was rejected:\n- over the repair budget" in model.prompts[1]
    assert '"z": 0.15' in model.prompts[1]  # the model sees its own reply


def test_invalid_json_is_retried():
    demo, verdict, sig = _raw()
    model = Model("Sure! I would raise the place a little.", '{"edits": [{"op": "shift_segment", "t0": 6.2,}]}',
                  "```json\n" + json.dumps(GOOD) + "\n```")
    res = nr.repair_with_nemotron(demo, verdict, sig, Verifier(), chat_fn=model)
    assert res.status == "repaired" and res.calls == 3
    assert "the reply has no JSON object" in model.prompts[1]
    assert "the JSON doesn't parse" in model.prompts[2]


def test_a_schema_error_names_the_field():
    with pytest.raises(EditError) as e:
        nr.parse_plan('{"edits": [{"op": "shift_segment", "t0": 6.2, "t1": 7.0, "dz": 0.2}]}')
    assert e.value.errors[0].startswith("edits.0.shift_segment.dz")
    with pytest.raises(EditError, match="release_above_bin"):
        nr.parse_plan('{"edits": [{"op": "release_above_bin", "t": 6.8}]}')  # off the language


def test_a_failed_verification_feeds_the_new_verdict_back_in_original_times():
    demo, verdict, sig = _raw()
    too_small = {"edits": [{"op": "shift_segment", "t0": 6.2, "t1": 7.0, "dz": 0.002},
                           {"op": "retime", "t0": 0.5, "t1": 1.5, "factor": 2.0}], "why": "a little higher"}
    model, verify = Model(too_small, GOOD), Verifier()
    res = nr.repair_with_nemotron(demo, verdict, sig, verify, chat_fn=model)
    assert res.status == "repaired" and len(verify.calls) == 2
    assert res.rounds[0]["verification"]["reasons"] == ["collision"]
    second = model.prompts[1]
    assert "Replay of the edited demo: FAILED: collision" in second
    assert "moved up to 0.2 cm" in second and "retime [0.50, 1.50] 1.00 s ->" in second
    contacts = json.loads(second.split("contacts_over_limit: ")[-1].split("\n")[0])
    assert 6.3 < contacts[0]["t0"] < 6.6 and contacts[0]["t1"] < 7.1  # original timeline, not the slowed one
    assert "complete corrected set of edits" in second


def test_it_stops_after_max_rounds():
    demo, verdict, sig = _raw()
    bad = {"edits": [{"op": "shift_segment", "t0": 6.2, "t1": 7.0, "dz": 0.001}]}
    model, verify = Model(bad, bad, bad, bad), Verifier()
    res = nr.repair_with_nemotron(demo, verdict, sig, verify, chat_fn=model, max_rounds=3)
    assert res.status == "failed" and res.calls == 3 and len(verify.calls) == 3
    assert res.trajectory is None and res.verification.reasons == ["collision"]


def test_an_empty_plan_gives_up_without_a_replay():
    demo, verdict, sig = _raw()
    verify = Verifier()
    res = nr.repair_with_nemotron(demo, verdict, sig, verify, chat_fn=Model({"edits": [], "why": "cube knocked away"}))
    assert res.status == "gave_up" and verify.calls == [] and res.plan.why == "cube knocked away"


def test_before_call_runs_before_every_model_call():
    demo, verdict, sig = _raw()
    seen = []
    nr.repair_with_nemotron(demo, verdict, sig, Verifier(), chat_fn=Model("no", GOOD),
                            before_call=lambda: seen.append(1))
    assert seen == [1, 1]


def test_release_above_bin_and_the_rules_are_never_shown():
    demo, verdict, sig = _raw()
    model = Model({"edits": [{"op": "shift_segment", "t0": 6.2, "t1": 7.0, "dz": 0.001}]}, "x", GOOD)
    nr.repair_with_nemotron(demo, verdict, sig, Verifier(), chat_fn=model)
    for text in model.prompts + model.systems:
        for word in ("release_above_bin", "recenter_grasp", "replan_transit", "remove_pause", "rules detector",
                     "diagnosis"):
            assert word not in text


def test_the_facts_the_prompt_shows():
    demo, verdict, sig = _raw()
    f = nr.facts(demo.trajectory, sig, SCENE)
    assert [s["step"] for s in f["steps"]] == ["reach", "grasp", "carry", "place", "release"]
    assert f["grasps"][0]["t"] == pytest.approx(T_CLOSE) and f["grasps"][0]["xy_offset_mm"] < 1
    assert f["grasps"][0]["cube_lifted"] is True and f["regrasps"] == 0
    c = f["contacts_over_limit"][0]
    assert c["with"] == "bin" and c["peak_N"] == 200.0 and c["gripper"] == "closed"
    r = f["releases"][0]
    assert r["t"] == pytest.approx(T_OPEN) and r["holding_cube"] and r["cube_over_bin_inside"]
    assert r["cube_centre_above_bin_origin_m"] == pytest.approx(0.03, abs=1e-3)
    assert f["final_cube_over_bin_inside"] is True
    prompt = nr.first_prompt(nr._Context(demo, demo.trajectory, verdict, sig))
    assert "Replay verdict: FAILED: collision (the arm or gripper pressed" in prompt
    assert "rim top at z = 0.090" in prompt and "Inside walls at x = 0.400 and 0.600, y = 0.200 and 0.400" in prompt
    assert prompt.count("\n6.") >= 5  # the path table, every 0.2 s


def test_signals_must_match_the_trajectory():
    demo, verdict, sig = _raw()
    short = SimSignals(cube_pos=sig.cube_pos[:-1], contact_gripper_cube=sig.contact_gripper_cube[:-1],
                       contact_arm_bin=sig.contact_arm_bin[:-1], contact_arm_table=sig.contact_arm_table[:-1],
                       max_contact_force=sig.max_contact_force[:-1])
    with pytest.raises(ValueError, match="signals have"):
        nr.facts(demo.trajectory, short, SCENE)


def test_a_dry_run_stops_at_the_first_valid_plan():
    demo, verdict, sig = _raw()
    res = nr.repair_with_nemotron(demo, verdict, sig, None, chat_fn=Model("no json", GOOD, GOOD))
    assert res.status == "unverified" and res.calls == 2 and res.verification is None
    assert res.trajectory is not None and res.report.max_moved_cm == pytest.approx(2.5)
