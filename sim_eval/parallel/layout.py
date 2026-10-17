"""Where the N envs sit, so that every env renders the background the policy was trained with.

The ground is one global checkered plane (sim_worker.scene_cfg: /World/defaultGroundPlane) and the front camera sees
it behind the table. The training episodes and the serial eval have one env at the world origin. Measured
2026-10-17 (scripts/probe_envs.py, one scene in every env): at Isaac Lab's env_spacing 3 the 4 envs sit at
(+-1.5, +-1.5) and every front image differed from the 1-env scene on ~19% of pixels (a 3 m shift inverts the
checker: 1 m squares, 2 m period). The smoke run on that layout failed 3 of the serial run's 4 successes. At spacing 8
(origins at multiples of 4 m) the difference fell to 0.5-2% of pixels, the wrist camera's render-noise level.

Rule: every env origin must be a whole number of checker periods from the world origin in x and y.
"""

from __future__ import annotations

import math

import numpy as np

GROUND_PERIOD_M = 2.0  # checker period of the default ground plane (measured, see above)
ENV_SPACING = 8.0  # Isaac Lab places origins at multiples of spacing / 2, so spacing % (2 * period) == 0 suffices


def grid_origins(n: int, spacing: float) -> np.ndarray:
    """(n, 3) env origins as Isaac Lab 3.0 lays them out (isaaclab/cloner/clone_plan.py, grid of rows x cols)."""
    rows = int(math.ceil(n / math.sqrt(n)))
    cols = int(math.ceil(n / rows))
    ii, jj = np.meshgrid(np.arange(rows, dtype=np.float64), np.arange(cols, dtype=np.float64), indexing="ij")
    x = -(ii.ravel()[:n] - (rows - 1) / 2) * spacing
    y = (jj.ravel()[:n] - (cols - 1) / 2) * spacing
    return np.stack([x, y, np.zeros(n)], axis=1)


def off_grid_envs(origins, period: float = GROUND_PERIOD_M, tol: float = 1e-4) -> list[int]:
    """Indices of envs whose origin is not a whole number of ground periods from the world origin (x and y)."""
    xy = np.asarray(origins, dtype=np.float64)[:, :2] / period
    return [i for i, row in enumerate(xy) if np.abs(row - np.round(row)).max() > tol]
