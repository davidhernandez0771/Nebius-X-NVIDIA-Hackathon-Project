"""The chart data for the web Results page (plan sprint 3b, T5 Task 1).

    GET /results    DATA_DIR/results/results.json as-is; 404 {"detail": "no results yet"} if missing,
                    422 if it isn't a JSON object

scripts/build_results_json.py (T1) writes the file in the shape web/src/pm/results/results.ts
parses; unmeasured values are null and the page shows them as pending. DATA_DIR is read on
every request (demo_pipeline.paths.data_dir).
"""
from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException

from demo_pipeline.paths import data_dir

router = APIRouter(tags=["results"])


@router.get("/results")
def get_results() -> dict:
    path = data_dir() / "results" / "results.json"
    if not path.is_file():
        raise HTTPException(404, "no results yet")
    try:
        results = json.loads(path.read_text(encoding="utf-8"))
    except (ValueError, OSError) as e:
        raise HTTPException(422, f"results.json is corrupt: {type(e).__name__}: {e}") from None
    if not isinstance(results, dict):
        raise HTTPException(422, f"results.json must be a JSON object, got {type(results).__name__}")
    return results
