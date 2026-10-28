"""Forward and inverse kinematics on a parsed URDF (sim_worker.urdf_import.Urdf). numpy only.

Used by "Bring your robot" for what it needs before (or without) Isaac: the tool point and gripper open/closed
(urdf_import), the start pose, and the report card's reach map. Poses are 4x4 matrices in the frame of the chain's
`top` link (the base); quaternions are (w, x, y, z).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import TYPE_CHECKING

import numpy as np

if TYPE_CHECKING:  # urdf_import imports this module
    from .urdf_import import Joint, Urdf

IK_ITERS = 150
IK_DAMPING = 0.05
POS_TOL = 0.005  # m: "reachable"
ROT_TOL = 0.05  # rad
_CONVERGED = (1e-5, 1e-4)  # stop early below these (m, rad)


def rpy_matrix(rpy) -> np.ndarray:
    """URDF fixed-axis roll, pitch, yaw: R = Rz(yaw) Ry(pitch) Rx(roll)."""
    r, p, y = rpy
    cr, sr, cp, sp, cy, sy = math.cos(r), math.sin(r), math.cos(p), math.sin(p), math.cos(y), math.sin(y)
    return np.array([
        [cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr],
        [sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr],
        [-sp, cp * sr, cp * cr],
    ])


def axis_angle(axis, angle: float) -> np.ndarray:
    x, y, z = np.asarray(axis, dtype=float) / np.linalg.norm(axis)
    c, s, v = math.cos(angle), math.sin(angle), 1 - math.cos(angle)
    return np.array([
        [c + x * x * v, x * y * v - z * s, x * z * v + y * s],
        [y * x * v + z * s, c + y * y * v, y * z * v - x * s],
        [z * x * v - y * s, z * y * v + x * s, c + z * z * v],
    ])


def quat_to_matrix(q) -> np.ndarray:
    w, x, y, z = np.asarray(q, dtype=float) / np.linalg.norm(q)
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
        [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
        [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
    ])


def matrix_to_quat(m) -> np.ndarray:
    """Rotation matrix -> (w, x, y, z) with w >= 0."""
    m = np.asarray(m, dtype=float)
    t = np.trace(m)
    if t > 0:
        s = 2 * math.sqrt(t + 1)
        q = [s / 4, (m[2, 1] - m[1, 2]) / s, (m[0, 2] - m[2, 0]) / s, (m[1, 0] - m[0, 1]) / s]
    else:
        i = int(np.argmax(np.diag(m)))
        j, k = (i + 1) % 3, (i + 2) % 3
        s = 2 * math.sqrt(1 + m[i, i] - m[j, j] - m[k, k])
        q = [0.0] * 4
        q[0] = (m[k, j] - m[j, k]) / s
        q[1 + i] = s / 4
        q[1 + j] = (m[j, i] + m[i, j]) / s
        q[1 + k] = (m[k, i] + m[i, k]) / s
    q = np.asarray(q)
    return q if q[0] >= 0 else -q


def origin_matrix(joint: Joint) -> np.ndarray:
    t = np.eye(4)
    t[:3, :3] = rpy_matrix(joint.origin.rpy)
    t[:3, 3] = joint.origin.xyz
    return t


def motion_matrix(joint: Joint, q: float) -> np.ndarray:
    t = np.eye(4)
    if joint.type in ("revolute", "continuous"):
        t[:3, :3] = axis_angle(joint.axis, q)
    elif joint.type == "prismatic":
        t[:3, 3] = np.asarray(joint.axis, dtype=float) / np.linalg.norm(joint.axis) * q
    return t


def joint_value(u: Urdf, name: str, q: dict[str, float]) -> float:
    """q[name], or for a mimic joint not in q: multiplier * leader + offset."""
    if name in q:
        return q[name]
    m = u.joints[name].mimic
    if m is not None and m.joint in u.joints:
        return m.multiplier * joint_value(u, m.joint, q) + m.offset
    return 0.0


def link_pose(u: Urdf, link: str, q: dict[str, float], top: str | None = None) -> np.ndarray:
    """Pose of `link` in the frame of `top` (default: the root); joints not in q are at 0 (mimics follow)."""
    path = u.path(top or u.root, link)
    if path is None:
        raise ValueError(f"{link} is not below {top or u.root}")
    t = np.eye(4)
    for name in path:
        j = u.joints[name]
        t = t @ origin_matrix(j) @ motion_matrix(j, joint_value(u, name, q))
    return t


def rotation_error(target: np.ndarray, current: np.ndarray) -> np.ndarray:
    """Axis-angle vector (world frame) that turns `current` into `target`."""
    w, *v = matrix_to_quat(target @ current.T)
    v = np.asarray(v)
    s = float(np.linalg.norm(v))
    return np.zeros(3) if s < 1e-12 else v / s * 2 * math.atan2(s, w)


@dataclass(frozen=True)
class IkResult:
    q: np.ndarray
    pos_err: float
    rot_err: float
    iters: int

    @property
    def ok(self) -> bool:
        return self.pos_err <= POS_TOL and self.rot_err <= ROT_TOL


class Chain:
    """The arm from `top` to `tip`: `joints` must be exactly the moving joints on that path, base outwards."""

    def __init__(self, u: Urdf, top: str, tip: str, joints: list[str]):
        path = u.path(top, tip)
        if path is None:
            raise ValueError(f"{tip} is not below {top}")
        moving = [j for j in path if u.joints[j].moving]
        if moving != list(joints):
            raise ValueError(f"the joints from {top} to {tip} are {', '.join(moving)}, not {', '.join(joints)}")
        self.u, self.top, self.tip, self.names = u, top, tip, list(joints)
        self._path = [u.joints[j] for j in path]
        lim = []
        for name in self.names:
            j = u.joints[name]
            lim.append((-math.inf, math.inf) if j.type == "continuous" or j.limits is None
                       else (j.limits.lower, j.limits.upper))
        self.limits = np.asarray(lim, dtype=float)

    def mid(self) -> np.ndarray:
        lo, hi = self.limits.T
        return np.where(np.isfinite(lo) & np.isfinite(hi), (lo + hi) / 2, 0.0)

    def clip(self, q: np.ndarray) -> np.ndarray:
        return np.clip(q, self.limits[:, 0], self.limits[:, 1])

    def _frames(self, q: np.ndarray) -> tuple[np.ndarray, list[tuple[np.ndarray, np.ndarray, str]]]:
        """Tip pose and, per moving joint, (world axis, world origin, type)."""
        t, k, axes = np.eye(4), 0, []
        for j in self._path:
            t = t @ origin_matrix(j)
            if j.moving:
                axis = t[:3, :3] @ (np.asarray(j.axis, dtype=float) / np.linalg.norm(j.axis))
                axes.append((axis, t[:3, 3].copy(), j.type))
                t = t @ motion_matrix(j, q[k])
                k += 1
        return t, axes

    def fk(self, q) -> np.ndarray:
        return self._frames(np.asarray(q, dtype=float))[0]

    def jacobian(self, q) -> tuple[np.ndarray, np.ndarray]:
        tip, axes = self._frames(np.asarray(q, dtype=float))
        jac = np.zeros((6, len(axes)))
        for i, (a, o, kind) in enumerate(axes):
            if kind == "prismatic":
                jac[:3, i] = a
            else:
                jac[:3, i] = np.cross(a, tip[:3, 3] - o)
                jac[3:, i] = a
        return tip, jac

    def solve(self, target: np.ndarray, q0, iters: int = IK_ITERS, damping: float = IK_DAMPING) -> IkResult:
        """Damped least squares on the 6-D pose error, joints clipped to their limits after every step."""
        q = self.clip(np.asarray(q0, dtype=float).copy())
        best = None
        for it in range(iters + 1):
            tip, jac = self.jacobian(q)
            dp = target[:3, 3] - tip[:3, 3]
            dr = rotation_error(target[:3, :3], tip[:3, :3])
            pe, re_ = float(np.linalg.norm(dp)), float(np.linalg.norm(dr))
            if best is None or pe + 0.1 * re_ < best.pos_err + 0.1 * best.rot_err:
                best = IkResult(q.copy(), pe, re_, it)
            if pe < _CONVERGED[0] and re_ < _CONVERGED[1] or it == iters:
                break
            err = np.concatenate([dp, dr])
            dq = jac.T @ np.linalg.solve(jac @ jac.T + damping ** 2 * np.eye(6), err)
            q = self.clip(q + dq)
        return best

    def solve_best(self, target: np.ndarray, seeds) -> IkResult:
        best = None
        for q0 in seeds:
            r = self.solve(target, q0)
            if r.ok:
                return r
            if best is None or r.pos_err + 0.1 * r.rot_err < best.pos_err + 0.1 * best.rot_err:
                best = r
        return best

    def seeds(self, extra=(), n_random: int = 2, seed: int = 0) -> list[np.ndarray]:
        """Start poses for solve_best: the given ones, the middle of each range, then fixed random ones."""
        rng = np.random.default_rng(seed)
        lo = np.where(np.isfinite(self.limits[:, 0]), self.limits[:, 0], -math.pi)
        hi = np.where(np.isfinite(self.limits[:, 1]), self.limits[:, 1], math.pi)
        return [np.asarray(s, dtype=float) for s in extra] + [self.mid()] + [rng.uniform(lo, hi) for _ in range(n_random)]
