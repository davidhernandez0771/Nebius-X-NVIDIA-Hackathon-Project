"""First-frame joint positions of a LeRobot v3 dataset (for sim_eval's start-state check). Needs pyarrow
(C:\venvs\lerobot); skipped elsewhere."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

pa = pytest.importorskip("pyarrow")
pq = pytest.importorskip("pyarrow.parquet")

from lerobot_tools.start_state import dataset_start_states, main  # noqa: E402
from sim_eval.start_state import FRANKA_DEFAULT_JOINT_POS, START_STATE_FILE, load_starts  # noqa: E402

REPO = Path(__file__).parents[2]
SMOKE_DS = REPO / "data/runs/t3_act_smoke_20261015_170519/dataset"


def _write(root: Path, rel: str, rows: list[tuple[int, int, list[float]]]) -> None:
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    ep, fr, st = zip(*rows)
    table = pa.table({"observation.state": pa.array(st, type=pa.list_(pa.float32())),
                      "episode_index": pa.array(ep, type=pa.int64()), "frame_index": pa.array(fr, type=pa.int64())})
    pq.write_table(table, path)


def _state(ep: int, fr: int) -> list[float]:
    return [ep + fr / 10] * 9


def test_first_frames_in_episode_order_across_files(tmp_path):
    # LeRobot v3 packs several episodes per file; rows may come in any order.
    _write(tmp_path, "data/chunk-000/file-001.parquet", [(2, 1, _state(2, 1)), (2, 0, _state(2, 0))])
    _write(tmp_path, "data/chunk-000/file-000.parquet",
           [(1, 0, _state(1, 0)), (0, 1, _state(0, 1)), (0, 0, _state(0, 0)), (1, 1, _state(1, 1))])
    starts = dataset_start_states(tmp_path)
    assert starts.shape == (3, 9)
    np.testing.assert_allclose(starts[:, 0], [0.0, 1.0, 2.0])


def test_an_episode_without_frame_zero_is_an_error(tmp_path):
    _write(tmp_path, "data/chunk-000/file-000.parquet", [(0, 0, _state(0, 0)), (1, 1, _state(1, 1))])
    with pytest.raises(ValueError, match="episode 1"):
        dataset_start_states(tmp_path)


def test_no_data_files(tmp_path):
    with pytest.raises(FileNotFoundError):
        dataset_start_states(tmp_path)


def test_cli_reports_the_check_and_writes_start_state(tmp_path, capsys):
    rows = [(e, 0, [0.1 * e, 0.2, -0.2, -2.2, 0.0, 2.45, 0.9, 0.04, 0.04]) for e in range(3)]
    _write(tmp_path, "data/chunk-000/file-000.parquet", rows)
    assert main([str(tmp_path)]) == 0
    report = json.loads(capsys.readouterr().out)
    assert report["differs"] is True and report["chosen"] == "dataset_mean"
    assert report["reset_default"] == list(FRANKA_DEFAULT_JOINT_POS)
    assert not (tmp_path / START_STATE_FILE).exists()  # report only, unless --write
    assert main([str(tmp_path), "--write"]) == 0
    np.testing.assert_allclose(load_starts(tmp_path), [r[2] for r in rows], rtol=1e-6)


def test_real_smoke_dataset_if_present():
    if not (SMOKE_DS / "data").is_dir():
        pytest.skip(f"no dataset at {SMOKE_DS}")
    meta = json.loads((SMOKE_DS / "meta/info.json").read_text(encoding="utf-8"))
    starts = dataset_start_states(SMOKE_DS)
    assert starts.shape == (meta["total_episodes"], 9) and np.isfinite(starts).all()
