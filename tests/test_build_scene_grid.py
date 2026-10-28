"""The Results page's scene grid (web/src/site/results/scenes.json) must be exactly what the committed raw log says."""

import json

from scripts.build_scene_grid import LOG, OUT, scene_rows


def test_the_committed_grid_matches_the_raw_episode_log():
    assert json.loads(OUT.read_text(encoding="utf-8"))["scenes"] == scene_rows(LOG)


def test_the_grid_is_the_big_test_30_of_40():
    rows = scene_rows(LOG)
    assert [r["seed"] for r in rows] == list(range(5400, 5440))
    assert sum(r["success"] for r in rows) == 30
