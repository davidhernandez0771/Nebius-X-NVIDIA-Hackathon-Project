"""sim_worker/mimic_tracking.py: SANT's tracking (joint velocity feed-forward, sim_worker.tracking) as the Mimic
env's arm action, checked without starting Isaac (Isaac Lab's Python; SANT's venv skips the file).

    set PYTHONPATH=.;src;C:\\isaac\\IsaacLab\\source\\isaaclab_mimic
    C:\\isaac\\env_isaaclab\\Scripts\\python.exe -m pytest --noconftest -p no:cacheprovider tests/test_mimic_tracking.py
"""
from __future__ import annotations

import os
import sys
from types import SimpleNamespace as NS

import pytest

MIMIC_SRC = os.environ.get("ISAACLAB_MIMIC_SRC", r"C:\isaac\IsaacLab\source\isaaclab_mimic")
torch = pytest.importorskip("torch")
pytest.importorskip("isaaclab.envs")
if MIMIC_SRC not in sys.path and os.path.isdir(MIMIC_SRC):
    sys.path.insert(0, MIMIC_SRC)
pytest.importorskip("isaaclab_mimic")

from sim_worker import mimic_env_cfg as mc  # noqa: E402
from sim_worker import mimic_tracking as mt  # noqa: E402
from sim_worker.tracking import dls_iterate  # noqa: E402

UNIT = torch.tensor([[0.0, 0.0, 0.0, 1.0]])


def _cmd(x, y=0.0, z=0.3):
    return torch.cat([torch.tensor([[x, y, z]]), UNIT], 1)


def _jacobian():
    """7 joints whose first six move the tool along x, y, z and turn it about x, y, z, one each."""
    j = torch.zeros(1, 6, 7)
    j[0, :, :6] = torch.eye(6)
    return j


def test_the_feedforward_is_the_commanded_twist_through_the_jacobian_as_replay_computes_it():
    prev, cmd = _cmd(0.50), _cmd(0.51)  # 1 cm in one 20 ms step: 0.5 m/s along x
    dq = mt.feedforward_joint_vel(prev, cmd, torch.tensor([True]), _jacobian(), dt=0.02, lam=0.01, max_lin=1.0, max_ang=3.0)
    want = dls_iterate(_jacobian(), torch.tensor([[0.5, 0, 0, 0, 0, 0]]), 0.01, 1)
    assert torch.allclose(dq, want, atol=1e-5)
    assert dq[0, 0].item() == pytest.approx(0.5, abs=1e-3)


def test_a_jump_is_clamped_to_the_speed_limit_not_passed_on_as_a_violent_velocity():
    prev, cmd = _cmd(0.50), _cmd(1.00)  # 50 cm in one step: 25 m/s
    dq = mt.feedforward_joint_vel(prev, cmd, torch.tensor([True]), _jacobian(), dt=0.02, lam=0.01, max_lin=1.0, max_ang=3.0)
    assert dq[0, 0].item() == pytest.approx(1.0, abs=1e-3)


def test_no_feedforward_without_a_previous_command():
    dq = mt.feedforward_joint_vel(_cmd(0.5), _cmd(0.51), torch.tensor([False]), _jacobian(), dt=0.02, lam=0.01,
                                  max_lin=1.0, max_ang=3.0)
    assert torch.count_nonzero(dq) == 0


def _term(vel_ff=True):
    """The action term without its Isaac machinery: just what the feed-forward, apply and reset touch."""
    t = mt.SantTrackingIKAction.__new__(mt.SantTrackingIKAction)
    t.cfg = NS(vel_ff=vel_ff, max_ff_speed=1.0, max_ff_ang_speed=3.0, controller=NS(ik_params={"lambda_val": 0.01}))
    t._env = NS(step_dt=0.02)
    t._prev_cmd = torch.zeros(1, 7)
    t._prev_valid = torch.zeros(1, dtype=torch.bool)
    t._joint_vel = torch.zeros(1, 7)
    t._joint_ids = slice(None)
    t._compute_frame_jacobian = _jacobian
    t._sent = []
    t._asset = NS(set_joint_velocity_target_index=lambda **kw: t._sent.append(kw))
    return t


def test_the_term_feeds_forward_from_its_last_command_and_sends_it_with_every_substep(monkeypatch):
    t = _term()
    t._processed = _cmd(0.50)
    monkeypatch.setattr(mt.SantTrackingIKAction, "processed_actions", property(lambda self: self._processed))
    t._update_feedforward()  # the first command: nothing to feed forward from yet
    assert torch.count_nonzero(t._joint_vel) == 0
    t._processed = _cmd(0.51)
    t._update_feedforward()
    assert t._joint_vel[0, 0].item() == pytest.approx(0.5, abs=1e-3)
    monkeypatch.setattr(mt.DifferentialInverseKinematicsAction, "apply_actions", lambda self: None)
    t.apply_actions()
    t.apply_actions()  # decimation 2: the same feed-forward on both substeps
    assert len(t._sent) == 2 and torch.equal(t._sent[1]["target"], t._joint_vel)


def test_a_reset_forgets_the_last_command(monkeypatch):
    t = _term()
    t._prev_valid[:] = True
    t._joint_vel[:] = 1.0
    monkeypatch.setattr(mt.DifferentialInverseKinematicsAction, "reset", lambda self, env_ids=None: None)
    t.reset(None)
    assert not t._prev_valid.any() and torch.count_nonzero(t._joint_vel) == 0


def test_without_feedforward_it_is_isaac_labs_ik_action(monkeypatch):
    t = _term(vel_ff=False)
    monkeypatch.setattr(mt.DifferentialInverseKinematicsAction, "apply_actions", lambda self: None)
    t.apply_actions()
    assert t._sent == []


def test_the_env_drives_the_arm_with_it_on_the_tool_centre():
    cfg = mc.SantPickPlaceMimicEnvCfg()
    arm = cfg.actions.arm_action
    assert isinstance(arm, mc.SantTrackingIKActionCfg)
    # A lazy reference: the config must not import the term (it imports USD; Mimic builds the config first).
    assert str(arm.class_type) == "sim_worker.mimic_tracking:SantTrackingIKAction"
    assert arm.vel_ff is True and arm.body_name == "panda_hand"
    assert arm.controller.use_relative_mode is False
