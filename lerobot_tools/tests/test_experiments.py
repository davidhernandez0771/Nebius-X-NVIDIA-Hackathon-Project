"""Experiment runner. Grid/dry-run/registry tests are pure (fake assemble + train); the real 2-cell run needs the GPU:
    $env:T3_GPU_TESTS="1"; C:\\venvs\\lerobot\\Scripts\\python.exe -m pytest -q lerobot_tools\\tests\\test_experiments.py
"""

from __future__ import annotations

import json
import math
import os
from pathlib import Path

import pytest

from lerobot_tools.assemble import Cell
from lerobot_tools.experiments import REGISTRY_FIELDS, TrainResult, load_grid, main, run_grid
from lerobot_tools.tests.test_assemble import make_episode


@pytest.fixture
def grid_file(tmp_path):
    eps = tmp_path / "grid" / "eps"
    make_episode(eps, "h0", ["h0"])
    make_episode(eps, "h1", ["h1"])
    make_episode(eps, "h0_v0", ["h0", "h0_v0"])
    grid = {
        "name": "tiny",
        "cells": [
            {"condition": "raw", "n_human": 2, "episode_dirs": ["eps/h0", "eps/h1"]},
            {"condition": "raw_multiply", "n_human": 2, "episode_dirs": ["eps/h0", "eps/h1", "eps/h0_v0"]},
        ],
    }
    path = tmp_path / "grid" / "grid.json"
    path.write_text(json.dumps(grid), encoding="utf-8")
    return path


class Fakes:
    def __init__(self, fail_train: set[str] = frozenset()):
        self.fail_train, self.assembled, self.trained = fail_train, [], []

    def assemble(self, cell: Cell, out_root: Path) -> Path:
        out = out_root / cell.name
        out.mkdir(parents=True)
        self.assembled.append(cell.name)
        return out

    def train(self, dataset: Path, out_dir: Path, steps: int, batch_size: int, log_path: Path,
              save_freq: int | None = None) -> TrainResult:
        self.trained.append((dataset.name, steps, batch_size))
        self.save_freqs = getattr(self, "save_freqs", []) + [save_freq]
        if dataset.name in self.fail_train:
            return TrainResult(exit_code=1, checkpoint=None, train_time_s=1.5, final_loss=None,
                               error="OSError: boom")
        ckpts = [out_dir / "checkpoints" / f"{s:06d}" / "pretrained_model" for s in (steps // 2, steps)]
        return TrainResult(exit_code=0, checkpoint=ckpts[-1], train_time_s=2.0, final_loss=1.25, error=None,
                           loss_curve=[[50, 3.0], [100, 1.25]], checkpoints=ckpts)


def _rows(registry: Path) -> list[dict]:
    return [json.loads(line) for line in registry.read_text(encoding="utf-8").splitlines()]


def test_load_grid_resolves_episode_dirs_against_the_grid_file(grid_file):
    grid = load_grid(grid_file)
    assert grid.name == "tiny"
    assert [c.name for c in grid.cells] == ["raw_2", "raw_multiply_2"]
    assert grid.cells[1].episode_dirs[2] == (grid_file.parent / "eps" / "h0_v0").resolve()


def test_run_writes_one_registry_row_per_cell(grid_file, tmp_path):
    fakes, registry = Fakes(), tmp_path / "results" / "registry.jsonl"
    rows = run_grid(load_grid(grid_file), steps=200, batch_size=8, runs_root=tmp_path / "exp", registry=registry,
                    assemble_fn=fakes.assemble, train_fn=fakes.train)
    assert fakes.trained == [("raw_2", 200, 8), ("raw_multiply_2", 200, 8)]
    on_disk = _rows(registry)
    assert on_disk == rows
    for row in on_disk:
        assert set(REGISTRY_FIELDS) <= set(row)
        assert row["status"] == "ok" and row["steps"] == 200 and row["final_loss"] == 1.25
        assert row["eval_success"] is None  # filled in later by the sim eval
    assert on_disk[1]["cell"] == {"condition": "raw_multiply", "n_human": 2, "name": "raw_multiply_2"}
    assert on_disk[1]["n_episodes"] == 3
    assert on_disk[0]["run_id"] == on_disk[1]["run_id"] and on_disk[0]["run_id"].startswith("tiny_")
    assert on_disk[1]["checkpoint"].endswith("pretrained_model")

    run_grid(load_grid(grid_file), steps=200, batch_size=8, runs_root=tmp_path / "exp", registry=registry,
             assemble_fn=Fakes().assemble, train_fn=Fakes().train)
    assert len(_rows(registry)) == 4  # appends, never rewrites earlier results


def test_a_failed_cell_is_recorded_and_the_next_cell_still_runs(grid_file, tmp_path):
    fakes, registry = Fakes(fail_train={"raw_2"}), tmp_path / "registry.jsonl"
    run_grid(load_grid(grid_file), steps=100, batch_size=8, runs_root=tmp_path / "exp", registry=registry,
             assemble_fn=fakes.assemble, train_fn=fakes.train)
    first, second = _rows(registry)
    assert first["status"] == "failed" and "boom" in first["error"] and first["checkpoint"] is None
    assert second["status"] == "ok"


def test_an_invalid_cell_fails_at_assembly_without_stopping_the_grid(tmp_path):
    eps = tmp_path / "eps"
    dirs = [make_episode(eps, "a", ["a"]), make_episode(eps, "b", ["b"])]
    grid_path = tmp_path / "g.json"
    grid_path.write_text(json.dumps({"name": "bad", "cells": [
        {"condition": "raw", "n_human": 1, "episode_dirs": [str(d) for d in dirs]},  # 2 roots > n_human
        {"condition": "raw", "n_human": 2, "episode_dirs": [str(d) for d in dirs]},
    ]}), encoding="utf-8")
    fakes, registry = Fakes(), tmp_path / "registry.jsonl"
    run_grid(load_grid(grid_path), steps=100, batch_size=8, runs_root=tmp_path / "exp", registry=registry,
             assemble_fn=fakes.assemble, train_fn=fakes.train)
    first, second = _rows(registry)
    assert first["status"] == "failed" and "n_human=1" in first["error"]
    assert second["status"] == "ok"
    assert fakes.assembled == ["raw_2"]  # validated before any export


def test_dry_run_writes_nothing_and_reports_invalid_cells(grid_file, tmp_path, capsys, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    assert main(["--grid", str(grid_file), "--steps", "200", "--dry-run"]) == 0
    plan = json.loads(capsys.readouterr().out)
    assert [c["cell"]["name"] for c in plan["cells"]] == ["raw_2", "raw_multiply_2"]
    assert all(c["valid"] for c in plan["cells"])
    assert plan["cells"][1]["n_frames"] == 24
    assert not (tmp_path / "data").exists()

    bad = json.loads(grid_file.read_text(encoding="utf-8"))
    bad["cells"][0]["n_human"] = 1
    grid_file.write_text(json.dumps(bad), encoding="utf-8")
    assert main(["--grid", str(grid_file), "--steps", "200", "--dry-run"]) == 1
    plan = json.loads(capsys.readouterr().out)
    assert plan["cells"][0]["valid"] is False and "n_human=1" in plan["cells"][0]["error"]


def test_budget_is_enforced_before_any_work(grid_file):
    with pytest.raises(SystemExit):
        main(["--grid", str(grid_file), "--steps", "60001", "--dry-run"])
    with pytest.raises(SystemExit):
        main(["--grid", str(grid_file), "--steps", "1000", "--save-freq", "0", "--dry-run"])


def test_sprint7_budget_allows_30k_steps(grid_file, capsys):
    assert main(["--grid", str(grid_file), "--steps", "30000", "--save-freq", "2500", "--dry-run"]) == 0
    plan = json.loads(capsys.readouterr().out)
    assert plan["steps"] == 30000 and plan["save_freq"] == 2500


def test_rows_record_the_loss_curve_and_every_checkpoint(grid_file, tmp_path):
    fakes, registry = Fakes(), tmp_path / "registry.jsonl"
    run_grid(load_grid(grid_file), steps=200, batch_size=8, runs_root=tmp_path / "exp", registry=registry,
             assemble_fn=fakes.assemble, train_fn=fakes.train, save_freq=100)
    assert fakes.save_freqs == [100, 100]
    row = _rows(registry)[0]
    assert row["loss_curve"] == [[50, 3.0], [100, 1.25]]
    assert [Path(c).parent.name for c in row["checkpoints"]] == ["000100", "000200"]
    assert row["checkpoint"] == row["checkpoints"][-1]
    assert row["save_freq"] == 100
    assert row["log"].endswith("raw_2.log")


@pytest.mark.skipif(os.environ.get("T3_GPU_TESTS") != "1", reason="GPU integration run; set T3_GPU_TESTS=1")
def test_real_two_cell_grid_200_steps(tmp_path):
    pytest.importorskip("lerobot")
    from lerobot_tools.train_smoke import make_synthetic_episodes

    eps = make_synthetic_episodes(tmp_path / "eps", n_episodes=4, n_steps=60)
    grid_path = tmp_path / "grid.json"
    grid_path.write_text(json.dumps({"name": "tiny_gpu", "cells": [
        {"condition": "raw", "n_human": 2, "episode_dirs": [str(e) for e in eps[:2]]},
        {"condition": "raw_multiply", "n_human": 4, "episode_dirs": [str(e) for e in eps]},
    ]}), encoding="utf-8")
    registry = tmp_path / "results" / "registry.jsonl"
    rows = run_grid(load_grid(grid_path), steps=200, batch_size=8, runs_root=tmp_path / "exp", registry=registry)
    assert [r["status"] for r in rows] == ["ok", "ok"], [r["error"] for r in rows]
    for r in rows:
        assert Path(r["checkpoint"]).joinpath("model.safetensors").is_file()
        assert math.isfinite(r["final_loss"]) and r["train_time_s"] > 0 and r["eval_success"] is None
    print("\nT3 tiny grid:", json.dumps([{k: r[k] for k in ("cell", "train_time_s", "final_loss")} for r in rows]))


def test_grasp_fix_run2_budget_allows_60k_steps(grid_file, capsys):
    assert main(["--grid", str(grid_file), "--steps", "60000", "--save-freq", "5000", "--dry-run"]) == 0
    assert json.loads(capsys.readouterr().out)["steps"] == 60000
