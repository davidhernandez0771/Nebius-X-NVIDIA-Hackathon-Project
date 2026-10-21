"""The coverage report (workflow step 6, demo_pipeline.coverage) for one experiment store: per scene of the task's set,
the verified takes, repairs and variants, their spread and grasp; the eval distribution's coverage; and the requests
for what to record next. Reads only; writes coverage.json and coverage.md to --out.

    uv run --no-sync python scripts/coverage_report.py --store <DATA_DIR>/human_exp/<name>/store --out <dir>
        [--scenes-dir <DATA_DIR>]   (its scenes/ library; default: Standard + the protocol's S1-S8)
        [--eval-n 40 --eval-seed0 5020] [--takes-per-scene 2]
        [--nemotron]                (Nemotron rewords the requests; any number it adds sends that one back to the rules)

--nemotron needs NEBIUS_API_KEY in the environment (e.g. `uv run --env-file <.env> ...`); it is never printed.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(REPO / "src"), str(REPO)]

from demo_pipeline.coverage import TAKES_PER_SCENE, coverage_report, phrase_requests, render_markdown  # noqa: E402
from demo_pipeline.scene_library import SceneLibrary, protocol_entries, standard_entry  # noqa: E402
from demo_pipeline.store import DemoStore  # noqa: E402


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--store", type=Path, required=True)
    p.add_argument("--scenes-dir", type=Path, default=None, help="a DATA_DIR whose scenes/ is the task's scene set")
    p.add_argument("--eval-n", type=int, default=40)
    p.add_argument("--eval-seed0", type=int, default=5020)
    p.add_argument("--takes-per-scene", type=int, default=TAKES_PER_SCENE)
    p.add_argument("--nemotron", action="store_true")
    p.add_argument("--out", type=Path, required=True)
    args = p.parse_args(argv)
    if not (args.store / "demos").is_dir():
        p.error(f"no demo store at {args.store}")

    entries = SceneLibrary(args.scenes_dir).list() if args.scenes_dir else [standard_entry(), *protocol_entries()]
    report = coverage_report(DemoStore(args.store), entries, eval_n=args.eval_n, eval_seed0=args.eval_seed0,
                             takes_per_scene=args.takes_per_scene)
    report["store"] = str(args.store)
    texts = None
    if args.nemotron:
        from nebius_llm import chat

        phrased = phrase_requests(report["requests"], chat_fn=chat)
        texts = phrased["texts"]
        report["phrasing"] = {"texts": texts, **phrased["provenance"]}
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "coverage.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    md = render_markdown(report, texts)
    (args.out / "coverage.md").write_text(f"# Coverage: `{args.store}`\n\n{md}", encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    print(md)
    return 0


if __name__ == "__main__":
    sys.exit(main())
