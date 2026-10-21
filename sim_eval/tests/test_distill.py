"""Teacher -> student distillation: the teacher interface, rollouts, relabelling and episode writing, against a toy
kinematic env, a stub teacher and a stub student (no Isaac, no server, no torch)."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from demo_pipeline.episode_io import load_episode
from demo_pipeline.multiply import sample_scene
from sim_eval.distill import (
    RolloutConfig, label_segments, rollout, rollout_row, write_rollout,
)
from sim_eval.eval_policy import Observation, StepRecord, gripper_command
from sim_eval.teacher import TeacherAction, TeacherState, check_action, load_teacher

DOWN = np.array([0.0, 1.0, 0.0, 0.0])
OPEN_F, CLOSED_F = 0.04, 0.0


def fingers(g: int) -> list[float]:
    return [CLOSED_F, CLOSED_F] if g else [OPEN_F, OPEN_F]


class ToyEnv:
    """Kinematic toy: joints 0-2 are the tool position and go exactly where the target says; the fingers are joints
    7-8. Closing within 1 cm of the cube holds it; opening over the bin drops it in, elsewhere onto the table."""

    cameras = ["front", "wrist"]
    bin_inner = (0.20, 0.20, 0.08)

    def __init__(self):
        self.resets, self.teacher_steps, self.student_steps = 0, [], []

    def reset(self, scene):
        self.scene, self.k, self.resets = scene, 0, self.resets + 1
        self.tcp = np.array([0.45, 0.0, 0.35])
        self.cube = np.asarray(scene.cube_pose.pos, dtype=float).copy()
        self.grip, self.held = 0, False

    def _q(self):
        f = 0.025 if self.held else fingers(self.grip)[0]
        return np.r_[self.tcp, [0.0] * 4, [f, f]]

    def observe(self):
        img = np.full((8, 8, 3), self.k % 256, dtype=np.uint8)
        return Observation(joint_pos=self._q(), images={c: img for c in self.cameras})

    def teacher_state(self, scene, k, gripper):
        return TeacherState(seed=scene.seed, k=k, joint_pos=self._q(), joint_vel=np.zeros(9), tcp_pos=self.tcp.copy(),
                            tcp_quat_wxyz=DOWN.copy(), gripper=gripper, cube_pos=self.cube.copy(),
                            cube_quat_wxyz=np.array([1.0, 0, 0, 0]), cube_lin_vel=np.zeros(3),
                            bin_pos=np.asarray(scene.bin_pose.pos, dtype=float),
                            bin_quat_wxyz=np.asarray(scene.bin_pose.quat_wxyz, dtype=float),
                            contact_gripper_cube=self.held)

    def ik_label(self, a: TeacherAction):
        return np.r_[a.ee_pos, [0.0] * 4, fingers(a.gripper)]

    def step_teacher(self, a: TeacherAction):
        """The teacher's own tracking: in the toy it reaches the target exactly too."""
        self.teacher_steps.append(self.k)
        return self._move(self.ik_label(a))

    def step(self, action):
        self.student_steps.append(self.k)
        return self._move(action)

    def _move(self, action):
        action = np.asarray(action, dtype=float)
        self.tcp = action[:3].copy()
        self.grip = gripper_command(action)
        if self.grip and not self.held and np.linalg.norm(self.tcp - self.cube) < 0.01:
            self.held = True
        if self.held and not self.grip:
            self.held = False
            b = np.asarray(self.scene.bin_pose.pos, dtype=float)
            if np.linalg.norm(self.tcp[:2] - b[:2]) < 0.05:
                self.cube = b + [0.0, 0.0, 0.035]
            else:
                self.cube = np.r_[self.tcp[:2], 0.025]
        if self.held:
            self.cube = self.tcp.copy()
        self.k += 1
        return StepRecord(tcp_pos=self.tcp.copy(), tcp_quat_wxyz=DOWN.copy(), cube_pos=self.cube.copy(),
                          gripper=self.grip, contact_gripper_cube=self.held, contact_arm_bin=False,
                          contact_arm_table=False, max_contact_force=0.0, cube_quat_wxyz=np.array([1.0, 0, 0, 0]))


class StubTeacher:
    """Privileged toy teacher (tests only): reach the cube, close, carry over the bin, open."""

    name = "stub"

    def __init__(self, none_at=(), bad_at=None):
        self.none_at, self.bad_at, self.seen = set(none_at), bad_at, []

    def reset(self, scene):
        self.scene = scene

    def act(self, s: TeacherState):
        self.seen.append(s.k)
        if s.k in self.none_at:
            return None
        if self.bad_at is not None and s.k == self.bad_at:
            return TeacherAction(ee_pos=s.tcp_pos, ee_quat_wxyz=np.array([2.0, 0, 0, 0]), gripper=0)
        b = s.bin_pos
        in_bin = np.linalg.norm(s.cube_pos[:2] - b[:2]) < 0.05 and s.cube_pos[2] < 0.06
        if in_bin and not s.contact_gripper_cube:
            return TeacherAction(ee_pos=s.tcp_pos, ee_quat_wxyz=DOWN, gripper=0)
        goal, g_at = (b + [0.0, 0.0, 0.12], 0) if s.contact_gripper_cube else (s.cube_pos, 1)
        d = goal - s.tcp_pos
        dist = float(np.linalg.norm(d))
        if dist < 0.005:
            return TeacherAction(ee_pos=goal, ee_quat_wxyz=DOWN, gripper=g_at)
        step = d if dist <= 0.02 else d / dist * 0.02
        return TeacherAction(ee_pos=s.tcp_pos + step, ee_quat_wxyz=DOWN, gripper=int(s.contact_gripper_cube))


class StubStudent:
    """A camera policy that goes the wrong way: always to a fixed point, gripper open."""

    def __init__(self, target=(0.40, -0.15, 0.20), raise_at=None):
        self.target, self.raise_at, self.calls, self.resets = np.asarray(target), raise_at, [], 0

    def reset(self):
        self.resets += 1

    def act(self, state, images):
        if self.raise_at is not None and len(self.calls) == self.raise_at:
            raise RuntimeError("server went away")
        self.calls.append((np.array(state), sorted(images)))
        return np.r_[self.target, [0.0] * 4, [OPEN_F, OPEN_F]]


@pytest.fixture
def scene():
    return sample_scene(np.random.default_rng(4000), "franka", 4000)


# --- the teacher interface -------------------------------------------------------------------------------------------

def test_check_action_validates_and_normalises():
    a = check_action(TeacherAction(ee_pos=np.zeros(3), ee_quat_wxyz=np.array([0.0, 1.05, 0, 0]), gripper=1))
    assert np.allclose(a.ee_quat_wxyz, DOWN) and a.gripper == 1
    assert check_action(None) is None
    for bad in (TeacherAction(np.zeros(2), DOWN, 0), TeacherAction(np.zeros(3), DOWN * 2, 0),
                TeacherAction(np.array([np.nan, 0, 0]), DOWN, 0), TeacherAction(np.zeros(3), DOWN, 2)):
        with pytest.raises(ValueError):
            check_action(bad)


def test_action_array_round_trip():
    a = TeacherAction(ee_pos=np.array([0.1, 0.2, 0.3]), ee_quat_wxyz=DOWN, gripper=1)
    assert a.as_array().tolist() == [0.1, 0.2, 0.3, 0.0, 1.0, 0.0, 0.0, 1.0]
    b = TeacherAction.from_array(a.as_array())
    assert np.allclose(b.ee_pos, a.ee_pos) and b.gripper == 1


def make_stub(**kw):
    return StubTeacher(**kw)


def not_a_teacher():
    return object()


def test_load_teacher_imports_a_factory_and_checks_the_protocol():
    t = load_teacher(f"{__name__}:make_stub", none_at=[3])
    assert t.name == "stub" and t.none_at == {3}
    with pytest.raises(TypeError):
        load_teacher(f"{__name__}:not_a_teacher")
    with pytest.raises(ValueError):
        load_teacher("no_colon_here")


def test_there_is_no_hand_written_teacher():
    """The user rules a scripted expert out as a teacher: nothing in the distill code may fall back to one."""
    root = Path(__file__).resolve().parents[1]
    for f in ("teacher.py", "distill.py", "distill_round.py", "scripts/distill_rollouts.py",
              "scripts/distill_round.py"):
        text = (root / f).read_text(encoding="utf-8")
        assert "scripted_expert" not in text and "recovery_trajectory" not in text, f


# --- rollouts ----------------------------------------------------------------------------------------------------------

def test_teacher_rollout_labels_what_it_executes_and_stops_at_success(scene):
    env, teacher = ToyEnv(), StubTeacher()
    r = rollout(env, scene, teacher, RolloutConfig(driver="teacher"))
    assert r.success and r.ended_by == "success"
    n = len(r.records)
    assert n % 25 == 0 and n < 1500  # stopped at the first passing check
    assert np.allclose(r.label, r.executed) and r.by_teacher.all()
    assert r.joint_pos.shape == (n, 9) and r.teacher_ee.shape == (n, 8)
    assert len(r.images["front"]) == n and r.images["front"][0].shape == (8, 8, 3)
    assert teacher.seen == list(range(n))  # asked once per step, before the step


def test_student_rollout_relabels_the_visited_states_without_replacing_the_trajectory(scene):
    env, teacher, student = ToyEnv(), StubTeacher(), StubStudent()
    r = rollout(env, scene, teacher, RolloutConfig(driver="student", max_seconds=2.0), student=student)
    assert not r.success and r.ended_by == "time_limit" and len(r.records) == 100
    assert student.resets == 1 and len(student.calls) == 100
    assert np.allclose(r.executed[:, :3], student.target)  # the student drove
    assert not r.by_teacher.any()
    # each label is the teacher's command at the state the student actually visited
    assert np.allclose(r.label[:, :3], r.teacher_ee[:, :3])
    assert np.allclose(r.tcp_pos[5], student.target)  # at step 5 the student had already moved the hand
    assert np.linalg.norm(r.teacher_ee[5, :3] - student.target) <= 0.02 + 1e-9  # one teacher step from there
    assert not np.allclose(r.label[:, :3], r.executed[:, :3])


def test_teacher_commands_run_through_the_teachers_own_tracking(scene):
    """Every step the teacher executes goes through env.step_teacher (its RL env's IK scheme); every step the
    student executes goes through env.step (its held 9-joint target)."""
    env = ToyEnv()
    r = rollout(env, scene, StubTeacher(), RolloutConfig(driver="teacher"))
    assert env.teacher_steps == list(range(len(r.records))) and env.student_steps == []
    env = ToyEnv()
    r = rollout(env, scene, StubTeacher(), RolloutConfig(driver="student", beta=0.5, max_seconds=2.0, rng_seed=3),
                student=StubStudent())
    assert env.teacher_steps == np.flatnonzero(r.by_teacher).tolist()
    assert env.student_steps == np.flatnonzero(~r.by_teacher).tolist()


def test_beta_mixes_in_the_teacher_deterministically(scene):
    cfg = RolloutConfig(driver="student", beta=0.5, max_seconds=2.0, rng_seed=7)
    a = rollout(ToyEnv(), scene, StubTeacher(), cfg, student=StubStudent())
    b = rollout(ToyEnv(), scene, StubTeacher(), cfg, student=StubStudent())
    assert (a.by_teacher == b.by_teacher).all()
    assert 0.3 < a.by_teacher.mean() < 0.7
    assert np.allclose(a.executed[a.by_teacher], a.label[a.by_teacher])
    full = rollout(ToyEnv(), scene, StubTeacher(), RolloutConfig(driver="student", beta=1.0), student=StubStudent())
    assert full.by_teacher.all() and full.success


def test_unlabelled_steps_split_the_episode(scene):
    teacher = StubTeacher(none_at=set(range(30, 40)) | {70})
    r = rollout(ToyEnv(), scene, teacher, RolloutConfig(driver="student", max_seconds=2.0), student=StubStudent())
    assert np.isnan(r.label[30:40]).all() and np.isnan(r.teacher_ee[70]).all()
    assert label_segments(r, min_len=25) == [(0, 30), (40, 70), (71, 100)]
    assert label_segments(r, min_len=30) == [(0, 30), (40, 70)]  # (71, 100) is 29 steps


def test_label_segments_keeps_the_tail():
    class R:
        label = np.zeros((100, 9))
    R.label[30:40] = np.nan
    assert label_segments(R, min_len=25) == [(0, 30), (40, 100)]
    assert label_segments(R, min_len=31) == [(40, 100)]


def test_a_teacher_that_abstains_cannot_drive(scene):
    r = rollout(ToyEnv(), scene, StubTeacher(none_at={10}), RolloutConfig(driver="teacher"))
    assert not r.success and r.ended_by == "teacher_abstained" and len(r.records) == 10


def test_a_broken_teacher_raises_instead_of_writing_labels(scene):
    with pytest.raises(ValueError):
        rollout(ToyEnv(), scene, StubTeacher(bad_at=3), RolloutConfig(driver="teacher"))


def test_student_errors_end_the_rollout_and_keep_the_labels(scene):
    r = rollout(ToyEnv(), scene, StubTeacher(), RolloutConfig(driver="student"), student=StubStudent(raise_at=12))
    assert r.ended_by == "policy_error" and len(r.records) == 12 and "server went away" in r.error
    assert np.isfinite(r.label).all()


def test_config_is_checked():
    with pytest.raises(ValueError):
        RolloutConfig(driver="scripted")
    with pytest.raises(ValueError):
        RolloutConfig(driver="student", beta=1.5)
    with pytest.raises(ValueError):
        RolloutConfig(driver="teacher", beta=0.5)
    with pytest.raises(ValueError):
        rollout(ToyEnv(), sample_scene(np.random.default_rng(1), "franka", 1), StubTeacher(),
                RolloutConfig(driver="student"))  # a student rollout needs a student


def test_rollout_row_reports_disagreement(scene):
    r = rollout(ToyEnv(), scene, StubTeacher(), RolloutConfig(driver="student", max_seconds=1.0), student=StubStudent())
    row = rollout_row(r)
    assert row["seed"] == 4000 and row["driver"] == "student" and row["steps"] == 50 and row["labelled"] == 50
    assert row["success"] is False and row["ended_by"] == "time_limit"
    assert row["arm_disagreement"] > 0.01  # joints 0-2 are metres in the toy
    assert 0.0 <= row["gripper_disagreement"] <= 1.0
    t = rollout(ToyEnv(), scene, StubTeacher(), RolloutConfig(driver="teacher"))
    assert rollout_row(t)["arm_disagreement"] == 0.0


# --- episodes ----------------------------------------------------------------------------------------------------------

def test_teacher_episode_is_a_training_episode_with_provenance(scene, tmp_path):
    from lerobot_tools.assemble import build_manifest, Cell

    r = rollout(ToyEnv(), scene, StubTeacher(), RolloutConfig(driver="teacher"))
    rows = write_rollout(tmp_path, r, scene, kind="teacher", round_id=0, teacher_name="stub")
    assert len(rows) == 1 and rows[0]["name"] == "teacher_r0_4000"
    ep = Path(rows[0]["ep_dir"])
    meta, arrays, images = load_episode(ep)
    n = len(r.records)
    assert meta.n_steps == n and meta.cameras == ["front", "wrist"] and meta.fps == 50
    assert meta.passport.lineage == ["teacher-stub", "teacher_r0_4000"] and meta.passport.verification.success
    assert np.allclose(arrays["action"], r.label) and np.allclose(arrays["joint_pos"], r.joint_pos)
    assert np.allclose(arrays["ee_pos"], r.tcp_pos) and arrays["gripper"].tolist() == r.teacher_ee[:, 7].tolist()
    assert all(p.exists() for p in images["front"]) and len(images["wrist"]) == n
    prov = json.loads((ep / "distill.json").read_text(encoding="utf-8"))
    assert prov["kind"] == "teacher" and prov["round"] == 0 and prov["teacher"] == "stub"
    assert prov["segment"] == [0, n] and prov["rollout"]["success"] is True
    assert (ep / "scene.json").exists() and (ep / "teacher.npz").exists()
    m = build_manifest(Cell(condition="distill", n_human=1, episode_dirs=[_human(tmp_path), ep]))
    assert m["sources"]["teacher"] == {"episodes": 1, "frames": n}


def _human(tmp_path):
    from lerobot_tools.tests.test_assemble import make_episode

    return make_episode(tmp_path / "human", "h0", ["h0"])


def test_failed_teacher_rollouts_are_not_kept(scene, tmp_path):
    r = rollout(ToyEnv(), scene, StubTeacher(none_at={10}), RolloutConfig(driver="teacher"))
    assert write_rollout(tmp_path, r, scene, kind="teacher", round_id=0, teacher_name="stub") == []
    assert not (tmp_path / "episodes").exists() or not any((tmp_path / "episodes").iterdir())


def test_dagger_episodes_keep_every_labelled_segment(scene, tmp_path):
    teacher = StubTeacher(none_at=set(range(30, 40)))
    r = rollout(ToyEnv(), scene, teacher, RolloutConfig(driver="student", max_seconds=2.0), student=StubStudent())
    rows = write_rollout(tmp_path, r, scene, kind="dagger", round_id=1, teacher_name="stub",
                         student_checkpoint="C:/ckpt/030000/pretrained_model", min_len=25)
    assert [x["name"] for x in rows] == ["dagger_r1_4000_0", "dagger_r1_4000_1"]
    meta, arrays, _ = load_episode(Path(rows[1]["ep_dir"]))
    assert meta.n_steps == 60 and np.allclose(arrays["action"], r.label[40:100])
    assert meta.passport.lineage == ["dagger-r1-stub", "dagger_r1_4000_1"]
    prov = json.loads((Path(rows[1]["ep_dir"]) / "distill.json").read_text(encoding="utf-8"))
    assert prov["student_checkpoint"] == "C:/ckpt/030000/pretrained_model" and prov["segment"] == [40, 100]
    assert prov["rollout"]["success"] is False and prov["executed_by_teacher"] == 0.0
    with np.load(Path(rows[1]["ep_dir"]) / "teacher.npz") as z:
        assert np.allclose(z["executed"], r.executed[40:100]) and z["teacher_ee"].shape == (60, 8)


def test_dagger_needs_the_student_checkpoint(scene, tmp_path):
    r = rollout(ToyEnv(), scene, StubTeacher(), RolloutConfig(driver="student", max_seconds=1.0), student=StubStudent())
    with pytest.raises(ValueError):
        write_rollout(tmp_path, r, scene, kind="dagger", round_id=1, teacher_name="stub")
    with pytest.raises(ValueError):
        write_rollout(tmp_path, r, scene, kind="dagger", round_id=0, teacher_name="stub", student_checkpoint="x")


# --- the GPU script's pure helpers ------------------------------------------------------------------------------------

def test_rollout_scenes_follow_the_seed_rules():
    from sim_eval.distill import rollout_scenes
    from sim_eval.scenes import eval_scenes

    t = rollout_scenes("teacher", 4000, 2)
    assert [s.seed for s in t] == [4000, 4001]
    assert t[0] == sample_scene(np.random.default_rng(4000), "franka", 4000)
    d = rollout_scenes("dagger", 5200, 2)
    assert d == eval_scenes(2, 5200)
    with pytest.raises(ValueError):
        rollout_scenes("teacher", 4999, 2)  # 5000 is a test-side seed
    with pytest.raises(ValueError):
        rollout_scenes("dagger", 5020, 2)  # test seeds
    with pytest.raises(ValueError):
        rollout_scenes("dagger", 4000, 2)  # DAgger visits practice seeds


def test_resume_rows_and_done_summary(tmp_path):
    from sim_eval.distill import append_row, done_summary, read_rows

    log = tmp_path / "rollouts.jsonl"
    append_row(log, {"seed": 5200, "success": False, "episodes": ["dagger_r1_5200_0"], "frames": 60})
    append_row(log, {"seed": 5201, "success": True, "episodes": ["dagger_r1_5201_0", "dagger_r1_5201_1"],
                     "frames": 90})
    append_row(log, {"seed": 5200, "success": True, "episodes": ["dagger_r1_5200_0"], "frames": 70})  # a re-run
    rows = read_rows(log)
    assert sorted(rows) == [5200, 5201] and rows[5200]["frames"] == 70
    s = done_summary(rows, kind="dagger", round_id=1, seed0=5200, n=2, teacher="rl")
    assert s["attempted"] == 2 and s["successes"] == 2 and s["episodes"] == 3 and s["frames"] == 160
    assert s["seeds"] == [5200, 5201] and s["kind"] == "dagger" and s["round"] == 1
    with pytest.raises(ValueError):
        done_summary(rows, kind="dagger", round_id=1, seed0=5200, n=3, teacher="rl")  # 5202 missing
    assert read_rows(tmp_path / "none.jsonl") == {}


def test_stale_episodes_of_a_seed_are_moved_aside_not_deleted(tmp_path):
    from sim_eval.distill import set_aside_stale

    eps = tmp_path / "episodes"
    for name in ("dagger_r1_5200_0", "dagger_r1_5200_1", "dagger_r1_52001_0", "dagger_r2_5200_0"):
        (eps / name).mkdir(parents=True)
        (eps / name / "episode.json").write_text("{}", encoding="utf-8")
    moved = set_aside_stale(tmp_path, kind="dagger", round_id=1, seed=5200)
    assert sorted(p.name for p in moved) == ["dagger_r1_5200_0", "dagger_r1_5200_1"]
    assert all((p / "episode.json").exists() for p in moved) and all("_stale" in p.parts for p in moved)
    assert sorted(p.name for p in eps.iterdir()) == ["dagger_r1_52001_0", "dagger_r2_5200_0"]
    assert set_aside_stale(tmp_path, kind="dagger", round_id=1, seed=5200) == []
