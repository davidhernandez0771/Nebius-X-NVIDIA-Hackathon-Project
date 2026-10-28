"""Recovery copies (grasp fix, run 2), pure: where a policy rollout went wrong, and the expert's way out from there.

The centered_10x10 policy learned to hover and fix its wrist yaw, but it still arrives up to ~3 cm off-center, lands
a finger on the cube top, or ends with an empty closed gripper (T3 grasp-fix note). It has never seen a way out of
those states: every demo starts at home and goes right. A recovery copy starts at such a state, restored from a
traced rollout (sim_eval.recording.StepTracer), and shows the expert finishing from it:
reopen if closed -> rise straight up to the hover height -> slowly center and align over the cube -> the scripted
expert's usual descent, grasp, lift, carry and release. Every copy is replayed in Isaac and verified by the same
physics check; only passing ones are kept.

find_recovery_states(trace, scene) picks at most one state per mode from a trace:
- hover_enter / hover_exit: the first and last still step of the first hover (gripper open, 10-22 cm above the cube
  center, before any finger contact) if the hand is > 10 mm off-center or > 10 deg turned from the cube's faces;
- descent: the first step 4-10 cm above the cube center, still open and untouched, with that misalignment;
- on_top: from 0.1 s after a finger first touches the cube with the gripper open and the TCP > 1.5 cm above its
  center (the policy often keeps pushing, up to ~13 cm/s);
- empty_closed: the first slow step from 0.5 s into a run of a closed gripper with the fingers shut on nothing (after
  a drop the policy first carries its empty gripper away at ~25 cm/s).
A state is kept only if it can be restored faithfully with zero velocities: the cube flat on a face (< 5 deg from
the nearest one; a cube that fell on its side is as graspable), nearly still (< 2 cm/s) on the table and off the
bin, and the hand slow enough (mode-dependent limit). The grasp yaw comes from the cube's horizontal faces.

Trace row k holds the observation before action k (joint_pos) and the record after it (TCP, cube), so the state
after step k is joint_pos[k + 1] with tcp/cube[k].
"""

from __future__ import annotations

import collections
import math
import shutil
import time
from collections.abc import Callable
from pathlib import Path

import numpy as np
from pydantic import BaseModel, ConfigDict

from demo_pipeline.schemas import Pose, Scene, Trajectory, VerificationResult
from sim_worker.homeset import CENTER_MIN_S, CENTER_SPEED, passport, stamp as stamp_episode
from sim_worker.jobs import _stored_variant, _write_done, episodes_dir
from sim_worker.scripted import ABOVE_CUBE, HOLD_S, MIN_MOVE_S, SPEED, _down_with_yaw, _min_jerk, _slerp, scripted_expert

RECOVERY_ROOT_PREFIX = "recovery-"  # lerobot_tools.assemble: such lineage roots are not human demos
CUBE_HALF = 0.025
MISALIGN_MM, MISALIGN_DEG = 10.0, 10.0
HOVER_BAND, DESCENT_BAND = (0.10, 0.22), (0.04, 0.10)  # TCP height above the cube center (m)
ON_TOP_Z = 0.015
EMPTY_FINGERS = 0.005  # m; mean finger joint position below this = shut on nothing (the cube holds them at 0.025)
MIN_HOVER_STEPS, ON_TOP_DELAY, EMPTY_DELAY = 10, 5, 25
MAX_TILT_DEG, MAX_CUBE_Z_ERR, MAX_CUBE_SPEED = 5.0, 0.005, 0.02
TCP_SPEED = {"hover": 0.03, "descent": 0.3, "on_top": 0.15, "empty_closed": 0.1, "rewind": 0.15}  # rewind: sim_worker.corrections
FAR_REALIGN = 0.06  # m; a re-approach longer than this moves at the expert's SPEED, a shorter one is a slow centering
BIN_FOOTPRINT_HALF = 0.12  # the bin's 0.20 m inner square + 2 cm: a cube there is in or on the bin

ReplayFn = Callable[..., tuple[VerificationResult, object, Trajectory]]


class RecoveryState(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    seed: int
    mode: str
    source: str  # the policy (cell) whose rollout this state comes from
    k: int
    t: float
    joint_pos: list[float]
    tcp_pos: list[float]
    tcp_quat_wxyz: list[float]
    gripper: int
    cube_pos: list[float]
    cube_quat_wxyz: list[float]
    offset_mm: float
    yaw_err_deg: float


def _hand_yaw(q) -> float:
    """Yaw of the hand's x axis (for a pointing-down gripper (0, cos(y/2), sin(y/2), 0) that is y)."""
    w, x, y, z = q
    return math.atan2(2 * (x * y + w * z), 1 - 2 * (y * y + z * z))


def _mod90(a: float) -> float:
    return a - (math.pi / 2) * round(a / (math.pi / 2))


def _rot(q) -> np.ndarray:
    w, x, y, z = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
                     [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
                     [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)]])


def _tilt_deg(q) -> float:
    """Angle between the world vertical and the cube's nearest body axis (0 = flat on some face)."""
    return math.degrees(math.acos(min(1.0, float(np.abs(_rot(q)[2]).max()))))


def _face_yaw(q) -> float:
    """Yaw of a horizontal body axis: the cube's face direction whichever face it rests on (mod 90 deg)."""
    r = _rot(q)
    a = r[:, (int(np.argmax(np.abs(r[2]))) + 1) % 3]
    return math.atan2(a[1], a[0])


def _speed(p: np.ndarray, fps: int) -> np.ndarray:
    v = np.linalg.norm(np.diff(p, axis=0), axis=1) * fps
    return np.r_[v[:1], v] if len(v) else np.zeros(len(p))


def _runs(mask: np.ndarray) -> list[tuple[int, int]]:
    edges = np.diff(np.concatenate([[0], mask.astype(np.int8), [0]]))
    return list(zip(np.flatnonzero(edges == 1).tolist(), np.flatnonzero(edges == -1).tolist()))


def _restorer(trace: dict, scene: Scene, fps: int = 50) -> Callable[[int, str], bool]:
    """restorable(k, family): the state after trace step k can be restored with zero velocities. The cube flat on a
    face, resting on the table (not in the hand, not in or on the bin) and nearly still; the hand slower than
    TCP_SPEED[family]. Shared by find_recovery_states and sim_worker.corrections (rewind before a failure)."""
    tcp, cube, cq = np.asarray(trace["tcp_pos"]), np.asarray(trace["cube_pos"]), np.asarray(trace["cube_quat_wxyz"])
    n = len(tcp)
    tcp_v, cube_v = _speed(tcp, fps), _speed(cube, fps)
    bw, bx, by, bz = scene.bin_pose.quat_wxyz
    bin_yaw = math.atan2(2 * (bw * bz + bx * by), 1 - 2 * (by * by + bz * bz))
    c, s = math.cos(-bin_yaw), math.sin(-bin_yaw)

    def restorable(k: int, family: str) -> bool:
        if not 0 <= k < n - 1 or tcp_v[k] >= TCP_SPEED[family]:
            return False
        if _tilt_deg(cq[k]) >= MAX_TILT_DEG or abs(cube[k, 2] - CUBE_HALF) >= MAX_CUBE_Z_ERR:
            return False
        if cube_v[k] >= MAX_CUBE_SPEED:
            return False
        dx, dy = cube[k, 0] - scene.bin_pose.pos[0], cube[k, 1] - scene.bin_pose.pos[1]
        return not (abs(c * dx - s * dy) <= BIN_FOOTPRINT_HALF and abs(s * dx + c * dy) <= BIN_FOOTPRINT_HALF)

    return restorable


def state_at(trace: dict, scene: Scene, k: int, *, name: str, mode: str, source: str, fps: int = 50) -> RecoveryState:
    """The restorable state after trace step k (joint_pos[k + 1], the TCP and cube of row k)."""
    q, tcp, tq = np.asarray(trace["joint_pos"]), np.asarray(trace["tcp_pos"]), np.asarray(trace["tcp_quat_wxyz"])
    cube, cq = np.asarray(trace["cube_pos"]), np.asarray(trace["cube_quat_wxyz"])
    off = float(np.linalg.norm(tcp[k, :2] - cube[k, :2]) * 1000)
    yaw_err = abs(math.degrees(_mod90(_hand_yaw(tq[k]) - _face_yaw(cq[k]))))
    return RecoveryState(
        name=name, seed=scene.seed, mode=mode, source=source, k=k, t=k / fps, joint_pos=[float(x) for x in q[k + 1]],
        tcp_pos=[float(x) for x in tcp[k]], tcp_quat_wxyz=[float(x) for x in tq[k]], gripper=int(trace["gripper"][k]),
        cube_pos=[float(x) for x in cube[k]], cube_quat_wxyz=[float(x) for x in cq[k]], offset_mm=off,
        yaw_err_deg=float(yaw_err))


def find_recovery_states(trace: dict, scene: Scene, *, source: str, fps: int = 50) -> list[RecoveryState]:
    if "cube_quat_wxyz" not in trace:
        raise ValueError("the trace has no cube_quat_wxyz (traces from before sim_eval c181547 can't be restored)")
    q, tcp, tq = np.asarray(trace["joint_pos"]), np.asarray(trace["tcp_pos"]), np.asarray(trace["tcp_quat_wxyz"])
    cube, cq = np.asarray(trace["cube_pos"]), np.asarray(trace["cube_quat_wxyz"])
    grip, con = np.asarray(trace["gripper"]).astype(int), np.asarray(trace["contact_gripper_cube"]).astype(bool)
    n = len(grip)
    tcp_v = _speed(tcp, fps)
    rel_z = tcp[:, 2] - cube[:, 2]
    off_mm = np.linalg.norm(tcp[:, :2] - cube[:, :2], axis=1) * 1000
    yaw_err = np.array([abs(math.degrees(_mod90(_hand_yaw(a) - _face_yaw(b)))) for a, b in zip(tq, cq)])
    misaligned = (off_mm > MISALIGN_MM) | (yaw_err > MISALIGN_DEG)
    fingers = q[:, 7:9].mean(axis=1)
    first_contact = int(np.argmax(con)) if con.any() else n
    before_contact = np.arange(n) < first_contact
    is_open = grip == 0
    restorable = _restorer(trace, scene, fps)

    picks: dict[str, int] = {}
    hover = is_open & before_contact & (rel_z >= HOVER_BAND[0]) & (rel_z <= HOVER_BAND[1]) & (tcp_v < TCP_SPEED["hover"])
    runs = [r for r in _runs(hover) if r[1] - r[0] >= MIN_HOVER_STEPS]
    if runs:
        a, b = runs[0]
        for mode, k in (("hover_enter", a), ("hover_exit", b - 1)):
            if misaligned[k] and restorable(k, "hover"):
                picks[mode] = k
    descent = is_open & before_contact & (rel_z >= DESCENT_BAND[0]) & (rel_z <= DESCENT_BAND[1]) & misaligned
    for k in np.flatnonzero(descent):
        if restorable(int(k), "descent"):
            picks["descent"] = int(k)
            break
    on_top = con & is_open & (rel_z > ON_TOP_Z)
    if on_top.any():
        k0 = int(np.argmax(on_top))
        for k in range(k0 + ON_TOP_DELAY, n):
            if on_top[k] and restorable(k, "on_top"):
                picks["on_top"] = k
                break
    empty = (grip == 1) & (fingers < EMPTY_FINGERS) & ~con
    for a, b in _runs(empty):
        k = next((k for k in range(a + EMPTY_DELAY, b) if restorable(k, "empty_closed")), None)
        if k is not None:
            picks["empty_closed"] = k
            break

    out = []
    for mode, k in sorted(picks.items(), key=lambda kv: kv[1]):
        out.append(RecoveryState(
            name=f"rec_{scene.seed}_{mode}", seed=scene.seed, mode=mode, source=source, k=k, t=k / fps,
            joint_pos=[float(x) for x in q[k + 1]], tcp_pos=[float(x) for x in tcp[k]],
            tcp_quat_wxyz=[float(x) for x in tq[k]], gripper=int(grip[k]), cube_pos=[float(x) for x in cube[k]],
            cube_quat_wxyz=[float(x) for x in cq[k]], offset_mm=float(off_mm[k]), yaw_err_deg=float(yaw_err[k])))
    return out


def _unit(q) -> tuple[float, float, float, float]:
    q = np.asarray(q, dtype=float)
    return tuple(float(x) for x in q / np.linalg.norm(q))


def state_scene(state: RecoveryState, bin_pose: Pose, robot: str = "franka") -> Scene:
    return Scene(cube_pose=Pose(pos=tuple(state.cube_pos), quat_wxyz=_unit(state.cube_quat_wxyz)), bin_pose=bin_pose,
                 robot=robot, seed=state.seed)


def recovery_trajectory(state: RecoveryState, bin_pose: Pose, rate_hz: int = 50) -> Trajectory:
    """The expert's continuation from `state`: reopen if closed (HOLD_S in place), rise straight up to the hover
    height (ABOVE_CUBE over the cube center) if below it, center and align over the cube (CENTER_SPEED average,
    CENTER_MIN_S at least; SPEED when it is more than FAR_REALIGN away), then scripted_expert's pick and place from
    above the cube, unchanged."""
    cube = np.asarray(state.cube_pos, dtype=float)
    yaw = _face_yaw(_unit(state.cube_quat_wxyz))
    # plan as if the cube stood upright at its face yaw (scripted_expert reads only position and yaw)
    plan_scene = Scene(cube_pose=Pose(pos=tuple(cube), quat_wxyz=(math.cos(yaw / 2), 0.0, 0.0, math.sin(yaw / 2))),
                       bin_pose=bin_pose, robot="franka", seed=state.seed)
    expert = scripted_expert(plan_scene, rate_hz=rate_hz).to_arrays()
    q_grasp = _down_with_yaw(yaw - (math.pi / 2) * round(yaw / (math.pi / 2)))
    above = cube + [0.0, 0.0, ABOVE_CUBE]
    assert np.allclose(expert["ee_pos"][0], above) and np.allclose(expert["ee_quat"][0], q_grasp)

    p0, q0 = np.asarray(state.tcp_pos, dtype=float), np.asarray(_unit(state.tcp_quat_wxyz))
    pos, quat, grip = [p0], [q0], [int(state.gripper)]
    plan = []  # (target pos, target quat, gripper, seconds or None for a move, speed)
    if state.gripper:
        plan.append((p0, q0, 0, HOLD_S, None))
    if p0[2] < above[2] - 1e-9:
        plan.append((np.array([p0[0], p0[1], above[2]]), q0, 0, None, (SPEED, MIN_MOVE_S)))
    start_above = plan[-1][0] if plan and plan[-1][3] is None else p0
    far = float(np.linalg.norm(above - start_above)) > FAR_REALIGN
    plan.append((above, q_grasp, 0, None, (SPEED, MIN_MOVE_S) if far else (CENTER_SPEED, CENTER_MIN_S)))
    cur_p, cur_q = p0, q0
    for p1, q1, g, hold, speed in plan:
        span = hold if hold is not None else max(float(np.linalg.norm(p1 - cur_p)) / speed[0], speed[1])
        n = max(1, math.ceil(span * rate_hz - 1e-9))
        s = _min_jerk(np.arange(1, n + 1) / n)
        grip[-1] = g  # the event happens at the segment's start, as in scripted_expert
        pos.extend(cur_p + s[:, None] * (p1 - cur_p))
        quat.extend(_slerp(cur_q, q1, s))
        grip.extend([g] * n)
        cur_p, cur_q = p1, q1
    pos.extend(expert["ee_pos"][1:])
    quat.extend(expert["ee_quat"][1:])
    grip.extend(int(g) for g in expert["gripper"][1:])
    quats = np.asarray(quat)
    quats /= np.linalg.norm(quats, axis=1, keepdims=True)
    return Trajectory.from_arrays(np.arange(len(pos)) / rate_hz, np.asarray(pos), quats, grip)


def _sim_error(traj: Trajectory) -> VerificationResult:
    return VerificationResult(success=False, reasons=["sim_error"], duration=traj.duration, path_length=0.0,
                              max_contact_force=0.0, settle_time=None)


def run_recovery(states: list[RecoveryState], bin_poses: dict[int, Pose], replay_fn: ReplayFn, *, root: Path,
                 log: Callable[[str], None] = print, stamp: Callable = stamp_episode, robot: str = "franka",
                 cameras: bool = True) -> list[dict]:
    """Replay every state's recovery into <root>/episodes/<state.name>/ and verify it. replay_fn(traj, scene,
    ep_dir, record_cameras, start_joint_pos) -> (VerificationResult, signals, executed Trajectory). A finished folder
    for the same scene is reused; one broken replay is a recorded sim_error, not a failed run."""
    rows = []
    for st in states:
        t0 = time.time()
        scene = state_scene(st, bin_poses[st.seed], robot)
        traj = recovery_trajectory(st, bin_poses[st.seed])
        ep = (episodes_dir(root) / st.name).resolve()
        stored = _stored_variant(ep, scene)
        if stored is not None:
            result = stored[1]
            log(f"[recovery] {st.name}: reused (success={result.success})")
        else:
            if ep.exists():
                shutil.rmtree(ep)
            try:
                result, _signals, executed = replay_fn(traj, scene, ep, cameras, st.joint_pos)
                _write_done(ep, scene, executed, result)
                stamp(ep, passport(st.name, [RECOVERY_ROOT_PREFIX + st.source, st.name], result, robot=robot))
            except Exception as exc:  # noqa: BLE001
                log(f"[recovery] {st.name}: sim_error {exc!r}")
                rows.append({"name": st.name, "seed": st.seed, "mode": st.mode, "success": False,
                             "reasons": ["sim_error"], "ep_dir": None, "wall_s": round(time.time() - t0, 1)})
                continue
            log(f"[recovery] {st.name}: success={result.success} reasons={result.reasons}")
        rows.append({"name": st.name, "seed": st.seed, "mode": st.mode, "success": result.success,
                     "reasons": list(result.reasons), "ep_dir": str(ep), "wall_s": round(time.time() - t0, 1)})
    return rows


def recovery_manifest(rows: list[dict]) -> dict:
    by_mode: dict[str, dict] = {}
    for r in rows:
        m = by_mode.setdefault(r["mode"], {"attempts": 0, "verified": 0})
        m["attempts"] += 1
        m["verified"] += bool(r["success"])
    verified = [r["ep_dir"] for r in rows if r["success"]]
    return {
        "attempts": len(rows), "verified": len(verified), "yield": len(verified) / len(rows) if rows else 0.0,
        "by_mode": by_mode,
        "reasons": dict(collections.Counter(x for r in rows if not r["success"] for x in r["reasons"])),
        "verified_dirs": verified, "rows": rows,
    }
