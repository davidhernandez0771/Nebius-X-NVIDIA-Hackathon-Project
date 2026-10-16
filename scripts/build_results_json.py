"""Write the real results file, DATA_DIR/results/results.json, from whatever has been measured so far.

    uv run python scripts/build_results_json.py --data-dir data --t2-data C:\\dev\\pm-t2\\data
    uv run python scripts/build_results_json.py --input-root C:\\dev\\pm-t3\\data --input-root C:\\dev\\pm-t4\\data

Collects (demo_pipeline.results has the rules; nothing measured stays null and is listed as pending):
  <data-dir>/results/registry.jsonl            T3's experiment registry (eval_success per cell)
  <data-dir>/evals/*.json                      T3's sim eval results files
  <root>/*/yield.json, <root>/*/*/yield.json   T2's multiply yields, for root in --data-dir and each --t2-data
  <data-dir>/sets/*/pipeline/*/scores.json     scripts/score_pipeline_run.py
Each --input-root (another track's data folder) contributes its registry, evals, yields and scores in place,
so every source path stays the file that was measured; only results.json is written, under --data-dir.
A file or registry line that cannot be read is skipped and listed in "skipped_inputs". The file is
replaced atomically, so the page never reads half of it.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from demo_pipeline.paths import data_dir  # noqa: E402
from demo_pipeline.results import ABLATION_DEMOS, DEMOS, build_results  # noqa: E402


def _load(path: Path, skipped: list[dict]) -> dict | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        skipped.append({"file": str(path), "error": f"{type(e).__name__}: {e}"})
        return None
    if not isinstance(data, dict):
        skipped.append({"file": str(path), "error": "not a JSON object"})
        return None
    return data


def _registry(path: Path, skipped: list[dict]) -> list[tuple[str, dict]]:
    if not path.is_file():
        return []
    rows = []
    for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except ValueError as e:
            skipped.append({"file": f"{path}#L{n}", "error": f"{type(e).__name__}: {e}"})
            continue
        if not isinstance(row, dict):
            skipped.append({"file": f"{path}#L{n}", "error": "not a JSON object"})
            continue
        rows.append((f"{path}#L{n}", row))
    return rows


def _files(paths, skipped: list[dict]) -> list[tuple[str, dict]]:
    out = []
    for p in paths:
        data = _load(p, skipped)
        if data is not None:
            out.append((str(p), data))
    return out


def _eval_run_id(path: str, e: dict) -> str | None:
    """The run an eval file belongs to: run.run_id, else its folder under evals/ (evals/<run_id>/<cell>.json)."""
    run_id = (e.get("run") or {}).get("run_id")
    if run_id:
        return run_id
    p = Path(path)
    return p.parent.name if p.parent.parent.name == "evals" else None


def build(data: Path, *, t2_data: list[Path] = (), input_roots: list[Path] = (), out: Path | None = None,
          robot: str = "franka", demos=DEMOS, ablation_demos: int = ABLATION_DEMOS,
          run_ids: list[str] | None = None) -> Path:
    """run_ids: use only these experiment runs' registry rows and eval files (others are listed as excluded),
    so one chart never mixes two experiments; None uses every run (the newest measurement of a cell wins)."""
    data = Path(data)
    roots = [data, *map(Path, input_roots)]
    skipped: list[dict] = []
    registry = [row for root in roots for row in _registry(root / "results" / "registry.jsonl", skipped)]
    evals = _files([p for root in roots for pattern in ("*.json", "*/*.json")
                    for p in sorted((root / "evals").glob(pattern))], skipped)
    excluded = []
    if run_ids is not None:
        keep = set(run_ids)
        excluded = [s for s, r in registry if r.get("run_id") not in keep]
        excluded += [s for s, e in evals if _eval_run_id(s, e) not in keep]
        registry = [(s, r) for s, r in registry if r.get("run_id") in keep]
        evals = [(s, e) for s, e in evals if _eval_run_id(s, e) in keep]
    yield_paths = {p.resolve(): p for root in [*roots, *map(Path, t2_data)]
                   for pattern in ("yield.json", "*/yield.json", "*/*/yield.json") for p in root.glob(pattern)}
    yields = _files(sorted(yield_paths.values(), key=lambda p: (p.stat().st_mtime, str(p))), skipped)  # oldest first
    scores = _files([p for root in roots for p in sorted(root.glob("sets/*/pipeline/*/scores.json"))], skipped)

    results = build_results(registry, evals, yields, scores, demos=demos, ablation_demos=ablation_demos, robot=robot)
    results["generated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    results["generator"] = "scripts/build_results_json.py"
    results["inputs"] = {"registry": [s for s, _ in registry], "evals": [s for s, _ in evals],
                         "yields": [s for s, _ in yields], "scores": [s for s, _ in scores]}
    results["run_ids"] = list(run_ids) if run_ids is not None else None
    results["excluded_by_run_id"] = excluded
    results["skipped_inputs"] = skipped

    out = Path(out) if out is not None else data / "results" / "results.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=out.parent, prefix=f".{out.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(results, f, indent=1)
        os.replace(tmp, out)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise
    return out


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--data-dir", type=Path, default=None, help="default DATA_DIR")
    p.add_argument("--t2-data", type=Path, action="append", default=[], help="another root with multiply yield.json files")
    p.add_argument("--input-root", type=Path, action="append", default=[],
                   help="another data folder read in place: registry, evals, yields and scores")
    p.add_argument("--out", type=Path, default=None, help="default <data-dir>/results/results.json")
    p.add_argument("--robot", default="franka", help="whose multiply yield is shown")
    p.add_argument("--demos", default=",".join(map(str, DEMOS)), help="human demo counts on the x axis")
    p.add_argument("--ablation-demos", type=int, default=ABLATION_DEMOS)
    p.add_argument("--run-id", action="append", default=None,
                   help="use only this experiment run (repeatable); default: every run, newest wins")
    args = p.parse_args(argv)
    out = build(args.data_dir if args.data_dir is not None else data_dir(), t2_data=args.t2_data,
                input_roots=args.input_root, out=args.out,
                robot=args.robot, demos=[int(x) for x in args.demos.split(",")], ablation_demos=args.ablation_demos,
                run_ids=args.run_id)
    r = json.loads(out.read_text(encoding="utf-8"))
    filled = [k for k, v in r["sources"].items() if v["value"] is not None and v.get("file")]
    print(f"wrote {out}: {len(filled)} values from source files, {len(r['pending'])} pending, "
          f"{len(r['skipped_inputs'])} inputs skipped")
    for k in filled:
        print(f"  {k} = {r['sources'][k]['value']}  <- {r['sources'][k]['file']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
