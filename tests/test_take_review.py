"""The take review (demo_pipeline.take_review) on the user's real takes (tests/fixtures/takes: 2026-10-20 mouse takes
with the soft floor, 2026-10-19 webcam takes that pressed into the bin), its Nemotron number check, and
GET /demos/{id}/take-review."""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
import pytest

from demo_pipeline.episode_io import save_signals
from demo_pipeline.schemas import Demo, SimSignals
from demo_pipeline.store import DemoStore
from demo_pipeline.take_review import (
    TakeFacts,
    allowed_numbers,
    check_numbers,
    coach_lines,
    phrase_review,
    review_take,
    take_facts,
)

FIXTURES = Path(__file__).parent / "fixtures" / "takes"
MOUSE_FLOOR = "human_20261020183738_00ab"  # clean, the floor held 39 steps
MOUSE_NO_FLOOR = "human_20261020184117_dc3e"  # clean, floor on but never needed
WEBCAM_927 = "human_20261019185902_c045"  # the 927 N press
WEBCAM_DROP = "human_20261019185341_0576"  # dropped outside the bin, no pushing
WEBCAM_REGRASP = "human_20261019185745_a67b"  # 531 N, dropped, 5 regrasps


def load_take(id: str) -> tuple[Demo, SimSignals, np.ndarray]:
    raw = json.loads((FIXTURES / f"{id}.json").read_text(encoding="utf-8"))
    s = raw["signals"]
    signals = SimSignals(
        cube_pos=np.asarray(s["cube_pos"]), contact_gripper_cube=np.asarray(s["contact_gripper_cube"]),
        contact_arm_bin=np.asarray(s["contact_arm_bin"]), contact_arm_table=np.asarray(s["contact_arm_table"]),
        max_contact_force=np.asarray(s["max_contact_force"]),
    )
    return Demo.model_validate(raw["demo"]), signals, np.asarray(raw["reached"])


def facts(id: str) -> TakeFacts:
    return take_facts(*load_take(id))


# --- the facts, on real takes ---------------------------------------------------------------------

def test_a_clean_mouse_take_with_the_floor():
    f = facts(MOUSE_FLOOR)
    assert f.success and f.reasons == []
    assert f.peak_force_n == 0 and f.peak_force_t is None and f.peak_force_against is None
    assert (f.soft_floor, f.soft_floor_steps) == (True, 39)
    assert [(g.offset_mm, g.caught) for g in f.grabs] == [(6, True)]
    assert [(r.over_rim_mm, r.over_bin) for r in f.releases] == [(-52, True)]  # the cube's bottom 5 cm under the rim
    assert f.regrasps == 0 and f.duration_s == 8.3 and f.input == "mouse"


def test_the_927_newton_press():
    f = facts(WEBCAM_927)
    assert not f.success and f.reasons == ["collision"]
    assert (f.peak_force_n, f.peak_force_t, f.peak_force_against) == (927, 7.8, "bin")
    assert f.soft_floor is None and f.soft_floor_steps == 0  # recorded before the soft floor existed
    assert [(g.offset_mm, g.caught) for g in f.grabs] == [(1, True)]


def test_a_drop_outside_the_bin_with_grabs_that_didnt_hold():
    f = facts(WEBCAM_DROP)
    assert f.reasons == ["dropped"] and f.peak_force_n == 0
    assert [(g.offset_mm, g.caught) for g in f.grabs] == [(16, False), (23, False), (10, False), (7, True)]
    assert f.regrasps == 3
    assert [(r.over_rim_mm, r.over_bin) for r in f.releases] == [(-90, False)]


def test_regrasps_and_pushing_together():
    f = facts(WEBCAM_REGRASP)
    assert f.reasons == ["collision", "dropped"]
    assert (f.peak_force_n, f.peak_force_t) == (531, 14.9)
    assert f.regrasps == 5 and sum(not g.caught for g in f.grabs) == 4


def test_grab_offsets_use_the_reached_path_not_the_hand_targets():
    """The 10-19 takes stored the hand targets as their trajectory, up to 12 cm from where the arm was."""
    demo, sim, reached = load_take(WEBCAM_927)
    assert take_facts(demo, sim, reached).grabs[0].offset_mm == 1
    assert take_facts(demo, sim).grabs[0].offset_mm == 76  # the target, not the fingers
    with pytest.raises(ValueError, match="reached"):
        take_facts(demo, sim, reached[:-1])


@pytest.mark.parametrize("id", [MOUSE_FLOOR, WEBCAM_927])
def test_the_fixtures_match_the_live_takes_when_they_are_here(id):
    """The fixtures are rounded copies of data/demos (git-ignored): same facts as the originals, where present."""
    root = Path(__file__).parents[1] / "data"
    if not (root / "demos" / id / "episode" / "signals.npz").is_file():
        pytest.skip("the original take isn't on this machine")
    from demo_pipeline.episode_io import load_signals

    store = DemoStore(root)
    original = take_facts(store.get_demo(id), load_signals(store.episode_dir(id)),
                          np.load(store.episode_dir(id) / "steps.npz")["ee_pos"])
    assert facts(id) == original


# --- the rules' lines -----------------------------------------------------------------------------

def test_the_lines_for_a_clean_take():
    assert coach_lines(facts(MOUSE_FLOOR)) == [
        "Clean take: the cube is in the bin (8.3 s).",
        "No pushing; the floor held you 39 times.",
        "Grab 6 mm off-centre.",
        "Let go 52 mm below the rim.",
    ]
    assert coach_lines(facts(MOUSE_NO_FLOOR))[1] == "No pushing."


def test_the_lines_for_the_press():
    lines = coach_lines(facts(WEBCAM_927))
    assert lines[0] == "Not verified: the arm pushed over 5 N."
    assert lines[1] == "Pushed 927 N into the bin at 7.8 s (the limit is 5 N): ease off when it touches."


def test_the_lines_for_the_drop():
    lines = coach_lines(facts(WEBCAM_DROP))
    assert lines[0] == "Not verified: the cube slipped out on the way."
    assert lines[2] == "Grab 7 mm off-centre (3 regrasps, 3 didn't hold)."  # the grab that held
    assert lines[3] == "Let go 90 mm below the rim, outside the bin."


def test_a_far_grab_and_a_high_release_get_a_tip():
    f = facts(MOUSE_FLOOR)
    far = f.model_copy(update={"grabs": [f.grabs[0].model_copy(update={"offset_mm": 14})],
                               "releases": [f.releases[0].model_copy(update={"over_rim_mm": 80})]})
    lines = coach_lines(far)
    assert lines[2] == "Grab 14 mm off-centre: line up over the cube before you close."
    assert lines[3] == "Let go 80 mm above the rim: lower it first."


@pytest.mark.parametrize("id", [MOUSE_FLOOR, MOUSE_NO_FLOOR, WEBCAM_927, WEBCAM_DROP, WEBCAM_REGRASP])
def test_always_two_to_four_short_lines_whose_numbers_are_the_facts(id):
    f = facts(id)
    lines = coach_lines(f)
    assert 2 <= len(lines) <= 4 and all(len(x) <= 120 for x in lines)
    assert check_numbers(lines, f) is None


# --- Nemotron's phrasing, checked -----------------------------------------------------------------

def reply(lines) -> callable:
    return lambda prompt, *, system: SimpleNamespace(text=json.dumps(lines) if not isinstance(lines, str) else lines)


def test_nemotrons_lines_are_used_when_every_number_is_a_fact():
    f = facts(MOUSE_FLOOR)
    mine = ["Nice and clean: in the bin in 8.3 s.", "You never pushed; the floor caught you 39 times.", "Grab was 6 mm off."]
    assert phrase_review(f, reply(mine)) == (mine, None)


@pytest.mark.parametrize("lines, why", [
    (["Clean take in 8.3 s.", "The floor held you 40 times."], "40"),  # a wrong number
    (["Clean take in 8 seconds.", "Grab 6.4 mm off-centre."], "6.4"),  # invented precision
    (["Clean take."], "1 lines"),
    (["a", "b", "c", "d", "e"], "5 lines"),
    (["Clean take.", "x" * 130], "over 120"),
    ("not json", "JSONDecodeError"),
    ({"lines": []}, "not a list"),
])
def test_a_reply_that_doesnt_check_out_falls_back_to_the_rules(lines, why):
    f = facts(MOUSE_FLOOR)
    used, rejected = phrase_review(f, reply(lines))
    assert used == coach_lines(f)
    assert why in rejected


def test_a_failing_model_call_falls_back_too():
    def boom(prompt, *, system):
        raise TimeoutError("no answer")

    f = facts(WEBCAM_927)
    assert phrase_review(f, boom) == (coach_lines(f), "TimeoutError: no answer")


def test_the_prompt_carries_the_facts_and_the_rules_lines():
    seen = {}

    def spy(prompt, *, system):
        seen["prompt"], seen["system"] = json.loads(prompt), system
        return SimpleNamespace(text="[]")

    f = facts(MOUSE_FLOOR)
    phrase_review(f, spy)
    assert seen["prompt"]["facts"]["soft_floor_steps"] == 39 and seen["prompt"]["lines"] == coach_lines(f)
    assert "never invent" in seen["system"]


def test_the_allowed_numbers_are_the_facts_as_shown():
    ok = allowed_numbers(facts(WEBCAM_927))
    assert {927, 7.8, 5, 1, 76.0} <= ok  # force, when, the limit, the grab offset is 1 mm, the release 76 mm
    assert 928 not in ok


def test_review_take_says_which_text_it_used():
    demo, sim, reached = load_take(MOUSE_FLOOR)
    assert review_take(demo, sim, reached=reached).model_dump(include={"verdict", "source", "rejected"}) == {
        "verdict": "PASS", "source": "rules", "rejected": None}
    bad = review_take(demo, sim, reply(["In 9 s.", "Ok."]), reached=reached)
    assert (bad.source, bad.lines) == ("rules", coach_lines(bad.facts)) and "9" in bad.rejected
    good = review_take(demo, sim, reply(["Clean, 8.3 s.", "No pushing."]), reached=reached)
    assert (good.source, good.lines) == ("nemotron", ["Clean, 8.3 s.", "No pushing."])


# --- GET /demos/{id}/take-review ----------------------------------------------------------------

@pytest.fixture
def take_api(api, monkeypatch, tmp_path):
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    store = DemoStore(tmp_path / "data")

    def put(id: str, *, signals: bool = True, steps: bool = True):
        demo, sim, reached = load_take(id)
        store.save_demo(demo)
        ep = store.episode_dir(id)
        ep.mkdir(parents=True, exist_ok=True)
        if signals:
            save_signals(ep, sim)
        if steps:
            np.savez(ep / "steps.npz", ee_pos=reached)
        return demo

    return api, put


def test_the_route_reviews_a_saved_take(take_api):
    api, put = take_api
    put(MOUSE_FLOOR)
    r = api.get(f"/demos/{MOUSE_FLOOR}/take-review")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["verdict"] == "PASS" and body["source"] == "rules" and body["rejected"] is None
    assert body["lines"][1] == "No pushing; the floor held you 39 times."
    assert body["facts"]["soft_floor_steps"] == 39 and body["facts"]["grabs"] == [{"t": 3.62, "offset_mm": 6, "caught": True}]


def test_the_route_uses_the_reached_path_when_the_episode_has_it(take_api):
    api, put = take_api
    put(WEBCAM_927)
    assert api.get(f"/demos/{WEBCAM_927}/take-review").json()["facts"]["grabs"][0]["offset_mm"] == 1


def test_the_route_with_nemotron_checks_its_numbers(take_api):
    api, put = take_api
    put(WEBCAM_927)
    with patch("app.routers.demos.chat", return_value=SimpleNamespace(text=json.dumps(["Pushed 900 N.", "Ease off."]))):
        body = api.get(f"/demos/{WEBCAM_927}/take-review", params={"phrasing": "nemotron"}).json()
    assert body["verdict"] == "FAIL" and body["source"] == "rules" and "900" in body["rejected"]
    good = ["You pressed 927 N into the bin at 7.8 s.", "Stop when it touches: the limit is 5 N."]
    with patch("app.routers.demos.chat", return_value=SimpleNamespace(text=json.dumps(good))) as chat:
        body = api.get(f"/demos/{WEBCAM_927}/take-review", params={"phrasing": "nemotron"}).json()
    assert (body["source"], body["lines"]) == ("nemotron", good)
    assert chat.call_args.kwargs["tier"] == "nano"


def test_the_route_refuses_what_it_cannot_review(take_api):
    api, put = take_api
    assert api.get("/demos/nope/take-review").status_code == 404
    put(MOUSE_FLOOR, signals=False)
    assert api.get(f"/demos/{MOUSE_FLOOR}/take-review").status_code == 409
    assert api.get(f"/demos/{MOUSE_FLOOR}/take-review", params={"phrasing": "shakespeare"}).status_code == 422


def test_the_route_reports_a_take_that_doesnt_add_up(take_api, tmp_path):
    api, put = take_api
    demo = put(MOUSE_FLOOR, signals=False)
    _, sim, _ = load_take(WEBCAM_927)  # another take's signals: a different number of steps
    save_signals(DemoStore(tmp_path / "data").episode_dir(demo.id), sim)
    r = api.get(f"/demos/{MOUSE_FLOOR}/take-review")
    assert r.status_code == 422 and "steps" in r.json()["detail"]


def test_without_steps_the_trajectory_is_used(take_api):
    api, put = take_api
    put(MOUSE_FLOOR, steps=False)
    assert api.get(f"/demos/{MOUSE_FLOOR}/take-review").json()["facts"]["grabs"][0]["offset_mm"] == 6  # same path
