"""sim_worker.jobs: contract requests -> responses through an injected replay function (pure, no sim)."""

from __future__ import annotations

import json
import math

import numpy as np
import pytest

from demo_pipeline.schemas import Pose, Scene, SimSignals, Trajectory, VerificationResult
from demo_pipeline.sim_protocol import MultiplyRequest, MultiplyResponse, ReplayRequest, ReplayResponse
from sim_worker.jobs import (
    WrongRobot,
    multiply_seeds,
    run_multiply,
    run_replay,
    variant_name,
)
from sim_worker.scripted import scripted_expert

IDENTITY = (1.0, 0.0, 0.0, 0.0)


def _scene(robot="franka", cube=(0.5, 0.0), bin_=(0.5, 0.3)) -> Scene:
    return Scene(cube_pose=Pose(pos=(*cube, 0.025), quat_wxyz=IDENTITY),
                 bin_pose=Pose(pos=(*bin_, 0.0), quat_wxyz=IDENTITY), robot=robot, seed=0)


class FakeReplay:
    """Stands in for sim_worker.replay.replay: records calls, 'succeeds' unless the cube x is > fail_above."""

    def __init__(self, fail_above: float = 9.9, extra_steps: int = 0):
        self.calls: list[tuple[Scene, str | None, bool]] = []
        self.fail_above = fail_above
        self.extra_steps = extra_steps

    def __call__(self, traj: Trajectory, scene: Scene, ep_dir, record_cameras: bool):
        self.calls.append((scene, None if ep_dir is None else str(ep_dir), record_cameras))
        a = traj.to_arrays()
        n = len(a["t"]) + self.extra_steps
        executed = traj if not self.extra_steps else Trajectory.from_arrays(
            np.arange(n) * 0.02, np.vstack([a["ee_pos"], np.repeat(a["ee_pos"][-1:], self.extra_steps, 0)]),
            np.vstack([a["ee_quat"], np.repeat(a["ee_quat"][-1:], self.extra_steps, 0)]),
            list(a["gripper"]) + [int(a["gripper"][-1])] * self.extra_steps)
        ok = scene.cube_pose.pos[0] <= self.fail_above
        if ep_dir is not None:
            ep_dir.mkdir(parents=True, exist_ok=True)
            (ep_dir / "steps.npz").write_bytes(b"fake")
        result = VerificationResult(success=ok, reasons=[] if ok else ["unreachable"], duration=executed.duration,
                                    path_length=1.0, max_contact_force=0.0, settle_time=1.0)
        signals = SimSignals(cube_pos=np.zeros((n, 3)), contact_gripper_cube=np.zeros(n, bool),
                             contact_arm_bin=np.zeros(n, bool), contact_arm_table=np.zeros(n, bool),
                             max_contact_force=np.zeros(n))
        return result, signals, executed


def _replay_req(**kw) -> ReplayRequest:
    sc = _scene()
    return ReplayRequest(trajectory=scripted_expert(sc), scene=sc, out_name="demo_1", **kw)


def _mult_req(n=3, seed0=100, robot="franka", prefix="mult") -> MultiplyRequest:
    sc = _scene()
    return MultiplyRequest(trajectory=scripted_expert(sc), scene=sc, robot=robot, n=n, seed0=seed0, out_prefix=prefix)


# ---- replay ------------------------------------------------------------------------------------------------------

def test_replay_writes_under_episodes_and_returns_a_valid_response(tmp_path):
    fake = FakeReplay()
    resp = run_replay(_replay_req(), fake, root=tmp_path, worker_robot="franka", worker_cameras=False)
    ReplayResponse.model_validate_json(resp.model_dump_json())
    assert resp.verification.success
    assert resp.ep_dir == str((tmp_path / "episodes" / "demo_1").resolve())
    assert resp.n_steps == resp.signals.n_steps == len(_replay_req().trajectory.t)
    assert fake.calls[0][1] == resp.ep_dir


def test_replay_reports_the_executed_length_when_the_replay_extends_it(tmp_path):
    resp = run_replay(_replay_req(), FakeReplay(extra_steps=7), root=tmp_path, worker_robot="franka",
                      worker_cameras=False)
    assert resp.n_steps == len(_replay_req().trajectory.t) + 7


def test_replay_without_saving_passes_no_folder(tmp_path):
    fake = FakeReplay()
    resp = run_replay(_replay_req(save_episode=False), fake, root=tmp_path, worker_robot="franka",
                      worker_cameras=False)
    assert resp.ep_dir is None and fake.calls[0][1] is None
    assert not (tmp_path / "episodes").exists()


def test_replay_for_another_robot_is_refused(tmp_path):
    with pytest.raises(WrongRobot):
        run_replay(_replay_req(), FakeReplay(), root=tmp_path, worker_robot="openarm", worker_cameras=False)


def test_replay_asking_for_cameras_on_a_camera_less_worker_is_refused(tmp_path):
    with pytest.raises(ValueError, match="cameras"):
        run_replay(_replay_req(record_cameras=True), FakeReplay(), root=tmp_path, worker_robot="franka",
                   worker_cameras=False)


# ---- multiply ----------------------------------------------------------------------------------------------------

def test_variant_names_are_prefix_and_zero_padded_seed():
    assert variant_name("mult", 7) == "mult_0007"
    assert multiply_seeds(_mult_req(n=3, seed0=100)) == [100, 101, 102]


def test_multiply_replays_every_variant_and_counts_successes(tmp_path):
    fake = FakeReplay(fail_above=0.5)
    resp = run_multiply(_mult_req(n=6), fake, root=tmp_path, worker_robot="franka", worker_cameras=False)
    MultiplyResponse.model_validate_json(resp.model_dump_json())
    assert resp.attempts == 6 == len(fake.calls)
    assert resp.successes == sum(s.cube_pose.pos[0] <= 0.5 for s, _, _ in fake.calls)
    assert [v.seed for v in resp.variants] == list(range(100, 106))
    for v in resp.variants:
        assert v.scene.robot == "franka" and v.scene.seed == v.seed
        assert v.ep_dir == str((tmp_path / "episodes" / variant_name("mult", v.seed)).resolve())
        assert (tmp_path / "episodes" / variant_name("mult", v.seed) / "verification.json").exists()


def test_multiply_variants_follow_the_sampled_scene(tmp_path):
    resp = run_multiply(_mult_req(n=2), FakeReplay(), root=tmp_path, worker_robot="franka", worker_cameras=False)
    for v in resp.variants:
        close = int(np.flatnonzero(np.diff(np.asarray(v.trajectory.gripper)) == 1)[0] + 1)
        assert np.allclose(v.trajectory.ee_pos[close][:2], v.scene.cube_pose.pos[:2], atol=1e-6)


def test_multiply_is_resumable_by_seed(tmp_path):
    first = FakeReplay()
    run_multiply(_mult_req(n=3), first, root=tmp_path, worker_robot="franka", worker_cameras=False)
    second = FakeReplay()
    resp = run_multiply(_mult_req(n=5), second, root=tmp_path, worker_robot="franka", worker_cameras=False)
    assert [s.seed for s, _, _ in second.calls] == [103, 104]  # 100-102 reused from disk
    assert resp.attempts == 5 and resp.successes == 5


def test_a_half_written_variant_is_replayed_again(tmp_path):
    run_multiply(_mult_req(n=2), FakeReplay(), root=tmp_path, worker_robot="franka", worker_cameras=False)
    (tmp_path / "episodes" / "mult_0101" / "verification.json").unlink()  # interrupted before the done marker
    again = FakeReplay()
    run_multiply(_mult_req(n=2), again, root=tmp_path, worker_robot="franka", worker_cameras=False)
    assert [s.seed for s, _, _ in again.calls] == [101]


def test_a_stored_variant_from_another_scene_is_not_reused(tmp_path):
    run_multiply(_mult_req(n=1), FakeReplay(), root=tmp_path, worker_robot="franka", worker_cameras=False)
    path = tmp_path / "episodes" / "mult_0100" / "scene.json"
    stored = json.loads(path.read_text())
    stored["cube_pose"]["pos"][0] += 0.01
    path.write_text(json.dumps(stored))
    again = FakeReplay()
    run_multiply(_mult_req(n=1), again, root=tmp_path, worker_robot="franka", worker_cameras=False)
    assert len(again.calls) == 1


def test_a_variant_whose_replay_raises_is_a_recorded_failure(tmp_path):
    calls = []

    def boom(traj, scene, ep_dir, record_cameras):
        calls.append(scene.seed)
        if scene.seed == 101:
            raise RuntimeError("Warp CUDA error 999")
        return FakeReplay()(traj, scene, ep_dir, record_cameras)

    resp = run_multiply(_mult_req(n=3), boom, root=tmp_path, worker_robot="franka", worker_cameras=False)
    bad = [v for v in resp.variants if v.seed == 101][0]
    assert not bad.verification.success and bad.verification.reasons == ["sim_error"]
    assert resp.attempts == 3 and resp.successes == 2
    assert not (tmp_path / "episodes" / "mult_0101" / "verification.json").exists()  # retried on resume


def test_multiply_for_another_robot_is_refused(tmp_path):
    with pytest.raises(WrongRobot):
        run_multiply(_mult_req(robot="openarm"), FakeReplay(), root=tmp_path, worker_robot="franka",
                     worker_cameras=False)


def test_multiply_may_move_a_demo_to_the_worker_robot(tmp_path):
    """The source scene may name another robot; variants are sampled for (and replayed on) the request's robot."""
    req = _mult_req(n=1, robot="openarm")
    resp = run_multiply(req, FakeReplay(), root=tmp_path, worker_robot="openarm", worker_cameras=False)
    assert resp.variants[0].scene.robot == "openarm"
    assert math.isfinite(resp.wall_s)
