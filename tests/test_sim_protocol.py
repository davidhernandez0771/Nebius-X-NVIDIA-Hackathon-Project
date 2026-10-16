"""Sim-worker HTTP contract: the backend (client) and the Isaac sim worker (server) both rely on these shapes."""
from __future__ import annotations

import numpy as np
import pytest
from pydantic import ValidationError

from demo_pipeline.schemas import Pose, Scene, SimSignals, Trajectory, VerificationResult
from demo_pipeline.sim_protocol import (
    DEFAULT_PORT,
    PATHS,
    HealthResponse,
    MultiplyRequest,
    MultiplyResponse,
    MultiplyVariant,
    ReplayRequest,
    ReplayResponse,
    SignalsPayload,
)

IDENTITY = (1.0, 0.0, 0.0, 0.0)


def _traj():
    return Trajectory(t=[0.0, 0.02, 0.04], ee_pos=[(0.5, 0, 0.3)] * 3, ee_quat=[IDENTITY] * 3, gripper=[0, 1, 1])


def _scene(robot="franka"):
    return Scene(cube_pose=Pose(pos=(0.5, 0, 0.025), quat_wxyz=IDENTITY),
                 bin_pose=Pose(pos=(0.5, 0.3, 0), quat_wxyz=IDENTITY), robot=robot, seed=1)


def _verification(ok=True):
    return VerificationResult(success=ok, reasons=[] if ok else ["not_in_bin"], duration=0.04,
                              path_length=0.0, max_contact_force=0.0, settle_time=0.5)


def _signals(n=3):
    return SimSignals(cube_pos=np.zeros((n, 3)), contact_gripper_cube=np.array([0, 1, 1], bool),
                      contact_arm_bin=np.zeros(n, bool), contact_arm_table=np.zeros(n, bool),
                      max_contact_force=np.zeros(n))


def test_constants():
    assert DEFAULT_PORT == 8770
    assert PATHS == {"health": "/health", "replay": "/replay", "multiply": "/multiply"}


def test_signals_payload_round_trips_simsignals():
    sig = _signals()
    back = SignalsPayload.from_signals(sig).to_signals()
    for name in ("cube_pos", "contact_gripper_cube", "contact_arm_bin", "contact_arm_table", "max_contact_force"):
        np.testing.assert_array_equal(getattr(back, name), getattr(sig, name))
    assert back.contact_gripper_cube.dtype == bool


def test_replay_request_and_response_round_trip_json():
    req = ReplayRequest(trajectory=_traj(), scene=_scene(), record_cameras=True, out_name="demo_abc-1")
    assert ReplayRequest.model_validate_json(req.model_dump_json()) == req
    resp = ReplayResponse(verification=_verification(), signals=SignalsPayload.from_signals(_signals()),
                          ep_dir="C:/dev/pm-t2/data/demo_abc-1", n_steps=3, wall_s=12.5)
    assert ReplayResponse.model_validate_json(resp.model_dump_json()) == resp


@pytest.mark.parametrize("bad", ["", "../escape", "a/b", "has space", "x" * 81])
def test_out_name_must_be_a_safe_folder_name(bad):
    with pytest.raises(ValidationError):
        ReplayRequest(trajectory=_traj(), scene=_scene(), out_name=bad)


def test_replay_response_signals_must_match_n_steps():
    with pytest.raises(ValidationError):
        ReplayResponse(verification=_verification(), signals=SignalsPayload.from_signals(_signals(3)),
                       ep_dir=None, n_steps=4, wall_s=1.0)


@pytest.mark.parametrize("n", [0, 201])
def test_multiply_request_bounds_n(n):
    with pytest.raises(ValidationError):
        MultiplyRequest(trajectory=_traj(), scene=_scene(), robot="franka", n=n, seed0=0, out_prefix="m")


def test_multiply_response_counts_must_match_variants():
    v_ok = MultiplyVariant(seed=0, scene=_scene(), trajectory=_traj(), verification=_verification(True), ep_dir=None)
    v_bad = MultiplyVariant(seed=1, scene=_scene(), trajectory=_traj(), verification=_verification(False), ep_dir=None)
    resp = MultiplyResponse(attempts=2, successes=1, variants=[v_ok, v_bad], wall_s=30.0)
    assert MultiplyResponse.model_validate_json(resp.model_dump_json()) == resp
    with pytest.raises(ValidationError):
        MultiplyResponse(attempts=2, successes=2, variants=[v_ok, v_bad], wall_s=30.0)
    with pytest.raises(ValidationError):
        MultiplyResponse(attempts=3, successes=1, variants=[v_ok, v_bad], wall_s=30.0)


def test_health_response():
    h = HealthResponse(ok=True, robots=["franka", "openarm"], cameras=True, busy=False)
    assert HealthResponse.model_validate_json(h.model_dump_json()) == h
