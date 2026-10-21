"""The soft floor (demo_pipeline.soft_floor) and the sim session that applies it, the contact reading and the
take's peak force (sim_worker.teleop_session), with no Isaac: a fake driver stands in."""

from __future__ import annotations

import json
import math

import numpy as np
import pytest

from demo_pipeline.schemas import Assist, Demo, Pose, Scene
from demo_pipeline.scene_geometry import BIN_FOOTPRINT_HALF, BIN_RIM_HEIGHT, TABLE_TOP_Z
from demo_pipeline.soft_floor import FLOOR_BELOW_RIM, FOOTPRINT_MARGIN, AssistZones, Zone, clamp_to_floor, floor_z, zones_for_scene
from demo_pipeline.teleop import Calibration, HandPoseMsg, to_ee_target
from sim_worker.teleop_session import (
    TELEOP_DT,
    ContactReading,
    Recording,
    StepState,
    TeleopSession,
    TwinState,
    dispatch,
    peak_contact,
)

IDENTITY = (1.0, 0.0, 0.0, 0.0)
DOWN = (0.0, 1.0, 0.0, 0.0)
BIN = Pose(pos=(0.5, 0.3, 0.0), quat_wxyz=IDENTITY)
SCENE = Scene(cube_pose=Pose(pos=(0.5, 0.0, 0.025), quat_wxyz=IDENTITY), bin_pose=BIN, robot="franka", seed=7)
RIM_FLOOR = BIN_RIM_HEIGHT - FLOOR_BELOW_RIM  # 0.08 above a bin on the table


# --- the clamp ------------------------------------------------------------------------------

def test_inside_the_bin_the_floor_is_a_centimetre_under_the_rim():
    assert floor_z((0.5, 0.3, 0.0), BIN) == pytest.approx(RIM_FLOOR)
    assert RIM_FLOOR == pytest.approx(0.08)
    pos, held = clamp_to_floor((0.52, 0.28, 0.02), BIN)  # pressing down into the bin floor
    assert held and pos == pytest.approx((0.52, 0.28, RIM_FLOOR))


def test_above_the_floor_the_target_is_untouched():
    assert clamp_to_floor((0.5, 0.3, 0.2), BIN) == ((0.5, 0.3, 0.2), False)
    assert clamp_to_floor((0.5, 0.3, RIM_FLOOR), BIN) == ((0.5, 0.3, RIM_FLOOR), False)  # at the floor: not held
    assert clamp_to_floor((0.3, -0.2, 0.0), BIN) == ((0.3, -0.2, 0.0), False)  # on the table top


def test_elsewhere_the_floor_is_the_table_top():
    pos, held = clamp_to_floor((0.3, -0.2, -0.04), BIN)
    assert held and pos == (0.3, -0.2, TABLE_TOP_Z)


@pytest.mark.parametrize("dy, inside", [
    (BIN_FOOTPRINT_HALF + FOOTPRINT_MARGIN - 0.001, True),  # fingers over the wall still stop at the rim
    (BIN_FOOTPRINT_HALF + FOOTPRINT_MARGIN + 0.001, False),
])
def test_the_footprint_is_the_bins_outside_plus_a_margin(dy, inside):
    assert floor_z((0.5, 0.3 + dy, 0.0), BIN) == pytest.approx(RIM_FLOOR if inside else TABLE_TOP_Z)


def test_the_floor_follows_the_bins_pose_not_a_fixed_place():
    turned = Pose(pos=(0.45, -0.25, 0.03), quat_wxyz=(math.cos(math.pi / 8), 0.0, 0.0, math.sin(math.pi / 8)))  # 45 deg
    assert floor_z((0.45, -0.25, 0.0), turned) == pytest.approx(0.03 + RIM_FLOOR)
    # a corner of the square's axis-aligned box, outside the turned bin: the table
    corner = BIN_FOOTPRINT_HALF + FOOTPRINT_MARGIN - 0.005
    assert floor_z((0.45 + corner, -0.25 + corner, 0.0), turned) == TABLE_TOP_Z
    # along the turned bin's own x axis, the same distance is inside
    d = corner / math.sqrt(2)
    assert floor_z((0.45 + d, -0.25 + d, 0.0), turned) == pytest.approx(0.03 + RIM_FLOOR)
    assert floor_z((0.5, 0.3, 0.0), turned) == TABLE_TOP_Z  # where the bin used to be


# --- the session applies it -------------------------------------------------------------------

class FakeDriver:
    """The TCP goes straight to each target; contact force is whatever the test sets."""

    joint_names = ["j1", "j2"]

    def __init__(self) -> None:
        self.applied: list[Pose] = []
        self.tcp = np.array((0.4, 0.0, 0.3))
        self.force = 0.0
        self.contact = ContactReading(force=0.0, body=None, against=None)

    def reset(self, scene: Scene) -> None:
        self.tcp = np.array((0.4, 0.0, 0.3))

    def apply(self, target: Pose, gripper: int) -> None:
        self.applied.append(target)
        self.tcp = np.array(target.pos)

    def read_state(self) -> StepState:
        return StepState(joint_pos=np.zeros(2), action=np.zeros(2), ee_pos=self.tcp.copy(), ee_quat=np.array(DOWN),
                         cube_pos=np.array((0.5, 0.0, 0.025)), contact_gripper_cube=False,
                         contact_arm_bin=self.force > 5, contact_arm_table=False, max_contact_force=self.force)

    def read_twin(self) -> TwinState:
        return TwinState(joint_pos=np.zeros(2), cube_pose=np.array((0.5, 0.0, 0.025, *IDENTITY)))

    def read_contact(self) -> ContactReading:
        return self.contact


def over_bin(z_frac: float = 0.0) -> HandPoseMsg:
    """A hand whose target is over the bin centre; z_frac 0 is the workspace's bottom (0.02 m: into the bin)."""
    calib = Calibration()
    s_y = (calib.y_range[1] - BIN.pos[1]) / (calib.y_range[1] - calib.y_range[0])  # y runs from y_max down
    s_x = (BIN.pos[0] - calib.x_range[0]) / (calib.x_range[1] - calib.x_range[0])
    return HandPoseMsg(t_ms=0.0, tracking_ok=True, wrist_uv=(0.5, 0.5), palm_width=0.1, pinch_ratio=0.8, yaw_rad=0.0,
                       frame_w=640, frame_h=480, control=(1.0 - s_y, 1.0 - z_frac, s_x))


@pytest.fixture
def rig():
    driver, saved = FakeDriver(), []
    t = [1000.0]
    ids = iter(f"human_test_{i}" for i in range(100))

    def save(rec: Recording) -> str:
        saved.append(rec)
        return f"saved {rec.demo.id}"

    session = TeleopSession(driver, SCENE, save, clock=lambda: t[0], new_id=lambda: next(ids))

    def run(steps: int, msg: HandPoseMsg | None) -> None:
        for _ in range(steps):
            if msg is not None:
                session.on_hand(msg)
            session.step()
            t[0] += TELEOP_DT

    return session, driver, saved, run


def test_the_hand_mapping_can_reach_into_the_bin_so_the_floor_matters():
    target = to_ee_target(over_bin())
    assert target.pos == pytest.approx((0.5, 0.3, 0.02))  # 6 cm under the rim floor: the bin floor is at 0.01


@pytest.mark.parametrize("input", ["camera", "keyboard", "mouse"])
def test_on_by_default_it_holds_every_inputs_target_at_the_rim(rig, input):
    session, driver, _, run = rig
    session.on_control("set_input", input)
    run(60, over_bin())  # keyboard/mouse targets are smoothed: long enough to settle
    assert session.soft_floor is True
    assert min(p.pos[2] for p in driver.applied) >= RIM_FLOOR - 1e-9
    assert driver.applied[-1].pos[2] == pytest.approx(RIM_FLOOR, abs=1e-4)  # keyboard/mouse: still gliding in
    assert session.floored is True
    assert session.twin()["floor"] is True


def test_above_the_floor_it_changes_nothing(rig):
    session, driver, _, run = rig
    run(3, over_bin(z_frac=0.5))
    assert driver.applied[-1] == to_ee_target(over_bin(z_frac=0.5))
    assert session.floored is False


def test_set_assist_turns_it_off_and_on(rig):
    session, driver, _, run = rig
    session.on_control("set_assist", soft_floor=False)
    assert session.last_result == "soft floor off" and session.status()["soft_floor"] is False
    run(2, over_bin())
    assert driver.applied[-1].pos[2] == pytest.approx(0.02)  # off: the target goes where the hand says
    session.on_control("set_assist", soft_floor=True)
    run(1, over_bin())
    assert driver.applied[-1].pos[2] == pytest.approx(RIM_FLOOR)


@pytest.mark.parametrize("bad", [None, "yes", 1])
def test_set_assist_needs_a_bool(rig, bad):
    session, *_ = rig
    with pytest.raises(ValueError, match="soft_floor"):
        session.on_control("set_assist", soft_floor=bad)


def test_the_relay_message_reaches_the_session(rig):
    session, *_ = rig
    assert dispatch(session, json.dumps({"type": "control", "action": "set_assist", "soft_floor": False})) is None
    assert session.soft_floor is False


def test_each_demo_is_labelled_with_the_assist(rig):
    session, _, saved, run = rig
    session.on_control("record_start")
    run(5, over_bin(z_frac=0.5))
    run(4, over_bin())  # 4 steps held at the rim
    session.on_control("record_stop")
    demo = saved[0].demo
    # The label says how many separate holds there were, and which zones were active: today's, the one bin's rim rule.
    assert demo.assist == Assist(soft_floor=True, soft_floor_steps=4, soft_floor_dips=1,
                                 zones=zones_for_scene(SCENE).to_dict())
    label = json.loads(demo.model_dump_json())["assist"]
    assert label["soft_floor"] is True and label["soft_floor_steps"] == 4 and label["soft_floor_dips"] == 1
    assert [z["id"] for z in label["zones"]["zones"]] == ["bin:bin"] and label["zones"]["source"] == "geometry"
    # what the arm was told is what was recorded: the clamped target
    assert min(demo.commanded.ee_pos[i][2] for i in range(len(demo.commanded.t))) == pytest.approx(RIM_FLOOR)


def test_a_take_with_it_off_says_so(rig):
    session, _, saved, run = rig
    session.on_control("set_assist", soft_floor=False)
    session.on_control("record_start")
    run(3, over_bin())
    session.on_control("record_stop")
    assert saved[0].demo.assist == Assist(soft_floor=False, soft_floor_steps=0, soft_floor_dips=0)


def test_an_assist_label_without_zones_serializes_as_before():
    # Demos saved before the zones existed hash the same.
    assert json.loads(Assist(soft_floor=True, soft_floor_steps=4).model_dump_json()) == {"soft_floor": True, "soft_floor_steps": 4}


def test_a_session_takes_any_scenes_zones_and_labels_the_take_with_them(rig):
    session, driver, saved, run = rig
    raised = Zone("keep_out:x", "keep_out", (0.5, 0.3), 0.0, (0.3, 0.3), 0.2, source="nemotron")
    session.zones = AssistZones(zones_for_scene(SCENE).zones + (raised,), source="nemotron")
    session.on_control("record_start")
    run(4, over_bin())
    session.on_control("record_stop")
    assert min(p.pos[2] for p in driver.applied) == pytest.approx(0.2)  # the higher, semantic floor held it
    assert saved[0].demo.assist.zones["source"] == "nemotron"


def test_a_speed_cap_limits_how_far_the_target_moves_each_step(rig):
    session, driver, _, run = rig
    run(3, over_bin(z_frac=1.0))  # settle high over the bin
    slow = Zone("slow:x", "slow", (0.5, 0.3), 0.0, (0.5, 0.5), TABLE_TOP_Z, source="rules", speed_cap=0.05)
    session.zones = AssistZones(zones_for_scene(SCENE).zones + (slow,), source="rules")
    run(5, over_bin(z_frac=0.0))  # the hand jumps down
    steps = np.linalg.norm(np.diff(np.asarray([a.pos for a in driver.applied[-6:]]), axis=0), axis=1)
    assert steps.max() <= 0.05 * TELEOP_DT + 1e-9


def test_a_take_with_the_soft_floor_off_has_no_zones(rig):
    session, _, saved, run = rig
    session.on_control("set_assist", soft_floor=False)
    session.on_control("record_start")
    run(2, over_bin())
    session.on_control("record_stop")
    assert saved[0].demo.assist.zones is None


def test_demos_without_assist_serialize_as_before():
    demo = Demo.model_validate_json(json.dumps({
        "id": "human_old", "source": "human", "scene": json.loads(SCENE.model_dump_json()), "human_seconds": 1.0,
        "trajectory": {"t": [0.0, 0.02], "ee_pos": [[0.5, 0, 0.1]] * 2, "ee_quat": [list(DOWN)] * 2, "gripper": [0, 0]},
    }))
    assert demo.assist is None and "assist" not in json.loads(demo.model_dump_json())


# --- contact: the take's peak, and the twin's reading -----------------------------------------

def test_the_status_carries_the_takes_peak_contact_force(rig):
    session, driver, _, run = rig
    assert session.status()["contact_peak_n"] is None  # no take yet
    session.on_control("record_start")
    assert session.status()["contact_peak_n"] == 0
    driver.force = 312.4
    run(1, over_bin(z_frac=0.5))
    driver.force = 40.0
    run(1, over_bin(z_frac=0.5))
    assert session.status()["contact_peak_n"] == 312
    session.on_control("record_stop")
    assert session.status()["contact_peak_n"] == 312  # the last take's, until the next starts
    session.on_control("record_start")
    assert session.status()["contact_peak_n"] == 0


def test_the_twin_carries_the_contact_reading(rig):
    session, driver, _, _ = rig
    driver.contact = ContactReading(force=7.26, body="panda_hand", against="bin")
    twin = session.twin()
    assert twin["contact"] == {"force_n": 7.3, "body": "panda_hand", "against": "bin"}
    assert twin["floor"] is False


def test_a_driver_without_contacts_sends_none(rig):
    session, driver, _, _ = rig
    del FakeDriver.read_contact
    try:
        assert "contact" not in session.twin()
    finally:
        FakeDriver.read_contact = lambda self: self.contact


BODIES = ["panda_link1", "panda_hand", "panda_leftfinger"]


def _matrix(per_body: list[float], history: int = 2) -> np.ndarray:
    """A sensor's normal_force_matrix_w_history: [env, history, sensor body, filter body, xyz], force along z."""
    m = np.zeros((1, history, 1, len(per_body), 3))
    m[0, -1, 0, :, 2] = per_body
    return m


def test_peak_contact_names_the_body_pushing_hardest_and_what_it_pushes():
    reading = peak_contact({"bin": [_matrix([0, 3.0, 0]), _matrix([0, 0, 120.0])], "table": [_matrix([9.0, 0, 0])]}, BODIES)
    assert reading == ContactReading(force=120.0, body="panda_leftfinger", against="bin")
    assert peak_contact({"table": [_matrix([0, 0, 0])]}, BODIES) == ContactReading(0.0, None, None)


def test_peak_contact_uses_both_physics_substeps():
    m = np.zeros((1, 2, 1, 3, 3))
    m[0, 0, 0, 1] = (3.0, 4.0, 0.0)  # the first substep's push, 5 N
    assert peak_contact({"table": [m]}, BODIES) == ContactReading(force=5.0, body="panda_hand", against="table")


def test_separate_holds_are_counted_as_dips(rig):
    session, _, saved, run = rig
    session.on_control("record_start")
    for _ in range(3):  # three dips into the bin, back up in between
        run(4, over_bin())
        run(3, over_bin(z_frac=0.5))
    session.on_control("record_stop")
    assert saved[0].demo.assist == Assist(soft_floor=True, soft_floor_steps=12, soft_floor_dips=3,
                                          zones=zones_for_scene(SCENE).to_dict())  # the floor was on: its zones too


def test_an_older_assist_without_dips_serializes_as_before():
    old = Assist.model_validate({"soft_floor": True, "soft_floor_steps": 39})
    assert old.soft_floor_dips is None
    assert json.loads(old.model_dump_json()) == {"soft_floor": True, "soft_floor_steps": 39}
