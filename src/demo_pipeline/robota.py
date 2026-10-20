"""The pure part of the Robota-Embed export (demo_pipeline.export_robota does the file I/O).

Robota-Embed (arXiv 2610.19495, Appendix A) trains on anchors: at time t a QUERY (instruction, an
interaction-region crop, the native action at t, a source id) is paired with a TARGET (the instruction, 16 frames
from the strictly-future window and every action in it at the native rate). This module holds the math: which
steps become anchors, the temporal-IoU dedup, the split by source demo, q01/q99 action normalization, the weak
phase labels, and the crop box computed from the simulation's known cube and gripper poses.

Steps are frame indices at the episode's native rate (step i is at i / fps).
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

import numpy as np

FORMAT_VERSION = "sant-robota-embed/1"
PAPER_URL = "https://arxiv.org/abs/2610.19495"
PAD_DIM = 64
CROP_W, CROP_H = 320, 192
SPLITS = ("train", "val", "test")
PHASES = ("reach", "grasp", "carry", "place", "release")
OBJECT_ROLES = {"cube": "manipulated", "bin": "target"}

# Isaac Lab's Franka joint order, which our joint_pos and action follow (see lerobot_tools/gr00t_modality.py)
ACTION_NAMES = {
    "franka": [f"panda_joint{i}" for i in range(1, 8)] + ["panda_finger_joint1", "panda_finger_joint2"],
}

# Copied from sim_worker/scene_cfg.py, which imports Isaac Lab (tests/test_dp_robota.py checks they still match)
CUBE_SIZE = 0.05
BIN_INNER_XY = (0.20, 0.20)
LIFT_M = 0.01  # the cube counts as lifted this far above its resting height
# The tool frame (demo_pipeline.episode_io ee_pos/ee_quat): origin at the fingertip center, +z = approach,
# fingers slide along +-y (sim_worker/robots.py). Franka: open fingers 0.04 m each side, hand ~0.11 m behind.
FINGER_HALF_SPAN_M = 0.04
HAND_BACK_M = 0.11


@dataclass(frozen=True)
class PinholeCamera:
    eye: tuple[float, float, float]
    target: tuple[float, float, float]
    focal_length: float  # mm
    horizontal_aperture: float  # mm
    width: int
    height: int


FRONT_CAMERA = PinholeCamera(eye=(1.35, 0.15, 0.65), target=(0.45, 0.15, 0.05), focal_length=24.0,
                             horizontal_aperture=20.955, width=128, height=128)


# --- anchors and windows ---------------------------------------------------------------------------

def anchor_steps(n_steps: int, stride: int, horizon: int) -> list[int]:
    """Every stride-th step t with t + horizon + 1 < n_steps, so the whole future window is inside the episode."""
    if stride < 1 or horizon < 1:
        raise ValueError(f"stride and horizon must be >= 1 step, got {stride}, {horizon}")
    return [t for t in range(0, n_steps, stride) if t + horizon + 1 < n_steps]


def future_window(t: int, horizon: int) -> tuple[int, int]:
    """The strictly-future window of anchor t as an inclusive step range: horizon steps, t itself excluded."""
    return t + 1, t + horizon


def temporal_iou(a: tuple[int, int], b: tuple[int, int]) -> float:
    """Intersection over union of two inclusive step ranges."""
    inter = max(0, min(a[1], b[1]) - max(a[0], b[0]) + 1)
    union = (a[1] - a[0] + 1) + (b[1] - b[0] + 1) - inter
    return inter / union


def dedup_anchors(steps: list[int], horizon: int, max_iou: float = 0.25) -> list[int]:
    """Greedy, earliest first: keep an anchor unless its future window overlaps a kept one by IoU > max_iou."""
    kept: list[int] = []
    for t in sorted(steps):
        w = future_window(t, horizon)
        if all(temporal_iou(w, future_window(k, horizon)) <= max_iou for k in kept):
            kept.append(t)
    return kept


def sample_frames(window: tuple[int, int], k: int) -> list[int]:
    """k distinct, evenly spaced steps from the inclusive window, including both ends."""
    lo, hi = window
    if hi - lo + 1 < k:
        raise ValueError(f"window {window} has fewer than {k} frames")
    return [int(i) for i in np.round(np.linspace(lo, hi, k)).astype(int)]


# --- splits ----------------------------------------------------------------------------------------

def assign_splits(sources: list[str], val_frac: float, test_frac: float, seed: int = 0) -> dict[str, str]:
    """Each source demo -> "train" | "val" | "test", deterministically (a seeded hash order, not the list order).

    Test and val get round(n * frac) sources each, at least one when the fraction is > 0 and there are enough
    sources (test needs 2, val needs 3), so train always keeps at least one.
    """
    if val_frac < 0 or test_frac < 0 or val_frac + test_frac >= 1:
        raise ValueError(f"val_frac + test_frac must be in [0, 1), got {val_frac} + {test_frac}")
    uniq = sorted(set(sources), key=lambda s: hashlib.sha256(f"{seed}:{s}".encode()).hexdigest())
    n = len(uniq)
    n_test = max(1, round(n * test_frac)) if test_frac > 0 and n >= 2 else 0
    n_val = max(1, round(n * val_frac)) if val_frac > 0 and n >= 3 else 0
    if n - n_test - n_val < 1:
        raise ValueError(f"{n} sources leave none for train at val {val_frac}, test {test_frac}")
    out = {s: "test" for s in uniq[:n_test]}
    out.update({s: "val" for s in uniq[n_test:n_test + n_val]})
    out.update({s: "train" for s in uniq[n_test + n_val:]})
    return out


# --- action normalization --------------------------------------------------------------------------

def norm_stats(actions: np.ndarray) -> dict[str, list[float]]:
    """Per-coordinate 1st and 99th percentiles of [N, D] actions (pass the train split only)."""
    a = np.asarray(actions, dtype=np.float64)
    return {"q01": np.quantile(a, 0.01, axis=0).tolist(), "q99": np.quantile(a, 0.99, axis=0).tolist()}


def normalize(x: np.ndarray, q01, q99) -> np.ndarray:
    """Map q01 -> -1 and q99 -> +1 per coordinate, not clipped. A constant coordinate (q01 == q99) keeps scale 1."""
    q01, q99 = np.asarray(q01, dtype=np.float64), np.asarray(q99, dtype=np.float64)
    half = (q99 - q01) / 2
    half = np.where(half > 1e-9, half, 1.0)
    return (np.asarray(x, dtype=np.float64) - (q01 + q99) / 2) / half


def pad(x: np.ndarray, dim: int = PAD_DIM) -> np.ndarray:
    """Zero-pad the last axis to dim."""
    x = np.asarray(x)
    if x.shape[-1] > dim:
        raise ValueError(f"action has {x.shape[-1]} dims, more than the padded {dim}")
    return np.concatenate([x, np.zeros(x.shape[:-1] + (dim - x.shape[-1],), dtype=x.dtype)], axis=-1)


# --- weak labels -----------------------------------------------------------------------------------

def _yaw(quat_wxyz) -> float:
    w, x, y, z = quat_wxyz
    return float(np.arctan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)))


def in_bin_footprint(xy, bin_xy, bin_quat_wxyz) -> bool:
    """Is the point (world xy) inside the bin's inner square, in the bin's own (yawed) frame?"""
    c, s = np.cos(_yaw(bin_quat_wxyz)), np.sin(_yaw(bin_quat_wxyz))
    dx, dy = np.asarray(xy, dtype=float)[:2] - np.asarray(bin_xy, dtype=float)[:2]
    lx, ly = c * dx + s * dy, -s * dx + c * dy
    return bool(abs(lx) <= BIN_INNER_XY[0] / 2 and abs(ly) <= BIN_INNER_XY[1] / 2)


def phases(gripper: np.ndarray, cube_pos: np.ndarray, bin_pos, bin_quat_wxyz) -> list[str]:
    """One phase per step from the gripper command (1 = closed) and the cube position:

    reach   = before the gripper first closes;
    grasp   = closed, cube still within LIFT_M of its starting height and not over the bin;
    carry   = closed, cube lifted, not over the bin;
    place   = closed, cube over the bin's inner footprint;
    release = open again after a close.
    """
    g = np.asarray(gripper).astype(bool)
    cube = np.asarray(cube_pos, dtype=float)
    rest_z = cube[0, 2]
    out, closed_once = [], False
    for i in range(len(g)):
        if g[i]:
            closed_once = True
            if in_bin_footprint(cube[i, :2], bin_pos, bin_quat_wxyz):
                out.append("place")
            elif cube[i, 2] - rest_z >= LIFT_M:
                out.append("carry")
            else:
                out.append("grasp")
        else:
            out.append("release" if closed_once else "reach")
    return out


# --- projection and crops --------------------------------------------------------------------------

def _rot(quat_wxyz) -> np.ndarray:
    w, x, y, z = np.asarray(quat_wxyz, dtype=float) / np.linalg.norm(quat_wxyz)
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
        [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
        [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
    ])


def project(points: np.ndarray, cam: PinholeCamera) -> np.ndarray:
    """World points [K, 3] -> pixel (u, v) [K, 2] for a look-at camera with world +z up (Isaac's
    set_world_poses_from_view), square pixels, principal point at the image center."""
    eye = np.asarray(cam.eye, dtype=float)
    fwd = np.asarray(cam.target, dtype=float) - eye
    fwd /= np.linalg.norm(fwd)
    right = np.cross(fwd, [0.0, 0.0, 1.0])
    right /= np.linalg.norm(right)
    up = np.cross(right, fwd)
    d = np.asarray(points, dtype=float) - eye
    x, y, z = d @ right, d @ up, d @ fwd
    f_px = cam.focal_length / cam.horizontal_aperture * cam.width
    return np.stack([cam.width / 2 + f_px * x / z, cam.height / 2 - f_px * y / z], axis=1)


def interaction_points(cube_pos: np.ndarray, ee_pos: np.ndarray, ee_quat_wxyz: np.ndarray) -> np.ndarray:
    """World points the crop must contain: the cube's 8 corners (axis-aligned; the cube's yaw isn't recorded,
    the crop margin covers it) and the gripper's fingertip center, both finger tips and the back of the hand."""
    h = CUBE_SIZE / 2
    corners = np.array([[sx, sy, sz] for sx in (-h, h) for sy in (-h, h) for sz in (-h, h)]) + cube_pos
    rot = _rot(ee_quat_wxyz)
    tool = np.array([[0, 0, 0], [0, FINGER_HALF_SPAN_M, 0], [0, -FINGER_HALF_SPAN_M, 0], [0, 0, -HAND_BACK_M]])
    return np.vstack([corners, ee_pos + tool @ rot.T])


def crop_box(points_px: np.ndarray, img_w: int, img_h: int, margin: float = 0.2,
             min_h: float = 24.0) -> tuple[tuple[float, float, float, float], bool]:
    """A CROP_W:CROP_H box (x0, y0, x1, y1) in source pixels around the points: their bounds plus margin on each
    side, grown to the aspect, shifted inside the image. Returns (box, clipped): clipped = some point falls
    outside because a box of this aspect that fits in the image can't cover them all."""
    pts = np.asarray(points_px, dtype=float)
    (lx, ly), (hx, hy) = pts.min(axis=0), pts.max(axis=0)
    w, h = hx - lx, hy - ly
    w, h = w + 2 * margin * max(w, h), h + 2 * margin * max(w, h)
    h = max(h, min_h)
    aspect = CROP_W / CROP_H
    w, h = max(w, h * aspect), max(h, w / aspect)
    scale = min(1.0, img_w / w, img_h / h)
    w, h = w * scale, h * scale
    cx, cy = (lx + hx) / 2, (ly + hy) / 2
    x0 = float(np.clip(cx - w / 2, 0, img_w - w))
    y0 = float(np.clip(cy - h / 2, 0, img_h - h))
    box = (x0, y0, x0 + w, y0 + h)
    clipped = bool(lx < box[0] or ly < box[1] or hx > box[2] or hy > box[3])
    return box, clipped
