"""Teacher -> student distillation with DAgger: rollouts, relabelling and training episodes. Pure: no Isaac.

The teacher (sim_eval.teacher; T3's state-based RL policy) has privileged state; the student is our camera policy
(ACT, 9-joint targets). Two kinds of rollout, both in the eval env with the cameras on (sim_eval.isaac_distill_env):

- teacher (round 0): the teacher drives. Each step its absolute tool target is executed as the teacher's own RL env
  executes it (env.step_teacher: IK at every physics substep + velocity feed-forward, sim_eval.teacher_ik). The label
  is the arm target of the LAST substep's IK solve + the finger targets, which step_teacher returns: the same
  convention as replay.py's recorded `action` (its _physics_step returns the last substep's target), so the teacher's
  episodes and the human/SANT episodes they are mixed with give one meaning to `action` (the lead's decision,
  2026-10-21). Only rollouts that pass the unchanged check_success are kept, so round 0 also validates the teacher in
  the eval env (the research note's risk 2: an RL env that differs from ours).
- student (DAgger rounds): the student drives (with probability `beta` per step the teacher's command is executed
  instead, labelled as above; default 0). At every visited state the teacher is asked what it would do, and the label
  is one differential-IK step from the observed state toward its target (env.ik_label: what the first substep would
  command): relabel, not replace. No teacher step is executed there, so the last-substep target does not exist; this
  is the known approximation of DAgger labels (one 10 ms substep earlier than the replay convention). The trajectory is
  the student's own, mistakes included; that is the point.
Both targets are kept for every teacher-labelled step (teacher.npz: label_first, label_last) to measure the
difference.

Episode rows (write_rollout's pairing): teacher episodes follow replay.py exactly, row k = the observation after step
k (joints, tool pose, both images) + step k's last-substep target, so they mean what the human/SANT rows they are
mixed with mean. DAgger rows pair the observation before step k with its one-step label (computed from that
observation). Replay's convention labels s(k+1) with the target that produced it, a one-step shift against what the
student does at test time (observe s(k), then act); whether that matters is a post-hackathon experiment, not a change
today.

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
Pairing = Literal["before", "after"]  # which observation an episode row pairs with step k's label (write_rollout)
TeacherExecution = Literal["tracking", "held"]  # how a teacher-executed step runs (RolloutConfig)


class DistillEnv(Protocol):
    """sim_eval.eval_policy.EvalEnv plus the teacher's view and the IK that turns its action into the student's."""

    cameras: list[str]
    bin_inner: tuple[float, float, float]

    def reset(self, scene: Scene) -> None: ...
    def observe(self) -> Observation: ...
    def step(self, action: np.ndarray) -> StepRecord: ...  # the student's 9-joint target, held for the step
    # As the teacher's own env executes it; returns the record and the 9-joint target of the last substep's IK solve
    # (+ fingers), replay's `action` convention.
    def step_teacher(self, action: TeacherAction) -> tuple[StepRecord, np.ndarray]: ...
    def teacher_state(self, scene: Scene, k: int, gripper: int) -> TeacherState: ...
    def ik_label(self, action: TeacherAction) -> np.ndarray: ...  # one DLS step from the observed state


@dataclass(frozen=True)
class RolloutConfig:
    driver: Driver
    beta: float = 0.0  # student driver only: per-step chance of executing the teacher's command instead
    max_seconds: float = MAX_SECONDS
    check_every: int = CHECK_EVERY
    rng_seed: int = 0  # for beta; combined with the scene seed
    # How a teacher-executed step runs. "tracking": the teacher's own RL-env tracking (IK at both substeps +
    # velocity feed-forward; label = the last substep's target). "held" (option A, 2026-10-21): one held 9-joint
    # target from ik_label through env.step, exactly the eval's student execution; label = that executed target.
    # Round 0 @300 showed the student cannot reproduce "tracking" data at 0.5 m/s (lag 0.10 vs 0.01 rad).
    teacher_execution: TeacherExecution = "tracking"

    def __post_init__(self):
        if self.driver not in ("teacher", "student"):
            raise ValueError(f"driver must be 'teacher' or 'student', got {self.driver!r}")
        if not 0.0 <= self.beta <= 1.0:
            raise ValueError(f"beta must be in [0, 1], got {self.beta}")
        if self.driver == "teacher" and self.beta != 0.0:
            raise ValueError("beta mixes the teacher into a student rollout; a teacher rollout has none")
        if self.teacher_execution not in ("tracking", "held"):
            raise ValueError(f"teacher_execution must be 'tracking' or 'held', got {self.teacher_execution!r}")


@dataclass
class Rollout:
    seed: int
    driver: Driver
    beta: float
    joint_pos: np.ndarray  # (T, 9) observed before each action
    tcp_pos: np.ndarray  # (T, 3) observed before each action
    tcp_quat_wxyz: np.ndarray  # (T, 4)
    label: np.ndarray  # (T, 9) the training label: label_last where the teacher executed, else label_first
    label_first: np.ndarray  # (T, 9) one DLS step from the observed state (ik_label); NaN where the teacher gave none
    label_last: np.ndarray  # (T, 9) the last substep's target of an executed teacher step; NaN elsewhere
    teacher_ee: np.ndarray  # (T, 8) its raw tool target + gripper; NaN where none
    executed: np.ndarray  # (T, 9) what was sent to the sim
    by_teacher: np.ndarray  # (T,) bool: the executed action was the teacher's
    images: dict[str, list[np.ndarray]]
    records: list[StepRecord]
    ended_by: str  # success | time_limit | teacher_abstained | policy_error | sim_error
    reasons: list[str] = field(default_factory=list)
    verdict: VerificationResult | None = None
    error: str | None = None
    teacher_execution: TeacherExecution = "tracking"

    @property
    def success(self) -> bool:
        return self.ended_by == "success"


def _joints(q, what: str) -> np.ndarray:
    q = np.asarray(q, dtype=np.float64).reshape(-1)
    if q.shape != (9,) or not np.isfinite(q).all():
        raise ValueError(f"{what} returned {q.tolist()}; expected 9 finite joint targets")
    return q


def rollout(env: DistillEnv, scene: Scene, teacher: Teacher, cfg: RolloutConfig, *,
            student: Policy | None = None) -> Rollout:
    """One episode, until check_success passes (checked every cfg.check_every steps) or time runs out. A student
    or sim failure ends it with a recorded outcome; a teacher failure raises (it must never write bad labels)."""
    if cfg.driver == "student" and student is None:
        raise ValueError("a student rollout needs the student policy")
    max_steps = int(round(cfg.max_seconds * FPS))
    rng = np.random.default_rng([cfg.rng_seed, scene.seed])
    rows: dict[str, list] = {k: [] for k in ("joint_pos", "tcp_pos", "tcp_quat_wxyz", "label", "label_first",
                                             "label_last", "teacher_ee", "executed", "by_teacher")}
    images: dict[str, list[np.ndarray]] = {c: [] for c in env.cameras}
    records: list[StepRecord] = []
    verdict: VerificationResult | None = None

    def done(ended_by: str, error: Exception | None = None) -> Rollout:
        n = len(records)
        widths = {"joint_pos": 9, "tcp_pos": 3, "tcp_quat_wxyz": 4, "label": 9, "label_first": 9, "label_last": 9,
                  "teacher_ee": 8, "executed": 9}
        arr = {k: np.asarray(rows[k], dtype=np.float64).reshape(-1, w) for k, w in widths.items()}
        reasons = [] if ended_by == "success" else (list(verdict.reasons) if verdict is not None else [ended_by])
        return Rollout(seed=scene.seed, driver=cfg.driver, beta=cfg.beta, joint_pos=arr["joint_pos"],
                       tcp_pos=arr["tcp_pos"], tcp_quat_wxyz=arr["tcp_quat_wxyz"], label=arr["label"],
                       label_first=arr["label_first"], label_last=arr["label_last"],
                       teacher_ee=arr["teacher_ee"], executed=arr["executed"],
                       by_teacher=np.asarray(rows["by_teacher"], dtype=bool), images={c: v[:n] for c, v in images.items()},
                       records=records, ended_by=ended_by, reasons=reasons, verdict=verdict,
                       error=f"{type(error).__name__}: {error}" if error else None,
                       teacher_execution=cfg.teacher_execution)

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
        first = _joints(env.ik_label(t_act), "ik_label") if t_act is not None else None
        if cfg.driver == "teacher":
            if first is None:
                return done("teacher_abstained")
            by_teacher = True
        else:
            try:
                s_act = _check_action(student.act(obs.joint_pos, obs.images))
            except Exception as e:  # noqa: BLE001 - server down, malformed action
                return done("policy_error", e)
            by_teacher = first is not None and cfg.beta > 0 and rng.random() < cfg.beta
        last = None
        try:
            # "tracking": the teacher's command runs through its own tracking (sim_eval.teacher_ik: IK at every
            # substep plus the velocity feed-forward, as in T3's env). "held": it becomes the one-DLS-step 9-joint
            # target, held for the step by env.step, as the student's always is.
            if by_teacher and cfg.teacher_execution == "tracking":
                rec, last = env.step_teacher(t_act)
            else:
                rec = env.step(first if by_teacher else s_act)
        except Exception as e:  # noqa: BLE001
            return done("sim_error", e)
        if last is not None:
            last = _joints(last, "step_teacher")
        action = (last if last is not None else first) if by_teacher else s_act
        label = last if last is not None else first
        nan9 = np.full(9, np.nan)
        rows["joint_pos"].append(np.asarray(obs.joint_pos, dtype=np.float64))
        rows["tcp_pos"].append(np.asarray(state.tcp_pos, dtype=np.float64))
        rows["tcp_quat_wxyz"].append(np.asarray(state.tcp_quat_wxyz, dtype=np.float64))
        rows["label"].append(label if label is not None else nan9)
        rows["label_first"].append(first if first is not None else nan9)
        rows["label_last"].append(last if last is not None else nan9)
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
            "gripper_disagreement": grip, "error": r.error, "teacher_execution": r.teacher_execution}


def _save_png(path: Path, img: np.ndarray) -> None:
    from PIL import Image

    Image.fromarray(np.asarray(img, dtype=np.uint8)).save(path)


def _rows(seg: tuple[int, int], n_steps: int, pairing: Pairing) -> tuple[np.ndarray, np.ndarray]:
    """(observation indices, label indices) of one segment's episode rows. "before": step k's observation (taken
    before its action) with step k's label. "after": replay's convention, the observation after step k (= the one
    taken before step k + 1) with step k's label; a segment's last step has no later observation in the rollout if it
    ends the rollout, so it is dropped."""
    k0, k1 = seg
    if pairing == "before":
        lab = np.arange(k0, k1)
        return lab, lab
    lab = np.arange(k0, min(k1, n_steps - 1))
    return lab + 1, lab


def _label_kind(kind: Kind, execution: TeacherExecution) -> str:
    if execution == "held":
        return "held target (one DLS step, as executed)"
    return "last substep" if kind == "teacher" else "first substep (one DLS step)"


def write_rollout(root: Path, r: Rollout, scene: Scene, *, kind: Kind, round_id: int, teacher_name: str,
                  student_checkpoint: str | None = None, min_len: int = MIN_SEGMENT, robot: str = "franka",
                  pairing: Pairing | None = None,
                  save_image: Callable[[Path, np.ndarray], None] = _save_png) -> list[dict]:
    """Write the rollout's training episodes into <root>/episodes/ (episode_io format + scene.json, distill.json,
    teacher.npz). kind "teacher": round 0, only a successful rollout, one episode per labelled segment. kind "dagger":
    round >= 1, every labelled segment, whatever the outcome. Returns one row per episode written.

    pairing (default by kind, the lead's decision 2026-10-21): teacher episodes "after", exactly replay.py's
    convention for every human/SANT episode (replay steps first, then reads joints, tool pose and both cameras: row k
    = the state after step k + the last substep's target of step k), so round 0's mix gives `action` one meaning.
    DAgger episodes "before": the label is one DLS step computed from the observation before the step, the documented
    approximation (no teacher step is executed there)."""
    pairing = pairing or ("after" if kind == "teacher" else "before")
    if pairing not in ("before", "after"):
        raise ValueError(f"pairing must be 'before' or 'after', got {pairing!r}")
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
        obs, lab = _rows((k0, k1), len(r.records), pairing)
        if len(lab) == 0:
            continue
        name = f"teacher_r0_{r.seed}" if kind == "teacher" and len(segs) == 1 else (
            f"{kind}_r{round_id}_{r.seed}_{i}")
        ep = episodes_dir(Path(root)) / name
        meta = EpisodeMeta(demo_id=name, robot=robot, task_text=TASK_TEXT, fps=FPS, n_steps=len(lab),
                           cameras=sorted(r.images), passport=passport(name, [root_id, name], r.verdict, robot=robot))
        save_episode(ep, meta, {
            "joint_pos": r.joint_pos[obs].astype(np.float32),
            "action": r.label[lab].astype(np.float32),
            "ee_pos": r.tcp_pos[obs].astype(np.float32),
            "ee_quat": r.tcp_quat_wxyz[obs].astype(np.float32),
            "gripper": r.teacher_ee[lab, 7].astype(np.int8),
        })
        for cam, imgs in r.images.items():
            for j, k in enumerate(obs):
                save_image(image_path(ep, cam, j), imgs[k])
        np.savez_compressed(ep / "teacher.npz", teacher_ee=r.teacher_ee[lab], executed=r.executed[lab],
                            by_teacher=r.by_teacher[lab], label_first=r.label_first[lab], label_last=r.label_last[lab],
                            obs_step=obs, label_step=lab)
        (ep / "scene.json").write_text(scene.model_dump_json(indent=1), encoding="utf-8")
        prov = {
            "kind": kind, "round": round_id, "teacher": teacher_name, "lineage_root": root_id,
            "student_checkpoint": student_checkpoint, "seed": r.seed, "segment": [k0, k1], "n_steps": len(lab),
            "pairing": pairing, "teacher_execution": r.teacher_execution,
            "label": _label_kind(kind, r.teacher_execution),
            "beta": r.beta, "executed_by_teacher": float(r.by_teacher[lab].mean()),
            "rollout": {"driver": r.driver, "success": r.success, "ended_by": r.ended_by, "reasons": list(r.reasons),
                        "steps": len(r.records), "arm_disagreement": arm, "gripper_disagreement": grip},
            "created": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }
        (ep / "distill.json").write_text(json.dumps(prov, indent=1), encoding="utf-8")
        out.append({"name": name, "ep_dir": str(ep), "seed": r.seed, "kind": kind, "round": round_id,
                    "n_steps": len(lab), "segment": [k0, k1]})
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


def check_execution(rows: dict[int, dict], execution: TeacherExecution) -> None:
    """A round folder holds one teacher execution: refuse to resume rows made with another (rows from before the
    option are "tracking")."""
    other = sorted({r.get("teacher_execution", "tracking") for r in rows.values()} - {execution})
    if other:
        raise ValueError(f"this folder's rollouts were made with teacher execution {other}, not {execution!r}: "
                         f"use another run id")


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
