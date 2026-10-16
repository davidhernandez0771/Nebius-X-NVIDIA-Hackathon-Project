"""Orchestration: perfect one human demo (spec 8.3-8.5), with every dependency injected. No I/O.

diagnose (Nemotron, or the rules on any failure) -> refine -> repair -> verify. On a failed
verification, the trajectory that just failed is re-diagnosed with its new replay signals and
the failure reasons, at most max_rediagnose times. A bad diagnosis, a repair that raises, and a
failed or crashed verification all end in a recorded PerfectResult, never an exception.
"""

from __future__ import annotations

from typing import Callable, Literal

from pydantic import Field

from .measure import compute_windows
from .refine import refine_diagnosis
from .repair import apply_repairs
from .rules import detect_rules
from .schemas import Demo, Diagnosis, MetricsWindow, Scene, SimSignals, Trajectory, VerificationResult, _Model

DiagnoseFn = Callable[[Demo, list[MetricsWindow], list[str]], Diagnosis]
VerifyFn = Callable[[Trajectory, Scene], tuple[VerificationResult, SimSignals]]
Source = Literal["nemotron", "rules", "none"]


class PerfectResult(_Model):
    status: Literal["perfected", "kept", "discarded"]
    trajectory: Trajectory | None  # the verified trajectory; None when discarded
    diagnosis: Diagnosis | None  # the last (refined) diagnosis
    diagnosis_source: Source  # where that last diagnosis came from
    attempts: int  # verify_fn calls
    verification: VerificationResult | None  # the last verification
    notes: list[str] = Field(default_factory=list)


def _err(e: Exception) -> str:
    return f"{type(e).__name__}: {e}"


def _diagnose(diagnose_fn: DiagnoseFn | None, demo: Demo, windows: list[MetricsWindow], reasons: list[str],
              notes: list[str]) -> tuple[Diagnosis, Source]:
    if diagnose_fn is not None:
        try:
            diag = diagnose_fn(demo, windows, reasons)
            diag.check_times(demo.trajectory.t[-1])
            return diag, "nemotron"
        except Exception as e:  # any failure, including an invalid reply, falls back to the rules
            notes.append(f"diagnose_fn failed ({_err(e)}); used the rules detector")
    return detect_rules(demo.trajectory, windows), "rules"


def perfect_demo(
    demo: Demo,
    signals: SimSignals,
    *,
    diagnose_fn: DiagnoseFn | None,
    verify_fn: VerifyFn,
    bin_rim_z: float,
    max_rediagnose: int = 2,
) -> PerfectResult:
    if max_rediagnose < 0:
        raise ValueError(f"max_rediagnose must be >= 0, got {max_rediagnose}")
    notes: list[str] = []
    state: dict = {"diagnosis": None, "diagnosis_source": "none", "attempts": 0, "verification": None}

    def done(status: str, traj: Trajectory | None = None, note: str | None = None) -> PerfectResult:
        if note:
            notes.append(note)
        return PerfectResult(status=status, trajectory=traj, notes=notes, **state)

    current, windows, reasons = demo, compute_windows(demo.trajectory, signals), []
    for round_ in range(max_rediagnose + 1):
        diag, state["diagnosis_source"] = _diagnose(diagnose_fn, current, windows, reasons, notes)
        diag = state["diagnosis"] = refine_diagnosis(diag, current.trajectory)
        if diag.decision == "discard":
            return done("discarded", note="the diagnosis decided to discard the demo")
        candidate = current.trajectory
        if diag.decision == "repair":
            try:
                candidate = apply_repairs(current.trajectory, diag.repairs, demo.scene, bin_rim_z)
            except Exception as e:  # DiscardDemo, ValueError from an op, or anything unexpected
                return done("discarded", note=f"repair failed ({_err(e)}); discarded")
        if round_ > 0 and candidate == current.trajectory:
            return done("discarded", note="the re-diagnosis proposed no change to the trajectory that failed")

        state["attempts"] += 1
        try:
            result, new_signals = verify_fn(candidate, demo.scene)
        except Exception as e:
            return done("discarded", note=f"verify_fn failed ({_err(e)}); discarded")
        state["verification"] = result
        if result.success:
            return done("kept" if candidate == demo.trajectory else "perfected", candidate)

        reasons = list(result.reasons)
        notes.append(f"verification {state['attempts']} failed: {', '.join(reasons) or 'no reason given'}")
        if round_ == max_rediagnose:
            break
        try:
            windows = compute_windows(candidate, new_signals)
        except Exception as e:
            return done("discarded", note=f"cannot measure the failed replay ({_err(e)}); discarded")
        if candidate != current.trajectory:
            current = Demo(id=f"{demo.id}-r{state['attempts']}", source="repaired", parent_id=demo.id,
                           trajectory=candidate, scene=demo.scene, human_seconds=0.0)
    return done("discarded", note=f"still failing after {max_rediagnose} re-diagnoses; discarded")
