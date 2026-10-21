"""demo_pipeline contract: the shapes every track (pipeline, sim worker, exporter, diagnoser) relies on."""
from __future__ import annotations

import numpy as np
import pytest
from pydantic import ValidationError

from demo_pipeline.episode_io import EpisodeMeta, load_episode, save_episode
from demo_pipeline.schemas import (
    Demo,
    Diagnosis,
    Passport,
    Pose,
    Scene,
    Trajectory,
    VerificationResult,
)

IDENTITY = (1.0, 0.0, 0.0, 0.0)


def _traj(n=5):
    return Trajectory(
        t=[i * 0.02 for i in range(n)],
        ee_pos=[(0.5, 0.0, 0.3 - 0.01 * i) for i in range(n)],
        ee_quat=[IDENTITY] * n,
        gripper=[0] * (n - 2) + [1, 1],
    )


def _scene():
    return Scene(cube_pose=Pose(pos=(0.5, 0.0, 0.025), quat_wxyz=IDENTITY),
                 bin_pose=Pose(pos=(0.5, 0.3, 0.0), quat_wxyz=IDENTITY), robot="franka", seed=7)


# --- Trajectory -----------------------------------------------------------------

def test_trajectory_round_trips_through_numpy_arrays():
    traj = _traj()
    arrays = traj.to_arrays()
    assert arrays["ee_pos"].shape == (5, 3)
    assert arrays["ee_quat"].shape == (5, 4)
    assert arrays["gripper"].dtype.kind == "i"
    assert Trajectory.from_arrays(**arrays) == traj
    assert traj.duration == pytest.approx(0.08)


@pytest.mark.parametrize("bad", [
    {"t": [0.0, 0.02, 0.02, 0.06, 0.08]},                       # not strictly increasing
    {"gripper": [0, 0, 2, 1, 1]},                               # gripper must be 0/1
    {"ee_quat": [(0.5, 0.0, 0.0, 0.0)] * 5},                    # not a unit quaternion
    {"ee_pos": [(0.5, 0.0, 0.3)] * 4},                          # length mismatch
])
def test_trajectory_rejects_invalid_data(bad):
    data = _traj().model_dump()
    data.update(bad)
    with pytest.raises(ValidationError):
        Trajectory(**data)


def test_trajectory_needs_at_least_two_steps():
    with pytest.raises(ValidationError):
        Trajectory(t=[0.0], ee_pos=[(0, 0, 0)], ee_quat=[IDENTITY], gripper=[0])


# --- SimSignals (sim worker -> measure) -------------------------------------------------------

def test_sim_signals_validates_lengths_and_shapes():
    from demo_pipeline.schemas import SimSignals
    n = 5
    s = SimSignals(cube_pos=np.zeros((n, 3)), contact_gripper_cube=np.zeros(n, bool),
                   contact_arm_bin=np.zeros(n, bool), contact_arm_table=np.zeros(n, bool),
                   max_contact_force=np.zeros(n))
    assert s.n_steps == n
    with pytest.raises(ValueError):
        SimSignals(cube_pos=np.zeros((n, 3)), contact_gripper_cube=np.zeros(n - 1, bool),
                   contact_arm_bin=np.zeros(n, bool), contact_arm_table=np.zeros(n, bool),
                   max_contact_force=np.zeros(n))
    with pytest.raises(ValueError):
        SimSignals(cube_pos=np.zeros((n, 2)), contact_gripper_cube=np.zeros(n, bool),
                   contact_arm_bin=np.zeros(n, bool), contact_arm_table=np.zeros(n, bool),
                   max_contact_force=np.zeros(n))


# --- Demo lineage ------------------------------------------------------------------

def test_human_demo_has_no_parent_and_derived_demo_needs_one():
    Demo(id="h1", source="human", parent_id=None, trajectory=_traj(), scene=_scene(), human_seconds=12.0)
    with pytest.raises(ValidationError):
        Demo(id="r1", source="repaired", parent_id=None, trajectory=_traj(), scene=_scene(), human_seconds=0.0)
    with pytest.raises(ValidationError):
        Demo(id="h2", source="human", parent_id="x", trajectory=_traj(), scene=_scene(), human_seconds=1.0)


def test_demo_keeps_the_commanded_targets_next_to_the_achieved_path():
    old = Demo(id="h0", source="human", trajectory=_traj(), scene=_scene(), human_seconds=1.0)
    assert old.commanded is None  # demos recorded before the field existed still load
    assert "commanded" not in old.model_dump_json() and "commanded" not in old.model_dump()  # and dump as before
    assert Demo.model_validate_json(old.model_dump_json()).commanded is None
    demo = Demo(id="h1", source="human", trajectory=_traj(), commanded=_traj(), scene=_scene(), human_seconds=1.0)
    assert Demo.model_validate_json(demo.model_dump_json()) == demo
    with pytest.raises(ValidationError, match="commanded"):  # one commanded target per achieved step
        Demo(id="h2", source="human", trajectory=_traj(5), commanded=_traj(4), scene=_scene(), human_seconds=1.0)


def test_a_demo_records_how_it_was_driven_or_nothing_for_older_demos():
    d = Demo(id="h1", source="human", trajectory=_traj(), scene=_scene(), human_seconds=12.0)
    assert d.input is None
    assert Demo.model_validate_json(d.model_dump_json(exclude={"input"})).input is None  # an older demo.json
    for mode in ("camera", "keyboard", "mouse"):
        assert Demo(id="h1", source="human", trajectory=_traj(), scene=_scene(), human_seconds=1.0, input=mode).input == mode
    with pytest.raises(ValidationError):
        Demo(id="h1", source="human", trajectory=_traj(), scene=_scene(), human_seconds=1.0, input="joystick")


# --- Diagnosis (Nemotron output) -----------------------------------------------------------

GOOD_DIAGNOSIS = {
    "segments": [{"name": "approach", "t0": 0.0, "t1": 2.1}, {"name": "grasp", "t0": 2.1, "t1": 3.4}],
    "issues": [{"type": "pause", "t0": 1.5, "t1": 2.4, "evidence": "speed ~0 for 0.9 s"},
               {"type": "grasp_off_center", "t": 3.1, "evidence": "fingers on cube edge"}],
    "repairs": [{"op": "remove_pause", "t0": 1.5, "t1": 2.4}, {"op": "recenter_grasp", "t": 3.1},
                {"op": "smooth", "t0": 0.0, "t1": 3.4, "strength": "med"}],
    "decision": "repair",
    "label": "pick up the red cube and place it in the blue bin",
}


def test_valid_diagnosis_parses_and_passes_time_check():
    d = Diagnosis.model_validate(GOOD_DIAGNOSIS)
    assert [r.op for r in d.repairs] == ["remove_pause", "recenter_grasp", "smooth"]
    d.check_times(duration=5.0)  # does not raise


def test_diagnosis_rejects_op_not_on_the_menu():
    bad = {**GOOD_DIAGNOSIS, "repairs": [{"op": "teleport_cube", "t": 1.0}]}
    with pytest.raises(ValidationError):
        Diagnosis.model_validate(bad)


def test_diagnosis_rejects_reversed_time_range():
    bad = {**GOOD_DIAGNOSIS, "repairs": [{"op": "remove_pause", "t0": 2.4, "t1": 1.5}]}
    with pytest.raises(ValidationError):
        Diagnosis.model_validate(bad)


def test_issue_needs_a_point_or_a_range():
    bad = {**GOOD_DIAGNOSIS, "issues": [{"type": "pause", "evidence": "no time given"}]}
    with pytest.raises(ValidationError):
        Diagnosis.model_validate(bad)


@pytest.mark.parametrize("duration", [3.0, 2.0])
def test_check_times_rejects_times_past_the_demo(duration):
    d = Diagnosis.model_validate(GOOD_DIAGNOSIS)
    with pytest.raises(ValueError):
        d.check_times(duration=duration)


def test_check_times_rejects_overlapping_segments():
    bad = {**GOOD_DIAGNOSIS, "segments": [{"name": "approach", "t0": 0.0, "t1": 2.5},
                                          {"name": "grasp", "t0": 2.1, "t1": 3.4}]}
    with pytest.raises(ValueError):
        Diagnosis.model_validate(bad).check_times(duration=5.0)


# --- Passport --------------------------------------------------------------------------

def test_passport_round_trips_as_json():
    p = Passport(demo_id="v1", lineage=["h1", "r1", "v1"],
                 repairs_applied=Diagnosis.model_validate(GOOD_DIAGNOSIS).repairs,
                 diagnosis_source="nemotron", model_id="nvidia/Nemotron-3.5-Super-VL", variant_seed=3,
                 robot="openarm",
                 verification=VerificationResult(success=True, reasons=[], duration=8.2, path_length=1.1,
                                                 max_contact_force=0.4, settle_time=0.6),
                 pipeline_version="0.1.0")
    assert Passport.model_validate_json(p.model_dump_json()) == p


# --- Episode files (sim worker writes, exporter reads) --------------------------------------

def test_episode_save_and_load_round_trip(tmp_path):
    n, joints = 4, 9
    arrays = {
        "joint_pos": np.zeros((n, joints), dtype=np.float32),
        "action": np.ones((n, joints), dtype=np.float32),
        "ee_pos": np.zeros((n, 3), dtype=np.float32),
        "ee_quat": np.tile(np.array(IDENTITY, dtype=np.float32), (n, 1)),
        "gripper": np.array([0, 0, 1, 1], dtype=np.int8),
    }
    meta = EpisodeMeta(demo_id="h1", robot="franka", task_text="pick up the red cube and place it in the blue bin",
                       fps=50, n_steps=n, cameras=["front", "wrist"])
    ep_dir = save_episode(tmp_path / "ep_h1", meta, arrays)
    loaded_meta, loaded_arrays, images = load_episode(ep_dir)
    assert loaded_meta == meta
    np.testing.assert_array_equal(loaded_arrays["action"], arrays["action"])
    assert images["front"] == [ep_dir / "front" / f"{i:06d}.png" for i in range(n)]


def test_sim_signals_save_and_load_round_trip(tmp_path):
    from demo_pipeline.episode_io import load_signals, save_signals
    from demo_pipeline.schemas import SimSignals
    n = 4
    sig = SimSignals(cube_pos=np.arange(n * 3, dtype=float).reshape(n, 3),
                     contact_gripper_cube=np.array([0, 1, 1, 0], bool), contact_arm_bin=np.zeros(n, bool),
                     contact_arm_table=np.zeros(n, bool), max_contact_force=np.linspace(0, 1, n))
    save_signals(tmp_path, sig)
    loaded = load_signals(tmp_path)
    for name in ("cube_pos", "contact_gripper_cube", "contact_arm_bin", "contact_arm_table", "max_contact_force"):
        np.testing.assert_array_equal(getattr(loaded, name), getattr(sig, name))
    assert load_signals(tmp_path / "missing") is None


def test_data_dir_defaults_to_repo_data_and_honours_env(monkeypatch, tmp_path):
    from demo_pipeline.paths import data_dir
    monkeypatch.delenv("DATA_DIR", raising=False)
    assert data_dir().name == "data" and (data_dir().parent / "pyproject.toml").exists()
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    assert data_dir() == tmp_path


def test_episode_save_rejects_arrays_with_wrong_length(tmp_path):
    meta = EpisodeMeta(demo_id="h1", robot="franka", task_text="t", fps=50, n_steps=3, cameras=[])
    arrays = {k: np.zeros((2, 3)) for k in ("joint_pos", "action", "ee_pos")}
    arrays["ee_quat"] = np.zeros((2, 4))
    arrays["gripper"] = np.zeros(2, dtype=np.int8)
    with pytest.raises(ValueError):
        save_episode(tmp_path / "bad", meta, arrays)


def test_a_demo_without_input_serializes_as_before_the_field_existed():
    d = Demo(id="h1", source="human", trajectory=_traj(), scene=_scene(), human_seconds=12.0)
    assert '"input"' not in d.model_dump_json() and "input" not in d.model_dump()
    with_input = d.model_copy(update={"input": "keyboard"})
    assert '"input":"keyboard"' in with_input.model_dump_json()
    assert Demo.model_validate_json(with_input.model_dump_json()).input == "keyboard"
