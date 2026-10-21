"""The trained RL teacher behind T6's teacher interface (pm/distill-dagger, sim_eval/teacher.py), for distillation:

    --teacher sim_worker.rl_policy:make --teacher-checkpoint data\\rl\\logs\\rsl_rl\\sant_rl_teacher\\<run>\\exported\\policy.pt

make(checkpoint=, device=) returns an object with .name, reset(scene) and act(state) -> TeacherAction (an absolute
tool target, wxyz, and a gripper 0/1), as sim_eval.teacher.Teacher requires. T6 imports it after the Isaac app has
started; it needs torch only to load the policy.

- **The policy** is rsl_rl's TorchScript export of the trained actor (the observation normaliser included; the
  deterministic action). Isaac Lab's play script and scripts/rl_eval_teacher.py both write it to
  <run>/exported/policy.pt; a run directory resolves to that file. A raw training checkpoint (model_<i>.pt) needs
  the env to rebuild its runner, so it is refused with that advice.
- **The observation** is the training env's (rl_teacher.OBS_SPEC, pinned by tests/test_rl_env.py), rebuilt from the
  TeacherState: joints and velocities, the tool's pose, the cube's pose, the bin, the cube relative to the tool and
  the bin, and the teacher's own previous action (zeros after reset, as the env's last_action).
- **The action** is the training env's mapping (rl_teacher.action_to_target) with the soft floor
  (rl_teacher.clamp_to_soft_floor), exactly as the env's action term applies them; clipped to [-1, 1] as the
  trainer clips. Its gripper is 1 for a command < 0, as the env's binary gripper.
No scripted or recovery logic anywhere: everything the teacher does comes from the trained policy.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import numpy as np

from demo_pipeline import rl_teacher as rt

EXPORTED = Path("exported") / "policy.pt"


@dataclass(frozen=True)
class _Action:
    """sim_eval.teacher.TeacherAction's fields, when T6's module isn't importable (before the merge)."""

    ee_pos: np.ndarray
    ee_quat_wxyz: np.ndarray
    gripper: int

    def as_array(self) -> np.ndarray:
        return np.concatenate([self.ee_pos, self.ee_quat_wxyz, [float(self.gripper)]]).astype(np.float64)


def _action_type():
    try:
        from sim_eval.teacher import TeacherAction  # T6's (pm/distill-dagger)

        return TeacherAction
    except ImportError:
        return _Action


class RLTeacher:
    """sim_eval.teacher.Teacher around a policy: a function from the observation (rl_teacher.OBS_DIM floats) to the
    action (rl_teacher.ACTION_DIM floats)."""

    def __init__(self, policy: Callable[[np.ndarray], np.ndarray], name: str):
        self.policy = policy
        self.name = name
        self._last = np.zeros(rt.ACTION_DIM)
        self._action = _action_type()

    def reset(self, scene) -> None:
        self._last = np.zeros(rt.ACTION_DIM)

    def act(self, state):
        obs = rt.policy_observation(state, self._last)
        a = np.clip(np.asarray(self.policy(obs), dtype=np.float64).reshape(rt.ACTION_DIM), -1.0, 1.0)
        self._last = a
        pos, quat, closed = rt.action_to_target(a[None])
        bin_pos = np.asarray(state.bin_pos, dtype=np.float64)[None]
        pos = rt.clamp_to_soft_floor(pos, bin_pos, np.array([rt.yaw_of_wxyz(state.bin_quat_wxyz)]))
        return self._action(ee_pos=pos[0].astype(np.float64), ee_quat_wxyz=quat[0].astype(np.float64),
                            gripper=int(bool(closed[0])))


def resolve_checkpoint(checkpoint) -> Path:
    """The exported policy file: the path itself, or <run dir>/exported/policy.pt."""
    path = Path(checkpoint)
    if path.is_dir():
        path = path / EXPORTED
    if not path.is_file():
        raise FileNotFoundError(f"no teacher policy at {path}: export it with scripts/rl_eval_teacher.py (or Isaac "
                                f"Lab's play script), which write <run>/exported/policy.pt")
    return path


def make(checkpoint, device: str = "cuda:0", **_) -> RLTeacher:
    """The trained RL teacher (see the module docstring)."""
    import torch

    path = resolve_checkpoint(checkpoint)
    try:
        model = torch.jit.load(str(path), map_location=device)
    except RuntimeError as e:
        raise ValueError(f"{path} is not a TorchScript policy (a raw model_<i>.pt checkpoint?): export it with "
                         f"scripts/rl_eval_teacher.py, which writes <run>/exported/policy.pt ({e})") from e
    model.eval()

    def policy(obs: np.ndarray) -> np.ndarray:
        with torch.inference_mode():
            x = torch.as_tensor(obs, dtype=torch.float32, device=device)[None]
            return model(x)[0].float().cpu().numpy()

    run = path.parent.parent.name if path.parent.name == "exported" else path.stem
    return RLTeacher(policy, name=f"rl-{run}")
