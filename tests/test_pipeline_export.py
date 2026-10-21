"""app.pipeline.export: what a finished run hands over: the datasets (LeRobot zip), the Robota-Embed export, the
results and a readable report, and provenance, each sized and hashed."""

from __future__ import annotations

import hashlib
import json
import zipfile
from pathlib import Path

import pytest

from app.pipeline.export import build_artifacts


def _w(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(data if isinstance(data, str) else json.dumps(data), encoding="utf-8")


def _dataset(root: Path, n_files: int = 3) -> Path:
    for i in range(n_files):
        _w(root / "data" / f"chunk-000/episode_{i:06d}.parquet", f"rows {i}")
    _w(root / "meta" / "info.json", {"fps": 50})
    _w(root / "manifest.json", {"n_episodes": n_files})
    return root


def _run(data: Path, *, trained: bool = True, smoke: bool = False) -> dict:
    root = data / "human_exp" / "pl_x"
    _w(root / "config.json", {"ids": ["human_a", "human_b"], "n_human": 2, "variants": 10, "steps": 30000,
                              "demo_sha256": {"human_a": "aa", "human_b": "bb"}, "pipeline_version": "pv1",
                              "smoke": smoke, "frozen_at": "2026-10-20T21:00:00+00:00"})
    _w(root / "preregistration.md", "# Pre-registration\n")
    _w(root / "grid.json", {"name": "hx_pl_x", "cells": []})
    _w(root / "stages" / "sim.json", {"physics_verified": 1, "repair": {"perfected": 2, "kept": 0, "discarded": 0},
                                      "multiply": {"attempts": 20, "successes": 18, "yield": 0.9}})
    if trained:
        raw = _dataset(data / "experiments" / "hx_pl_x_1" / "datasets" / "raw_2", 2)
        mult = _dataset(data / "experiments" / "hx_pl_x_1" / "datasets" / "perfected_multiply_2", 5)
        _w(root / "stages" / "train.json", {"ok": True, "run_id": "hx_pl_x_1", "cells": {
            "raw_2": {"dataset": str(raw), "n_episodes": 2}, "perfected_multiply_2": {"dataset": str(mult), "n_episodes": 5}}})
        _w(root / "results.json", {"sample": smoke, "experiment": {"headline": {
            "raw": {"successes": 1, "n": 40}, "multiplied": {"successes": 9, "n": 40}, "fisher_p": 0.013}}})
    return {"id": "pl_x", "name": "my run", "created": "2026-10-20T21:00:00+00:00", "recipe": {"tag": "human_*"},
            "args": ["--name", "pl_x", "--tag", "human_*"]}


def _robota(dataset: Path, out: Path) -> dict:
    _w(out / "anchors.jsonl", '{"a": 1}\n')
    _w(out / "README.md", "# Robota\n")
    return {"instructions": "the task text only", "anchors": 1}


def test_a_trained_run_exports_its_datasets_robota_results_report_and_provenance(tmp_path):
    run = _run(tmp_path)
    out = tmp_path / "pipeline" / "runs" / "pl_x" / "artifacts"
    arts = build_artifacts(run, data=tmp_path, out=out, robota=_robota, assemble=None, commit="abc1234")
    names = {a["name"]: a for a in arts}
    assert set(names) == {"dataset_raw_2.zip", "dataset_perfected_multiply_2.zip", "robota_embed.zip", "results.json",
                          "report.md", "report.html", "provenance.json"}
    kinds = {a["name"]: a["kind"] for a in arts}
    assert kinds["dataset_raw_2.zip"] == "dataset" and kinds["robota_embed.zip"] == "robota" and kinds["report.md"] == "report"
    for a in arts:  # sized and hashed, with the download route
        p = out / a["name"]
        assert a["bytes"] == p.stat().st_size and a["sha256"] == hashlib.sha256(p.read_bytes()).hexdigest()
        assert a["url"] == f"/pipeline/runs/pl_x/artifacts/{a['name']}"
    with zipfile.ZipFile(out / "dataset_perfected_multiply_2.zip") as z:
        assert sorted(z.namelist()) == sorted(["perfected_multiply_2/manifest.json", "perfected_multiply_2/meta/info.json",
                                               *[f"perfected_multiply_2/data/chunk-000/episode_{i:06d}.parquet" for i in range(5)]])
    with zipfile.ZipFile(out / "robota_embed.zip") as z:
        assert "robota_embed/anchors.jsonl" in z.namelist()
    assert names["robota_embed.zip"]["note"] == "instructions: the task text only"
    # the index next to them, and nothing left half-written
    assert json.loads((out / "artifacts.json").read_text(encoding="utf-8")) == arts
    assert not list(out.glob("*.tmp"))


def test_the_report_reads_the_run_and_provenance_pins_every_input(tmp_path):
    run = _run(tmp_path)
    out = tmp_path / "a"
    arts = build_artifacts(run, data=tmp_path, out=out, robota=_robota, assemble=None, commit="abc1234")
    md = (out / "report.md").read_text(encoding="utf-8")
    assert "my run" in md and "2 demos" in md and "physics: 1/2 verified" in md and "18/20" in md
    assert "raw_2: 1/40" in md or "raw: 1/40" in md
    assert "9/40" in md and "0.013" in md
    html = (out / "report.html").read_text(encoding="utf-8")
    assert html.startswith("<!doctype html>") and "my run" in html and "<script" not in html
    prov = json.loads((out / "provenance.json").read_text(encoding="utf-8"))
    assert prov["git_commit"] == "abc1234" and prov["pipeline_version"] == "pv1"
    assert prov["demo_sha256"] == {"human_a": "aa", "human_b": "bb"} and prov["runner_args"] == run["args"]
    # the file as written (text mode: \r\n on Windows), byte for byte
    prereg = tmp_path / "human_exp" / "pl_x" / "preregistration.md"
    assert prov["preregistration_sha256"] == hashlib.sha256(prereg.read_bytes()).hexdigest()
    # every other artifact's hash, so the downloads can be checked against it
    assert {a["name"] for a in prov["artifacts"]} == {a["name"] for a in arts} - {"provenance.json"}


def test_a_smoke_run_says_so_and_a_robota_failure_is_noted_not_fatal(tmp_path):
    run = _run(tmp_path, smoke=True)

    def broken(dataset, out):
        raise ValueError("no sim-verified episodes")

    arts = build_artifacts(run, data=tmp_path, out=tmp_path / "a", robota=broken, assemble=None, commit="x")
    assert "robota_embed.zip" not in {a["name"] for a in arts}
    md = (tmp_path / "a" / "report.md").read_text(encoding="utf-8")
    assert "SMOKE TEST" in md and "Robota-Embed export failed: ValueError: no sim-verified episodes" in md


def test_a_data_only_run_assembles_its_datasets_in_the_lerobot_venv(tmp_path):
    run = _run(tmp_path, trained=False)
    calls = []

    def assemble(grid: Path, out: Path) -> list[Path]:
        calls.append(grid)
        return [_dataset(out / "raw_2", 1), _dataset(out / "perfected_multiply_2", 2)]

    arts = build_artifacts(run, data=tmp_path, out=tmp_path / "a", robota=_robota, assemble=assemble, commit="x")
    assert calls == [tmp_path / "human_exp" / "pl_x" / "grid.json"]
    names = {a["name"] for a in arts}
    assert {"dataset_raw_2.zip", "dataset_perfected_multiply_2.zip", "robota_embed.zip", "report.md"} <= names
    assert "results.json" not in names  # no training, no results


def test_a_run_with_nothing_to_export_still_gets_its_report_and_provenance(tmp_path):
    run = _run(tmp_path, trained=False)
    arts = build_artifacts(run, data=tmp_path, out=tmp_path / "a", robota=_robota, assemble=None, commit="x")
    assert {a["name"] for a in arts} == {"report.md", "report.html", "provenance.json"}
    assert "no LeRobot dataset" in (tmp_path / "a" / "report.md").read_text(encoding="utf-8")


@pytest.mark.parametrize("bad", ["../x.zip", "a/b.zip", "..", ""])
def test_artifact_names_are_plain_file_names(bad):
    from app.pipeline.export import safe_name

    assert safe_name(bad) is None
    assert safe_name("report.md") == "report.md"
