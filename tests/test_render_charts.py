"""scripts/render_charts.py: results.json -> standalone SVG charts for the README."""
from __future__ import annotations

import json
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

from demo_pipeline.results import build_results
from scripts import render_charts as rc

NS = {"s": "http://www.w3.org/2000/svg"}
SAMPLE = Path(__file__).resolve().parents[1] / "web" / "src" / "pm" / "mocks" / "results.sample.json"


def _parse(svg: str) -> ET.Element:
    root = ET.fromstring(svg)
    assert root.tag == "{http://www.w3.org/2000/svg}svg" and root.get("viewBox")
    return root


def _cls(root, tag, cls):
    return [e for e in root.iter(f"{{{NS['s']}}}{tag}") if cls in (e.get("class") or "").split()]


def _texts(root):
    return ["".join(e.itertext()) for e in root.iter(f"{{{NS['s']}}}text")]


def _results(series=None, bars=(0.4, 0.46), ours=0.9, sample=False, demos=(5, 10, 20)):
    series = series or {"raw": [0.1, 0.2, 0.3], "raw_multiply": [0.2, 0.3, 0.4], "ours": [0.3, 0.5, 0.7]}
    labels = {"raw": "Raw human demos", "raw_multiply": "Raw + multiply", "ours": "Perfected + multiply"}
    return {"sample": sample, "demos": list(demos),
            "series": [{"key": k, "label": labels[k], "success": list(v)} for k, v in series.items()],
            "ablation": {"demos": 10, "bars": [{"key": "rules", "label": "Rules-only repair", "success": bars[0]},
                                               {"key": "ours", "label": "Rules + Nemotron repair", "success": bars[1]}]},
            "multiply_yield": {"ours": ours, "mimicgen": [0.38, 0.74]}}


# --- the success chart ---------------------------------------------------------------------------

def test_success_chart_draws_one_line_and_a_point_per_measured_value():
    root = _parse(rc.success_chart(_results()))
    assert len(_cls(root, "polyline", "series")) == 3
    assert len(_cls(root, "circle", "point")) == 9
    texts = _texts(root)
    assert {"Raw human demos", "Raw + multiply", "Perfected + multiply"} <= set(texts)
    assert {"5", "10", "20"} <= set(texts) and {"0%", "50%", "100%"} <= set(texts)


def test_success_points_sit_at_their_rate_with_zero_at_the_bottom():
    root = _parse(rc.success_chart(_results(series={"raw": [0.0, 0.5, 1.0]})))
    ys = [float(c.get("cy")) for c in _cls(root, "circle", "point")]
    g = rc.GEOMETRY
    assert ys == pytest.approx([g.bottom, (g.top + g.bottom) / 2, g.top])  # a measured 0 is a real point


def test_null_is_a_pending_mark_never_a_point_at_zero():
    root = _parse(rc.success_chart(_results(series={"raw": [0.2, None, 0.4], "ours": [None, None, None]})))
    assert len(_cls(root, "circle", "point")) == 2
    assert all(float(c.get("cy")) != rc.GEOMETRY.bottom for c in _cls(root, "circle", "point"))
    pending = _cls(root, "g", "pending")
    assert len(pending) == 4 and all("pending" in "".join(p.itertext()) for p in pending)
    # the line breaks at the gap: no segment joins 0.2 to 0.4 across the pending point, and "ours" has none
    assert _cls(root, "polyline", "series") == []


def test_a_line_runs_only_through_consecutive_measured_points():
    root = _parse(rc.success_chart(_results(series={"raw": [0.2, 0.3, None]})))
    (line,) = _cls(root, "polyline", "series")
    assert len(line.get("points").split()) == 2


# --- ablation and yield ----------------------------------------------------------------------------

def test_ablation_bars_have_their_width_and_null_is_pending():
    root = _parse(rc.ablation_chart(_results(bars=(0.4, None))))
    (bar,) = _cls(root, "rect", "bar")
    assert float(bar.get("width")) == pytest.approx(0.4 * rc.BAR_WIDTH)
    assert len(_cls(root, "g", "pending")) == 1
    assert "Rules-only repair" in _texts(root) and "40%" in _texts(root)
    assert any("10 human demos" in t for t in _texts(root))


def test_yield_shows_ours_against_mimicgens_published_band():
    root = _parse(rc.yield_chart(_results(ours=0.9)))
    (band,) = _cls(root, "rect", "mimicgen")
    assert float(band.get("x")) == pytest.approx(rc.BAR_X + 0.38 * rc.BAR_WIDTH)
    assert float(band.get("width")) == pytest.approx((0.74 - 0.38) * rc.BAR_WIDTH)
    (bar,) = _cls(root, "rect", "bar")
    assert float(bar.get("width")) == pytest.approx(0.9 * rc.BAR_WIDTH)
    assert "90%" in _texts(root) and any("38" in t and "74%" in t for t in _texts(root))


def test_yield_pending_keeps_the_mimicgen_band():
    root = _parse(rc.yield_chart(_results(ours=None)))
    assert _cls(root, "rect", "bar") == [] and len(_cls(root, "g", "pending")) == 1
    assert len(_cls(root, "rect", "mimicgen")) == 1


# --- sample watermark ------------------------------------------------------------------------------

@pytest.mark.parametrize("draw", ["success_chart", "ablation_chart", "yield_chart"])
@pytest.mark.parametrize("sample,marked", [(True, True), (False, False), (None, True)])
def test_sample_data_carries_a_visible_watermark(draw, sample, marked):
    r = _results(sample=sample)
    if sample is None:
        del r["sample"]  # like results.ts: only "sample": false counts as real
    root = _parse(getattr(rc, draw)(r))
    assert bool(_cls(root, "text", "watermark")) == marked
    if marked:
        assert "SAMPLE" in "".join(_cls(root, "text", "watermark")[0].itertext())


# --- inputs and the CLI ----------------------------------------------------------------------------

def test_the_real_builders_all_pending_file_renders():
    r = build_results([], [], [], [])
    root = _parse(rc.success_chart(r))
    assert len(_cls(root, "g", "pending")) == 9 and _cls(root, "circle", "point") == []
    assert len(_cls(_parse(rc.ablation_chart(r)), "g", "pending")) == 2


def test_labels_are_escaped():
    r = _results()
    r["series"][0]["label"] = "Raw <human> & co"
    assert "Raw <human> & co" in _texts(_parse(rc.success_chart(r)))


@pytest.mark.parametrize("bad", [1.5, -0.1, "0.3", True])
def test_a_value_that_is_not_a_rate_is_refused(bad):
    with pytest.raises(ValueError):
        rc.success_chart(_results(series={"raw": [bad, 0.2, 0.3]}))


def test_a_series_with_the_wrong_length_is_refused():
    with pytest.raises(ValueError):
        rc.success_chart(_results(series={"raw": [0.1, 0.2]}))


def test_cli_writes_three_svgs_from_the_sample_file(tmp_path, capsys):
    assert rc.main(["--results", str(SAMPLE), "--out", str(tmp_path)]) == 0
    files = sorted(p.name for p in tmp_path.glob("*.svg"))
    assert files == ["ablation.svg", "success.svg", "yield.svg"]
    for f in files:
        root = _parse((tmp_path / f).read_text(encoding="utf-8"))
        assert _cls(root, "text", "watermark")  # the sample file is sample data
    assert "success.svg" in capsys.readouterr().out


def test_cli_defaults_to_data_dir_results(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    (tmp_path / "results").mkdir()
    (tmp_path / "results" / "results.json").write_text(json.dumps(build_results([], [], [], [])), encoding="utf-8")
    assert rc.main([]) == 0
    assert (tmp_path / "results" / "charts" / "success.svg").is_file()


def test_cli_reports_a_missing_results_file(tmp_path, capsys):
    assert rc.main(["--results", str(tmp_path / "nope.json"), "--out", str(tmp_path)]) == 1
    assert "results.sample.json" in capsys.readouterr().out


def test_written_svgs_use_lf_line_endings_on_every_platform(tmp_path):
    for p in rc.render_all(build_results([], [], [], []), tmp_path):
        assert b"\r" not in p.read_bytes()
