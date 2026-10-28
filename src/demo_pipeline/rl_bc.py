"""Behaviour cloning data for the RL teacher's actor (BC-initialised RL, 2026-10-21): every step of the SANT-verified
training episodes the demo-start bank comes from, as (the env's policy observation, the env's action) pairs. Pure
numpy; it only reads the store.

The step convention is the replay's: at step k the replay commanded the episode's trajectory point k (its
trajectory.json: the executed path, gate holds included, one row per recorded step) and then recorded the reached
state k (steps.npz, signals.npz). So the observation before step k is the reached state k-1 (state 0 for k = 0),
and the action is the step from that state's tool pose to target k (rl_teacher.target_to_action, clipped to one
action; the gripper +-1, past any deadband).

The observation is rl_teacher.policy_observation's, rebuilt from the files:
- joints as recorded, their velocities by finite difference (zero on the first two steps: an episode starts at rest);
- the tool's reached pose (steps ee_pos / ee_quat) and the cube's position (signals cube_pos);
- the cube's orientation as the bank computes it: the scene's until the first close, turned with the hand while held,
  then the last held orientation (not recorded after the release; it matters little once the cube is let go);
- the bin from scene.json; the previous step's action (zeros at k = 0, as after the env's reset).
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from . import rl_teacher as rt
from .rl_demo_bank import _qconj, _qmul, training_episode_ids
from .store import DemoStore


def _wrap(a):
    return (np.asarray(a) + np.pi) % (2 * np.pi) - np.pi


def cube_quats(ee_quat: np.ndarray, gripper: np.ndarray, rest_quat_wxyz) -> np.ndarray:
    """The cube's orientation (wxyz) at every step (see the module docstring)."""
    grip = np.asarray(gripper).astype(int)
    n = len(grip)
    rest = np.asarray(rest_quat_wxyz, dtype=np.float64)
    closes = np.flatnonzero((grip[1:] == 1) & (grip[:-1] == 0)) + 1
    k_close = int(closes[0]) if closes.size else n
    opens = np.flatnonzero((grip[1:] == 0) & (grip[:-1] == 1)) + 1
    opens = opens[opens > k_close]
    k_open = int(opens[0]) if opens.size else n
    out = np.tile(rest, (n, 1))
    if k_close < n:
        hand0 = _qconj(ee_quat[k_close])
        for k in range(k_close, n):
            q = _qmul(_qmul(ee_quat[min(k, k_open - 1)], hand0), rest)
            out[k] = q / np.linalg.norm(q)
    return out


def episode_pairs(steps: dict, signals: dict, scene: dict, target_pos, target_quat_wxyz, target_gripper,
                  rest_quat_wxyz=None) -> tuple[np.ndarray, np.ndarray]:
    """One episode's (observations [n, OBS_DIM], actions [n, ACTION_DIM]) by the replay's step convention."""
    from types import SimpleNamespace as NS

    q = np.asarray(steps["joint_pos"], dtype=np.float64)
    ee_pos, ee_quat = np.asarray(steps["ee_pos"], dtype=np.float64), np.asarray(steps["ee_quat"], dtype=np.float64)
    cube = np.asarray(signals["cube_pos"], dtype=np.float64)
    tp, tq = np.asarray(target_pos, dtype=np.float64), np.asarray(target_quat_wxyz, dtype=np.float64)
    tg = np.asarray(target_gripper).astype(int)
    n = min(len(q), len(tp))
    rest = scene["cube_pose"]["quat_wxyz"] if rest_quat_wxyz is None else rest_quat_wxyz
    cq = cube_quats(ee_quat, steps["gripper"], rest)
    vel = np.zeros_like(q)
    vel[1:] = np.diff(q, axis=0) / rt.STEP_S
    bin_pos, bin_q = scene["bin_pose"]["pos"], scene["bin_pose"]["quat_wxyz"]
    obs, act = np.zeros((n, rt.OBS_DIM)), np.zeros((n, rt.ACTION_DIM))
    prev = np.zeros(rt.ACTION_DIM)
    for k in range(n):
        s = max(k - 1, 0)  # the state the action at step k is taken from
        state = NS(joint_pos=q[s], joint_vel=vel[s] if k >= 2 else np.zeros(q.shape[1]), tcp_pos=ee_pos[s],
                   tcp_quat_wxyz=ee_quat[s], cube_pos=cube[s], cube_quat_wxyz=cq[s], bin_pos=bin_pos,
                   bin_quat_wxyz=bin_q)
        obs[k] = rt.policy_observation(state, prev)
        yaw_now = float(rt.tool_yaw(ee_quat[s]))
        yaw_target = yaw_now + float(_wrap(rt.tool_yaw(tq[k]) - yaw_now))
        act[k] = rt.target_to_action(tp[k], yaw_target, tg[k] == 1, ee_pos[s], yaw_now)
        prev = act[k]
    return obs, act


def build_dataset(store: DemoStore, ids: list[str] | None = None) -> tuple[dict, dict]:
    """Every training episode's pairs: arrays obs [N, OBS_DIM], act [N, ACTION_DIM], episode [N], step [N]; and meta
    (the store, the episode ids, counts). ids: the episodes (default: the bank's, rl_demo_bank.training_episode_ids)."""
    from .schemas import Trajectory

    ids = training_episode_ids(store) if ids is None else ids
    parts = []
    for i, id in enumerate(ids):
        ep = store.episode_dir(id)
        traj = Trajectory.model_validate(json.loads((ep / "trajectory.json").read_text(encoding="utf-8"))).to_arrays()
        scene = json.loads((ep / "scene.json").read_text(encoding="utf-8"))
        with np.load(ep / "steps.npz") as s, np.load(ep / "signals.npz") as g:
            obs, act = episode_pairs(dict(s), dict(g), scene, traj["ee_pos"], traj["ee_quat"], traj["gripper"])
        parts.append({"obs": obs, "act": act, "episode": np.full(len(obs), i, dtype=np.int32),
                      "step": np.arange(len(obs), dtype=np.int32)})
    if not parts:
        raise ValueError(f"no training episodes in {store.root}")
    data = {k: np.concatenate([p[k] for p in parts]) for k in ("obs", "act", "episode", "step")}
    meta = {"store": str(store.root), "episodes": list(ids), "pairs": int(len(data["obs"])),
            "clipped_share": float(np.mean(np.abs(data["act"][:, :4]) >= 1.0 - 1e-9))}
    return data, meta


def save_dataset(path: Path, data: dict, meta: dict) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(path, **data)
    path.with_suffix(".json").write_text(json.dumps(meta, indent=1), encoding="utf-8")
