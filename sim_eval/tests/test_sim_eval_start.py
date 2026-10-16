"""Start-state check (Review Focus 4): eval reset pose vs where the training episodes start. Pure, no Isaac."""

from __future__ import annotations

import json

import numpy as np
import pytest

from sim_eval.report import resolve_start
from sim_eval.start_state import (
    FRANKA_DEFAULT_JOINT_POS,
    START_STATE_FILE,
    START_TOL_RAD,
    check_start,
    load_starts,
    save_starts,
)

DEFAULT = np.array(FRANKA_DEFAULT_JOINT_POS)
# First frames of three T2 batch_franka_cam episodes (ep_0000, ep_0001, ep_0016): the TCP starts above the cube.
T2_STARTS = np.array([
    [-0.16, 0.334, -0.1847, -2.048, 0.0879, 2.3824, 0.8314, 0.04, 0.04],
    [-0.1745, 0.1018, 0.433, -2.3924, -0.0776, 2.4922, 1.3831, 0.04, 0.04],
    [0.2336, -0.1048, -0.0186, -2.643, -0.0028, 2.5507, 0.4636, 0.04, 0.04],
])


def test_franka_default_and_threshold():
    assert FRANKA_DEFAULT_JOINT_POS == (0.0, -0.569, 0.0, -2.810, 0.0, 3.037, 0.741, 0.04, 0.04)
    assert START_TOL_RAD == 0.1


def test_starts_near_the_default_keep_the_default_pose():
    starts = DEFAULT + np.array([[0.02, -0.03, 0.01, 0.0, 0.05, -0.02, 0.0, 0.0, 0.0],
                                 [-0.02, 0.03, -0.01, 0.0, -0.05, 0.02, 0.0, 0.0, 0.0]])
    c = check_start(starts)
    assert c.differs is False and c.chosen == "default"
    assert c.reset_pose == list(FRANKA_DEFAULT_JOINT_POS)
    assert c.n_episodes == 2
    assert c.max_abs_diff == pytest.approx(0.0, abs=1e-12)  # the mean is exactly the default


def test_t2_like_starts_differ_and_reset_to_their_mean():
    c = check_start(T2_STARTS)
    mean = T2_STARTS.mean(axis=0)
    assert c.differs is True and c.chosen == "dataset_mean"
    np.testing.assert_allclose(c.reset_pose, mean)
    np.testing.assert_allclose(c.dataset_mean, mean)
    # joint 2 (index 1): default -0.569 vs mean 0.110 is the worst
    assert c.worst_joint == 1
    assert c.max_abs_diff == pytest.approx(abs(-0.569 - mean[1]))
    assert len(c.abs_diff) == 7
    # spread = how far the training starts themselves sit from their mean (max over arm joints)
    assert c.dataset_spread == pytest.approx(np.abs(T2_STARTS[:, :7] - mean[:7]).max())


def test_fingers_are_not_compared_in_radians():
    # Finger joints are prismatic (metres, 0..0.04); only the 7 arm joints count against the rad threshold.
    starts = np.array([list(FRANKA_DEFAULT_JOINT_POS[:7]) + [0.0, 0.0]])
    c = check_start(starts)
    assert c.differs is False and c.chosen == "default"


def test_threshold_is_strict():
    below, above = DEFAULT.copy()[None], DEFAULT.copy()[None]
    below[0, 3] += START_TOL_RAD - 1e-6
    above[0, 3] += START_TOL_RAD + 1e-6
    assert check_start(below).differs is False
    assert check_start(above).differs is True


def test_forced_modes():
    assert check_start(T2_STARTS, mode="default").reset_pose == list(FRANKA_DEFAULT_JOINT_POS)
    assert check_start(T2_STARTS, mode="default").differs is True  # still reported
    near = DEFAULT[None].copy()
    c = check_start(near, mode="dataset")
    assert c.chosen == "dataset_mean"
    with pytest.raises(ValueError, match="mode"):
        check_start(T2_STARTS, mode="sometimes")


@pytest.mark.parametrize("starts", [np.zeros((0, 9)), np.zeros((3, 8)), np.zeros(9),
                                    np.full((2, 9), np.nan)])
def test_bad_starts_are_refused(starts):
    with pytest.raises(ValueError):
        check_start(starts)


def test_save_and_load_round_trip(tmp_path):
    path = save_starts(tmp_path, T2_STARTS, source="unit test")
    assert path == tmp_path / START_STATE_FILE
    data = json.loads(path.read_text(encoding="utf-8"))
    assert data["source"] == "unit test" and data["n_episodes"] == 3 and data["state_dim"] == 9
    np.testing.assert_allclose(load_starts(tmp_path), T2_STARTS)  # a dataset root
    np.testing.assert_allclose(load_starts(path), T2_STARTS)  # or the file itself
    with pytest.raises(FileNotFoundError):
        load_starts(tmp_path / "nope")


# --- run_eval's choice of reset pose (report.resolve_start) ----------------------------------------------------------

def _registry(tmp_path, dataset, checkpoint="C:/runs/a/pretrained_model"):
    reg = tmp_path / "registry.jsonl"
    rows = [{"cell": {"name": "raw_5"}, "status": "ok", "dataset": str(dataset), "checkpoint": checkpoint},
            {"cell": {"name": "raw_10"}, "status": "ok", "dataset": None, "checkpoint": "C:/runs/b"}]
    reg.write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")
    return reg


def test_resolve_start_from_an_explicit_file(tmp_path):
    save_starts(tmp_path, T2_STARTS, source="x")
    pose, record = resolve_start("auto", start_state=tmp_path)
    np.testing.assert_allclose(pose, T2_STARTS.mean(axis=0))
    assert record["chosen"] == "dataset_mean" and record["source"] == str(tmp_path)


def test_resolve_start_from_the_cells_registry_row(tmp_path):
    ds = tmp_path / "ds"
    save_starts(ds, T2_STARTS, source="x")
    reg = _registry(tmp_path, ds)
    pose, record = resolve_start("auto", registry=reg, cell="raw_5", checkpoint="C:/runs/a/pretrained_model")
    np.testing.assert_allclose(pose, T2_STARTS.mean(axis=0))
    assert record["source"] == str(ds)


def test_resolve_start_without_any_start_state_falls_back_to_default(tmp_path):
    reg = _registry(tmp_path, tmp_path / "missing")
    pose, record = resolve_start("auto", registry=reg, cell="raw_5")
    assert pose is None and record["chosen"] == "default" and record["available"] is False
    assert "start_state.json" in record["reason"]
    pose, record = resolve_start("auto")
    assert pose is None and record["available"] is False


def test_resolve_start_dataset_mode_needs_a_start_state(tmp_path):
    with pytest.raises(FileNotFoundError):
        resolve_start("dataset")


def test_resolve_start_default_mode_still_records_the_check(tmp_path):
    save_starts(tmp_path, T2_STARTS, source="x")
    pose, record = resolve_start("default", start_state=tmp_path)
    assert pose is None and record["chosen"] == "default" and record["differs"] is True
