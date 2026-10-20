"""scripts/build_site_results.py: the Results page's store numbers, regenerated from the experiment stores.

The stores are faked in tmp_path with the shapes the real runs write (human_exp/<name>/results.json, stages/physics,
ab_summary.json, evals/<run>/<cell>.json). The citation test reads the real notes in docs/superpowers/notes.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPT = REPO / "scripts" / "build_site_results.py"

WEBCAM = [f"human_20261019_{i:04x}" for i in range(10)]
MOUSE = [f"human_20261020_{i:04x}" for i in range(10)]


@pytest.fixture(scope="module")
def bsr():
    spec = importlib.util.spec_from_file_location("build_site_results", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _write(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data), encoding="utf-8")


def _physics(root: Path, ids: list[str], passed: int) -> None:
    for i, id in enumerate(ids):
        _write(root / "stages" / "physics" / f"{id}.json",
               {"id": id, "success": i < passed, "reasons": [] if i < passed else ["collision"], "steps": 400})


def _webcam(data: Path) -> None:
    root = data / "human_exp" / "human10c"
    _write(root / "config.json", {"name": "human10c", "ids": WEBCAM, "n_human": 10, "multiplied_only": True})
    _physics(root, WEBCAM, 0)
    run = "hx_human10c_20261020_112039"
    _write(data / "evals" / run / "perfected_multiply_10.json",
           {"summary": {"n": 40, "successes": 3, "reasons": {"not_in_bin": 37, "dropped": 26}}, "episodes": []})
    _write(root / "results.json", {"sample": False, "experiment": {
        "name": "human10c", "smoke": False, "run_id": run,
        "headline": {"multiplied": {"successes": 3, "n": 40, "ci": [0.0258, 0.1986],
                                    "file": f"C:\\elsewhere\\evals\\{run}\\perfected_multiply_10.json"}},
        "data": {"physics_verified": 0, "repair": {"perfected": 3, "kept": 0, "discarded": 7},
                 "multiply": {"attempts": 30, "successes": 24, "yield": 0.8}}}})


def _ab(data: Path, name: str, rules: list[int], edits: list[int], p: float, cost: float) -> None:
    status = lambda ok: {id: ("perfected" if i in ok else "discarded") for i, id in enumerate(WEBCAM)}
    both = len(set(rules) & set(edits))
    _write(data / "human_exp" / name / "ab_summary.json", {
        "n": 10, "raw_pass": 0, "mcnemar_p": p, "nemotron_cost_usd": cost,
        "paired": {"both": both, "only_rules": len(rules) - both, "only_edits": len(edits) - both,
                   "neither": 10 - len(set(rules) | set(edits))},
        "arms": {"rules": {"pass": len(rules), "of": 10, "wilson_95": [0.1078, 0.6032], "status": status(rules)},
                 "nemotron-edits": {"pass": len(edits), "of": 10, "wilson_95": [0.2366, 0.7634], "status": status(edits)}}})


def _mouse(data: Path, results: dict | None = None) -> None:
    root = data / "human_exp" / "mouse20261020"
    _write(root / "config.json", {"name": "mouse20261020", "ids": MOUSE, "n_human": 10, "input": "mouse", "smoke": False})
    _physics(root, MOUSE, 10)
    if results is not None:
        _write(root / "results.json", results)


def _stores(data: Path, mouse_results: dict | None = None) -> Path:
    _webcam(data)
    _ab(data, "repair_ab1", rules=[2, 4, 8], edits=[1, 2, 4, 5, 8], p=0.5, cost=0.207)
    _ab(data, "repair_ab2", rules=[2, 4, 8], edits=[0, 2], p=1.0, cost=0.278)
    _mouse(data, mouse_results)
    return data


def _two_arms(raw: int, sant: int, p: float, *, smoke: bool = False) -> dict:
    return {"sample": smoke, "experiment": {"name": "mouse20261020", "smoke": smoke, "headline": {
        "raw": {"successes": raw, "n": 40, "ci": [0.1, 0.3]}, "multiplied": {"successes": sant, "n": 40, "ci": [0.3, 0.6]},
        "fisher_p": p, "significant": p < 0.05}}}


def _exp(out: dict, id: str) -> dict:
    return next(e for e in out["experiments"] if e["id"] == id)


def _arm(exp: dict, key: str) -> dict:
    return next(a for g in exp["groups"] for a in g["arms"] if a["key"] == key)


def test_webcam_pipeline_comes_from_the_human10c_store(bsr, tmp_path):
    out = bsr.build(_stores(tmp_path))
    e = _exp(out, "webcam")
    assert (_arm(e, "webcam_raw")["k"], _arm(e, "webcam_raw")["n"]) == (0, 10)
    assert (_arm(e, "webcam_repaired")["k"], _arm(e, "webcam_repaired")["n"]) == (3, 10)
    assert (_arm(e, "webcam_copies")["k"], _arm(e, "webcam_copies")["n"]) == (24, 30)
    policy = _arm(e, "webcam_policy")
    assert (policy["k"], policy["n"], policy["ci"]) == (3, 40, [0.0258, 0.1986])
    assert policy["drops"]["k"] == 26 and policy["drops"]["of"] == 37  # the eval file's own reasons
    assert all(a["source"] for g in e["groups"] for a in g["arms"])  # every number cites a note
    assert "one arm" in e["finding"].lower() and not any(g["comparisons"] for g in e["groups"])


def test_the_repair_ab_has_both_runs_and_the_demos_repaired_at_least_once(bsr, tmp_path):
    e = _exp(bsr.build(_stores(tmp_path)), "repair_ab")
    run1, run2, union = e["groups"]
    assert [(a["key"], a["k"]) for a in run1["arms"]] == [("ab1_rules", 3), ("ab1_edits", 5)]
    assert [(a["key"], a["k"]) for a in run2["arms"]] == [("ab2_rules", 3), ("ab2_edits", 2)]
    assert run1["comparisons"][0]["p"] == 0.5 and run2["comparisons"][0]["p"] == 1.0
    assert all("not significant" in g["comparisons"][0]["verdict"] for g in (run1, run2))
    assert [(a["key"], a["k"]) for a in union["arms"]] == [("union_rules", 3), ("union_edits", 6)]
    assert not union["comparisons"]  # two runs side by side, not a pooled test
    assert "$0.21" in e["finding"] and "$0.28" in e["finding"]


def test_the_mouse_comparison_is_pending_until_its_results_json_lands(bsr, tmp_path):
    e = _exp(bsr.build(_stores(tmp_path)), "mouse")
    assert (_arm(e, "mouse_replay")["k"], _arm(e, "mouse_replay")["n"]) == (10, 10)  # the physics markers
    assert _arm(e, "mouse_live")["k"] == 10
    assert _arm(e, "mouse_raw")["k"] is None and _arm(e, "mouse_sant")["k"] is None
    cmp = next(g for g in e["groups"] if g["comparisons"])["comparisons"][0]
    assert cmp["p"] is None
    assert "results.json" in e["finding"]


def test_the_mouse_comparison_fills_in_from_the_run_results(bsr, tmp_path):
    e = _exp(bsr.build(_stores(tmp_path, _two_arms(9, 21, 0.012))), "mouse")
    raw, sant = _arm(e, "mouse_raw"), _arm(e, "mouse_sant")
    assert (raw["k"], raw["n"], raw["ci"]) == (9, 40, [0.1, 0.3]) and (sant["k"], sant["ci"]) == (21, [0.3, 0.6])
    assert raw["source"] == {"file": "human_exp/mouse20261020/results.json"}
    cmp = next(g for g in e["groups"] if g["comparisons"])["comparisons"][0]
    assert cmp["p"] == 0.012 and cmp["verdict"].startswith("significant")


def test_a_smoke_run_never_fills_the_mouse_slot(bsr, tmp_path):
    e = _exp(bsr.build(_stores(tmp_path, _two_arms(9, 21, 0.012, smoke=True))), "mouse")
    assert _arm(e, "mouse_raw")["k"] is None


def test_the_mouse_live_facts_are_read_from_t4s_note_table(bsr, tmp_path):
    facts = bsr.build(_stores(tmp_path))["facts"]
    assert facts["mouse_path_mean_mm"]["text"] == "1.6–4.6 mm"
    assert facts["mouse_path_max_mm"]["text"] == "10.9 mm"
    assert facts["mouse_peak_n"]["text"] == "0.0 N"
    assert facts["webcam_peak_n"]["text"] == "927 N" and facts["webcam_pressed"]["text"] == "9/10"


def test_it_only_reads_the_stores(bsr, tmp_path):
    data = _stores(tmp_path, _two_arms(9, 21, 0.012))
    digest = lambda: {p: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(data.rglob("*")) if p.is_file()}
    before = digest()
    bsr.build(data)
    assert digest() == before


def test_a_missing_store_is_named(bsr, tmp_path):
    with pytest.raises(bsr.StoreError, match="human10c"):
        bsr.build(tmp_path)


def test_every_citation_quotes_its_note_lines(bsr):
    for key, c in bsr.CITES.items():
        lines = (REPO / bsr.NOTES[c["note"]]["path"]).read_text(encoding="utf-8").splitlines()
        lo, _, hi = c["lines"].partition("–")
        cited = "\n".join(lines[int(lo) - 1:int(hi or lo)])
        assert c["quote"] in cited, f"{key}: {c['quote']!r} is not on {c['note']} lines {c['lines']}"


def test_cli_writes_the_file_and_check_says_when_it_is_stale(bsr, tmp_path):
    data, out = _stores(tmp_path / "data"), tmp_path / "stores.json"
    assert bsr.main(["--data-dir", str(data), "--out", str(out)]) == 0
    assert json.loads(out.read_text(encoding="utf-8"))["experiments"]
    assert bsr.main(["--data-dir", str(data), "--out", str(out), "--check"]) == 0
    _mouse(data, _two_arms(9, 21, 0.012))  # T4's run lands
    assert bsr.main(["--data-dir", str(data), "--out", str(out), "--check"]) == 1
