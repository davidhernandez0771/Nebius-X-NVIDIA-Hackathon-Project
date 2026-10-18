"""sim_worker.recovery (pure): find where a policy rollout went wrong, and let the expert finish from there.

Run 2 of the grasp fix: the centered_10x10 policy arrives off-center or turned, lands a finger on the cube top, or
ends with an empty closed gripper, and has never seen how to get out of those states. Recovery copies start at such
a state (restored from the rollout's trace) and show the expert re-aligning, reopening and re-grasping.
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from demo_pipeline.schemas import Pose, Scene, VerificationResult
from sim_worker.homeset import CENTER_MIN_S
from sim_worker.recovery import (RECOVERY_ROOT_PREFIX, RecoveryState, find_recovery_states, recovery_manifest,
                                 recovery_trajectory, run_recovery)
from sim_worker.scripted import ABOVE_CUBE, HOLD_S, scripted_expert

CUBE = np.array([0.50, 0.10, 0.025])
BIN = Pose(pos=(0.45, -0.25, 0.0), quat_wxyz=(1.0, 0.0, 0.0, 0.0))
SCENE = Scene(cube_pose=Pose(pos=tuple(CUBE), quat_wxyz=(1.0, 0.0, 0.0, 0.0)), bin_pose=BIN, robot="franka",
              seed=5203)
OPEN, CLOSED = 0.04, 0.0


def down(yaw_deg=0.0):
    y = math.radians(yaw_deg)
    return np.array([0.0, math.cos(y / 2), math.sin(y / 2), 0.0])


def z_quat(yaw_deg):
    y = math.radians(yaw_deg)
    return np.array([math.cos(y / 2), 0.0, 0.0, math.sin(y / 2)])


def trace(tcp, *, yaw=0.0, grip=None, contact=None, fingers=None, cube=None, cube_quat=None):
    """A StepTracer-shaped dict from a TCP path (n, 3); the rest defaults to an open hand and a resting cube."""
    tcp = np.asarray(tcp, dtype=float)
    n = len(tcp)
    grip = np.zeros(n, dtype=int) if grip is None else np.asarray(grip)
    fingers = np.where(grip == 1, CLOSED, OPEN) if fingers is None else np.asarray(fingers, dtype=float)
    q = np.zeros((n, 9))
    q[:, 0] = np.arange(n)  # joint 1 encodes the row, so tests can see which row a state took its joints from
    q[:, 7] = q[:, 8] = fingers
    act = np.zeros((n, 9))
    act[:, 7] = act[:, 8] = np.where(grip == 1, CLOSED, OPEN)
    return {
        "joint_pos": q, "action": act, "tcp_pos": tcp, "tcp_quat_wxyz": np.tile(down(yaw), (n, 1)),
        "cube_pos": np.tile(CUBE, (n, 1)) if cube is None else np.asarray(cube, dtype=float),
        "cube_quat_wxyz": np.tile(z_quat(0.0) if cube_quat is None else cube_quat, (n, 1)),
        "gripper": grip, "contact_gripper_cube": np.zeros(n, bool) if contact is None else np.asarray(contact),
        "contact_arm_bin": np.zeros(n, bool), "contact_arm_table": np.zeros(n, bool),
        "max_contact_force": np.zeros(n),
    }


def path(*legs):
    """Concatenate (start, end, n_steps) linear legs into an (n, 3) path."""
    out = []
    for a, b, k in legs:
        a, b = np.asarray(a, float), np.asarray(b, float)
        out.append(a + (b - a) * np.linspace(0, 1, k, endpoint=False)[:, None])
    return np.vstack(out)


HOME = [0.45, 0.0, 0.35]


def hover_then_descend(off=(0.020, 0.0), hover_steps=60):
    hover = CUBE + [off[0], off[1], ABOVE_CUBE]
    low = CUBE + [off[0], off[1], 0.10]
    return path((HOME, hover, 60), (hover, hover, hover_steps), (hover, low, 30), (low, low, 10))


# --- finding the states ------------------------------------------------------------------------------------------

def test_a_misaligned_hover_gives_its_entry_and_exit_states():
    tr = trace(hover_then_descend((0.020, 0.0)))
    states = {s.mode: s for s in find_recovery_states(tr, SCENE, source="centered_10x10")}
    assert {"hover_enter", "hover_exit"} <= set(states)
    s = states["hover_enter"]
    assert s.offset_mm == pytest.approx(20.0, abs=0.5) and s.gripper == 0 and s.seed == 5203
    assert 60 <= s.k < 70 and s.joint_pos[0] == s.k + 1  # the observation after step k is the state after it
    np.testing.assert_allclose(s.tcp_pos, tr["tcp_pos"][s.k]) and np.testing.assert_allclose(s.cube_pos, CUBE)
    assert states["hover_exit"].k > s.k + 0.2 * 50
    assert s.name == "rec_5203_hover_enter"


def test_a_turned_hover_counts_as_misaligned():
    states = find_recovery_states(trace(hover_then_descend((0.002, 0.0)), yaw=25.0), SCENE, source="c")
    assert "hover_enter" in {s.mode for s in states}
    assert next(s for s in states if s.mode == "hover_enter").yaw_err_deg == pytest.approx(25.0, abs=0.5)


def test_an_aligned_hover_gives_no_state():
    states = find_recovery_states(trace(hover_then_descend((0.003, 0.0)), yaw=3.0), SCENE, source="c")
    assert not [s for s in states if s.mode.startswith("hover") or s.mode == "descent"]


def test_a_misaligned_descent_gives_a_descent_state():
    states = {s.mode: s for s in find_recovery_states(trace(hover_then_descend((0.020, 0.0))), SCENE, source="c")}
    d = states["descent"]
    assert 0.04 <= d.tcp_pos[2] - CUBE[2] <= 0.10 and d.gripper == 0


def test_a_finger_on_the_cube_top_gives_an_on_top_state():
    top = CUBE + [0.025, 0.0, 0.033]
    tcp = path((CUBE + [0.025, 0, 0.15], top, 40), (top, top, 40))
    contact = np.zeros(80, bool)
    contact[40:] = True
    states = {s.mode: s for s in find_recovery_states(trace(tcp, contact=contact), SCENE, source="c")}
    s = states["on_top"]
    assert s.k >= 40 and s.gripper == 0 and s.tcp_pos[2] - CUBE[2] > 0.015


def test_an_empty_closed_gripper_gives_an_empty_closed_state():
    low = CUBE + [0.03, 0.0, 0.06]
    tcp = path((low, low, 100))
    grip = np.r_[np.zeros(20, int), np.ones(80, int)]
    states = {s.mode: s for s in find_recovery_states(trace(tcp, grip=grip), SCENE, source="c")}
    s = states["empty_closed"]
    assert s.gripper == 1 and s.k >= 20 + 25 and s.joint_pos[7] < 0.005


def test_a_closed_gripper_holding_the_cube_is_not_empty():
    low = CUBE + [0.0, 0.0, 0.0]
    grip = np.r_[np.zeros(20, int), np.ones(80, int)]
    fingers = np.where(grip == 1, 0.025, OPEN)
    contact = grip == 1
    states = find_recovery_states(trace(path((low, low, 100)), grip=grip, fingers=fingers, contact=contact),
                                  SCENE, source="c")
    assert "empty_closed" not in {s.mode for s in states}


def test_states_need_a_resting_upright_cube_off_the_bin():
    tilted = math.radians(20)
    tq = np.array([math.cos(tilted / 2), math.sin(tilted / 2), 0.0, 0.0])
    assert find_recovery_states(trace(hover_then_descend(), cube_quat=tq), SCENE, source="c") == []
    n = len(hover_then_descend())
    moving = np.tile(CUBE, (n, 1)) + np.arange(n)[:, None] * [0.001, 0.0, 0.0]  # 5 cm/s
    assert find_recovery_states(trace(hover_then_descend(), cube=moving), SCENE, source="c") == []
    in_bin = np.tile([*BIN.pos[:2], 0.035], (n, 1))
    assert find_recovery_states(trace(hover_then_descend(), cube=in_bin), SCENE, source="c") == []


def test_a_trace_without_the_cube_orientation_is_refused():
    tr = trace(hover_then_descend())
    del tr["cube_quat_wxyz"]
    with pytest.raises(ValueError, match="cube_quat"):
        find_recovery_states(tr, SCENE, source="c")


def test_states_round_trip_through_json():
    s = find_recovery_states(trace(hover_then_descend()), SCENE, source="c")[0]
    assert RecoveryState.model_validate_json(s.model_dump_json()) == s


# --- the expert's continuation -----------------------------------------------------------------------------------

def _state(mode, tcp, grip, yaw=0.0):
    return RecoveryState(name=f"rec_5203_{mode}", seed=5203, mode=mode, source="c", k=100, t=2.0,
                         joint_pos=[0.0] * 7 + ([CLOSED] * 2 if grip else [OPEN] * 2), tcp_pos=list(tcp),
                         tcp_quat_wxyz=list(down(yaw)), gripper=grip, cube_pos=list(CUBE),
                         cube_quat_wxyz=[1.0, 0.0, 0.0, 0.0], offset_mm=0.0, yaw_err_deg=0.0)


def _expert():
    return scripted_expert(SCENE)


def test_from_an_empty_closed_gripper_the_expert_opens_rises_realigns_then_picks_as_usual():
    start = CUBE + [0.03, 0.01, 0.06]
    traj = recovery_trajectory(_state("empty_closed", start, 1), BIN)
    pos, grip = np.asarray(traj.ee_pos), np.asarray(traj.gripper)
    exp = _expert()
    tail = len(exp.t) - 1
    np.testing.assert_allclose(pos[-tail:], np.asarray(exp.ee_pos)[1:])  # then exactly the usual pick and place
    assert list(grip[-tail:]) == list(exp.gripper[1:])
    np.testing.assert_allclose(pos[0], start)
    n_hold = round(HOLD_S * 50)
    assert grip[0] == 0 and not grip[: len(grip) - tail].any()  # it opens at once and stays open until the grasp
    np.testing.assert_allclose(pos[: n_hold + 1], np.tile(start, (n_hold + 1, 1)))  # opening in place
    rise = pos[n_hold: len(pos) - tail]
    top = int(np.argmax(rise[:, 2] >= CUBE[2] + ABOVE_CUBE - 1e-9))
    np.testing.assert_allclose(rise[: top + 1, :2], np.tile(start[:2], (top + 1, 1)), atol=1e-12)  # straight up
    assert np.allclose(np.diff(traj.t), 0.02) and traj.t[0] == 0.0


def test_from_a_misaligned_hover_the_expert_only_realigns_slowly_then_picks():
    start = CUBE + [0.02, -0.01, ABOVE_CUBE]
    traj = recovery_trajectory(_state("hover_enter", start, 0, yaw=25.0), BIN)
    pos = np.asarray(traj.ee_pos)
    tail = len(_expert().t) - 1
    realign = pos[: len(pos) - tail]  # up to and including the above-cube pose; the expert's descent follows
    assert np.allclose(realign[:, 2], start[2])  # no rise, a level move
    assert len(realign) - 1 >= round(CENTER_MIN_S * 50)
    np.testing.assert_allclose(realign[-1], CUBE + [0, 0, ABOVE_CUBE])


def test_from_a_finger_on_top_the_expert_backs_up_before_moving_sideways():
    start = CUBE + [0.025, 0.0, 0.033]
    pos = np.asarray(recovery_trajectory(_state("on_top", start, 0), BIN).ee_pos)
    k = int(np.argmax(pos[:, 2] >= CUBE[2] + ABOVE_CUBE - 1e-9))
    np.testing.assert_allclose(pos[: k + 1, :2], np.tile(start[:2], (k + 1, 1)), atol=1e-12)


# --- the job loop ------------------------------------------------------------------------------------------------

OK = VerificationResult(success=True, reasons=[], duration=8.0, path_length=1.0, max_contact_force=0.0,
                        settle_time=1.0)
BAD = VerificationResult(success=False, reasons=["dropped"], duration=8.0, path_length=1.0, max_contact_force=0.0,
                         settle_time=1.0)


class FakeReplay:
    def __init__(self, results):
        self.results, self.calls = list(results), []

    def __call__(self, traj, scene, ep, cameras, start_joint_pos):
        self.calls.append((ep.name, scene, list(start_joint_pos), cameras))
        ep.mkdir(parents=True, exist_ok=True)
        r = self.results.pop(0)
        if isinstance(r, Exception):
            raise r
        return r, None, traj


def _states():
    return [_state("hover_enter", CUBE + [0.02, 0, ABOVE_CUBE], 0),
            _state("empty_closed", CUBE + [0.03, 0, 0.06], 1),
            _state("on_top", CUBE + [0.025, 0, 0.033], 0)]


def test_run_recovery_replays_from_each_state_and_keeps_the_verdicts(tmp_path):
    stamped = []
    replay = FakeReplay([OK, BAD, RuntimeError("PhysX")])
    rows = run_recovery(_states(), {5203: BIN}, replay, root=tmp_path, log=lambda m: None,
                        stamp=lambda ep, pp: stamped.append(pp))
    assert [r["success"] for r in rows] == [True, False, False]
    assert rows[2]["reasons"] == ["sim_error"] and rows[2]["ep_dir"] is None
    name, scene, q0, cameras = replay.calls[1]
    assert name == "rec_5203_empty_closed" and q0[7] == CLOSED and cameras is True
    assert scene.cube_pose.pos == tuple(CUBE) and scene.bin_pose == BIN and scene.seed == 5203
    assert [p.lineage for p in stamped] == [[RECOVERY_ROOT_PREFIX + "c", "rec_5203_hover_enter"],
                                            [RECOVERY_ROOT_PREFIX + "c", "rec_5203_empty_closed"]]
    assert (tmp_path / "episodes" / "rec_5203_hover_enter" / "verification.json").exists()


def test_run_recovery_reuses_finished_folders(tmp_path):
    run_recovery(_states()[:1], {5203: BIN}, FakeReplay([OK]), root=tmp_path, log=lambda m: None,
                 stamp=lambda ep, pp: None)
    again = FakeReplay([])
    rows = run_recovery(_states()[:1], {5203: BIN}, again, root=tmp_path, log=lambda m: None,
                        stamp=lambda ep, pp: None)
    assert again.calls == [] and rows[0]["success"] is True


def test_recovery_manifest_counts_by_mode_and_lists_only_verified_episodes():
    rows = [{"name": "a", "mode": "hover_enter", "success": True, "reasons": [], "ep_dir": "A"},
            {"name": "b", "mode": "hover_enter", "success": False, "reasons": ["dropped"], "ep_dir": "B"},
            {"name": "c", "mode": "on_top", "success": True, "reasons": [], "ep_dir": "C"}]
    m = recovery_manifest(rows)
    assert m["verified_dirs"] == ["A", "C"] and m["attempts"] == 3 and m["verified"] == 2
    assert m["by_mode"] == {"hover_enter": {"attempts": 2, "verified": 1}, "on_top": {"attempts": 1, "verified": 1}}
    assert m["reasons"] == {"dropped": 1}


# --- from the practice-seed traces (5200-5219): what real rollouts look like -----------------------------------

def test_a_finger_on_top_while_the_hand_still_pushes_is_kept():
    top = CUBE + [0.025, 0.0, 0.033]
    tcp = path((CUBE + [0.025, 0, 0.15], top, 40), (top, top + [0.0, 0.0, -0.016], 40))  # 1 cm/s... then 2 cm/s
    tcp[40:] += np.arange(40)[:, None] * [0.002, 0.0, 0.0]  # pushing sideways at 10 cm/s
    contact = np.zeros(80, bool)
    contact[40:] = True
    assert "on_top" in {s.mode for s in find_recovery_states(trace(tcp, contact=contact), SCENE, source="c")}


def test_an_empty_closed_state_waits_until_the_hand_slows_down():
    # after the drop the policy carries its empty gripper away (25 cm/s), then stops
    a = CUBE + [0.0, 0.0, 0.06]
    b = a + [0.0, -0.25, 0.15]
    tcp = path((a, a, 20), (a, b, 60), (b, b, 60))
    grip = np.r_[np.zeros(20, int), np.ones(120, int)]
    s = {x.mode: x for x in find_recovery_states(trace(tcp, grip=grip), SCENE, source="c")}["empty_closed"]
    assert s.k >= 80 and np.allclose(s.tcp_pos, b)


def test_a_cube_lying_on_its_side_counts_as_upright_and_is_grasped_at_its_face_yaw():
    side = np.array([math.cos(math.pi / 4), math.sin(math.pi / 4), 0.0, 0.0])  # rolled 90 deg about x
    rolled_and_turned = np.array([  # then 20 deg about the world vertical: z_quat(20) * side
        math.cos(math.radians(10)) * side[0] - math.sin(math.radians(10)) * side[3],
        math.cos(math.radians(10)) * side[1] - math.sin(math.radians(10)) * side[2],
        math.cos(math.radians(10)) * side[2] + math.sin(math.radians(10)) * side[1],
        math.cos(math.radians(10)) * side[3] + math.sin(math.radians(10)) * side[0]])
    states = find_recovery_states(trace(hover_then_descend(), cube_quat=rolled_and_turned), SCENE, source="c")
    assert states
    st = states[0]
    traj = recovery_trajectory(st, BIN)
    yaws = [math.degrees(2 * math.atan2(q[2], q[1])) for q in traj.ee_quat]
    k_close = int(np.argmax(np.asarray(traj.gripper)))
    assert (yaws[k_close] + 45) % 90 - 45 == pytest.approx(20.0, abs=1e-6)


def test_a_far_reapproach_moves_at_the_expert_speed_not_the_centering_speed():
    far = CUBE + [0.0, -0.30, ABOVE_CUBE]
    traj = recovery_trajectory(_state("empty_closed", far, 1), BIN)
    pos = np.asarray(traj.ee_pos)
    v = np.linalg.norm(np.diff(pos, axis=0), axis=1) * 50
    from sim_worker.scripted import SPEED
    tail = len(_expert().t) - 1
    move = v[round(HOLD_S * 50): len(pos) - tail]
    assert move.mean() == pytest.approx(SPEED, rel=0.15)


def test_the_recovery_root_prefix_matches_assembles():
    from lerobot_tools.assemble import RECOVERY_ROOT_PREFIX as ASSEMBLE_PREFIX
    assert RECOVERY_ROOT_PREFIX == ASSEMBLE_PREFIX
