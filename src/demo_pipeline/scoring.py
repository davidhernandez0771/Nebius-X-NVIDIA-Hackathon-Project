"""Scoring: how well a diagnosis finds the injected issues (degrade's ground truth).

Per issue type, predictions and truths are matched one-to-one, best time IoU first; a pair counts
when its IoU reaches the threshold. A point issue (`t`, or a truth with t0 == t1) is scored as
the interval t +- POINT_HALF_S, half a metrics window. Rates are None when undefined (0 / 0).
"""

from __future__ import annotations

from collections.abc import Iterable

from pydantic import Field

from .degrade import InjectedIssue
from .schemas import Diagnosis, Issue, _Model

POINT_HALF_S = 0.25
DONT_CARE_INSIDE = 0.5  # a leftover prediction at least this much inside a dont_care truth is ignored
_TOL = 1e-12
Interval = tuple[float, float]


class TypeScore(_Model):
    tp: int = 0
    fp: int = 0
    fn: int = 0
    iou_sum: float = 0.0  # over the matched pairs
    ignored: int = 0  # unmatched predictions on a dont_care truth (the expert's own stops): neither TP nor FP

    @property
    def precision(self) -> float | None:
        return self.tp / (self.tp + self.fp) if self.tp + self.fp else None

    @property
    def recall(self) -> float | None:
        return self.tp / (self.tp + self.fn) if self.tp + self.fn else None

    @property
    def f1(self) -> float | None:
        d = 2 * self.tp + self.fp + self.fn
        return 2 * self.tp / d if d else None

    @property
    def mean_iou(self) -> float | None:
        return self.iou_sum / self.tp if self.tp else None

    def report(self) -> dict:
        """Counts and rates as plain JSON values (rates None when undefined)."""
        return {"tp": self.tp, "fp": self.fp, "fn": self.fn, "ignored": self.ignored, "precision": self.precision,
                "recall": self.recall, "f1": self.f1, "mean_iou": self.mean_iou}

    def __add__(self, other: "TypeScore") -> "TypeScore":
        return TypeScore(tp=self.tp + other.tp, fp=self.fp + other.fp, fn=self.fn + other.fn,
                         iou_sum=self.iou_sum + other.iou_sum, ignored=self.ignored + other.ignored)


class DiagnosisScore(_Model):
    per_type: dict[str, TypeScore] = Field(default_factory=dict)  # only types that were predicted or injected

    @property
    def total(self) -> TypeScore:
        return sum(self.per_type.values(), TypeScore())


def _interval(t0: float, t1: float) -> Interval:
    return (t0 - POINT_HALF_S, t0 + POINT_HALF_S) if t1 - t0 < _TOL else (t0, t1)


def _iou(a: Interval, b: Interval) -> float:
    inter = max(0.0, min(a[1], b[1]) - max(a[0], b[0]))
    union = (a[1] - a[0]) + (b[1] - b[0]) - inter
    return inter / union if union > _TOL else 0.0


def _inside(p: Interval, regions: list[Interval]) -> float:
    """The fraction of p that lies inside the regions."""
    return sum(max(0.0, min(p[1], r[1]) - max(p[0], r[0])) for r in regions) / (p[1] - p[0])


def _match(pred: list[Interval], truth: list[Interval], dont_care: list[Interval], threshold: float) -> TypeScore:
    pairs = sorted(((_iou(p, t), i, j) for i, p in enumerate(pred) for j, t in enumerate(truth)),
                   key=lambda x: (-x[0], x[1], x[2]))
    used_p, used_t, iou_sum = set(), set(), 0.0
    for iou, i, j in pairs:
        if iou < threshold or iou <= 0.0:
            break
        if i in used_p or j in used_t:
            continue
        used_p.add(i)
        used_t.add(j)
        iou_sum += iou
    tp = len(used_p)
    ignored = sum(1 for i, p in enumerate(pred) if i not in used_p and _inside(p, dont_care) >= DONT_CARE_INSIDE)
    return TypeScore(tp=tp, fp=len(pred) - tp - ignored, fn=len(truth) - tp, iou_sum=iou_sum, ignored=ignored)


def score_diagnosis(diag: Diagnosis, truth: list[InjectedIssue], iou_threshold: float = 0.3) -> DiagnosisScore:
    """Per-type TP/FP/FN of the diagnosis's issues (see score_issues)."""
    return score_issues(diag.issues, truth, iou_threshold)


def score_issues(issues: Iterable[Issue], truth: list[InjectedIssue], iou_threshold: float = 0.3) -> DiagnosisScore:
    """Per-type TP/FP/FN. Real truths are matched first; a leftover prediction lying at least
    DONT_CARE_INSIDE inside dont_care truths of its type is `ignored`; dont_care truths are never missed."""
    pred: dict[str, list[Interval]] = {}
    for i in issues:
        pred.setdefault(i.type, []).append(_interval(i.t, i.t) if i.t0 is None else _interval(i.t0, i.t1))
    true: dict[str, list[Interval]] = {}
    dont_care: dict[str, list[Interval]] = {}
    for i in truth:
        (dont_care if i.dont_care else true).setdefault(i.type, []).append(_interval(i.t0, i.t1))
    kinds = sorted(set(pred) | set(true))
    return DiagnosisScore(per_type={k: _match(pred.get(k, []), true.get(k, []), dont_care.get(k, []), iou_threshold)
                                    for k in kinds})


def aggregate(scores: Iterable[DiagnosisScore]) -> DiagnosisScore:
    per_type: dict[str, TypeScore] = {}
    for s in scores:
        for k, v in s.per_type.items():
            per_type[k] = per_type.get(k, TypeScore()) + v
    return DiagnosisScore(per_type=dict(sorted(per_type.items())))
