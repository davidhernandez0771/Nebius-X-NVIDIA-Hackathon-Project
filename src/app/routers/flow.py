"""SANT's whole pipeline in one summary (/flow): each stage with its real headline number and where it comes from.

    GET /flow   {as_of, stages: [{id, title, does, link, metric: {headline, detail, ...}, source: {kind, label, note}}],
                 loop_back: {from, to}, loop: {status, name?, current?, seeds?, stages?, result?}}

Built only from committed files and DATA_DIR caches; no request names a file:
- web/src/site/results/results.json (the scripted multiply A/B) and web/public/test-track-data/index.json (the final
  test's 40 runs), read when present;
- DATA_DIR/analysis/bigtest_final/analysis.json, the failure analyst's cached Nemotron run, when present;
- DATA_DIR/loops/<name>/loop.json, the latest closed loop (scripts/sant_loop.py), folder names checked;
- otherwise CITED: each number with the note it is copied from and the exact text it appears as there
  (tests/test_flow_router.py checks every one is still in its note).
The response carries repo-relative note paths only: no filesystem path, command or secret.
"""
from __future__ import annotations

import json
import logging
import math
import re
from dataclasses import dataclass
from pathlib import Path

from fastapi import APIRouter, Request, Response

from demo_pipeline.paths import REPO_ROOT, data_dir

from ._http_cache import etag_json

router = APIRouter(tags=["flow"])
log = logging.getLogger(__name__)

RESULTS_JSON = REPO_ROOT / "web" / "src" / "site" / "results" / "results.json"
TRACK_INDEX = REPO_ROOT / "web" / "public" / "test-track-data" / "index.json"
ANALYSIS_ID = "bigtest_final"
LOOP_STAGES = ("diagnose", "freeze", "train_recipe", "train_control", "eval_recipe", "eval_control", "compare")
STATUSES = ("pending", "running", "done", "provided", "failed")
NAME_RE = re.compile(r"^[a-z0-9_-]{1,64}$")
NOTES = "docs/superpowers/notes/"


@dataclass(frozen=True)
class Cited:
    note: str  # repo-relative
    needles: tuple[str, ...]  # the exact text each number appears as in the note


CITED: dict[str, Cited] = {
    "record": Cited(NOTES + "2026-10-21-distill-prereg.md", ("the 10 mouse demos",)),
    "measure": Cited(NOTES + "2026-10-20-site-results-live.md", ("0/10 pass as recorded", "927 N")),
    "repair": Cited(NOTES + "2026-10-20-pr-live-12.md", ("**3/10** repaired → **24/30** copies verified",)),
    "verify": Cited(NOTES + "2026-10-20-mouse20261020-results.md", ("**Replay:** 10/10 pass", "100/100 verified")),
    "multiply": Cited(NOTES + "2026-10-15-t3-status.md", ("3 / 40 = 7.5%", "17 / 40 = 42.5%", "0.00055")),
    "teach": Cited(NOTES + "2026-10-21-distill-prereg.md",
                   ("**113/128 (88.3%)** | 0.816–0.928", "**0/128 (0%)** | 0.000–0.029")),
    "train_v1": Cited(NOTES + "2026-10-21-distill-prereg.md", ("15/40 (37.5%), Wilson 95% CI 0.242–0.530",)),
    "train_v2": Cited(NOTES + "2026-10-23-bigtest-prereg.md", ("30/40 (75%), Wilson 95% CI 0.598–0.858", "p = 0.0014")),
    "evaluate": Cited(NOTES + "2026-10-23-bigtest-prereg.md", ("All 40 seeds ran once",)),
    "analyse": Cited(NOTES + "2026-10-25-failure-analyst.md",
                     ("69 episodes", "17 dropped and 1 collision", "$0.042, agreement 0.83", "p = 0.092")),
    "recipe": Cited(NOTES + "2026-10-25-failure-analyst.md", ("a weak lead, not a finding",)),
}

# The numbers CITED's notes hold (the fallback when a committed data file is missing).
MULTIPLY = {"before": {"k": 3, "n": 40, "ci": [0.026, 0.199]}, "after": {"k": 17, "n": 40, "ci": [0.285, 0.578]},
            "p": 0.00055}
FINAL_TEST = {"k": 30, "n": 40, "ci": [0.598, 0.858]}
ANALYSE = {"episodes": 69, "failures": 18, "dropped": 17, "k": 3, "calls": 5, "cost_usd": 0.042, "agreement": 0.83,
           "p_value": 0.092, "regions": 1}


def _read_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _num(x) -> float | None:
    return x if isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x) else None


def _rate(k: int, n: int, ci) -> dict:
    return {"k": k, "n": n, "ci": [round(float(c), 3) for c in ci]}


def _note_source(key: str, label: str) -> dict:
    return {"kind": "note", "label": label, "note": CITED[key].note}


def _pct(k: int, n: int) -> str:
    return f"{round(100 * k / n)}%"


# ------------------------------------------------------------------ committed files


def _multiply() -> tuple[dict, dict]:
    data = _read_json(RESULTS_JSON) or {}
    try:
        exp = next(e for e in data["experiments"] if e["id"] == "multiply")
        arms = {a["key"]: a for g in exp["groups"] for a in g["arms"]}
        a, b = arms["raw_10_30k"], arms["raw_multiply_10_30k"]
        before, after = _rate(int(a["k"]), int(a["n"]), a["ci"]), _rate(int(b["k"]), int(b["n"]), b["ci"])
        src = {"kind": "file", "label": "Results page data (web/src/site/results/results.json), from the T3 status note",
               "note": CITED["multiply"].note}
        return {"before": before, "after": after, "p": MULTIPLY["p"]}, src
    except (KeyError, TypeError, ValueError, StopIteration):
        return MULTIPLY, _note_source("multiply", "T3 status note, sprint 7 confirmatory seeds 5020–5059")


def _final_test() -> tuple[dict, int, dict]:
    data = _read_json(TRACK_INDEX) or {}
    try:
        src = next(s for s in data["sources"] if s["id"] == "final-test-v2")
        s = src["summary"]
        rate = _rate(int(s["successes"]), int(s["n"]), s["ci95"])
        return rate, len(src["runs"]), {"kind": "file", "label": "Test track data (web/public/test-track-data), "
                                        "every run's own trace", "note": CITED["evaluate"].note}
    except (KeyError, TypeError, ValueError, StopIteration):
        return FINAL_TEST, 40, _note_source("evaluate", "Big-test pre-registration note")


# ------------------------------------------------------------------ DATA_DIR caches


def _analysis() -> tuple[dict, dict]:
    root = (data_dir() / "analysis").resolve()
    path = (root / ANALYSIS_ID / "analysis.json").resolve()
    cached = _read_json(path) if path.is_relative_to(root) else None
    fallback = dict(ANALYSE)
    if isinstance(cached, dict) and isinstance(cached.get("recipe"), dict):
        support = cached.get("support") or []
        p = _num(support[0].get("p_value")) if support and isinstance(support[0], dict) else None
        out = {**fallback, "k": cached.get("k") if isinstance(cached.get("k"), int) else fallback["k"],
               "calls": cached.get("calls") if isinstance(cached.get("calls"), int) else fallback["calls"],
               "cost_usd": _num(cached.get("cost_usd")) if _num(cached.get("cost_usd")) is not None else fallback["cost_usd"],
               "agreement": _num(cached.get("agreement")),
               "p_value": p if p is not None else fallback["p_value"],
               "regions": len(cached["recipe"].get("regions") or [])}
        model = cached.get("model") if isinstance(cached.get("model"), str) else None
        if model and re.fullmatch(r"[\w./-]{1,80}", model):
            out["model"] = model
        return out, {"kind": "cache", "label": "The analyst's cached Nemotron run on the big test's final model "
                     "(DATA_DIR/analysis/bigtest_final)", "note": CITED["analyse"].note}
    return fallback, _note_source("analyse", "Failure-analyst note, section 1b (on real results)")


def _latest_loop() -> dict:
    root = (data_dir() / "loops").resolve()
    best: tuple[float, dict] | None = None
    if root.is_dir():
        for folder in root.iterdir():
            if not NAME_RE.fullmatch(folder.name):
                continue
            path = (folder / "loop.json").resolve()
            if not path.is_relative_to(root) or not path.is_file():
                continue
            state = _read_json(path)
            if not isinstance(state, dict) or not isinstance(state.get("stages"), dict):
                continue
            mtime = path.stat().st_mtime
            if best is None or mtime > best[0]:
                best = (mtime, {"name": folder.name, "state": state})
    if best is None:
        return {"status": "none"}
    name, state = best[1]["name"], best[1]["state"]
    stages = []
    for sid in LOOP_STAGES:
        st = state["stages"].get(sid) if isinstance(state["stages"].get(sid), dict) else {}
        status = st.get("status") if st.get("status") in STATUSES else "pending"
        stages.append({"id": sid, "status": status,
                       "started": st.get("started") if isinstance(st.get("started"), str) else None,
                       "ended": st.get("ended") if isinstance(st.get("ended"), str) else None})
    statuses = [s["status"] for s in stages]
    if "failed" in statuses:
        status = "failed"
    elif all(s in ("done", "provided") for s in statuses):
        status = "done"
    elif "running" in statuses:
        status = "running"
    elif any(s in ("done", "provided") for s in statuses):
        status = "paused"
    else:
        status = "pending"
    current = next((s["id"] for s in stages if s["status"] in ("running", "failed")), None) or next(
        (s["id"] for s in stages if s["status"] == "pending"), None)
    seeds = state.get("seeds") if isinstance(state.get("seeds"), dict) else {}
    rng = seeds.get("range")
    out = {"status": status, "name": name, "current": current, "stages": stages,
           "seeds": rng if isinstance(rng, list) and len(rng) == 2 and all(isinstance(x, int) for x in rng) else None,
           "result": _loop_result(state.get("result"))}
    return out


def _loop_result(res) -> dict | None:
    if not isinstance(res, dict):
        return None

    def arm(a):
        if not isinstance(a, dict) or not isinstance(a.get("successes"), int) or not isinstance(a.get("n"), int):
            return None
        ci = a.get("ci")
        return {"successes": a["successes"], "n": a["n"],
                "ci": [float(c) for c in ci] if isinstance(ci, list) and len(ci) == 2 and all(_num(c) is not None for c in ci) else None}

    r, c = arm(res.get("recipe")), arm(res.get("control"))
    if r is None or c is None:
        return None
    decision = res.get("decision") if res.get("decision") in ("recipe_better", "no_difference_shown") else None
    return {"recipe": r, "control": c, "p_one_sided": _num(res.get("p_one_sided")),
            "p_two_sided": _num(res.get("p_two_sided")), "decision": decision, "sample": bool(res.get("sample"))}


# ------------------------------------------------------------------ the summary


def _stages(loop: dict) -> list[dict]:
    mult, mult_src = _multiply()
    final, runs, final_src = _final_test()
    an, an_src = _analysis()
    b, a = mult["before"], mult["after"]
    res = loop.get("result")
    if res:
        rr, cc = res["recipe"], res["control"]
        recipe_metric = {
            "headline": f"Recipe {rr['successes']}/{rr['n']} vs uniform {cc['successes']}/{cc['n']}",
            "detail": ("Recipe better, two-sided Fisher p ≤ 0.05" if res["decision"] == "recipe_better"
                       else "No difference shown at p ≤ 0.05") + (" (smoke test, not a result)" if res["sample"] else ""),
            "before": {"k": cc["successes"], "n": cc["n"], "ci": cc["ci"]},
            "after": {"k": rr["successes"], "n": rr["n"], "ci": rr["ci"]}, "p": res["p_one_sided"]}
        recipe_src = {"kind": "loop", "label": f"Closed loop {loop['name']}: compare stage", "note": None}
    else:
        recipe_metric = {
            "headline": f"{an['regions']} scene region{'' if an['regions'] == 1 else 's'} proposed",
            "detail": "Cube left, bin right: a weak lead, not a finding. Recipe vs uniform A/B not run yet."
                      if loop["status"] == "none" else f"Recipe vs uniform A/B: {loop['status']}"
                      + (f" at {loop['current']}" if loop.get("current") else ""),
            "value": an["regions"]}
        recipe_src = _note_source("recipe", "Failure-analyst note, section 1b (verdict)")
    return [
        {"id": "record", "title": "Record", "does": "A person drives the simulated arm with a mouse or webcam and "
         "SANT saves each take as a demo.", "link": "/record",
         "metric": {"headline": "10 human mouse demos", "detail": "One person; the whole climb starts from them",
                    "value": 10},
         "source": _note_source("record", "Distill pre-registration note")},
        {"id": "measure", "title": "Measure", "does": "Every demo is replayed in Isaac physics and measured: "
         "contacts, forces, where the cube ended.", "link": "/pm/review",
         "metric": {"headline": "0/10 webcam demos pass as recorded", "detail": "Up to 927 N pressing into the bin "
                    "(5 N limit)", "before": {"k": 0, "n": 10, "ci": None}},
         "source": _note_source("measure", "Site results note (real webcam demos)")},
        {"id": "repair", "title": "Repair", "does": "Rules fix what the measurements flag: trim, smooth, recenter "
         "the grasp, release above the bin.", "link": "/pm/review",
         "metric": {"headline": "3/10 repaired → 24/30 copies verified", "detail": "Rules repair on the webcam demos",
                    "after": {"k": 3, "n": 10, "ci": None}},
         "source": _note_source("repair", "PR live-12 note")},
        {"id": "verify", "title": "Verify", "does": "A demo only counts if its physics replay puts the cube in the "
         "bin with no hard contact.", "link": "/data",
         "metric": {"headline": "10/10 mouse demos pass on replay", "detail": "And 100/100 multiplied copies verified",
                    "after": {"k": 10, "n": 10, "ci": None}},
         "source": _note_source("verify", "Mouse demos results note")},
        {"id": "multiply", "title": "Multiply", "does": "Each verified demo is moved into new scenes and replayed; "
         "only copies that pass are kept.", "link": "/site/results",
         "metric": {"headline": f"{b['k']}/{b['n']} → {a['k']}/{a['n']}", "detail": f"10 scripted demos alone vs + 100 "
                    f"verified copies; Fisher p = {mult['p']}", "before": b, "after": a, "p": mult["p"]},
         "source": mult_src},
        {"id": "teach", "title": "Teach (RL)", "does": "An RL teacher learns the task from the human demo starts, "
         "then has to pass SANT's own physics check.", "link": "/site/results",
         "metric": {"headline": "113/128 with demos vs 0/128 without", "detail": "Same code, budget and seed",
                    "before": _rate(0, 128, [0.0, 0.029]), "after": _rate(113, 128, [0.816, 0.928])},
         "source": _note_source("teach", "Distill pre-registration note, Amendment 6")},
        {"id": "train", "title": "Train (ACT)", "does": "The teacher's verified runs train a camera policy (ACT) "
         "that sees only its cameras and joints.", "link": "/metrics",
         "metric": {"headline": f"v1 15/40 → v2 {FINAL_TEST['k']}/{FINAL_TEST['n']}",
                    "detail": "v2: 180k steps + a gripper deadband; Wilson 95% CI 0.598–0.858",
                    "before": _rate(15, 40, [0.242, 0.530]), "after": FINAL_TEST},
         "source": _note_source("train_v2", "Distill and big-test pre-registration notes")},
        {"id": "evaluate", "title": "Evaluate", "does": "The policy runs once on 40 scenes it has never seen, and "
         "SANT judges every run.", "link": "/test-track",
         "metric": {"headline": f"{final['k']}/{final['n']} on fresh seeds 5400–5439",
                    "detail": f"{runs} recorded runs, {_pct(final['k'], final['n'])} success", "after": final,
                    "runs": runs},
         "source": final_src},
        {"id": "analyse", "title": "Analyse (Nemotron)", "does": "Nemotron reads how the policy failed and proposes "
         "the next data; code checks every claim.", "link": "/analysis",
         "metric": {"headline": f"{an['failures']} failures read: {an['dropped']} drops",
                    "detail": f"{an['k']} samples"
                              + ("" if an["agreement"] is None else f", agreement {round(an['agreement'], 2)}")
                              + f", region p = {round(an['p_value'], 3)}, ${round(an['cost_usd'], 3)}",
                    "episodes": an["episodes"], "agreement": an["agreement"], "p_value": an["p_value"],
                    "cost_usd": an["cost_usd"], "calls": an["calls"], **({"model": an["model"]} if "model" in an else {})},
         "source": an_src},
        {"id": "recipe", "title": "Recipe", "does": "The checked recipe says which scenes to multiply into next; "
         "a recipe arm is tested against a uniform control.", "link": "/pipeline",
         "metric": recipe_metric, "source": recipe_src},
    ]


@router.get("/flow")
def get_flow(request: Request) -> Response:
    """Rebuilt per request (a few small files, under 2 ms) so a loop stage shows at once; the ETag saves the body."""
    loop = _latest_loop()
    return etag_json(request, {"as_of": "2026-10-28", "stages": _stages(loop), "loop_back": {"from": "recipe", "to": "multiply"},
            "loop": loop})
