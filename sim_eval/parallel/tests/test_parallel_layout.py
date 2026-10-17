"""Env layout: every env must see the same ground-plane background as the 1-env scene the policy was trained in."""

from __future__ import annotations

import numpy as np

from sim_eval.parallel.layout import ENV_SPACING, GROUND_PERIOD_M, grid_origins, off_grid_envs


def test_the_one_env_scene_is_on_the_grid():
    assert off_grid_envs(np.zeros((1, 3))) == []


def test_the_3m_default_spacing_puts_every_env_off_the_checker_phase():
    # measured 2026-10-17: Isaac Lab's grid at env_spacing 3 puts 4 envs at (+-1.5, +-1.5): every front image differed
    # from the 1-env scene on ~19% of pixels, and envs 1-3 failed episodes the serial eval succeeded on.
    assert off_grid_envs(grid_origins(4, 3.0)) == [0, 1, 2, 3]


def test_the_default_spacing_keeps_any_number_of_envs_on_the_grid():
    for n in (1, 2, 3, 4, 6, 8, 9, 16):
        assert off_grid_envs(grid_origins(n, ENV_SPACING)) == [], n
    assert ENV_SPACING % (2 * GROUND_PERIOD_M) == 0


def test_grid_origins_match_isaac_labs_layout_for_four_envs():
    # PROBE origins printed by sim_eval/parallel/scripts/probe_envs.py with --env-spacing 8 (2026-10-17)
    got = sorted(map(tuple, grid_origins(4, 8.0).tolist()))
    assert got == sorted([(4.0, -4.0, 0.0), (4.0, 4.0, 0.0), (-4.0, -4.0, 0.0), (-4.0, 4.0, 0.0)])
