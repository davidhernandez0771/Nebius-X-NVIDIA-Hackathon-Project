"""Nemotron as the failure analyst, on the site (/analysis): how a trained policy failed, what Nemotron says to change
in the next round's data, and which of its claims the measurements kept or sent back (app.ai.failure_analyst).

    GET  /analysis/sources          {live_enabled, sources: [{id, title, detail, episodes, successes, post_hoc, cached}]}
    GET  /analysis/{id}             the analysis: failure counts, per-axis table, contrast, episodes (scene + class),
                                    the rules baseline and its support, and Nemotron's last cached run (or null)
    POST /analysis/{id}/run         {k?} -> ask Nemotron now (k <= 3 samples, 2 fixes each), cache it, return the same

Sources are a fixed list in this file: committed eval results of the big test's models. A request names one by id
and never by path, so no request can reach another file. Their traces are on the GPU machine, so each episode is
built from its result row (failure_features.result_features): the scene, check_success's reasons, the cube's end.

Asking Nemotron costs money, so POST is off unless SANT_ANALYST_LIVE=1 (403 otherwise), runs one at a time (409 while
one runs), and at most once a minute (429). GET never calls the model. The cache is the script's own format
(scripts/analyze_failures.py's analysis.json) under DATA_DIR/analysis/<id>/, so the page and the script agree.
"""
from __future__ import annotations

import json
import logging
import math
import os
import re
import threading
import time
from collections import Counter
from functools import lru_cache
from pathlib import Path

import numpy as np
from fastapi import APIRouter, Body, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field

from app.ai import failure_analyst as fa
from demo_pipeline.data_recipe import DataRecipe, contrast_table, region_support, rules_mechanism, rules_recipe, validate_recipe
from demo_pipeline.failure_features import EVAL_SEED_MIN, TEST_SEEDS, EpisodeFeatures, read_episode_log, result_features
from demo_pipeline.multiply import sample_scene
from demo_pipeline.paths import REPO_ROOT, data_dir

from ._http_cache import etag_json

router = APIRouter(prefix="/analysis", tags=["analysis"])
log = logging.getLogger(__name__)

RESULTS = REPO_ROOT / "docs" / "superpowers" / "notes" / "2026-10-23-bigtest" / "results"
ID_RE = re.compile(r"^[a-z0-9_]{1,64}$")
MAX_K = 3
RETRIES = 2
COOLDOWN_S = 60.0
REPLY_EXCERPT = 600  # characters of a rejected reply shown on the page

# id -> (title, detail, eval files relative to RESULTS). The only files this router reads.
SOURCES: dict[str, tuple[str, str, tuple[str, ...]]] = {
    "bigtest_final": ("Final model · selection + test",
                      "The big test's final model (Stage A, 180k steps): its selection on 5500-5528 and the "
                      "pre-registered test on 5400-5439 (30/40). Post-hoc: the test result stands as run.",
                      ("stageA_selection/distill_r0_s180000.episodes.jsonl", "final_test/bigtest_final.episodes.jsonl")),
    "stage_a_60k": ("Stage A · 60k steps", "Stage A's 60k checkpoint on its selection seeds 5500-5528.",
                    ("stageA_selection/distill_r0_s60000.episodes.jsonl",)),
    "stage_a_120k": ("Stage A · 120k steps", "Stage A's 120k checkpoint on its selection seeds 5500-5528.",
                     ("stageA_selection/distill_r0_s120000.episodes.jsonl",)),
    "stage_b_60k": ("Stage B · 60k steps", "Stage B (DAgger round 1) at 60k on its selection seeds 5529-5557.",
                    ("stageB_selection/distill_r1_s60000.episodes.jsonl",)),
    "stage_b_180k": ("Stage B · 180k steps", "Stage B (DAgger round 1) at 180k on its selection seeds 5529-5557.",
                     ("stageB_selection/distill_r1_s180000.episodes.jsonl",)),
}

_run_lock = threading.Lock()
_last_run = {"t": -math.inf}


def live_enabled() -> bool:
    """Whether POST /analysis/{id}/run may call Nemotron (it costs money): off unless SANT_ANALYST_LIVE=1."""
    return os.environ.get("SANT_ANALYST_LIVE", "").strip().lower() in ("1", "true", "yes", "on")


def get_chat_fn():
    """The chat function the live run uses (a dependency, so tests can fake it)."""
    return fa.chat


def _source(source_id: str) -> tuple[str, str, tuple[Path, ...]]:
    if not ID_RE.fullmatch(source_id):
        raise HTTPException(400, "an analysis id is lower-case letters, digits and _")
    if source_id not in SOURCES:
        raise HTTPException(404, f"no analysis {source_id!r}")
    title, detail, rel = SOURCES[source_id]
    root = RESULTS.resolve()
    files = []
    for r in rel:
        path = (RESULTS / r).resolve()
        if not path.is_relative_to(root) or not path.is_file():
            raise HTTPException(404, f"the results of {source_id!r} are missing on this server")
        files.append(path)
    return title, detail, tuple(files)


def _cache_dir(source_id: str) -> Path:
    root = (data_dir() / "analysis").resolve()
    path = (root / source_id).resolve()
    if not path.is_relative_to(root):  # a symlinked folder pointing elsewhere
        raise HTTPException(400, "the cache folder is outside the analysis folder")
    return path


@lru_cache(maxsize=16)
def _episodes_cached(files: tuple[Path, ...], mtimes: tuple[float, ...]) -> tuple[EpisodeFeatures, ...]:
    out = []
    for path in files:
        for row in read_episode_log(path):
            seed = int(row["seed"])
            if seed < EVAL_SEED_MIN or row.get("ended_by") in ("policy_error", "sim_error"):
                continue
            out.append(result_features(row, sample_scene(np.random.default_rng(seed), "franka", seed)))
    return tuple(sorted(out, key=lambda e: e.seed))


def episodes_of(source_id: str) -> list[EpisodeFeatures]:
    _, _, files = _source(source_id)
    return list(_episodes_cached(files, tuple(f.stat().st_mtime for f in files)))


def _post_hoc(episodes) -> bool:
    return any(lo <= e.seed <= hi for e in episodes for lo, hi in TEST_SEEDS)


def _clean(obj):
    """JSON-safe: NaN/inf -> None (the page reads plain JSON)."""
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, dict):
        return {k: _clean(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_clean(v) for v in obj]
    return obj


def _claimed(reply: str) -> dict | None:
    """What one reply claimed, if it parsed: the summary, the regions and the fixes."""
    try:
        r = fa.parse_recipe(reply)
    except fa.RecipeReplyError:
        return None
    return {"summary": r.summary, "regions": [g.name for g in r.regions], "fixes": [f.lever for f in r.fixes],
            "mechanism": [f"{m.feature} {m.direction}" for m in r.mechanism]}


def _nemotron_view(analysis: dict | None, episodes) -> dict | None:
    """The cached run as the page shows it. Raw replies are cut to an excerpt; nothing else from the API is kept."""
    if analysis is None:
        return None
    recipe = analysis.get("recipe")
    support = None
    if recipe is not None:
        support = [s.model_dump() for s in region_support(DataRecipe.model_validate(recipe), episodes)]
    attempts = []
    for a in analysis.get("attempts", []):
        reply = a.get("reply") or ""
        errors = [e for e in a.get("errors", [])]
        api_error = any(e.startswith("api_error") for e in errors)
        attempts.append({"sample": a.get("sample"), "think": a.get("think"), "accepted": not errors,
                         "errors": ["the model service did not answer"] if api_error else errors,
                         "claimed": None if api_error else _claimed(reply),
                         "excerpt": None if api_error or not errors else reply.strip()[:REPLY_EXCERPT]})
    return {"recipe": recipe, "support": support, "agreement": analysis.get("agreement"),
            "candidates": len(analysis.get("candidates") or []), "k": analysis.get("k"),
            "calls": analysis.get("calls"), "cost_usd": analysis.get("cost_usd"), "model": analysis.get("model"),
            "api_errors": analysis.get("api_errors", 0), "attempts": attempts, "ran_at": analysis.get("ran_at")}


SNAPSHOTS = RESULTS / "analysis"  # committed copies of each source's Nemotron run, for a server with no DATA_DIR cache


def _cache_file(source_id: str) -> Path:
    """This server's own run (DATA_DIR/analysis/<id>/analysis.json) when there is one, else the committed snapshot."""
    own = _cache_dir(source_id) / "analysis.json"
    if own.is_file():
        return own
    root = SNAPSHOTS.resolve()
    snap = (root / source_id / "analysis.json").resolve()
    return snap if snap.is_relative_to(root) else own


def _cache_stamp(source_id: str) -> tuple[str, int, int] | None:
    """(path, mtime_ns, size) of the cached run, or None: what a cached report is keyed on, so a new run shows."""
    path = _cache_file(source_id)
    try:
        st = path.stat()
    except OSError:
        return None
    return str(path), st.st_mtime_ns, st.st_size


def _read_cache(source_id: str) -> dict | None:
    path = _cache_file(source_id)
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        log.warning("analysis cache for %s is unreadable", source_id)
        return None


@lru_cache(maxsize=32)
def _report_cached(source_id: str, files: tuple[Path, ...], mtimes: tuple[int, ...], stamp, live: bool) -> dict:
    """The GET report, rebuilt only when the results, the cached run or the live flag change (the arguments)."""
    return _report(source_id)


def _report(source_id: str, analysis: dict | None = None) -> dict:
    title, detail, _ = _source(source_id)
    episodes = episodes_of(source_id)
    if analysis is None:
        analysis = _read_cache(source_id)
    rules = rules_recipe(episodes)
    if rules is not None and validate_recipe(rules):
        rules = None
    n_ok = sum(e.success for e in episodes)
    return _clean({
        "id": source_id, "title": title, "detail": detail,
        "episodes": len(episodes), "successes": n_ok, "failures": len(episodes) - n_ok,
        "post_hoc": _post_hoc(episodes), "untraced": any(e.source == "result" for e in episodes),
        "failure_counts": dict(Counter(e.primary for e in episodes if e.primary).most_common()),
        "failure_table": fa.failure_table(episodes),
        "contrast": [c.model_dump() for c in contrast_table(episodes)],
        "code_mechanism": [c.feature for c in rules_mechanism(episodes)],
        "points": [{"seed": e.seed, "success": e.success, "primary": e.primary, "reasons": e.reasons,
                    "cube": [e.scene.cube_x, e.scene.cube_y], "bin": [e.scene.bin_x, e.scene.bin_y],
                    "cube_yaw_deg": e.scene.cube_yaw_deg, "test": any(lo <= e.seed <= hi for lo, hi in TEST_SEEDS)}
                   for e in episodes],
        "rules": None if rules is None else {"recipe": rules.model_dump(),
                                             "support": [s.model_dump() for s in region_support(rules, episodes)]},
        "nemotron": _nemotron_view(analysis, episodes),
        "live_enabled": live_enabled(),
    })


class RunBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    k: int = Field(3, ge=1, le=MAX_K)


@router.get("/sources")
def list_sources(request: Request) -> Response:
    return etag_json(request, _sources())


def _sources() -> dict:
    out = []
    for sid, (title, detail, _) in SOURCES.items():
        try:
            eps = episodes_of(sid)
        except HTTPException:
            continue  # its results aren't on this server
        try:
            cached = _read_cache(sid) is not None
        except HTTPException:
            cached = False
        out.append({"id": sid, "title": title, "detail": detail, "episodes": len(eps),
                    "successes": sum(e.success for e in eps), "post_hoc": _post_hoc(eps), "cached": cached})
    return {"live_enabled": live_enabled(), "sources": out}


@router.get("/{source_id}")
def get_analysis(source_id: str, request: Request) -> Response:
    _, _, files = _source(source_id)
    report = _report_cached(source_id, files, tuple(f.stat().st_mtime_ns for f in files), _cache_stamp(source_id),
                            live_enabled())
    return etag_json(request, report)


@router.post("/{source_id}/run")
def run_analysis(source_id: str, body: RunBody = Body(default_factory=RunBody), chat_fn=Depends(get_chat_fn)) -> dict:
    if not live_enabled():
        raise HTTPException(403, "live Nemotron runs are off on this server (set SANT_ANALYST_LIVE=1 to allow them)")
    _source(source_id)  # 400/404 before taking the lock
    if not _run_lock.acquire(blocking=False):
        raise HTTPException(409, "a Nemotron run is already in progress; try again when it finishes")
    try:
        wait = COOLDOWN_S - (time.monotonic() - _last_run["t"])
        if wait > 0:
            raise HTTPException(429, f"one live run a minute; try again in {math.ceil(wait)} s")
        _last_run["t"] = time.monotonic()
        episodes = episodes_of(source_id)
        if all(e.success for e in episodes):
            raise HTTPException(400, "every episode succeeded; there is no failure to analyse")
        try:
            res = fa.analyse(episodes, k=body.k, retries=RETRIES, chat_fn=chat_fn)
        except Exception as e:  # noqa: BLE001 - the message may carry request details; the page gets a plain line
            log.error("live analysis of %s failed: %s", source_id, type(e).__name__)
            raise HTTPException(502, "the analysis failed; the server log has the error type") from None
        analysis = {
            "k": body.k, "calls": res.calls, "cost_usd": round(res.cost, 6), "model": res.model,
            "api_errors": res.api_errors, "recipe": None if res.recipe is None else res.recipe.model_dump(),
            "agreement": None if res.agreement is None or math.isnan(res.agreement) else res.agreement,
            "candidates": [c.model_dump() for c in res.candidates],
            "candidate_agreement": [None if math.isnan(a) else a for a in res.candidate_agreement],
            "attempts": [vars(a) for a in res.attempts], "ran_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        }
        out = _cache_dir(source_id)
        out.mkdir(parents=True, exist_ok=True)
        (out / "analysis.json").write_text(json.dumps(_clean(analysis), indent=1), encoding="utf-8")
        if res.recipe is not None:
            (out / "recipe_nemotron.json").write_text(res.recipe.model_dump_json(indent=1), encoding="utf-8")
        _report_cached.cache_clear()  # the stamp changes too; this also covers a same-size write in the same tick
        return _report(source_id, analysis)
    finally:
        _run_lock.release()
