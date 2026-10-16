"""scripts/make_experiment_set.py: synthetic webcam-like human demos with ground truth (pure, no sim)."""
from __future__ import annotations

import json

import numpy as np
import pytest

from demo_pipeline.degrade import InjectedIssue
from demo_pipeline.schemas import Demo
from scripts import make_experiment_set as mes


def _read(path):
    return json.loads(path.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    root = tmp_path_factory.mktemp("data")
    return root, mes.build_set("pilot", n=3, seed0=0, root=root)


def test_writes_demo_truth_and_manifest_per_seed(built):
    root, set_dir = built
    assert set_dir == root / "sets" / "pilot"
    ids = sorted(p.name for p in set_dir.iterdir() if p.is_dir())
    assert ids == ["pilot_0000", "pilot_0001", "pilot_0002"]
    for i in ids:
        assert (set_dir / i / "demo.json").is_file() and (set_dir / i / "truth.json").is_file()
    assert (set_dir / "manifest.json").is_file()


def test_demo_is_a_human_demo_timed_by_its_degraded_duration(built):
    _, set_dir = built
    for seed in range(3):
        demo = Demo.model_validate_json((set_dir / f"pilot_{seed:04d}" / "demo.json").read_text(encoding="utf-8"))
        assert demo.id == f"pilot_{seed:04d}" and demo.source == "human" and demo.parent_id is None
        assert demo.scene.seed == seed and demo.scene.robot == "franka"
        assert demo.human_seconds == pytest.approx(demo.trajectory.t[-1] - demo.trajectory.t[0])
        assert demo.human_seconds > 5.0  # the scripted expert alone takes ~8 s


def test_demo_and_truth_match_a_rebuild_from_the_seed(built):
    # The files hold exactly what make_demo(seed) produces: the set is reproducible from its seeds.
    _, set_dir = built
    for seed in range(3):
        demo, issues, settings = mes.make_demo("pilot", seed)
        stored = Demo.model_validate_json((set_dir / f"pilot_{seed:04d}" / "demo.json").read_text(encoding="utf-8"))
        np.testing.assert_array_equal(stored.trajectory.ee_pos, demo.trajectory.ee_pos)
        assert stored.scene == demo.scene
        truth = _read(set_dir / f"pilot_{seed:04d}" / "truth.json")
        assert truth["synthetic"] is True and truth["seed"] == seed and truth["settings"] == settings
        assert [InjectedIssue.model_validate(x) for x in truth["issues"]] == issues


def test_truth_issues_are_degrades_ground_truth_with_the_experts_stops(built):
    _, set_dir = built
    for seed in range(3):
        truth = _read(set_dir / f"pilot_{seed:04d}" / "truth.json")
        issues = [InjectedIssue.model_validate(x) for x in truth["issues"]]
        s = truth["settings"]
        assert sum(i.type == "pause" and not i.dont_care for i in issues) == s["n_pauses"]
        assert any(i.type == "jitter" for i in issues) == (s["jitter_mm"] > 0)
        assert any(i.type == "grasp_off_center" for i in issues) == (s["grasp_offset_mm"] > 0)
        assert any(i.type == "slow" for i in issues) == (s["slow_factor"] > 1)
        assert any(i.dont_care for i in issues)  # the scripted expert's waypoint stops


def test_manifest_records_the_set_and_its_mix(built):
    _, set_dir = built
    m = _read(set_dir / "manifest.json")
    assert m["name"] == "pilot" and m["n"] == 3 and m["seed0"] == 0 and m["robot"] == "franka"
    assert m["synthetic"] is True and m["skipped"] == []
    assert [d["id"] for d in m["demos"]] == ["pilot_0000", "pilot_0001", "pilot_0002"]
    assert all(d["settings"] == _read(set_dir / d["id"] / "truth.json")["settings"] for d in m["demos"])
    assert m["mix_rules"] == mes.MIX_RULES
    # realized counts of each injected issue type over the set's demos
    counts = {}
    for d in m["demos"]:
        for x in _read(set_dir / d["id"] / "truth.json")["issues"]:
            if not x["dont_care"]:
                counts[x["type"]] = counts.get(x["type"], 0) + 1
    assert m["issue_counts"] == counts


def test_the_mix_varies_across_seeds():
    # Over 60 seeds (the planned set size) every knob is both on and off somewhere.
    settings = [mes.settings_for(np.random.default_rng(seed)) for seed in range(60)]
    for key, off in [("jitter_mm", 0.0), ("grasp_offset_mm", 0.0), ("slow_factor", 1.0),
                     ("idle_start_s", 0.0), ("idle_end_s", 0.0)]:
        values = [s[key] for s in settings]
        assert any(v == off for v in values) and any(v != off for v in values), key
    assert {s["n_pauses"] for s in settings} == {0, 1, 2}
    assert all(1.0 <= s["jitter_mm"] <= 3.0 for s in settings if s["jitter_mm"] > 0)


def test_some_seeds_are_clean_demos_for_the_keep_path():
    # Independent knobs almost never leave a demo clean (~0.5%); the set needs keep cases too.
    settings = [mes.settings_for(np.random.default_rng(seed)) for seed in range(60)]
    clean = [s for s in settings if s["n_pauses"] == 0 and s["grasp_offset_mm"] == 0 and s["slow_factor"] == 1
             and s["idle_start_s"] == 0 and s["idle_end_s"] == 0]
    assert 5 <= len(clean) <= 20
    assert any(s["jitter_mm"] > 0 for s in clean)  # webcam tremor alone is still a "clean" human demo
    assert all(s["clean"] == (s in clean) for s in settings)


def test_refuses_to_overwrite_an_existing_set_unless_asked(tmp_path):
    mes.build_set("again", n=1, seed0=5, root=tmp_path)
    with pytest.raises(FileExistsError):
        mes.build_set("again", n=1, seed0=5, root=tmp_path)
    set_dir = mes.build_set("again", n=2, seed0=7, root=tmp_path, overwrite=True)
    assert sorted(p.name for p in set_dir.iterdir() if p.is_dir()) == ["again_0007", "again_0008"]


@pytest.mark.parametrize("name", ["", "a/b", "..", "bad name"])
def test_rejects_set_names_that_are_not_folder_safe(tmp_path, name):
    with pytest.raises(ValueError):
        mes.build_set(name, n=1, seed0=0, root=tmp_path)


def test_a_seed_degrade_cannot_place_is_skipped_and_recorded(tmp_path, monkeypatch):
    real = mes.degrade

    def picky(traj, rng, **kw):
        if kw["n_pauses"] > 0:
            raise ValueError("degrade: no room for 1 pauses in a 1.00 s demo")
        return real(traj, rng, **kw)

    monkeypatch.setattr(mes, "degrade", picky)
    set_dir = mes.build_set("picky", n=6, seed0=0, root=tmp_path)
    m = _read(set_dir / "manifest.json")
    kept = {d["id"] for d in m["demos"]}
    skipped = {s["id"] for s in m["skipped"]}
    assert skipped and kept and not kept & skipped and len(kept | skipped) == 6
    assert all("no room" in s["error"] for s in m["skipped"])
    assert sorted(p.name for p in set_dir.iterdir() if p.is_dir()) == sorted(kept)


def test_data_dir_is_the_default_root(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "dd"))
    assert mes.build_set("envroot", n=1, seed0=0) == tmp_path / "dd" / "sets" / "envroot"


def test_cli_builds_the_set_and_prints_a_summary(tmp_path, capsys):
    mes.main(["--name", "cli", "--n", "2", "--seed0", "3", "--root", str(tmp_path)])
    out = capsys.readouterr().out
    assert (tmp_path / "sets" / "cli" / "manifest.json").is_file()
    assert "cli" in out and "2 demos" in out


def test_a_seed_whose_draws_are_all_off_is_flagged_clean_too():
    # Seed 98 is not forced clean (its first draw is above 1/6), but every issue knob drew "off".
    assert np.random.default_rng(98).random() >= 1 / 6
    s = mes.settings_for(np.random.default_rng(98))
    assert s["clean"] is True and s["n_pauses"] == 0 and s["slow_factor"] == 1.0
