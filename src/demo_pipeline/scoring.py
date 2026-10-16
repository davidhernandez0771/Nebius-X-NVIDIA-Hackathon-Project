"""Scoring: how well a diagnosis finds the injected issues (degrade's ground truth).

Per issue type, predictions and truths are matched one-to-one, best time IoU first; a pair counts
when its IoU reaches the threshold. A point issue (`t`, or a truth with t0 == t1) is scored as
the interval t +- POINT_HALF_S, half a metrics window. Rates are None when undefined (0 / 0).
"""

from __future__ import annotations

from collections.abc import Iterable

from pydantic import Field

from .degrade import InjectedIssue
from .schemas import Diagnosis, _Model

POINT_HALF_S = 0.25
_TOL = 1e-12
Interval = tuple[float, float]


class TypeScore(_Model):
    tp: int = 0
    fp: int = 0
    fn: int = 0
    iou_sum: float = 0.0  # over the matched pairs

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

    def __add__(self, other: "TypeScore") -> "TypeScore":
        return TypeScore(tp=self.tp + other.tp, fp=self.fp + other.fp, fn=self.fn + other.fn,
                         iou_sum=self.iou_sum + other.iou_sum)


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


def _match(pred: list[Interval], truth: list[Interval], threshold: float) -> TypeScore:
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
    return TypeScore(tp=tp, fp=len(pred) - tp, fn=len(truth) - tp, iou_sum=iou_sum)


def score_diagnosis(diag: Diagnosis, truth: list[InjectedIssue], iou_threshold: float = 0.3) -> DiagnosisScore:
    pred: dict[str, list[Interval]] = {}
    for i in diag.issues:
        pred.setdefault(i.type, []).append(_interval(i.t, i.t) if i.t0 is None else _interval(i.t0, i.t1))
    true: dict[str, list[Interval]] = {}
    for i in truth:
        true.setdefault(i.type, []).append(_interval(i.t0, i.t1))
    kinds = sorted(set(pred) | set(true))
    return DiagnosisScore(per_type={k: _match(pred.get(k, []), true.get(k, []), iou_threshold) for k in kinds})


def aggregate(scores: Iterable[DiagnosisScore]) -> DiagnosisScore:
    per_type: dict[str, TypeScore] = {}
    for s in scores:
        for k, v in s.per_type.items():
            per_type[k] = per_type.get(k, TypeScore()) + v
    return DiagnosisScore(per_type=dict(sorted(per_type.items())))
