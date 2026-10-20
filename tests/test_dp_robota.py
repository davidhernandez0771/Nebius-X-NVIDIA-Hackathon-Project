"""demo_pipeline.robota: the pure parts of the Robota-Embed export (windows, dedup, splits, phases, norm, crops)."""
from __future__ import annotations

import re
from pathlib import Path

import numpy as np
import pytest

from demo_pipeline import robota, scene_geometry


# --- anchors and windows ---------------------------------------------------------------------------

def test_anchors_need_a_whole_future_window_inside_the_episode():
    # t + horizon + 1 < n: with n = 10, horizon = 4 the last legal anchor is t = 4
    assert robota.anchor_steps(10, stride=2, horizon=4) == [0, 2, 4]
    assert robota.anchor_steps(10, stride=1, horizon=4) == [0, 1, 2, 3, 4]
    assert robota.anchor_steps(5, stride=1, horizon=4) == []  # 0 + 4 + 1 = 5 is not < 5
    with pytest.raises(ValueError):
        robota.anchor_steps(10, stride=0, horizon=4)


def test_future_window_is_strictly_after_the_anchor():
    assert robota.future_window(7, horizon=200) == (8, 207)  # 200 frames, the anchor frame excluded


def test_temporal_iou_on_inclusive_frame_ranges():
    assert robota.temporal_iou((0, 9), (0, 9)) == 1.0
    assert robota.temporal_iou((0, 9), (10, 19)) == 0.0
    assert robota.temporal_iou((0, 9), (5, 14)) == pytest.approx(5 / 15)


def test_dedup_keeps_the_earliest_and_drops_heavy_overlaps():
    # 200-frame windows: IoU = (200 - d) / (200 + d) <= 0.25 needs a gap d >= 120 frames
    kept = robota.dedup_anchors(list(range(0, 300, 25)), horizon=200, max_iou=0.25)
    assert kept == [0, 125, 250]
    assert robota.dedup_anchors([0, 120], horizon=200) == [0, 120]  # IoU 80/320 = 0.25 exactly is kept
    assert robota.dedup_anchors([0, 119], horizon=200) == [0]
    assert robota.dedup_anchors([], horizon=200) == []


def test_sampled_target_frames_span_the_window():
    frames = robota.sample_frames((1, 200), 16)
    assert len(frames) == 16 and frames[0] == 1 and frames[-1] == 200
    assert frames == sorted(set(frames))
    with pytest.raises(ValueError):
        robota.sample_frames((1, 10), 16)  # fewer frames than samples


# --- splits ----------------------------------------------------------------------------------------

def test_splits_put_each_source_demo_in_exactly_one_split():
    roots = [f"src_{i}" for i in range(10)]
    split = robota.assign_splits(roots, val_frac=0.1, test_frac=0.1, seed=0)
    assert set(split) == set(roots)
    counts = {s: sum(v == s for v in split.values()) for s in robota.SPLITS}
    assert counts == {"train": 8, "val": 1, "test": 1}
    assert robota.assign_splits(list(reversed(roots)), 0.1, 0.1, seed=0) == split  # order-free, deterministic
    assert robota.assign_splits(roots, 0.1, 0.1, seed=1) != split  # the seed matters


def test_splits_with_few_sources_still_give_train_one():
    assert set(robota.assign_splits(["a"], 0.1, 0.1).values()) == {"train"}
    two = robota.assign_splits(["a", "b"], 0.1, 0.1)
    assert sorted(two.values()) == ["test", "train"]
    three = robota.assign_splits(["a", "b", "c"], 0.1, 0.1)
    assert sorted(three.values()) == ["test", "train", "val"]
    with pytest.raises(ValueError):
        robota.assign_splits(["a", "b"], 0.6, 0.5)


# --- normalization ---------------------------------------------------------------------------------

def test_q01_q99_normalization_maps_to_minus_one_one_without_clipping():
    x = np.stack([np.linspace(0.0, 1.0, 1001), np.linspace(-2.0, 2.0, 1001)], axis=1)
    stats = robota.norm_stats(x)
    assert stats["q01"] == pytest.approx([0.01, -1.96]) and stats["q99"] == pytest.approx([0.99, 1.96])
    n = robota.normalize(x, stats["q01"], stats["q99"])
    assert n[10] == pytest.approx([-1.0, -1.0]) and n[990] == pytest.approx([1.0, 1.0])
    assert n[0, 0] < -1.0 and n[-1, 0] > 1.0  # outside q01..q99 stays outside


def test_constant_coordinate_normalizes_to_zero_offsets():
    x = np.array([[0.04], [0.04], [0.05]])
    n = robota.normalize(x, [0.04], [0.04])
    assert n[:, 0] == pytest.approx([0.0, 0.0, 0.01])  # half-range 0 -> scale 1, centered at the median


def test_pad_to_64_dims():
    p = robota.pad(np.ones((3, 9)))
    assert p.shape == (3, 64) and p[:, :9].sum() == 27 and not p[:, 9:].any()
    assert robota.pad(np.ones(9)).shape == (64,)
    with pytest.raises(ValueError):
        robota.pad(np.ones(65))


# --- phases ----------------------------------------------------------------------------------------

def _pick_place_track():
    """reach (open), grasp (closed, on table), carry (lifted), place (over bin), release (open again)."""
    g = np.array([0, 0, 1, 1, 1, 1, 1, 0, 0])
    cube = np.array([
        [0.5, 0.0, 0.025], [0.5, 0.0, 0.025], [0.5, 0.0, 0.025], [0.5, 0.0, 0.03], [0.5, 0.0, 0.2],
        [0.4, -0.25, 0.2], [0.4, -0.25, 0.04], [0.4, -0.25, 0.035], [0.4, -0.25, 0.035]])
    return g, cube


def test_phases_from_gripper_and_cube_pose():
    g, cube = _pick_place_track()
    got = robota.phases(g, cube, bin_pos=[0.4, -0.25, 0.0], bin_quat_wxyz=[1, 0, 0, 0])
    assert got == ["reach", "reach", "grasp", "grasp", "carry", "place", "place", "release", "release"]
    assert set(got) <= set(robota.PHASES)


def test_bin_footprint_follows_the_bin_yaw():
    # a 45-degree bin: a point 0.12 m along world x is outside a 0.2 m square bin unrotated (0.12 > 0.1)
    # but inside once rotated (0.12 / sqrt(2) = 0.085 per bin axis)
    yaw45 = [np.cos(np.pi / 8), 0.0, 0.0, np.sin(np.pi / 8)]
    assert robota.in_bin_footprint([0.12, 0.0], [0.0, 0.0], [1, 0, 0, 0]) is False
    assert robota.in_bin_footprint([0.12, 0.0], [0.0, 0.0], yaw45) is True


# --- projection and crops --------------------------------------------------------------------------

def test_projection_puts_the_camera_target_at_the_image_center():
    cam = robota.FRONT_CAMERA
    u, v = robota.project(np.array([cam.target]), cam)[0]
    assert (u, v) == pytest.approx((cam.width / 2, cam.height / 2))


def test_projection_matches_a_rendered_frame():
    # home_src_3000 step 0: the red cube's pixels in the 128x128 front image are centered near (60, 67)
    u, v = robota.project(np.array([[0.46012405, 0.1308756, 0.02499962]]), robota.FRONT_CAMERA)[0]
    assert abs(u - 60) < 3 and abs(v - 67) < 3


def test_world_up_is_image_up_and_world_plus_y_is_image_right():
    cam = robota.FRONT_CAMERA
    (u0, v0), (u1, v1), (u2, v2) = robota.project(np.array([[0.5, 0.0, 0.0], [0.5, 0.0, 0.2], [0.5, 0.1, 0.0]]), cam)
    assert v1 < v0 and u2 > u0


def test_crop_box_has_the_crop_aspect_and_covers_the_points():
    pts = np.array([[50.0, 40.0], [70.0, 60.0]])
    (x0, y0, x1, y1), clipped = robota.crop_box(pts, 128, 128)
    assert (x1 - x0) / (y1 - y0) == pytest.approx(robota.CROP_W / robota.CROP_H)
    assert x0 <= 50 and x1 >= 70 and y0 <= 40 and y1 >= 60 and not clipped
    assert 0 <= x0 and x1 <= 128 and 0 <= y0 and y1 <= 128


def test_crop_box_shifts_inside_the_image_and_flags_what_it_cannot_cover():
    (x0, y0, x1, y1), clipped = robota.crop_box(np.array([[2.0, 2.0], [10.0, 6.0]]), 128, 128)
    assert x0 == 0 and y0 == 0 and not clipped
    (x0, y0, x1, y1), clipped = robota.crop_box(np.array([[0.0, 0.0], [127.0, 127.0]]), 128, 128)
    assert x1 - x0 == pytest.approx(128) and clipped  # a 5:3 box can't cover a full-height spread


def test_interaction_points_cover_cube_corners_and_the_gripper():
    pts = robota.interaction_points(np.array([0.5, 0.0, 0.025]), np.array([0.5, 0.0, 0.3]), np.array([0, 1, 0, 0]))
    assert pts.shape == (8 + 4, 3)
    assert pts[:8, 2].min() == pytest.approx(0.0) and pts[:8, 2].max() == pytest.approx(0.05)
    # tool +z points down here (quat 180 deg about x), so the hand sits above the fingertips
    assert pts[8:, 2].max() > 0.3


def test_copied_sim_constants_match_sim_worker():
    src = (Path(__file__).resolve().parents[1] / "sim_worker" / "scene_cfg.py").read_text(encoding="utf-8")

    cam = robota.FRONT_CAMERA
    # The camera pose lives in sim_worker.scene_parts (no Isaac imports), which scene_cfg.py imports.
    from sim_worker import scene_parts

    assert "from .scene_parts import" in src
    assert scene_parts.FRONT_EYE == cam.eye and scene_parts.FRONT_TARGET == cam.target
    assert "from demo_pipeline.scene_geometry import BIN_INNER, BIN_WALL, CUBE_SIZE" in src
    assert robota.BIN_INNER_XY == scene_geometry.BIN_INNER[:2] and robota.CUBE_SIZE == scene_geometry.CUBE_SIZE
    assert int(re.search(r"^IMAGE_SIZE = (\d+)", src, re.M).group(1)) == cam.width == cam.height
    front = src[src.index("front = CameraCfg"):src.index("wrist = CameraCfg")]
    assert f"focal_length={cam.focal_length}" in front and f"horizontal_aperture={cam.horizontal_aperture}" in front
