"""demo_pipeline.media: the pure math behind the submission GIFs and contact sheet (no images needed)."""
from __future__ import annotations

import pytest

from demo_pipeline import media
from demo_pipeline.rules import TASK_TEXT
from demo_pipeline.schemas import Diagnosis


def _diag(issues=(), segments=(("approach", 0.0, 2.0), ("carry", 2.0, 5.0), ("retreat", 5.0, 8.0))):
    return Diagnosis.model_validate({
        "segments": [{"name": n, "t0": a, "t1": b} for n, a, b in segments],
        "issues": list(issues), "repairs": [], "decision": "repair" if issues else "keep", "label": TASK_TEXT})


# --- frame selection -------------------------------------------------------------------------------

def test_evenly_spaced_frames_include_the_first_and_last():
    assert media.select_frames(376, 6) == [0, 75, 150, 225, 300, 375]
    assert media.select_frames(4, 6) == [0, 1, 2, 3]  # never more frames than steps, never repeats
    assert media.select_frames(1, 6) == [0]
    with pytest.raises(ValueError):
        media.select_frames(0, 6)


def test_gif_frames_play_in_real_time():
    steps, ms = media.gif_frames(376, fps=50, gif_fps=10)
    assert steps[:3] == [0, 5, 10] and steps[-1] == 375  # every 5th step, and the last one
    assert len(ms) == len(steps) and all(m == 100 for m in ms[:-1])
    assert sum(ms) == pytest.approx(376 / 50 * 1000, abs=100)  # the GIF lasts as long as the episode


def test_gif_frames_are_thinned_to_a_cap_without_changing_the_length():
    steps, ms = media.gif_frames(3000, fps=50, gif_fps=10, max_frames=100)
    assert len(steps) == 100 and steps[0] == 0 and steps[-1] == 2999
    assert sum(ms) == pytest.approx(60_000, abs=100)
    assert all(m % 10 == 0 for m in ms)  # GIF delays are whole hundredths of a second


def test_side_by_side_pairs_hold_the_shorter_episodes_last_frame():
    pairs, ms = media.pair_frames(100, 200, fps=50, gif_fps=10)  # 2 s next to 4 s
    assert pairs[0] == (0, 0) and pairs[-1] == (99, 199)
    assert pairs[5] == (25, 25) and pairs[12] == (60, 60)
    assert pairs[25] == (99, 125)  # past 2 s, the left side holds its last frame
    assert len(ms) == len(pairs) and sum(ms) == pytest.approx(4000, abs=100)


# --- timeline geometry -----------------------------------------------------------------------------

def test_time_maps_onto_the_bar_inside_its_padding():
    bar = media.TimelineBar(width=384, duration=8.0, pad=8)
    assert bar.x(0.0) == 8 and bar.x(8.0) == 376 and bar.x(4.0) == 192
    assert bar.x(-1.0) == 8 and bar.x(99.0) == 376  # clipped to the bar


def test_layout_has_segment_bands_and_issue_marks_in_pixels():
    diag = _diag(issues=[{"type": "pause", "t0": 3.0, "t1": 4.0, "evidence": "e"},
                         {"type": "grasp_off_center", "t": 2.0, "evidence": "e"}])
    lay = media.timeline_layout(diag, duration=8.0, width=384, pad=8)
    assert [(s.label, s.x0, s.x1) for s in lay.segments] == [("approach", 8, 100), ("carry", 100, 238),
                                                             ("retreat", 238, 376)]
    pause, grasp = lay.issues
    assert (pause.label, pause.x0, pause.x1, pause.point) == ("pause", 146, 192, False)
    assert (grasp.label, grasp.x0, grasp.point) == ("grasp_off_center", 100, True)
    assert all(s.color.startswith("#") for s in lay.segments + lay.issues)


def test_layout_without_a_diagnosis_is_just_the_bar():
    lay = media.timeline_layout(None, duration=8.0, width=384)
    assert lay.segments == [] and lay.issues == []


def test_issues_past_the_episode_end_are_clipped_not_dropped():
    # A replay can be shorter than the diagnosed demo's timeline; the mark stays visible at the end.
    lay = media.timeline_layout(_diag(issues=[{"type": "idle_start_end", "t0": 7.5, "t1": 9.0, "evidence": "e"}]),
                                duration=8.0, width=384, pad=8)
    (idle,) = lay.issues
    assert idle.x0 == 353 and idle.x1 == 376


def test_cursor_follows_the_step_time():
    bar = media.TimelineBar(width=384, duration=7.5, pad=8)
    assert bar.x(media.step_time(375, fps=50)) == 376
    assert media.step_time(25, fps=50) == 0.5


def test_active_labels_name_the_segment_and_issues_at_a_time():
    diag = _diag(issues=[{"type": "pause", "t0": 3.0, "t1": 4.0, "evidence": "e"},
                         {"type": "jitter", "t0": 0.0, "t1": 8.0, "evidence": "e"}])
    assert media.active_labels(diag, 3.5) == ["carry", "pause", "jitter"]
    assert media.active_labels(diag, 1.0) == ["approach", "jitter"]
    assert media.active_labels(None, 1.0) == []


# --- diagnosis files -------------------------------------------------------------------------------

def test_load_diagnosis_reads_a_bare_or_a_stored_diagnosis():
    d = _diag()
    bare = d.model_dump(mode="json")
    assert media.load_diagnosis(bare) == d
    assert media.load_diagnosis({"source": "rules", "model_id": None, "diagnosis": bare, "gated": []}) == d
    with pytest.raises(ValueError):
        media.load_diagnosis({"status": "error"})


def test_a_point_issue_is_active_near_its_time():
    diag = _diag(issues=[{"type": "grasp_off_center", "t": 2.0, "evidence": "e"}])
    assert "grasp_off_center" in media.active_labels(diag, 2.2)
    assert "grasp_off_center" not in media.active_labels(diag, 2.5)


def test_side_by_side_timelines_share_one_time_scale():
    # 2 s next to 4 s: both bars span 4 s, so the shorter episode's end sits halfway along its bar.
    a, b = media.side_by_side_layouts((_diag(), None), n_a=100, n_b=200, fps=50, width=384, pad=8)
    assert a.bar.duration == b.bar.duration == 4.0
    assert a.bar.x(2.0) == 192 and a.segments[-1].x1 == 376  # retreat ends at 8 s: clipped to the bar's end


def test_a_finished_side_by_side_panel_stops_its_clock_at_its_own_end():
    assert media.panel_time(3.0, n_steps=200, fps=50) == (3.0, False)
    assert media.panel_time(5.0, n_steps=200, fps=50) == (3.98, True)  # its last step is at 199 / 50
    assert media.panel_time(3.98, n_steps=200, fps=50) == (3.98, False)


def test_every_curated_media_file_is_at_most_2_mb():
    # docs/media is for the README and the video: GitHub renders it inline, so each file stays <= 2 MB.
    from pathlib import Path

    root = Path(__file__).resolve().parents[1] / "docs" / "media"
    big = [(str(p.relative_to(root)), p.stat().st_size) for p in root.rglob("*") if p.is_file()
           and p.stat().st_size > 2 * 1024 * 1024]
    assert big == []
