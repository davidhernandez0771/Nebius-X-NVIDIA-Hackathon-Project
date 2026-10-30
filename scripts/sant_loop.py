"""SANT's closed loop in one resumable command: eval -> Nemotron's diagnosis -> frozen recipe -> recipe arm vs uniform
control arm -> both evaluated on the same fresh seeds -> one-sided Fisher. The stages are in src/demo_pipeline/loop.py.

    uv run python scripts/sant_loop.py --name <name> --root C:\\dev --data-dir C:\\dev\\pm-t6\\data ^
        --eval <eval>.episodes.jsonl [--results-only] [--post-hoc] [--env-file <.env>] ^
        --tag "human_2026102[01]*" --input mouse --min-demos 5 --eval-seed0 5680 --eval-n 40 [--dry-run] [--stage S]

  --recipe <recipe.json>   skip the diagnosis and test this recipe (e.g. data/analysis/bigtest_final/recipe_nemotron.json)
  --dry-run                print every stage's exact command; run nothing, write nothing
  --stage <stage>          run one stage (its earlier stages must be done): diagnose, freeze, train_recipe,
                           train_control, eval_recipe, eval_control, compare
  --smoke                  2000 ACT steps per arm, results marked sample (proves the stages run; measures nothing)

State: DATA_DIR/loops/<name>/loop.json (each stage's status, command, start/end, inputs hash, outputs);
preregistration.md is written by the freeze stage, before any training; compare.json and report.md at the end.
Re-run the same command to resume: finished stages whose inputs are unchanged are skipped.
Exit: 0 done, 1 refused (nothing run), 2 a stage failed (re-run to resume).
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
for p in (REPO / "src", REPO):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

from demo_pipeline.loop import INPUTS, RECIPE_SOURCES, REPAIRERS, STAGES, Loop, LoopConfig, Refused  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--name", required=True, help="the loop's name: lower-case letters, digits, _ and - (<= 56)")
    p.add_argument("--root", type=Path, default=REPO, help="every path given must be under this folder (default: the repo)")
    p.add_argument("--data-dir", type=Path, default=None, help="DATA_DIR (default: the DATA_DIR env var, or data/)")
    p.add_argument("--eval", type=Path, action="append", default=[], help="an eval to diagnose (.json or .episodes.jsonl)")
    p.add_argument("--recipe", type=Path, default=None, help="a recipe to test instead of diagnosing")
    p.add_argument("--recipe-source", choices=RECIPE_SOURCES, default="nemotron",
                   help="which recipe the diagnosis hands on: Nemotron's consensus or the code baseline")
    p.add_argument("--results-only", action="store_true", help="the eval has no traces (analyze_failures --results-only)")
    p.add_argument("--post-hoc", action="store_true", help="the eval is a test already run (analyze_failures --protect none)")
    p.add_argument("--no-model", action="store_true", help="no Nemotron call: the rules baseline only")
    p.add_argument("--k", type=int, default=3, help="independent Nemotron samples")
    p.add_argument("--env-file", type=Path, default=None, help="a .env with the Token Factory key, for the diagnosis only")
    p.add_argument("--tag", help='fnmatch pattern over human demo ids, e.g. "human_2026102[01]*"')
    p.add_argument("--ids", help="comma-separated human demo ids")
    p.add_argument("--input", choices=INPUTS, default="mouse")
    p.add_argument("--min-demos", type=int, default=None)
    p.add_argument("--repairer", choices=REPAIRERS, default="rules")
    p.add_argument("--variants", type=int, default=10)
    p.add_argument("--steps", type=int, default=30_000)
    p.add_argument("--eval-seed0", type=int, required=True, help="first fresh eval seed (no default: 5020 is spent)")
    p.add_argument("--eval-n", type=int, default=40)
    p.add_argument("--smoke", action="store_true")
    p.add_argument("--stage", choices=STAGES, default=None)
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args(argv)

    if args.data_dir is None:
        from demo_pipeline.paths import data_dir

        args.data_dir = Path(os.environ.get("DATA_DIR") or data_dir())
    try:
        cfg = LoopConfig(
            name=args.name, root=args.root, data_dir=args.data_dir, evals=tuple(args.eval), recipe=args.recipe,
            recipe_source=args.recipe_source, results_only=args.results_only, post_hoc=args.post_hoc,
            no_model=args.no_model, k=args.k, env_file=args.env_file, tag=args.tag,
            ids=tuple(args.ids.split(",")) if args.ids else None, input=args.input, min_demos=args.min_demos,
            repairer=args.repairer, variants=args.variants, steps=args.steps, eval_seed0=args.eval_seed0,
            eval_n=args.eval_n, smoke=args.smoke)
        loop = Loop(cfg, log=lambda m: print(m, flush=True))
    except Refused as e:
        print(f"[loop] REFUSED: {e}", flush=True)
        return 1
    return loop.run(stage=args.stage, dry_run=args.dry_run)


if __name__ == "__main__":
    sys.exit(main())
