"""The Review page's verdict card data: physics, the stored Nemotron verdict and the fixes Neaten applied.

    GET /demos/{id}/review    404 if the demo is missing; 422 if its passport, signals or verdict file is corrupt

    {"demo_id", "lineage",           # the passport's lineage (human demo first), null without a passport
     "physics": {"status": verified|failed|unknown, "source": passport|episode_passport|success_check|null,
                 "reasons", "duration", "path_length", "max_contact_force", "settle_time", "detail"},
     "fixes": {"source": passport|null, "diagnosis_source", "model_id",
               "applied_to", "applied_at",   # the repaired demo in the lineage and its created_at
               "applied": [RepairOp]},       # passport.repairs_applied, with t / t0 / t1 in demo seconds
     "verdict": ReviewVerdict|null, "verdict_source": "review_verdict.json"|null,
     "warnings": [str]}

Physics is the recorded verification: the store passport, then the episode's passport, and only
without either does it run the success check (demo_pipeline.success) on the episode's signals.
"unknown" says why in `detail`; nothing is guessed.

The verdict is <demo dir>/review_verdict.json, a ReviewVerdict (docs/design/nemotron-judge.md), served
as written. Nothing writes it yet: the wiring that labels and judges demos is the next step on
pm/nemotron-judge. Its shape is checked here against the contract; when pm/nemotron-judge merges, the
check can use demo_pipeline.intent.ReviewVerdict instead of the mirror below. Physics decides: if the
verdict's physics line disagrees with this route's, the route's stands and `warnings` says so.
"""
from __future__ import annotations

import zipfile
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ValidationError

from demo_pipeline.episode_io import EpisodeMeta, load_signals
from demo_pipeline.schemas import Demo, Passport, VerificationResult
from demo_pipeline.store import REVIEW_VERDICT, DemoStore
from demo_pipeline.success import check_success

from .demos import get_store

router = APIRouter(prefix="/demos", tags=["review"])

_CORRUPT = (ValueError, OSError, KeyError, EOFError, zipfile.BadZipFile)


# --- the ReviewVerdict contract (docs/design/nemotron-judge.md), checked, not re-shaped ----------------

class _CardPhysics(BaseModel):
    status: Literal["verified", "failed"]
    reasons: list[str]


class _CardLabel(BaseModel):
    status: Literal["ok", "unavailable"]
    task: str | None = None


class _CardMatch(BaseModel):
    status: Literal["yes", "no", "not_checked", "unavailable"]
    checks: dict[str, bool] | None = None
    reason: str | None = None


class _ReviewVerdict(BaseModel):
    physics: _CardPhysics
    label: _CardLabel
    match: _CardMatch
    conflict: str | None = None


def _verification(store: DemoStore, demo: Demo) -> tuple[VerificationResult | None, str | None, Passport | None, str | None]:
    """(verification, its source, the store passport, why it is unknown)."""
    try:
        passport = store.get_passport(demo.id)
    except _CORRUPT as e:
        raise HTTPException(422, f"passport of {demo.id!r} is corrupt: {e}") from None
    if passport is not None:
        return passport.verification, "passport", passport, None

    ep_dir = store.episode_dir(demo.id)
    if not (ep_dir / "episode.json").is_file():
        return None, None, None, "no passport and no recorded episode; Perfect runs the physics replay"
    try:
        meta = EpisodeMeta.model_validate_json((ep_dir / "episode.json").read_text(encoding="utf-8"))
        if meta.passport is not None:
            return meta.passport.verification, "episode_passport", None, None
        signals = load_signals(ep_dir)
        if signals is None:
            return None, None, None, "no passport and the episode has no signals (signals.npz)"
        return check_success(demo.trajectory, signals, demo.scene.bin_pose), "success_check", None, None
    except _CORRUPT as e:
        raise HTTPException(422, f"episode of {demo.id!r} is unreadable: {type(e).__name__}: {e}") from None


def _applied(store: DemoStore, lineage: list[str]) -> tuple[str | None, str | None]:
    """The repaired demo in the lineage (where Neaten applied the fixes) and its created_at."""
    for id in reversed(lineage):
        try:
            d = store.get_demo(id)
        except (KeyError, ValueError):
            continue
        if d.source == "repaired":
            return d.id, d.created_at.isoformat()
    return None, None


@router.get("/{demo_id}/review")
def get_review(demo_id: str, store: DemoStore = Depends(get_store)) -> dict:
    try:
        demo = store.get_demo(demo_id)
    except KeyError:
        raise HTTPException(404, f"demo {demo_id!r} not found") from None
    except ValueError as e:
        raise HTTPException(422, f"demo {demo_id!r} is corrupt: {e}") from None

    v, source, passport, detail = _verification(store, demo)
    physics = {
        "status": "unknown" if v is None else "verified" if v.success else "failed",
        "source": source,
        "reasons": [] if v is None else list(v.reasons),
        "duration": None if v is None else v.duration,
        "path_length": None if v is None else v.path_length,
        "max_contact_force": None if v is None else v.max_contact_force,
        "settle_time": None if v is None else v.settle_time,
        "detail": detail,
    }

    fixes = {"source": None, "diagnosis_source": None, "model_id": None, "applied_to": None, "applied_at": None,
             "applied": []}
    if passport is not None:
        applied_to, applied_at = _applied(store, passport.lineage) if passport.repairs_applied else (None, None)
        fixes = {
            "source": "passport",
            "diagnosis_source": passport.diagnosis_source,
            "model_id": passport.model_id,
            "applied_to": applied_to,
            "applied_at": applied_at,
            "applied": [r.model_dump(mode="json") for r in passport.repairs_applied],
        }

    try:
        verdict = store.get_review_verdict(demo_id)
        if verdict is not None:
            _ReviewVerdict.model_validate(verdict)
    except (ValidationError, ValueError, OSError) as e:
        raise HTTPException(422, f"{REVIEW_VERDICT} of {demo_id!r} is corrupt: {e}") from None

    warnings = []
    if verdict is not None and physics["status"] != "unknown" and verdict["physics"]["status"] != physics["status"]:
        warnings.append(f"{REVIEW_VERDICT} says physics {verdict['physics']['status']}, but the {source} says "
                        f"{physics['status']}; physics decides.")

    return {
        "demo_id": demo.id,
        "lineage": passport.lineage if passport is not None else None,
        "physics": physics,
        "fixes": fixes,
        "verdict": verdict,
        "verdict_source": REVIEW_VERDICT if verdict is not None else None,
        "warnings": warnings,
    }
