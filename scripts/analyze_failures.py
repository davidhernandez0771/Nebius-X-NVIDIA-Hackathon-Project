"""A traced policy eval -> measured failures -> Nemotron's data recipe -> the scenes to multiply into next.

Input: an eval run with --trace (sim_eval/scripts/run_eval.py, eval_cells.py): <name>.json or <name>.episodes.jsonl,
plus <name>_traces/seed_<seed>.npz. Only unseen scenes (seed >= 5000) are analysed: their scene is sample_scene(seed).
Training-scene episodes are skipped, since their scenes come from the dataset.

Writes to --out:
  features.json         every analysed episode, measured (demo_pipeline.failure_features)
  failure_table.json    first-failure counts per bin of each scene axis
  contrast.json         failed vs successful episodes on grasp and motion measurements (medians, effect, p)
  analysis.json         Nemotron's candidate recipes, the consensus, agreement, every reply, calls and cost
  recipe_nemotron.json  the consensus recipe          scenes_nemotron.json  its --n scenes (seeds --seed0..)
  recipe_rules.json     the code-only baseline recipe scenes_rules.json     its --n scenes
  scenes_uniform.json   the control: --n scenes exactly as multiply has always sampled them
  report.md             a readable summary
Each scenes_*.json is {"recipe", "seed0", "n", "scenes": [Scene...], "regions": [name per scene]}; its "scenes" go
into MultiplyRequest.scenes as they are.

Several --eval files can be pooled (the same policy on different seeds, e.g. its selection eval and its test).

No traces (an eval run without --trace, or traces left on another machine): --results-only builds each episode from
the eval's own result row (scene, check_success reasons, where the cube ended). Scene patterns can still be found;
grasp and motion mechanisms can't, so the recipe can only move scenes or say "keep the data as it is".

Seed discipline: the pre-registered test seeds (default 5020-5059 and the big test's 5400-5439) are refused, so a
recipe can never be fitted to the scenes it will be judged on. Analyse practice or selection seeds. To diagnose a test that has already run once (its
result stands as run), pass --protect none: the report marks it post-hoc, and any change it suggests must be judged
on fresh seeds.

Run:
  uv run python scripts/analyze_failures.py --eval DATA/evals/<run>/<cell>.json --out DATA/analysis/<name>
  uv run python scripts/analyze_failures.py --eval ... --out ... --no-model    # measurements + rules baseline only
  uv run python scripts/analyze_failures.py --eval A.json --eval B.episodes.jsonl --results-only --protect none ...

Spend: --k independent recipes (default 3), each with up to --retries fixes; about 3-9 calls to the super tier.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT))

from demo_pipeline.data_recipe import (  # noqa: E402
    DataRecipe, contrast_table, region_support, rules_mechanism, rules_recipe, sample_recipe_scenes, uniform_scenes,
    validate_recipe,
)
from demo_pipeline.failure_features import EpisodeFeatures, episode_features, result_features  # noqa: E402
from demo_pipeline.multiply import sample_scene  # noqa: E402

EVAL_SEED_MIN = 5000  # sim_eval.scenes: unseen scenes start here
TEST_SEEDS = ((5020, 5059), (5400, 5439))  # the pre-registered tests: distill final, big test (sim_eval.distill_round)


def parse_range(text: str) -> tuple[int, int]:
    lo, _, hi = text.partition("-")
    return int(lo), int(hi or lo)


def parse_ranges(text: str) -> tuple[tuple[int, int], ...]:
    """'5020-5059,5400-5439' -> ((5020, 5059), (5400, 5439)); 'none' -> ()."""
    return () if text == "none" else tuple(parse_range(t.strip()) for t in text.split(",") if t.strip())


def in_ranges(seed: int, ranges) -> bool:
    return any(lo <= seed <= hi for lo, hi in ranges)


def read_eval(path: Path) -> tuple[list[dict], Path]:
    """The episode rows and the default traces folder of an eval's results: <name>.json ({"episodes": [...]}, from
    run_eval) or <name>.episodes.jsonl (a header line, then {"episode": {...}} per line, from the episode log; the
    last row per seed wins, as a resume reads it). Traces are <name>_traces next to it."""
    path = Path(path)
    if path.name.endswith(".episodes.jsonl"):
        latest: dict[int, dict] = {}
        for line in path.read_text(encoding="utf-8").splitlines():
            rec = json.loads(line) if line.strip() else {}
            if "episode" in rec:
                latest[int(rec["episode"]["seed"])] = rec["episode"]
        return [latest[s] for s in sorted(latest)], path.with_name(path.name[: -len(".episodes.jsonl")] + "_traces")
    return json.loads(path.read_text(encoding="utf-8"))["episodes"], path.with_name(path.stem + "_traces")


def load_episodes(eval_path: Path, traces_dir: Path | None, *, protect=TEST_SEEDS, robot: str = "franka",
                  results_only: bool = False, log=print) -> list[EpisodeFeatures]:
    """protect: seed ranges to refuse, ((lo, hi), ...); () refuses none. results_only: no traces, each episode from
    its result row (failure_features.result_features)."""
    rows, default_traces = read_eval(eval_path)
    traces_dir = traces_dir or default_traces
    if not results_only and not traces_dir.is_dir():
        raise FileNotFoundError(f"no traces at {traces_dir}; re-run the eval with --trace, or pass --results-only")
    out = []
    for row in rows:
        seed = int(row["seed"])
        if in_ranges(seed, protect):
            raise ValueError(f"seed {seed} is a pre-registered test seed ({protect}); analyse practice seeds, or pass "
                             "--protect none to diagnose a test that has already run (its result stands as run)")
        if seed < EVAL_SEED_MIN:
            log(f"[analyze] seed {seed}: a training scene, skipped")
            continue
        if row.get("ended_by") in ("policy_error", "sim_error"):
            log(f"[analyze] seed {seed}: ended by {row['ended_by']}, skipped (not a policy failure)")
            continue
        scene = sample_scene(np.random.default_rng(seed), robot, seed)
        if results_only:
            out.append(result_features(row, scene))
            continue
        path = traces_dir / f"seed_{seed}.npz"
        if not path.exists():
            log(f"[analyze] seed {seed}: no trace, skipped")
            continue
        with np.load(path) as npz:
            trace = {k: npz[k] for k in npz.files}
        ep = episode_features(trace, scene, success=bool(row["success"]))
        out.append(ep.model_copy(update={"reasons": [str(r) for r in row.get("reasons") or []]}))
    return out


def load_all(evals: list[Path], traces_dir: Path | None, **kw) -> list[EpisodeFeatures]:
    """Several evals pooled; a seed in two of them is refused (two policies or two runs on one scene)."""
    if traces_dir is not None and len(evals) > 1:
        raise ValueError("--traces names one folder; with several --eval files keep each one's <name>_traces")
    out: list[EpisodeFeatures] = []
    for path in evals:
        out += load_episodes(path, traces_dir, **kw)
    seeds = [e.seed for e in out]
    dup = sorted({s for s in seeds if seeds.count(s) > 1})
    if dup:
        raise ValueError(f"seeds {dup} appear in more than one eval")
    return sorted(out, key=lambda e: e.seed)


def scenes_file(recipe_name: str, scenes, regions, seed0: int) -> dict:
    return {"recipe": recipe_name, "seed0": seed0, "n": len(scenes),
            "scenes": [s.model_dump() for s in scenes], "regions": regions}


def _write(path: Path, obj) -> None:
    path.write_text(json.dumps(obj, indent=1, allow_nan=False, default=str), encoding="utf-8")


def _fmt_recipe(r: DataRecipe, episodes: list[EpisodeFeatures]) -> str:
    lines = [f"_{r.summary}_", ""]
    lines += ["| region | episodes inside | its target failures inside | coverage | rate inside vs overall | p |",
              "|---|---|---|---|---|---|"]
    for s in region_support(r, episodes):
        lines.append(f"| {s.region} | {s.episodes_inside} | {s.target_failures_inside} / {s.target_failures_total} | "
                     f"{s.coverage:.0%} | {s.rate_inside:.2f} vs {s.rate_overall:.2f} | {s.p_value:.3g} |")
    lines.append("")
    for h in r.hypotheses:
        lines.append(f"- **Hypothesis:** {h.claim} (seeds {', '.join(map(str, h.evidence_seeds))})")
    for m in r.mechanism:
        lines.append(f"- **Mechanism:** `{m.feature}` {m.direction.replace('_', ' ')}: {m.explanation}")
    for f in r.fixes:
        params = {k: v for k, v in f.model_dump().items()
                  if k in ("feature", "keep", "threshold", "max_speed_mps") and v is not None}
        lines.append(f"- **Fix:** `{f.lever}` {json.dumps(params) if params else ''}: {f.rationale}")
    if not r.regions:
        lines += ["", "No scene regions: the scenes stay uniform."]
        return "\n".join(lines)
    lines += ["", "| region | targets | share | cube x | cube y | yaw (deg) | bin x | bin y |", "|---|---|---|---|---|---|---|---|"]
    for g in r.regions:
        lines.append(f"| {g.name} | {', '.join(g.targets)} | {g.share:.2f} | {g.cube_x[0]:.2f}–{g.cube_x[1]:.2f} | "
                     f"{g.cube_y[0]:.2f}–{g.cube_y[1]:.2f} | {g.cube_yaw_deg[0]:.0f}–{g.cube_yaw_deg[1]:.0f} | "
                     f"{g.bin_x[0]:.2f}–{g.bin_x[1]:.2f} | {g.bin_y[0]:.2f}–{g.bin_y[1]:.2f} |")
    lines.append(f"| uniform | | {r.uniform_share:.2f} | full range | | | | |")
    for g in r.regions:
        lines.append(f"\n- **{g.name}:** {g.rationale}")
    return "\n".join(lines)


def report_md(episodes: list[EpisodeFeatures], analysis: dict | None, rules: DataRecipe | None) -> str:
    from collections import Counter
    n = len(episodes)
    k = sum(e.success for e in episodes)
    counts = Counter(e.primary for e in episodes if e.primary)
    lines = ["# Failure analysis", "", f"{n} unseen-scene episodes, {k} succeeded, {n - k} failed.", ""]
    used_test = sorted(e.seed for e in episodes if in_ranges(e.seed, TEST_SEEDS))
    if used_test:
        sets = ", ".join(f"{lo}–{hi}" for lo, hi in TEST_SEEDS if any(lo <= s <= hi for s in used_test))
        lines += [f"> **Post-hoc:** {len(used_test)} of these are pre-registered test seeds ({sets}). This is a "
                  "diagnosis of a finished test. Any change it suggests must be judged on fresh seeds, never on these.",
                  ""]
    untraced = sum(e.source == "result" for e in episodes)
    if untraced:
        lines += [f"> **No traces:** {untraced} episodes come from the eval's result rows only (scene, reason codes, "
                  "where the cube ended). Their class comes from the reason codes, and there are no grasp or motion "
                  "measurements, so the contrast table below is empty for them.", ""]
    lines += ["| first failure | episodes |", "|---|---|"]
    lines += [f"| {c} | {m} |" for c, m in counts.most_common()]
    lines += ["", "## Failed vs successful episodes (measured)", "",
              "| feature | median, failures | median, successes | effect (+ = higher in failures) | p | n fail / ok |",
              "|---|---|---|---|---|---|"]
    for c in contrast_table(episodes):
        def fmt(v, spec=".4g"):
            return "–" if v is None else format(v, spec)
        lines.append(f"| {c.feature} | {fmt(c.median_failure)} | {fmt(c.median_success)} | {fmt(c.effect, '+.2f')} | "
                     f"{fmt(c.p_value, '.3g')} | {c.n_failure} / {c.n_success} |")
    strong = rules_mechanism(episodes)
    lines += ["", "Code alone (p ≤ 0.05, |effect| ≥ 0.2): " +
              (", ".join(f"`{c.feature}` {'higher' if c.effect > 0 else 'lower'} in failures" for c in strong)
               if strong else "no measured difference is that clear.")]
    lines += ["", "## Nemotron's recipe", ""]
    no_change = analysis is not None and analysis["recipe"] is not None and not analysis["recipe"]["regions"] \
        and not analysis["recipe"]["fixes"]
    if no_change:
        lines += ["**Verdict: keep the data as it is.** No scene region or fix passed the checks.", ""]
    if analysis is None:
        lines.append("Not asked (--no-model).")
    elif analysis["recipe"] is None:
        lines.append(f"No valid recipe in {analysis['calls']} calls; the replies and their problems are in analysis.json.")
    else:
        agree = analysis["agreement"]
        lines.append(f"{len(analysis['candidates'])} of {analysis['k']} samples gave a valid recipe; the consensus "
                     f"one agrees with the others at {'n/a' if agree is None else f'{agree:.2f}'} (0 = no overlap, "
                     f"1 = identical). {analysis['calls']} calls, ${analysis['cost_usd']:.4f}, {analysis['model']}.")
        lines += ["", _fmt_recipe(DataRecipe.model_validate(analysis["recipe"]), episodes)]
    lines += ["", "## Rules baseline", ""]
    lines.append("No failure class has 3 or more episodes." if rules is None else _fmt_recipe(rules, episodes))
    lines += ["", "## Next", "", "Multiply the same source demos into scenes_nemotron, scenes_rules and scenes_uniform "
              "(MultiplyRequest.scenes), train one policy per arm with identical settings, and evaluate all three on "
              "the same unseen seeds that none of this analysis used."]
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--eval", type=Path, required=True, action="append",
                   help="an eval's results (.json or .episodes.jsonl); repeat to pool evals of the same policy")
    p.add_argument("--results-only", action="store_true",
                   help="no traces: each episode from its result row (scene, reasons, final cube position)")
    p.add_argument("--traces", type=Path, help="the traces folder (default: <eval>_traces next to it)")
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--robot", default="franka")
    p.add_argument("--n", type=int, default=100, help="scenes per arm")
    p.add_argument("--seed0", type=int, default=3000, help="first seed of the generated scenes (below 5000)")
    p.add_argument("--k", type=int, default=3, help="independent Nemotron samples")
    p.add_argument("--retries", type=int, default=2)
    p.add_argument("--no-model", action="store_true", help="measurements and the rules baseline only, no Nemotron call")
    p.add_argument("--protect", default=",".join(f"{lo}-{hi}" for lo, hi in TEST_SEEDS),
                   help="test seed ranges to refuse, e.g. 5020-5059,5400-5439, or 'none'")
    args = p.parse_args(argv)

    episodes = load_all(args.eval, args.traces, protect=parse_ranges(args.protect), robot=args.robot,
                        results_only=args.results_only)
    if not episodes:
        print("[analyze] no unseen-scene episodes to analyse")
        return 1
    args.out.mkdir(parents=True, exist_ok=True)
    _write(args.out / "features.json", [e.model_dump() for e in episodes])
    from app.ai.failure_analyst import analyse, failure_table
    _write(args.out / "failure_table.json", failure_table(episodes, args.robot))
    _write(args.out / "contrast.json", [c.model_dump() for c in contrast_table(episodes)])

    rules = rules_recipe(episodes, args.robot)
    if rules is not None:
        problems = validate_recipe(rules, robot=args.robot)
        if problems:
            print(f"[analyze] the rules baseline is not usable: {problems}")
            rules = None
    if rules is not None:
        _write(args.out / "recipe_rules.json", rules.model_dump())
        pairs = sample_recipe_scenes(rules, args.n, args.seed0, args.robot)
        _write(args.out / "scenes_rules.json", scenes_file("rules", [s for s, _ in pairs], [r for _, r in pairs], args.seed0))
    _write(args.out / "scenes_uniform.json",
           scenes_file("uniform", uniform_scenes(args.n, args.seed0, args.robot), ["uniform"] * args.n, args.seed0))

    analysis = None
    if not args.no_model:
        if all(e.success for e in episodes):
            print("[analyze] every episode succeeded; Nemotron not asked")
        else:
            res = analyse(episodes, robot=args.robot, k=args.k, retries=args.retries)
            analysis = {
                "k": args.k, "calls": res.calls, "cost_usd": round(res.cost, 6), "model": res.model,
                "api_errors": res.api_errors,
                "recipe": None if res.recipe is None else res.recipe.model_dump(),
                "support": None if res.recipe is None else [s.model_dump() for s in region_support(res.recipe, episodes)],
                "agreement": None if res.agreement is None or math.isnan(res.agreement) else res.agreement,
                "candidates": [c.model_dump() for c in res.candidates],
                "candidate_agreement": [None if math.isnan(a) else a for a in res.candidate_agreement],
                "attempts": [vars(a) for a in res.attempts],
            }
            _write(args.out / "analysis.json", analysis)
            if res.recipe is not None:
                _write(args.out / "recipe_nemotron.json", res.recipe.model_dump())
                pairs = sample_recipe_scenes(res.recipe, args.n, args.seed0, args.robot)
                _write(args.out / "scenes_nemotron.json",
                       scenes_file("nemotron", [s for s, _ in pairs], [r for _, r in pairs], args.seed0))
    (args.out / "report.md").write_text(report_md(episodes, analysis, rules), encoding="utf-8")
    print(f"[analyze] {len(episodes)} episodes analysed; wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
