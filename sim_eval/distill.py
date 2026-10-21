"""Teacher -> student distillation with DAgger: rollouts, relabelling and training episodes. Pure: no Isaac.

The teacher (sim_eval.teacher; T3's state-based RL policy) has privileged state; the student is our camera policy
(ACT, 9-joint targets). Two kinds of rollout, both in the eval env with the cameras on (sim_eval.isaac_distill_env):

- teacher (round 0): the teacher drives. Each step its absolute tool target is executed as the teacher's own RL env
  executes it (env.step_teacher: IK at every physics substep + velocity feed-forward, sim_eval.teacher_ik), and its
  label is the 9-joint target of one differential-IK step from the observed state (env.ik_label: the first substep's
  target, the action the student will hold for the step). Only rollouts that pass
  the unchanged check_success are kept, so round 0 also validates the teacher in the eval env (the research note's
  risk 2: an RL env that differs from ours).
- student (DAgger rounds): the student drives (with probability `beta` per step the teacher's command is executed
  instead; default 0). At every visited state the teacher is asked what it would do, and that is the label: relabel,
  not replace. The trajectory is the student's own, mistakes included; that is the point.

A step's row pairs the observation before the action (joints, images, the tool pose) with that step's label: what
the student will see and must answer at test time. (Replayed demos pair the state after step k with action k, one
20 ms step later; ACT predicts 100-step chunks, so both are kept as they are.)

Steps where the teacher returns None get no label; the labelled runs become separate episodes (label_segments),
because ACT's action chunks must not jump across a gap. Every episode carries its provenance (distill.json) and a
lineage root "teacher-<name>" or "dagger-r<round>-<name>" (lerobot_tools.assemble counts those apart from human
demos), and teacher.npz keeps the teacher's raw tool targets, the executed actions and who executed each step.
"""

from __future__ import annotations

import json
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal, Protocol

import numpy as np

from demo_pipeline.episode_io import EpisodeMeta, image_path, save_episode
from demo_pipeline.rules import TASK_TEXT
from demo_pipeline.schemas import Scene, VerificationResult
from sim_eval.eval_policy import (
    CHECK_EVERY, FPS, MAX_SECONDS, Observation, Policy, StepRecord, _check_action, _score, gripper_command,
)
from sim_eval.teacher import Teacher, TeacherAction, TeacherState, check_action
from sim_worker.homeset import passport
from sim_worker.jobs import episodes_dir

TEACHER_ROOT_PREFIX = "teacher-"  # lerobot_tools.assemble: teacher rollouts, not human demos
DAGGER_ROOT_PREFIX = "dagger-"  # lerobot_tools.assemble: student states relabelled by the teacher
MIN_SEGMENT = 25  # steps (0.5 s): a shorter labelled run is dropped
ARM = slice(0, 7)
Driver = Literal["teacher", "student"]
Kind = Literal["teacher", "dagger"]


class DistillEnv(Protocol):
    """sim_eval.eval_policy.EvalEnv plus the teacher's view and the IK that turns its action into the student's."""

    cameras: list[str]
    bin_inner: tuple[float, float, float]

    def reset(self, scene: Scene) -> None: ...
    def observe(self) -> Observation: ...
    def step(self, action: np.ndarray) -> StepRecord: ...  # the student's 9-joint target, held for the step
    def step_teacher(self, action: TeacherAction) -> StepRecord: ...  # as the teacher's own env executes it
    def teacher_state(self, scene: Scene, k: int, gripper: int) -> TeacherState: ...
    def ik_label(self, action: TeacherAction) -> np.ndarray: ...


@dataclass(frozen=True)
class RolloutConfig:
    driver: Driver
    beta: float = 0.0  # student driver only: per-step chance of executing the teacher's command instead
    max_seconds: float = MAX_SECONDS
    check_every: int = CHECK_EVERY
    rng_seed: int = 0  # for beta; combined with the scene seed

    def __post_init__(self):
        if self.driver not in ("teacher", "student"):
            raise ValueError(f"driver must be 'teacher' or 'student', got {self.driver!r}")
        if not 0.0 <= self.beta <= 1.0:
            raise ValueError(f"beta must be in [0, 1], got {self.beta}")
        if self.driver == "teacher" and self.beta != 0.0:
            raise ValueError("beta mixes the teacher into a student rollout; a teacher rollout has none")


@dataclass
class Rollout:
    seed: int
    driver: Driver
    beta: float
    joint_pos: np.ndarray  # (T, 9) observed before each action
    tcp_pos: np.ndarray  # (T, 3) observed before each action
    tcp_quat_wxyz: np.ndarray  # (T, 4)
    label: np.ndarray  # (T, 9) the teacher's command as a 9-joint target; NaN where it gave none
    teacher_ee: np.ndarray  # (T, 8) its raw tool target + gripper; NaN where none
    executed: np.ndarray  # (T, 9) what was sent to the sim
    by_teacher: np.ndarray  # (T,) bool: the executed action was the teacher's
    images: dict[str, list[np.ndarray]]
    records: list[StepRecord]
    ended_by: str  # success | time_limit | teacher_abstained | policy_error | sim_error
    reasons: list[str] = field(default_factory=list)
    verdict: VerificationResult | None = None
    error: str | None = None

    @property
    def success(self) -> bool:
        return self.ended_by == "success"


def _label(env: DistillEnv, a: TeacherAction) -> np.ndarray:
    q = np.asarray(env.ik_label(a), dtype=np.float64).reshape(-1)
    if q.shape != (9,) or not np.isfinite(q).all():
        raise ValueError(f"ik_label returned {q.tolist()}; expected 9 finite joint targets")
    return q


def rollout(env: DistillEnv, scene: Scene, teacher: Teacher, cfg: RolloutConfig, *,
            student: Policy | None = None) -> Rollout:
    """One episode, until check_success passes (checked every cfg.check_every steps) or time runs out. A student
    or sim failure ends it with a recorded outcome; a teacher failure raises (it must never write bad labels)."""
    if cfg.driver == "student" and student is None:
        raise ValueError("a student rollout needs the student policy")
    max_steps = int(round(cfg.max_seconds * FPS))
    rng = np.random.default_rng([cfg.rng_seed, scene.seed])
    rows: dict[str, list] = {k: [] for k in ("joint_pos", "tcp_pos", "tcp_quat_wxyz", "label", "teacher_ee",
                                             "executed", "by_teacher")}
    images: dict[str, list[np.ndarray]] = {c: [] for c in env.cameras}
    records: list[StepRecord] = []
    verdict: VerificationResult | None = None

    def done(ended_by: str, error: Exception | None = None) -> Rollout:
        n = len(records)
        widths = {"joint_pos": 9, "tcp_pos": 3, "tcp_quat_wxyz": 4, "label": 9, "teacher_ee": 8, "executed": 9}
        arr = {k: np.asarray(rows[k], dtype=np.float64).reshape(-1, w) for k, w in widths.items()}
        reasons = [] if ended_by == "success" else (list(verdict.reasons) if verdict is not None else [ended_by])
        return Rollout(seed=scene.seed, driver=cfg.driver, beta=cfg.beta, joint_pos=arr["joint_pos"],
                       tcp_pos=arr["tcp_pos"], tcp_quat_wxyz=arr["tcp_quat_wxyz"], label=arr["label"],
                       teacher_ee=arr["teacher_ee"], executed=arr["executed"],
                       by_teacher=np.asarray(rows["by_teacher"], dtype=bool), images={c: v[:n] for c, v in images.items()},
                       records=records, ended_by=ended_by, reasons=reasons, verdict=verdict,
                       error=f"{type(error).__name__}: {error}" if error else None)

    try:
        env.reset(scene)
    except Exception as e:  # noqa: BLE001
        return done("sim_error", e)
    teacher.reset(scene)
    if student is not None:
        try:
            student.reset()
        except Exception as e:  # noqa: BLE001
            return done("policy_error", e)
    gripper = 0
    for k in range(max_steps):
        try:
            obs = env.observe()
            state = env.teacher_state(scene, k, gripper)
        except Exception as e:  # noqa: BLE001
            return done("sim_error", e)
        t_act = check_action(teacher.act(state))  # raises on a malformed teacher output
        label = _label(env, t_act) if t_act is not None else None
        if cfg.driver == "teacher":
            if label is None:
                return done("teacher_abstained")
            action, by_teacher = label, True
        else:
            try:
                s_act = _check_action(student.act(obs.joint_pos, obs.images))
            except Exception as e:  # noqa: BLE001 - server down, malformed action
                return done("policy_error", e)
            use_teacher = label is not None and cfg.beta > 0 and rng.random() < cfg.beta
            action, by_teacher = (label, True) if use_teacher else (s_act, False)
        try:
            # The teacher's command runs through its own tracking (sim_eval.teacher_ik: IK at every substep plus the
            # velocity feed-forward, as in T3's env); the student's 9-joint target is held for the step.
            rec = env.step_teacher(t_act) if by_teacher else env.step(action)
        except Exception as e:  # noqa: BLE001
            return done("sim_error", e)
        rows["joint_pos"].append(np.asarray(obs.joint_pos, dtype=np.float64))
        rows["tcp_pos"].append(np.asarray(state.tcp_pos, dtype=np.float64))
        rows["tcp_quat_wxyz"].append(np.asarray(state.tcp_quat_wxyz, dtype=np.float64))
        rows["label"].append(label if label is not None else np.full(9, np.nan))
        rows["teacher_ee"].append(t_act.as_array() if t_act is not None else np.full(8, np.nan))
        rows["executed"].append(np.asarray(action, dtype=np.float64))
        rows["by_teacher"].append(by_teacher)
        for c in images:
            images[c].append(obs.images[c])
        records.append(rec)
        gripper = gripper_command(action)
        if (k + 1) % cfg.check_every == 0 or k + 1 == max_steps:
            if len(records) >= 2:
                verdict = _score(records, scene, env.bin_inner, FPS)
                if verdict.success:
                    return done("success")
    return done("time_limit")


def label_segments(r, min_len: int = MIN_SEGMENT) -> list[tuple[int, int]]:
    """[k0, k1) runs of consecutive labelled steps, at least min_len long."""
    ok = np.isfinite(np.asarray(r.label)).all(axis=1)
    edges = np.diff(np.concatenate([[0], ok.astype(np.int8), [0]]))
    runs = zip(np.flatnonzero(edges == 1).tolist(), np.flatnonzero(edges == -1).tolist())
    return [(a, b) for a, b in runs if b - a >= min_len]


def _disagreement(r: Rollout) -> tuple[float, float]:
    """(mean L2 over the arm joints, gripper mismatch rate) between what was executed and the teacher's label, over
    labelled steps. 0 for a teacher rollout; for a student one it is how far the student is from the teacher."""
    ok = np.isfinite(r.label).all(axis=1)
    if not ok.any():
        return 0.0, 0.0
    arm = float(np.linalg.norm(r.executed[ok, ARM] - r.label[ok, ARM], axis=1).mean())
    grip = float(np.mean([gripper_command(a) != gripper_command(b) for a, b in zip(r.executed[ok], r.label[ok])]))
    return round(arm, 6), round(grip, 6)


def rollout_row(r: Rollout) -> dict:
    arm, grip = _disagreement(r)
    return {"seed": r.seed, "driver": r.driver, "beta": r.beta, "success": r.success, "ended_by": r.ended_by,
            "reasons": list(r.reasons), "steps": len(r.records), "labelled": int(np.isfinite(r.label).all(axis=1).sum()),
            "by_teacher": float(r.by_teacher.mean()) if len(r.by_teacher) else 0.0, "arm_disagreement": arm,
            "gripper_disagreement": grip, "error": r.error}


def _save_png(path: Path, img: np.ndarray) -> None:
    from PIL import Image

    Image.fromarray(np.asarray(img, dtype=np.uint8)).save(path)


def write_rollout(root: Path, r: Rollout, scene: Scene, *, kind: Kind, round_id: int, teacher_name: str,
                  student_checkpoint: str | None = None, min_len: int = MIN_SEGMENT, robot: str = "franka",
                  save_image: Callable[[Path, np.ndarray], None] = _save_png) -> list[dict]:
    """Write the rollout's training episodes into <root>/episodes/ (episode_io format + scene.json, distill.json,
    teacher.npz). kind "teacher": round 0, only a successful rollout, one episode per labelled segment. kind "dagger":
    round >= 1, every labelled segment, whatever the outcome. Returns one row per episode written."""
    if kind == "teacher":
        if round_id != 0:
            raise ValueError("teacher rollouts are round 0")
        if r.driver != "teacher":
            raise ValueError("a teacher episode comes from a teacher-driven rollout")
        if not r.success:
            return []
        root_id = f"{TEACHER_ROOT_PREFIX}{teacher_name}"
    elif kind == "dagger":
        if round_id < 1:
            raise ValueError("DAgger rounds start at 1 (round 0 is the teacher's)")
        if not student_checkpoint:
            raise ValueError("a DAgger episode records the student checkpoint that visited its states")
        root_id = f"{DAGGER_ROOT_PREFIX}r{round_id}-{teacher_name}"
    else:
        raise ValueError(f"kind must be 'teacher' or 'dagger', got {kind!r}")
    if r.verdict is None:
        return []
    segs = label_segments(r, min_len)
    arm, grip = _disagreement(r)
    out = []
    for i, (k0, k1) in enumerate(segs):
        name = f"teacher_r0_{r.seed}" if kind == "teacher" and len(segs) == 1 else (
            f"{kind}_r{round_id}_{r.seed}_{i}")
        ep = episodes_dir(Path(root)) / name
        meta = EpisodeMeta(demo_id=name, robot=robot, task_text=TASK_TEXT, fps=FPS, n_steps=k1 - k0,
                           cameras=sorted(r.images), passport=passport(name, [root_id, name], r.verdict, robot=robot))
        save_episode(ep, meta, {
            "joint_pos": r.joint_pos[k0:k1].astype(np.float32),
            "action": r.label[k0:k1].astype(np.float32),
            "ee_pos": r.tcp_pos[k0:k1].astype(np.float32),
            "ee_quat": r.tcp_quat_wxyz[k0:k1].astype(np.float32),
            "gripper": r.teacher_ee[k0:k1, 7].astype(np.int8),
        })
        for cam, imgs in r.images.items():
            for j, img in enumerate(imgs[k0:k1]):
                save_image(image_path(ep, cam, j), img)
        np.savez_compressed(ep / "teacher.npz", teacher_ee=r.teacher_ee[k0:k1], executed=r.executed[k0:k1],
                            by_teacher=r.by_teacher[k0:k1])
        (ep / "scene.json").write_text(scene.model_dump_json(indent=1), encoding="utf-8")
        prov = {
            "kind": kind, "round": round_id, "teacher": teacher_name, "lineage_root": root_id,
            "student_checkpoint": student_checkpoint, "seed": r.seed, "segment": [k0, k1], "n_steps": k1 - k0,
            "beta": r.beta, "executed_by_teacher": float(r.by_teacher[k0:k1].mean()),
            "rollout": {"driver": r.driver, "success": r.success, "ended_by": r.ended_by, "reasons": list(r.reasons),
                        "steps": len(r.records), "arm_disagreement": arm, "gripper_disagreement": grip},
            "created": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }
        (ep / "distill.json").write_text(json.dumps(prov, indent=1), encoding="utf-8")
        out.append({"name": name, "ep_dir": str(ep), "seed": r.seed, "kind": kind, "round": round_id,
                    "n_steps": k1 - k0, "segment": [k0, k1]})
    return out


# --- the GPU script's pure helpers (sim_eval/scripts/distill_rollouts.py) --------------------------------------------

def rollout_scenes(kind: Kind, seed0: int, n: int) -> list[Scene]:
    """Teacher rollouts: training-side scenes (sample_scene, seeds < 5000). DAgger rollouts: the practice scenes
    (eval_scenes, seeds 5200-5279 only; never the test seeds)."""
    from demo_pipeline.multiply import sample_scene
    from sim_eval.overnight import PRACTICE_SEEDS
    from sim_eval.scenes import EVAL_SEED_MIN, eval_scenes

    seeds = range(seed0, seed0 + n)
    if n <= 0:
        raise ValueError(f"n must be positive, got {n}")
    if kind == "teacher":
        if seed0 < 0 or seeds.stop > EVAL_SEED_MIN:
            raise ValueError(f"teacher rollouts use training-side seeds < {EVAL_SEED_MIN}, not {seed0}-{seeds.stop - 1}")
        return [sample_scene(np.random.default_rng(s), "franka", s) for s in seeds]
    if kind == "dagger":
        if not set(seeds) <= set(PRACTICE_SEEDS):
            raise ValueError(f"DAgger rollouts use practice seeds {PRACTICE_SEEDS.start}-{PRACTICE_SEEDS.stop - 1} "
                             f"only, not {seed0}-{seeds.stop - 1}")
        return eval_scenes(n, seed0)
    raise ValueError(f"kind must be 'teacher' or 'dagger', got {kind!r}")


def append_row(path: Path, row: dict) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(row) + "\n")


def read_rows(path: Path) -> dict[int, dict]:
    """{seed: its last row} from a rollouts.jsonl (a re-run seed's later row wins); {} if there is none."""
    path = Path(path)
    if not path.exists():
        return {}
    rows = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            row = json.loads(line)
            rows[int(row["seed"])] = row
    return rows


def done_summary(rows: dict[int, dict], *, kind: Kind, round_id: int, seed0: int, n: int, teacher: str,
                 **extra) -> dict:
    """rollouts_done.json: written once every seed has a row; sim_eval.distill_round reads it."""
    seeds = list(range(seed0, seed0 + n))
    missing = [s for s in seeds if s not in rows]
    if missing:
        raise ValueError(f"seeds {missing} have no rollout row yet")
    got = [rows[s] for s in seeds]
    return {"kind": kind, "round": round_id, "seeds": [seed0, seed0 + n - 1], "attempted": n,
            "successes": sum(bool(r["success"]) for r in got), "episodes": sum(len(r["episodes"]) for r in got),
            "frames": sum(int(r["frames"]) for r in got), "teacher": teacher,
            "ended_by": dict(Counter(str(r.get("ended_by")) for r in got)),
            **extra}


def set_aside_stale(root: Path, *, kind: Kind, round_id: int, seed: int) -> list[Path]:
    """Before a seed is (re)run: move its episodes from an interrupted earlier attempt to <root>/_stale/<time>/, so a
    partial attempt is never mixed into the round (the project never deletes data). Returns the new paths."""
    eps = episodes_dir(Path(root))
    if not eps.is_dir():
        return []
    stem = f"{kind}_r{round_id}_{seed}"
    found = [p for p in eps.iterdir() if p.is_dir() and (p.name == stem or p.name.startswith(stem + "_"))]
    if not found:
        return []
    dest = Path(root) / "_stale" / datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    dest.mkdir(parents=True)
    return [p.rename(dest / p.name) for p in sorted(found)]
