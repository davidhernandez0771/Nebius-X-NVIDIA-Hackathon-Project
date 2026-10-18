"""Labeler and judge (pure parts): schemas, trajectory summary, frame sampling, perturbations,
code baselines and scoring. The Nemotron calls are tested in test_intent_ai.py."""
from __future__ import annotations

import json

import numpy as np
import pytest

from demo_pipeline.intent import (
    IntentError,
    Label,
    Verdict,
    code_judge,
    code_label,
    cube_color,
    cube_in_bin,
    parse_label,
    parse_verdict,
    recolor_cube,
    reverse_trajectory,
    sample_indices,
    score_label,
    summarize,
    truth_events,
)
from demo_pipeline.schemas import Trajectory

FPS = 50


def traj(n=200, close=60, open_=150, z_close=0.03, z_open=0.25):
    """A pick-and-place: down to the cube, close, up and over, open above the bin."""
    t = [i / FPS for i in range(n)]
    pos = []
    for i in range(n):
        if i < close:
            z = 0.3 - (0.3 - z_close) * i / close
        elif i < open_:
            z = z_close + (z_open - z_close) * (i - close) / (open_ - close)
        else:
            z = z_open
        pos.append([0.5, -0.2 + 0.4 * i / n, z])
    grip = [1 if close <= i < open_ else 0 for i in range(n)]
    return Trajectory(t=t, ee_pos=pos, ee_quat=[[1.0, 0, 0, 0]] * n, gripper=grip)


# --- images: a 32x32 table with a blue bin on the left and a red cube --------------------------

TABLE = (235, 235, 235)
BIN = (40, 140, 230)
RED = (220, 40, 40)


def scene(cube_xy=(24, 20), in_bin=False, color=RED):
    img = np.full((32, 32, 3), TABLE, dtype=np.uint8)
    img[14:26, 2:12] = BIN
    x, y = (6, 19) if in_bin else cube_xy
    img[y : y + 3, x : x + 3] = color
    return img


# --- sampling and summary ------------------------------------------------------------------------


def test_sample_indices_spans_the_clip_evenly_and_keeps_both_ends():
    assert sample_indices(458, 8) == [0, 65, 131, 196, 261, 326, 392, 457]
    assert sample_indices(5, 8) == [0, 1, 2, 3, 4]
    assert sample_indices(1, 4) == [0]


def test_summary_finds_the_gripper_events_and_the_heights_there():
    s = summarize(traj(), FPS)
    assert (s.n_frames, s.close_frames, s.open_frames) == (200, [60], [150])
    assert s.z_at_close == pytest.approx(0.03)
    assert s.z_at_open == pytest.approx(0.25)
    text = s.render()
    assert "frame 60" in text and "frame 150" in text and "1.20 s" in text


def test_truth_events_are_the_first_close_and_the_open_after_it():
    assert truth_events(traj()) == (60, 150)
    with pytest.raises(IntentError):
        truth_events(traj(close=300, open_=300))  # never closes


# --- perturbations -------------------------------------------------------------------------------


def test_reversal_plays_the_demo_backwards_with_time_still_increasing():
    r = reverse_trajectory(traj())
    assert r.t[0] == 0 and all(b > a for a, b in zip(r.t, r.t[1:]))
    assert r.ee_pos[0] == traj().ee_pos[-1]
    s = summarize(r, FPS)
    assert (s.close_frames, s.open_frames) == ([50], [140])  # 199 - 149, 199 - 59
    assert s.z_at_close > s.z_at_open  # it now "grasps" above the bin and lets go on the table


def test_recolor_turns_only_the_red_cube_green():
    img = scene()
    out = recolor_cube(img)
    assert cube_color([out]) == "green"
    assert (out[14:26, 2:12] == BIN).all() and (out[0, 0] == TABLE).all()
    assert cube_color([img]) == "red"


# --- pixel rules ---------------------------------------------------------------------------------


def test_cube_in_bin_reads_where_the_red_pixels_sit():
    assert cube_in_bin(scene(in_bin=True)) is True
    assert cube_in_bin(scene(in_bin=False)) is False
    empty = np.full((32, 32, 3), TABLE, dtype=np.uint8)
    assert cube_in_bin(empty) is None  # no cube in view


def test_code_label_reads_colour_and_destination():
    frames = [scene(), scene(cube_xy=(16, 10)), scene(in_bin=True)]
    lab = code_label(frames, summarize(traj(), FPS))
    assert (lab.object.color, lab.destination) == ("red", "bin")
    assert [s.name for s in lab.steps] == ["reach", "grasp", "carry", "release"]
    assert lab.steps[1].frames[0] == 60 and lab.steps[3].frames[0] == 150


def test_code_judge_flags_object_goal_order_and_outcome():
    human = ([scene(), scene(in_bin=True)], summarize(traj(), FPS))
    good = code_judge(human, ([scene(cube_xy=(20, 6)), scene(in_bin=True)], summarize(traj(), FPS)))
    assert good.matches == "yes"
    green = code_judge(human, ([recolor_cube(scene()), recolor_cube(scene(in_bin=True))], summarize(traj(), FPS)))
    assert (green.matches, green.same_object) == ("no", False)
    backwards = code_judge(human, ([scene(in_bin=True), scene()], summarize(reverse_trajectory(traj()), FPS)))
    assert (backwards.matches, backwards.same_goal, backwards.same_order) == ("no", False, False)
    dropped = code_judge(human, ([scene(), scene(cube_xy=(20, 26))], summarize(traj(), FPS)))
    assert (dropped.matches, dropped.copy_completes) == ("no", False)


# --- parsing the model's replies ------------------------------------------------------------------

GOOD_LABEL = {
    "task": "pick up the red cube and put it in the blue bin",
    "object": {"name": "cube", "color": "red"},
    "destination": "bin",
    "objects": [{"name": "cube", "color": "red"}, {"name": "bin", "color": "blue"}],
    "steps": [
        {"name": "reach", "frames": [0, 59]},
        {"name": "grasp", "frames": [60, 80]},
        {"name": "carry", "frames": [81, 149]},
        {"name": "release", "frames": [150, 199]},
    ],
    "confidence": 0.8,
}


def test_parse_label_accepts_fenced_json_and_checks_frames():
    lab = parse_label("```json\n" + json.dumps(GOOD_LABEL) + "\n```", n_frames=200)
    assert isinstance(lab, Label) and lab.destination == "bin"
    with pytest.raises(IntentError, match="frame"):
        parse_label(json.dumps(GOOD_LABEL), n_frames=100)
    shuffled = {**GOOD_LABEL, "steps": [GOOD_LABEL["steps"][i] for i in (1, 0, 2, 3)]}
    with pytest.raises(IntentError, match="order"):
        parse_label(json.dumps(shuffled), n_frames=200)
    with pytest.raises(IntentError):
        parse_label("not json", n_frames=200)


GOOD_VERDICT = {
    "same_object": True,
    "same_goal": True,
    "same_order": True,
    "copy_completes": True,
    "matches": "yes",
    "reason": "Both pick up the red cube and drop it in the blue bin.",
    "confidence": 0.9,
}


def test_parse_verdict_requires_matches_to_agree_with_the_checks():
    assert parse_verdict(json.dumps(GOOD_VERDICT)).matches == "yes"
    with pytest.raises(IntentError, match="matches"):
        parse_verdict(json.dumps({**GOOD_VERDICT, "same_goal": False}))
    v = parse_verdict(json.dumps({**GOOD_VERDICT, "same_goal": False, "matches": "no"}))
    assert isinstance(v, Verdict) and v.matches == "no"


# --- scoring -------------------------------------------------------------------------------------


def test_score_label_checks_colour_destination_and_both_boundaries():
    lab = parse_label(json.dumps(GOOD_LABEL), n_frames=200)
    s = score_label(lab, color="red", destination="bin", events=(60, 150), fps=FPS)
    assert s == {"color": True, "destination": True, "task": True, "steps": True}
    late = {**GOOD_LABEL, "steps": [*GOOD_LABEL["steps"][:3], {"name": "release", "frames": [180, 199]}]}
    s = score_label(parse_label(json.dumps(late), n_frames=200), color="green", destination="bin", events=(60, 150), fps=FPS)
    assert s == {"color": False, "destination": True, "task": False, "steps": False}  # 30 frames = 0.6 s off


# --- the Review verdict card -----------------------------------------------------------------------

from demo_pipeline.intent import review_verdict  # noqa: E402
from demo_pipeline.schemas import VerificationResult  # noqa: E402

PASSED = VerificationResult(success=True, reasons=[], duration=4.0, path_length=1.2, max_contact_force=0.0)
FAILED = VerificationResult(success=False, reasons=["not_in_bin", "dropped"], duration=4.0, path_length=1.2, max_contact_force=0.0)


def test_card_for_a_verified_copy_that_matches():
    card = review_verdict(PASSED, label=parse_label(json.dumps(GOOD_LABEL), 200), verdict=parse_verdict(json.dumps(GOOD_VERDICT)))
    assert card.physics.status == "verified" and card.physics.reasons == []
    assert card.label.status == "ok" and card.label.task.startswith("pick up the red cube")
    assert (card.match.status, card.match.reason) == ("yes", GOOD_VERDICT["reason"])
    assert card.conflict is None


def test_physics_decides_success_and_a_disagreement_is_flagged():
    card = review_verdict(FAILED, label=None, verdict=parse_verdict(json.dumps(GOOD_VERDICT)))
    assert card.physics.status == "failed" and card.physics.reasons == ["not_in_bin", "dropped"]
    assert card.match.status == "not_checked"  # a failed copy is not kept, whatever the model says
    assert "physics decides" in card.conflict
    no = parse_verdict(json.dumps({**GOOD_VERDICT, "copy_completes": False, "matches": "no"}))
    assert "physics decides" in review_verdict(PASSED, label=None, verdict=no).conflict


def test_a_missing_reply_is_unavailable_not_a_no():
    card = review_verdict(PASSED, label=None, verdict=None, label_error="no valid labeler reply", verdict_error="timeout")
    assert (card.label.status, card.match.status) == ("unavailable", "unavailable")
    assert card.match.reason == "timeout"
    human = review_verdict(PASSED, label=parse_label(json.dumps(GOOD_LABEL), 200), verdict=None)
    assert human.match.status == "not_checked"  # the human demo itself: nothing to compare with


def test_the_card_never_carries_the_model_confidence():
    card = review_verdict(PASSED, label=parse_label(json.dumps(GOOD_LABEL), 200), verdict=parse_verdict(json.dumps(GOOD_VERDICT)))
    assert "confidence" not in json.dumps(card.model_dump())
