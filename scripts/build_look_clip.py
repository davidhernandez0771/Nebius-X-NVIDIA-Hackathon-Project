"""Build the LOOK clip's data (web/public/look-clip): the same scene played by two policies side by side, from traces
Isaac already recorded. Left, the policy that imitated the 10 raw mouse demos (0/40 on seeds 5020-5059); right, the
v2 camera policy SANT built from the same 10 demos (30/40 on seeds 5400-5439). It never runs physics.

    uv run --no-sync python scripts/build_look_clip.py [--raw-traces DIR --raw-cell CELL] [--v2-traces DIR --v2-cell CELL]
                                                       [--seeds S ...] [--out DIR]

Inputs (read only). Each side is an eval_cells/run_eval folder with <cell>.episodes.jsonl and <cell>_traces/seed_<s>.*
(run_eval --trace):
- the headline evals, whose counts make the caption: the raw arm's pre-registered eval (raw_10, 0/40) and v2's
  pre-registered final test (bigtest_final, 30/40). Their counts, seeds and checkpoints are read from their own files.
- the traces to play. A side's traces may be its headline eval itself (v2's final test kept a trace of every run), a
  traced re-run of the same checkpoint (the raw arm's 10-20 trace eval, 5020-5022), or an illustrative run of the same
  checkpoint on the other side's seeds (made for this clip; never a result).

Checks (the build stops on any): each side's traces come from its headline's checkpoint with its headline's inference
options; both sides start from the same arm pose; every trace is re-judged by SANT's check_success against the scene
re-made from its seed (build_test_track.build_final_test) and must agree with its log; a seed asked for with --seeds
must be a raw failure and a v2 success.

How the pairs are picked (written into index.json as `pick`): every seed both sides have a trace for where the raw
policy failed and v2 succeeded. The raw policy failed every seed it ran (0/40), so in effect this keeps v2's successes:
it is a cherry-pick of v2's good runs, and the page labels it an illustrative replay. v2's 10 failures are on the
test track.

Writes:
    <out>/index.json             {built, caption, label, pick, sides: {raw, v2}, pairs: [{seed, raw: run, v2: run}]}
    <out>/runs/raw/<seed>.json   the test track's run payload (build_test_track.build_final_test), 50 Hz, every step
    <out>/runs/v2/<seed>.json
Run files of seeds no longer picked are left in place (never deleted); index.json names the ones in use.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_test_track as btt  # noqa: E402

REPO = Path(__file__).resolve().parents[1]
OUT = REPO / "web" / "public" / "look-clip"
# The pre-registered evals behind the caption (docs/superpowers/notes/2026-10-20-mouse20261020-results.md and
# 2026-10-23-bigtest-prereg.md "THE TEST").
RAW_HEADLINE = (Path(r"C:\dev\pm-t6\data\evals\hx_mouse20261020_20261020_164411"), "raw_10")
V2_HEADLINE = (Path(r"C:\dev\pm-t6-big\data\evals\bigtest_test"), "bigtest_final")
# The traces on disk before this clip: the raw arm's traced re-run (5020-5022) and v2's final test (5400-5439).
RAW_TRACES = (Path(r"C:\dev\pm-t6\data\trace_eval_20261020\evals\hx_mouse20261020_20261020_164411"), "trace_raw_10")
V2_TRACES = V2_HEADLINE

SIDES = {
    "raw": {"title": "Copying the 10 raw demos",
            "what": "An ACT camera policy trained directly on the 10 human mouse demos, no SANT."},
    "v2": {"title": "SANT v2",
           "what": "The same 10 demos, physics-checked and multiplied by SANT, taught to an RL teacher and distilled into an ACT camera policy."},
}


def read_log(root: Path, cell: str) -> tuple[dict, dict[int, dict]]:
    """An eval's episode log: its header and its episodes by seed."""
    lines = [json.loads(x) for x in (root / f"{cell}.episodes.jsonl").read_text(encoding="utf-8").splitlines() if x.strip()]
    header = next((r["header"] for r in lines if "header" in r), {})
    return header, {int(r["episode"]["seed"]): r["episode"] for r in lines if "episode" in r}


def headline(root: Path, cell: str) -> dict:
    """The pre-registered count, from the eval's own summary, checked against its episode log."""
    header, eps = read_log(root, cell)
    s = (json.loads((root / f"{cell}.json").read_text(encoding="utf-8")).get("summary") or {})
    k = sum(bool(e["success"]) for e in eps.values())
    if (s.get("successes"), s.get("n")) != (k, len(eps)):
        raise ValueError(f"{cell}.json says {s.get('successes')}/{s.get('n')}, its episode log {k}/{len(eps)}")
    return {"successes": k, "n": len(eps), "seeds": [min(eps), max(eps)], "checkpoint": header.get("checkpoint"),
            "header": header, "episodes": eps, "root": root.resolve(), "cell": cell}


def _ckpt(p) -> str:
    return str(p or "").replace("/", "\\").rstrip("\\").lower()


def _inference(header: dict) -> dict:
    """The inference options that change what the policy does (all off by default; older logs don't list them)."""
    return {k: v for k, v in (header.get("inference") or {}).items() if v not in (None, False)}


def standing(side_root: Path, cell: str, seed: int, ep: dict, head: dict) -> str:
    """counted: the run is one of the headline's own; rerun: a traced re-run of a counted seed that ended exactly as the
    counted run did; illustrative: run for this clip, on a seed the headline didn't count."""
    if side_root.resolve() == head["root"] and cell == head["cell"]:
        return "counted"
    h = head["episodes"].get(seed)
    if h is None:
        return "illustrative"
    same = (bool(h["success"]) == bool(ep["success"]) and sorted(h["reasons"]) == sorted(ep["reasons"])
            and h.get("final_cube_pos") is not None and ep.get("final_cube_pos") is not None
            and np.allclose(h["final_cube_pos"], ep["final_cube_pos"], atol=1e-5))
    if not same:
        raise ValueError(f"seed {seed}: the re-run ended differently from the counted run ({ep['reasons']} vs {h['reasons']})")
    return "rerun"


def build(raw: tuple[Path, str], v2: tuple[Path, str], out: Path, *, seeds: list[int] | None = None,
          raw_head: tuple[Path, str] = RAW_HEADLINE, v2_head: tuple[Path, str] = V2_HEADLINE,
          scene_for=None, judge=None) -> dict:
    heads = {"raw": headline(*raw_head), "v2": headline(*v2_head)}
    sides = {"raw": raw, "v2": v2}
    logs = {sid: read_log(*sides[sid]) for sid in sides}
    for sid, (header, _) in logs.items():
        if _ckpt(header.get("checkpoint")) != _ckpt(heads[sid]["checkpoint"]):
            raise ValueError(f"{sid}: the traces are from {header.get('checkpoint')}, the headline from {heads[sid]['checkpoint']}")
        if _inference(header) != _inference(heads[sid]["header"]):
            raise ValueError(f"{sid}: the traces ran with {_inference(header)}, the headline with {_inference(heads[sid]['header'])}")
    poses = [logs[sid][0].get("reset_pose") for sid in sides]
    if any(p is None for p in poses) or not np.allclose(poses[0], poses[1], atol=1e-6):
        raise ValueError(f"the two sides don't start from the same arm pose: {poses}")
    common = sorted(set(logs["raw"][1]) & set(logs["v2"][1]))
    qualifies = [s for s in common if not logs["raw"][1][s]["success"] and logs["v2"][1][s]["success"]]
    if seeds is not None:
        if bad := [s for s in seeds if s not in qualifies]:
            raise ValueError(f"seeds {bad}: not a raw failure and a v2 success with a trace on both sides (those are {qualifies})")
        picked = list(seeds)
    else:
        picked = qualifies
    if not picked:
        raise ValueError(f"no seed has a trace on both sides with a raw failure and a v2 success (common seeds: {common})")

    built = {}
    for sid, (root, cell) in sides.items():
        src = btt.build_final_test(root, sid, SIDES[sid]["title"], SIDES[sid]["what"], out, cell=cell, seeds=picked,
                                   scene_for=scene_for or btt.final_scene, judge=judge or btt.judge_trace)
        built[sid] = {r["seed"]: r for r in src["runs"]}
    for seed in picked:  # the scene is the same by construction (one seed, one sampler); say so if the traces disagree
        a, b = (json.loads((out / built[sid][seed]["file"]).read_text(encoding="utf-8")) for sid in sides)
        if a["bin"] != b["bin"] or not np.allclose(a["cube_pos"][0], b["cube_pos"][0], atol=2e-3):
            raise ValueError(f"seed {seed}: the two traces don't start from the same cube and bin")

    pairs = [{"seed": s, **{sid: {**built[sid][s], "standing": standing(sides[sid][0], sides[sid][1], s, logs[sid][1][s], heads[sid])}
                            for sid in sides}} for s in picked]
    k_raw, k_v2 = heads["raw"], heads["v2"]
    index = {
        "built": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "caption": f"Same 10 demos. Same scene. {k_raw['successes']}/{k_raw['n']} vs {k_v2['successes']}/{k_v2['n']}.",
        "label": "Illustrative replay",
        "pick": (f"Picked: the seeds where both policies have a recorded trace, the raw-demo policy failed and v2 succeeded "
                 f"({len(picked)} of {len(common)} shared seeds{'' if seeds is None else ', chosen by hand'}). The raw-demo policy "
                 f"failed all {k_raw['n']} of its counted runs, so this keeps v2's successes: a cherry-pick for the picture. "
                 f"v2's {k_v2['n'] - k_v2['successes']} failures are on the test track."),
        "sides": {sid: {**SIDES[sid], "checkpoint": heads[sid]["checkpoint"],
                        "headline": {k: heads[sid][k] for k in ("successes", "n", "seeds")}} for sid in sides},
        "pairs": pairs,
    }
    btt._write(out / "index.json", index)
    return index


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--raw-traces", type=Path, default=RAW_TRACES[0])
    ap.add_argument("--raw-cell", default=RAW_TRACES[1])
    ap.add_argument("--v2-traces", type=Path, default=V2_TRACES[0])
    ap.add_argument("--v2-cell", default=V2_TRACES[1])
    ap.add_argument("--seeds", type=int, nargs="+", default=None, help="these seeds, in this order (the first plays first)")
    ap.add_argument("--out", type=Path, default=OUT)
    a = ap.parse_args(argv)
    index = build((a.raw_traces, a.raw_cell), (a.v2_traces, a.v2_cell), a.out, seeds=a.seeds)
    print(index["caption"])
    for p in index["pairs"]:
        print(f"seed {p['seed']}: raw {p['raw']['standing']} {p['raw']['reasons']} · v2 {p['v2']['standing']} {p['v2']['duration_s']} s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
