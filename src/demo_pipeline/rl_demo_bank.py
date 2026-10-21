"""Demo starts for the RL teacher (DemoStart-style): states along SANT-verified episodes that an RL episode can be
reset into, and the curriculum that picks them. Pure numpy; it only reads the store.

The bank holds, every `stride` steps of each verified training episode (by default what the multiplied cell trains
on: the verified home-aligned repaired demos "<id>_rules_home" and the verified variants), the state an Isaac env
needs to restore: the 9 joint positions (arm and fingers), the cube's position and orientation, the bin's pose, the
gripper command, and how far into its episode the state is (progress, 0 to 1).

Only states that can be restored faithfully with zero velocities (SANT's episodes record no velocities; as
sim_worker.recovery restores its states):
- free: before the first close, the fingers off the cube, and the cube where the scene put it (within 2 mm). The
  cube's orientation is the scene's, exactly;
- held: from the first close to the release, the gripper closed with the fingers on the cube. The cube's orientation
  is the scene's turned with the hand since the close (a rigid grasp; the hand's reached orientation is recorded).
Steps where the gripper is closing on nothing yet, and everything after the release (the cube settling with an
unrecorded orientation), are left out.

The curriculum (DemoStart's reverse curriculum, simplified): early in training, demo starts come from late in the
episodes (progress >= min_progress, near the end of the task); min_progress falls linearly to 0, so starts move
back toward the beginning. A share of resets (the env's demo_start_prob) still starts from home in a random scene,
and with demo starts off (prob 0) the teacher learns from home alone: the "RL without demos" control arm.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from .store import DemoStore

STRIDE = 5  # steps between saved states (0.1 s at 50 Hz)
CUBE_MOVED_M = 0.002
FIELDS = ("joint_pos", "cube_pos", "cube_quat_wxyz", "bin_pos", "bin_quat_wxyz", "closed", "phase", "progress",
          "episode", "step", "tcp_speed")
FREE, HELD = 0, 1


def _qmul(a, b):
    aw, ax, ay, az = a
    bw, bx, by, bz = b
    return np.array([aw * bw - ax * bx - ay * by - az * bz, aw * bx + ax * bw + ay * bz - az * by,
                     aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw])


def _qconj(q):
    return np.array([q[0], -q[1], -q[2], -q[3]])


def training_episode_ids(store: DemoStore, include_raw: bool = False) -> list[str]:
    """The verified episodes the multiplied cell trains on: "<…>_home" repaired demos (not a raw take's own
    "<root>_home" unless include_raw) and variants, each with a recorded episode."""
    out = []
    for d in sorted(store.list_demos(), key=lambda d: d.id):
        pp = store.get_passport(d.id)
        if pp is None or not pp.verification.success:
            continue
        ep = store.episode_dir(d.id)
        if not ((ep / "steps.npz").is_file() and (ep / "signals.npz").is_file() and (ep / "scene.json").is_file()):
            continue
        root = store.lineage(d.id)[0]
        if d.source == "variant" or (d.source == "repaired" and d.id.endswith("_home")
                                     and (include_raw or d.id != f"{root}_home")):
            out.append(d.id)
    return out


def episode_states(steps: dict, signals: dict, scene: dict, stride: int = STRIDE) -> dict:
    """The restorable states of one episode (see the module docstring), as arrays keyed by FIELDS (minus episode)."""
    q, ee_quat = np.asarray(steps["joint_pos"], float), np.asarray(steps["ee_quat"], float)
    ee_pos = np.asarray(steps["ee_pos"], float)
    grip = np.asarray(steps["gripper"]).astype(int)
    cube = np.asarray(signals["cube_pos"], float)
    contact = np.asarray(signals["contact_gripper_cube"], bool)
    n = len(grip)
    rest, rest_q = np.asarray(scene["cube_pose"]["pos"], float), np.asarray(scene["cube_pose"]["quat_wxyz"], float)
    closes = np.flatnonzero((grip[1:] == 1) & (grip[:-1] == 0)) + 1
    k_close = int(closes[0]) if closes.size else n
    opens = np.flatnonzero((grip[1:] == 0) & (grip[:-1] == 1)) + 1
    opens = opens[opens > k_close]
    k_open = int(opens[0]) if opens.size else n
    speed = np.r_[0.0, np.linalg.norm(np.diff(ee_pos, axis=0), axis=1) * 50.0]
    rows: dict[str, list] = {k: [] for k in FIELDS if k != "episode"}
    hand_at_close = ee_quat[min(k_close, n - 1)]
    for k in range(0, n, stride):
        if k < k_close and grip[k] == 0 and not contact[k] and np.linalg.norm(cube[k] - rest) <= CUBE_MOVED_M:
            phase, cq = FREE, rest_q
        elif k_close <= k < k_open and grip[k] == 1 and contact[k]:
            phase = HELD
            cq = _qmul(_qmul(ee_quat[k], _qconj(hand_at_close)), rest_q)
            cq = cq / np.linalg.norm(cq)
        else:
            continue
        rows["joint_pos"].append(q[k])
        rows["cube_pos"].append(cube[k])
        rows["cube_quat_wxyz"].append(cq)
        rows["bin_pos"].append(np.asarray(scene["bin_pose"]["pos"], float))
        rows["bin_quat_wxyz"].append(np.asarray(scene["bin_pose"]["quat_wxyz"], float))
        rows["closed"].append(bool(grip[k]))
        rows["phase"].append(phase)
        rows["progress"].append(k / max(1, n - 1))
        rows["step"].append(k)
        rows["tcp_speed"].append(speed[k])
    dtypes = {"closed": bool, "phase": np.int8, "step": np.int32}
    shapes = {"joint_pos": (q.shape[1],), "cube_pos": (3,), "cube_quat_wxyz": (4,), "bin_pos": (3,),
              "bin_quat_wxyz": (4,)}
    return {k: np.asarray(v, dtype=dtypes.get(k, np.float32)).reshape((-1,) + shapes.get(k, ()))
            for k, v in rows.items()}


def build_bank(store: DemoStore, *, stride: int = STRIDE, include_raw: bool = False) -> tuple[dict, dict]:
    """(arrays keyed by FIELDS, meta: the store, the episode ids, the stride, counts)."""
    ids = training_episode_ids(store, include_raw)
    parts = []
    for i, id in enumerate(ids):
        ep = store.episode_dir(id)
        with np.load(ep / "steps.npz") as s, np.load(ep / "signals.npz") as g:
            st = episode_states(dict(s), dict(g), json.loads((ep / "scene.json").read_text(encoding="utf-8")), stride)
        st["episode"] = np.full(len(st["phase"]), i, dtype=np.int32)
        parts.append(st)
    if not parts:
        raise ValueError(f"no verified training episodes with recorded steps in {store.root}")
    bank = {k: np.concatenate([p[k] for p in parts]) for k in FIELDS}
    meta = {"store": str(store.root), "episodes": ids, "stride": stride, "states": int(len(bank["phase"])),
            "free": int((bank["phase"] == FREE).sum()), "held": int((bank["phase"] == HELD).sum())}
    return bank, meta


def save_bank(path: Path, bank: dict, meta: dict) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(path, **bank)
    path.with_suffix(".json").write_text(json.dumps(meta, indent=1), encoding="utf-8")


def load_bank(path: Path) -> dict:
    with np.load(Path(path)) as z:
        bank = {k: z[k] for k in z.files}
    missing = set(FIELDS) - set(bank)
    if missing:
        raise ValueError(f"{path} is not a demo-start bank (missing {sorted(missing)})")
    return bank


def min_progress(env_step: int, *, start: float = 0.75, end: float = 0.0, steps: int = 24_000) -> float:
    """The curriculum: the earliest progress a demo start may come from at this env step (late -> early). Env steps
    are per environment (Isaac Lab's common_step_counter; a PPO iteration of 24 steps per env is 24 of them)."""
    if steps <= 0:
        return end
    u = min(1.0, max(0.0, env_step / steps))
    return start + (end - start) * u


def sample_states(rng: np.random.Generator, progress: np.ndarray, n: int, floor: float) -> np.ndarray:
    """n bank rows, uniformly among those at least `floor` into their episode (all rows if none are)."""
    ok = np.flatnonzero(progress >= floor)
    pool = ok if ok.size else np.arange(len(progress))
    return rng.choice(pool, size=n, replace=True)


def plan_resets(rng: np.random.Generator, n: int, bank: dict | None, demo_prob: float, floor: float,
                home_joints: np.ndarray, robot: str = "franka") -> dict:
    """What n resetting environments start from (numpy; the env writes it): with probability demo_prob (and a
    bank) a demo state sampled by the curriculum floor, else home (home_joints, the gripper open) in a random scene
    as SANT samples them (multiply.sample_scene, training-side). Returns arrays: demo [n] bool, row [n] (-1 for
    home), joint_pos [n, J], cube_pos [n, 3], cube_quat_wxyz [n, 4], bin_pos [n, 3], bin_quat_wxyz [n, 4]."""
    from .multiply import sample_scene

    home_joints = np.asarray(home_joints, dtype=np.float32)
    demo = (rng.random(n) < demo_prob) if (bank is not None and demo_prob > 0) else np.zeros(n, dtype=bool)
    out = {"demo": demo, "row": np.full(n, -1, dtype=np.int64),
           "joint_pos": np.tile(home_joints, (n, 1)).astype(np.float32),
           "cube_pos": np.zeros((n, 3), np.float32), "cube_quat_wxyz": np.zeros((n, 4), np.float32),
           "bin_pos": np.zeros((n, 3), np.float32), "bin_quat_wxyz": np.zeros((n, 4), np.float32)}
    rows = sample_states(rng, bank["progress"], int(demo.sum()), floor) if demo.any() else np.zeros(0, dtype=np.int64)
    out["row"][demo] = rows
    for key in ("joint_pos", "cube_pos", "cube_quat_wxyz", "bin_pos", "bin_quat_wxyz"):
        if demo.any():
            out[key][demo] = bank[key][rows]
    for i in np.flatnonzero(~demo):
        s = sample_scene(rng, robot, seed=0)
        out["cube_pos"][i], out["cube_quat_wxyz"][i] = s.cube_pose.pos, s.cube_pose.quat_wxyz
        out["bin_pos"][i], out["bin_quat_wxyz"][i] = s.bin_pose.pos, s.bin_pose.quat_wxyz
    return out
