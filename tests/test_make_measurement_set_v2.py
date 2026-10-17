"""scripts/make_measurement_set_v2.py: the balanced, pre-registered set for a fair Nemotron test (pure)."""
from __future__ import annotations

import hashlib
import json

import pytest

from demo_pipeline.schemas import Demo
from scripts import make_measurement_set_v2 as v2

PLAN_MIX = {"timing_off_center": 8, "timing_centered": 8, "drop": 6, "bad_release": 6, "clean": 4}
TIMING = {"pause", "slow", "idle_start_end", "jitter"}


def _read(path):
    return json.loads(path.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    out = tmp_path_factory.mktemp("data") / "sets" / "v2"
    return v2.build_set(out, n=32, seed=2000)


def _demos(set_dir):
    return _read(set_dir / "manifest.json")["demos"]


def test_the_mix_is_the_plans_table():
    assert v2.MIX == PLAN_MIX


def test_writes_32_demos_with_the_preregistered_mix(built):
    m = _read(built / "manifest.json")
    assert m["name"] == "v2" and m["seed"] == 2000 and m["n"] == 32 and m["skipped"] == []
    assert m["mix"] == PLAN_MIX
    demos = m["demos"]
    assert [d["id"] for d in demos] == [f"v2_{s:04d}" for s in range(2000, 2032)]
    assert [d["seed"] for d in demos] == list(range(2000, 2032))
    assert {t: sum(d["type"] == t for d in demos) for t in PLAN_MIX} == PLAN_MIX
    for d in demos:
        assert (built / d["id"] / "demo.json").is_file() and (built / d["id"] / "truth.json").is_file()


def test_types_are_shuffled_so_ids_do_not_give_them_away(built):
    types = [d["type"] for d in _demos(built)]
    runs = sum(1 for i in range(1, len(types)) if types[i] != types[i - 1]) + 1
    assert runs >= 12  # 5 blocks in a row would be 5 runs


def test_truth_matches_each_demos_type(built):
    for d in _demos(built):
        truth = _read(built / d["id"] / "truth.json")
        assert truth["type"] == d["type"] and truth["demo_id"] == d["id"] and truth["seed"] == d["seed"]
        kinds = {i["type"] for i in truth["issues"] if not i["dont_care"]}
        semantic = kinds - TIMING
        if d["type"] == "clean":
            assert kinds == set()
        elif d["type"] == "timing_off_center":
            assert semantic == {"grasp_off_center"} and "pause" in kinds
        elif d["type"] == "timing_centered":
            assert semantic == set() and "pause" in kinds  # a negative: timing issues, centered grasp
        else:
            assert semantic == {d["type"]} and "pause" in kinds


def test_settings_follow_the_type(built):
    for d in _demos(built):
        s = d["settings"]
        assert s["drop"] == (d["type"] == "drop")
        assert s["bad_release"] == ("outside" if d["type"] == "bad_release" else None)
        if d["type"] == "timing_off_center":
            assert 6.0 <= s["grasp_offset_mm"] <= 12.0  # well over T4's 3.3 mm tracking error
        else:
            assert s["grasp_offset_mm"] == 0.0
        if d["type"] == "clean":
            assert (s["jitter_mm"], s["n_pauses"], s["slow_factor"], s["idle_start_s"], s["idle_end_s"]) == (0, 0, 1, 0, 0)
        else:
            assert 1.0 <= s["jitter_mm"] <= 3.0 and s["n_pauses"] in (1, 2)


def test_demo_json_is_a_human_demo_of_its_scene(built):
    for d in _demos(built):
        demo = Demo.model_validate_json((built / d["id"] / "demo.json").read_text(encoding="utf-8"))
        assert demo.id == d["id"] and demo.source == "human" and demo.scene.seed == d["seed"]
        assert demo.human_seconds == pytest.approx(demo.trajectory.t[-1]) == pytest.approx(d["duration_s"])


def test_the_manifest_pins_every_demo_and_truth(built):
    for d in _demos(built):
        demo = Demo.model_validate_json((built / d["id"] / "demo.json").read_text(encoding="utf-8"))
        body = demo.model_dump_json(exclude={"created_at"}).encode()
        assert d["demo_sha256"] == hashlib.sha256(body).hexdigest()
        assert d["truth_sha256"] == hashlib.sha256((built / d["id"] / "truth.json").read_bytes()).hexdigest()


def test_a_rebuild_gives_the_same_manifest_bytes(built, tmp_path):
    again = v2.build_set(tmp_path / "sets" / "v2", n=32, seed=2000)
    assert (again / "manifest.json").read_bytes() == (built / "manifest.json").read_bytes()
    assert b"\r\n" not in (again / "manifest.json").read_bytes()  # the same bytes on every OS


def test_an_existing_set_is_never_replaced_unless_asked(built):
    with pytest.raises(FileExistsError):
        v2.build_set(built, n=32, seed=2000)


def test_overwrite_replaces_it(tmp_path):
    out = tmp_path / "sets" / "small"
    v2.build_set(out, n=5, seed=2000)
    (out / "stale.txt").write_text("x", encoding="utf-8")
    v2.build_set(out, n=5, seed=2000, overwrite=True)
    assert not (out / "stale.txt").exists()


def test_another_n_keeps_the_proportions_by_largest_remainder():
    assert v2.allocate(32) == PLAN_MIX
    assert v2.allocate(10) == {"timing_off_center": 3, "timing_centered": 2, "drop": 2, "bad_release": 2, "clean": 1}
    for n in range(1, 70):
        c = v2.allocate(n)
        assert sum(c.values()) == n
        assert all(abs(c[t] - n * k / 32) < 1 for t, k in PLAN_MIX.items())


def test_bad_names_and_sizes_are_refused(tmp_path):
    with pytest.raises(ValueError, match="name"):
        v2.build_set(tmp_path / "bad name", n=4, seed=0)
    with pytest.raises(ValueError, match="n"):
        v2.build_set(tmp_path / "v2", n=0, seed=0)


def test_the_cli_writes_the_set_and_prints_the_manifest_sha256(tmp_path, capsys):
    out = tmp_path / "sets" / "v2"
    v2.main(["--n", "5", "--seed", "2000", "--out", str(out)])
    printed = capsys.readouterr().out
    assert hashlib.sha256((out / "manifest.json").read_bytes()).hexdigest() in printed


FROZEN_V2_SHA256 = "21d82eac05a1977338350801aafc4ea52187daab99252a2cc93718c09ba07733"  # T1 note, 2026-10-16


def test_set_v2_is_frozen(built):
    """The set scored in sprint 5 is the one built on 2026-10-16. If this fails, a change to the expert,
    degrade or this script changed v2: build it under a new name; never rebuild v2 in place."""
    assert hashlib.sha256((built / "manifest.json").read_bytes()).hexdigest() == FROZEN_V2_SHA256
