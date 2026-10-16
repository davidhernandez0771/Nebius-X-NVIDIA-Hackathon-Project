"""demo_pipeline.scoring: diagnosis accuracy against injected ground truth, on hand-built cases."""
from __future__ import annotations

import pytest

from demo_pipeline.degrade import InjectedIssue
from demo_pipeline.rules import TASK_TEXT
from demo_pipeline.schemas import Diagnosis
from demo_pipeline.scoring import aggregate, score_diagnosis


def _diag(*issues) -> Diagnosis:
    return Diagnosis.model_validate({"segments": [], "issues": list(issues), "repairs": [],
                                     "decision": "repair" if issues else "keep", "label": TASK_TEXT})


def _rng(kind, t0, t1):
    return {"type": kind, "t0": t0, "t1": t1, "evidence": "e"}


def _pt(kind, t):
    return {"type": kind, "t": t, "evidence": "e"}


def _truth(kind, t0, t1=None):
    return InjectedIssue(type=kind, t0=t0, t1=t0 if t1 is None else t1)


def _counts(score, kind):
    s = score.per_type[kind]
    return s.tp, s.fp, s.fn


def test_exact_match_is_a_true_positive_with_iou_one():
    s = score_diagnosis(_diag(_rng("pause", 1.0, 2.0)), [_truth("pause", 1.0, 2.0)])
    p = s.per_type["pause"]
    assert (p.tp, p.fp, p.fn) == (1, 0, 0)
    assert (p.precision, p.recall, p.f1, p.mean_iou) == (1.0, 1.0, 1.0, 1.0)


def test_partial_overlap_above_the_threshold_matches_with_its_iou():
    s = score_diagnosis(_diag(_rng("pause", 1.0, 1.5)), [_truth("pause", 1.0, 2.0)])
    assert _counts(s, "pause") == (1, 0, 0)
    assert s.per_type["pause"].mean_iou == pytest.approx(0.5)


def test_overlap_below_the_threshold_is_a_false_positive_and_a_false_negative():
    s = score_diagnosis(_diag(_rng("pause", 1.8, 3.0)), [_truth("pause", 1.0, 2.0)])  # IoU 0.2 / 2.0 = 0.1
    assert _counts(s, "pause") == (0, 1, 1)
    p = s.per_type["pause"]
    assert (p.precision, p.recall, p.f1, p.mean_iou) == (0.0, 0.0, 0.0, None)


def test_the_threshold_is_a_parameter():
    d, t = _diag(_rng("pause", 1.0, 1.25)), [_truth("pause", 1.0, 2.0)]  # IoU 0.25
    assert _counts(score_diagnosis(d, t), "pause") == (0, 1, 1)
    assert _counts(score_diagnosis(d, t, iou_threshold=0.2), "pause") == (1, 0, 0)


def test_the_right_time_with_the_wrong_type_does_not_match():
    s = score_diagnosis(_diag(_rng("jitter", 1.0, 2.0)), [_truth("pause", 1.0, 2.0)])
    assert _counts(s, "pause") == (0, 0, 1)
    assert _counts(s, "jitter") == (0, 1, 0)


def test_point_issues_match_within_a_quarter_second_window():
    truth = [_truth("grasp_off_center", 3.0)]
    near = score_diagnosis(_diag(_pt("grasp_off_center", 3.1)), truth)  # [2.85, 3.35] vs [2.75, 3.25]
    assert _counts(near, "grasp_off_center") == (1, 0, 0)
    assert near.per_type["grasp_off_center"].mean_iou == pytest.approx(0.4 / 0.6)
    far = score_diagnosis(_diag(_pt("grasp_off_center", 3.5)), truth)  # touching windows, IoU 0
    assert _counts(far, "grasp_off_center") == (0, 1, 1)


def test_a_point_prediction_can_match_a_range_truth_and_vice_versa():
    s = score_diagnosis(_diag(_pt("drop", 2.0), _rng("grasp_off_center", 2.9, 3.2)),
                        [_truth("drop", 1.8, 2.3), _truth("grasp_off_center", 3.0)])
    assert _counts(s, "drop") == (1, 0, 0)  # [1.75, 2.25] vs [1.8, 2.3]
    assert _counts(s, "grasp_off_center") == (1, 0, 0)  # [2.9, 3.2] vs [2.75, 3.25]


def test_matching_is_one_to_one_and_prefers_the_best_overlap():
    s = score_diagnosis(_diag(_rng("pause", 1.0, 1.8), _rng("pause", 1.0, 2.0)), [_truth("pause", 1.0, 2.0)])
    p = s.per_type["pause"]
    assert (p.tp, p.fp, p.fn) == (1, 1, 0)
    assert p.mean_iou == pytest.approx(1.0)  # the exact one matched, not the first listed
    assert p.precision == pytest.approx(0.5) and p.recall == 1.0


def test_two_truths_two_predictions_cross_matched_correctly():
    s = score_diagnosis(_diag(_rng("pause", 4.0, 5.0), _rng("pause", 1.0, 2.0)),
                        [_truth("pause", 1.0, 2.0), _truth("pause", 4.1, 5.0)])
    assert _counts(s, "pause") == (2, 0, 0)
    assert s.per_type["pause"].mean_iou == pytest.approx((1.0 + 0.9) / 2)


def test_nothing_to_find_and_nothing_found_has_undefined_rates():
    s = score_diagnosis(_diag(), [])
    assert s.per_type == {}
    t = s.total
    assert (t.tp, t.fp, t.fn, t.precision, t.recall, t.f1, t.mean_iou) == (0, 0, 0, None, None, None, None)


def test_missing_everything_gives_zero_recall_and_undefined_precision():
    s = score_diagnosis(_diag(), [_truth("pause", 1.0, 2.0), _truth("jitter", 0.0, 8.0)])
    assert (s.total.tp, s.total.fn, s.total.precision, s.total.recall, s.total.f1) == (0, 2, None, 0.0, 0.0)


def test_total_sums_every_type():
    s = score_diagnosis(_diag(_rng("pause", 1.0, 2.0), _rng("jitter", 3.0, 3.5)),
                        [_truth("pause", 1.0, 2.0), _truth("slow", 0.0, 8.0)])
    t = s.total
    assert (t.tp, t.fp, t.fn) == (1, 1, 1)
    assert t.f1 == pytest.approx(2 * 1 / (2 * 1 + 1 + 1))


def test_aggregate_sums_counts_and_weights_iou_by_matches():
    a = score_diagnosis(_diag(_rng("pause", 1.0, 2.0)), [_truth("pause", 1.0, 2.0)])  # tp, IoU 1
    b = score_diagnosis(_diag(_rng("pause", 1.0, 1.5), _rng("jitter", 0.0, 1.0)), [_truth("pause", 1.0, 2.0)])
    c = score_diagnosis(_diag(), [_truth("idle_start_end", 0.0, 1.0)])
    agg = aggregate([a, b, c])
    assert _counts(agg, "pause") == (2, 0, 0)
    assert agg.per_type["pause"].mean_iou == pytest.approx(0.75)
    assert _counts(agg, "jitter") == (0, 1, 0)
    assert _counts(agg, "idle_start_end") == (0, 0, 1)
    assert (agg.total.tp, agg.total.fp, agg.total.fn) == (2, 1, 1)
    assert aggregate([]).total.tp == 0


def test_baseline_script_scores_the_rules_on_degraded_demos():
    from scripts.score_rules_on_degraded import run

    scores = run(n=8, seed0=0, jitter_levels=[0.0])
    s = scores[0.0]
    assert s.per_type["pause"].fn == 0 and s.per_type["pause"].tp > 0  # no tremor: every pause is found
    assert s.per_type["grasp_off_center"].tp == 0  # the rules never name a semantic issue
    assert s.per_type["grasp_off_center"].fn == 8
    again = run(n=8, seed0=0, jitter_levels=[0.0])[0.0]
    assert again == s  # seeded: the same demos every time


# --- don't-care truth (the expert's own stops) ---------------------------------------------------

def _dc(kind, t0, t1):
    return InjectedIssue(type=kind, t0=t0, t1=t1, dont_care=True)


def test_a_prediction_on_a_dont_care_stop_is_ignored_not_a_false_positive():
    s = score_diagnosis(_diag(_rng("pause", 5.0, 5.4)), [_dc("pause", 4.9, 5.3)])  # 75% inside
    p = s.per_type["pause"]
    assert (p.tp, p.fp, p.fn, p.ignored) == (0, 0, 0, 1)
    assert p.precision is None


def test_a_missed_dont_care_stop_is_not_a_false_negative():
    s = score_diagnosis(_diag(), [_dc("pause", 4.9, 5.3), _truth("pause", 1.0, 2.0)])
    assert (s.per_type["pause"].fn, s.per_type["pause"].ignored) == (1, 0)


def test_a_prediction_mostly_outside_the_dont_care_stop_is_still_a_false_positive():
    s = score_diagnosis(_diag(_rng("pause", 5.0, 6.0)), [_dc("pause", 4.9, 5.3)])  # 30% inside
    assert _counts(s, "pause") == (0, 1, 0) and s.per_type["pause"].ignored == 0


def test_real_truth_is_matched_before_dont_care_and_types_stay_separate():
    s = score_diagnosis(_diag(_rng("pause", 1.0, 2.0), _rng("jitter", 4.9, 5.3)),
                        [_truth("pause", 1.0, 2.0), _dc("pause", 1.0, 2.0)])
    assert _counts(s, "pause") == (1, 0, 0) and s.per_type["pause"].ignored == 0
    assert _counts(s, "jitter") == (0, 1, 0)  # a pause don't-care does not excuse a jitter finding


def test_aggregate_sums_ignored():
    a = score_diagnosis(_diag(_rng("pause", 5.0, 5.4)), [_dc("pause", 4.9, 5.3)])
    assert aggregate([a, a]).per_type["pause"].ignored == 2


def test_baseline_script_counts_the_expert_stops_it_flags_as_ignored_not_false():
    from scripts.score_rules_on_degraded import run

    s = run(n=80, seed0=0, jitter_levels=[0.0])[0.0].per_type["pause"]  # seeds 16, 53, 74, 75 hit slowed stops
    assert s.fp == 0 and s.ignored >= 4


def test_under_tremor_every_rules_pause_is_injected_or_an_expert_stop():
    from scripts.score_rules_on_degraded import run

    s = run(n=40, seed0=0, jitter_levels=[2.0])[2.0].per_type["pause"]
    assert s.fp == 0 and s.tp > 0 and s.ignored > 0
