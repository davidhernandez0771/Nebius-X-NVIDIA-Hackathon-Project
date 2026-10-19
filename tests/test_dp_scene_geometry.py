"""demo_pipeline.scene_geometry: the one copy of the cube and bin sizes, shared by the Isaac scene and the repairs."""
from __future__ import annotations

from pathlib import Path

import pytest

from demo_pipeline import scene_geometry as geo


def test_rim_height_is_the_floor_plus_the_inner_height():
    assert geo.BIN_RIM_HEIGHT == pytest.approx(geo.BIN_WALL + geo.BIN_INNER[2]) == pytest.approx(0.09)
    assert geo.CUBE_HALF == pytest.approx(geo.CUBE_SIZE / 2) == pytest.approx(0.025)
    assert geo.BIN_FOOTPRINT_HALF == pytest.approx(geo.BIN_INNER[0] / 2 + geo.BIN_WALL) == pytest.approx(0.11)


def test_the_release_height_clears_the_rim_and_stays_under_the_high_release_limit():
    # check_success flags a release with the cube centre > 0.18 m above the bin origin (high_release)
    z = geo.BIN_RIM_HEIGHT + geo.CUBE_HALF + geo.RELEASE_CLEARANCE
    assert geo.BIN_RIM_HEIGHT + geo.CUBE_HALF < z < 0.18


def test_the_isaac_scene_and_the_sant_side_use_these_numbers():
    root = Path(__file__).resolve().parents[1]
    scene_cfg = (root / "sim_worker" / "scene_cfg.py").read_text(encoding="utf-8")  # imports Isaac: read, not import
    assert "from demo_pipeline.scene_geometry import BIN_INNER, BIN_WALL, CUBE_SIZE" in scene_cfg
    assert "\nBIN_INNER = (" not in scene_cfg and "\nBIN_WALL = " not in scene_cfg and "\nCUBE_SIZE = " not in scene_cfg
    from app.ai import diagnose
    from app.jobs import BIN_RIM_HEIGHT

    assert BIN_RIM_HEIGHT == geo.BIN_RIM_HEIGHT
    assert (diagnose.BIN_RIM_HEIGHT, diagnose.BIN_FOOTPRINT_HALF, diagnose.CUBE_HALF) == (
        geo.BIN_RIM_HEIGHT, geo.BIN_FOOTPRINT_HALF, geo.CUBE_HALF)
