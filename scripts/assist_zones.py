"""A scene's assist zones: the geometric soft floor for every support surface, plus Nemotron's (or the rules') semantic
rules on top (app.ai.assist_planner, demo_pipeline.assist_rules, demo_pipeline.soft_floor).

The plan file is a ScenePlan JSON (e.g. sim_worker/scene_examples/*.json) or a scene creator file
(DATA_DIR/scenes/<id>.json: {"text", "plan", ...}). Prints the rules, the source and every zone; --out saves
{"rules", "floor_rules", "zones", "source", "fallback_reason", "calls"}.

Run:
  uv run python scripts/assist_zones.py sim_worker/scene_examples/2_stack_of_three_two_bins.json --text "..."
  uv run python scripts/assist_zones.py <plan.json> --rules-only        # no model call
Real calls need the Nebius key in the environment (uv run --env-file <.env>); it is never printed.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from app.ai.assist_planner import TIER, plan_assist  # noqa: E402
from demo_pipeline.scene_plan import ScenePlan  # noqa: E402

_DEFAULT = object()


def _load(path: Path) -> tuple[ScenePlan, str | None]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if "plan" in data:
        return ScenePlan.model_validate(data["plan"]), data.get("text")
    return ScenePlan.model_validate(data), None


def _goals_text(plan: ScenePlan) -> str:
    return "; ".join(f"put {g.object} in {g.bin}" for g in plan.goals)


def main(argv: list[str] | None = None, *, chat_fn=_DEFAULT) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("plan", type=Path)
    p.add_argument("--text", help="the scene in words (default: the scene creator file's, or the goals)")
    p.add_argument("--rules-only", action="store_true", help="no model call: the rules fallback")
    p.add_argument("--tier", default=TIER)
    p.add_argument("--out", type=Path)
    args = p.parse_args(argv)

    plan, text = _load(args.plan)
    text = args.text or text or _goals_text(plan)
    kwargs = {} if chat_fn is _DEFAULT else {"chat_fn": chat_fn}
    if args.rules_only:
        kwargs["chat_fn"] = None
    res = plan_assist(text, plan, tier=args.tier, **kwargs)
    for n, a in enumerate(res.attempts, start=1):
        print(f"attempt {n}: " + ("valid" if not a["errors"] else "; ".join(a["errors"])))
    print(f"source: {res.source}" + (f" ({res.fallback_reason})" if res.fallback_reason else "")
          + f"; calls {res.calls}, est. cost ${res.cost:.4f}")
    print("rules: " + res.rules.model_dump_json())
    if res.floor_rules is not None:
        print("rules kept under them: " + res.floor_rules.model_dump_json())
    for z in res.zones.zones:
        cap = f", speed cap {z.speed_cap} m/s" if z.speed_cap is not None else ""
        print(f"  {z.id:24s} {z.kind:9s} floor {z.floor:.3f} m over {2 * z.half[0] * 100:.0f} x {2 * z.half[1] * 100:.0f} cm "
              f"at ({z.center[0]:.3f}, {z.center[1]:.3f}){cap}  [{z.source}]")
    if args.out:
        floor = json.loads(res.floor_rules.model_dump_json()) if res.floor_rules is not None else None
        args.out.write_text(json.dumps({"rules": json.loads(res.rules.model_dump_json()), "floor_rules": floor,
                                        "zones": res.zones.to_dict(),
                                        "source": res.source, "fallback_reason": res.fallback_reason, "calls": res.calls},
                                       indent=1), encoding="utf-8")
        print(f"saved {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
