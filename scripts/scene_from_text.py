"""A scene in words -> a ScenePlan from Nemotron, checked by code (app.ai.scene_creator, demo_pipeline.scene_plan).

Prints the plan, where every object ends up, and the validation. A valid plan is saved as
DATA_DIR/scenes/<id>.json ({"id", "text", "created", "model", "calls", "est_cost_usd", "plan"}).

Run:
  uv run python scripts/scene_from_text.py "2 bins, 3 cubes stacked in a pile, put the red one in the left bin"
  uv run python scripts/scene_from_text.py --check <plan.json>     # validate a plan file, no model call
  uv run python scripts/scene_from_text.py --settle "..."           # also settle each valid plan in Isaac (GPU)

--settle builds each plan the validator passes in Isaac and lets it settle for 1 s (sim_worker.settle): what moves,
falls or tips goes back to the model like a validator problem. It runs Isaac's python as a subprocess, which takes
the shared GPU lock (C:\\dev\\gpu.lock), so it waits while another GPU job runs.

Spend: one call, plus up to --retries more when the plan has problems.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT))  # for sim_worker (--settle)

from app.ai.scene_creator import RETRIES, TIER, PlanReplyError, parse_plan, plan_from_text  # noqa: E402
from demo_pipeline.paths import data_dir  # noqa: E402
from demo_pipeline.scene_plan import ScenePlan, StackError, resolve, validate_plan  # noqa: E402


def plan_id(text: str, now: datetime) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")[:40].rstrip("_") or "scene"
    return f"{now:%Y%m%d_%H%M%S}_{slug}"


def describe(plan: ScenePlan) -> str:
    """One line per object: where it ends up (heights resolved through the stacks)."""
    try:
        placed = resolve(plan)
    except StackError:
        return "  (the stacks can't be built, so positions aren't resolved)"
    lines = []
    for o in plan.objects:
        p = placed[o.id]
        what = f"{o.color} {o.kind}" + (f" {o.size * 100:.0f} cm" if o.kind == "cube" else
                                        f" {o.inner[0] * 100:.0f}x{o.inner[1] * 100:.0f}x{o.inner[2] * 100:.0f} cm")
        where = f"on {p.support}" if p.support else "on the table"
        lines.append(f"  {o.id:14s} {what:24s} x {p.pos[0]:+.3f}  y {p.pos[1]:+.3f}  z {p.pos[2]:.3f}  "
                     f"yaw {p.yaw_deg:+.0f}  {where}")
    lines.append("  goals: " + ", ".join(f"{g.object} -> {g.bin}" for g in plan.goals))
    return "\n".join(lines)


def settle_check(plan: ScenePlan) -> list[str]:
    """The physics settle in Isaac (a subprocess; no Isaac in this process)."""
    from sim_worker.settle import settle_in_isaac

    return settle_in_isaac(plan)


def _report(plan: ScenePlan | None, errors: list[str]) -> None:
    if plan is not None:
        print(json.dumps(plan.model_dump(mode="json"), indent=2))
        print(describe(plan))
    print("validation: valid" if not errors else "validation: INVALID\n" + "\n".join(f"  - {e}" for e in errors))


def main(argv: list[str] | None = None, *, chat_fn=None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("text", nargs="?", help="the scene in words")
    p.add_argument("--check", type=Path, help="validate this plan JSON file instead of asking the model")
    p.add_argument("--tier", default=TIER)
    p.add_argument("--robot", default="franka")
    p.add_argument("--retries", type=int, default=RETRIES)
    p.add_argument("--no-save", action="store_true")
    p.add_argument("--settle", action="store_true", help="also settle each valid plan in Isaac (uses the GPU)")
    args = p.parse_args(argv)

    if args.check:
        try:
            plan = parse_plan(args.check.read_text(encoding="utf-8"), args.robot)
        except PlanReplyError as e:
            _report(None, e.errors)
            return 1
        errors = validate_plan(plan)
        _report(plan, errors)
        return 0 if not errors else 1
    if not args.text:
        p.error("give the scene in words, or --check <plan.json>")

    kwargs = {"chat_fn": chat_fn} if chat_fn is not None else {}
    if args.settle:
        kwargs["check_fn"] = lambda plan: settle_check(plan)
    res = plan_from_text(args.text, robot=args.robot, tier=args.tier, retries=args.retries, **kwargs)
    for n, a in enumerate(res.attempts[:-1], start=1):
        print(f"attempt {n}: {len(a['errors'])} problem(s), sent back: " + "; ".join(a["errors"]))
    shown = res.plan
    if shown is None:
        try:
            shown = parse_plan(res.attempts[-1]["reply"], args.robot)
        except PlanReplyError:
            shown = None
    _report(shown, res.errors)
    print(f"calls {res.calls}, est. cost ${res.cost:.4f}" + (f", model {res.model}" if res.model else ""))
    if not res.ok:
        return 1
    if not args.no_save:
        now = datetime.now(timezone.utc)
        pid = plan_id(args.text, now)
        out = data_dir() / "scenes" / f"{pid}.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps({"id": pid, "text": args.text, "created": now.isoformat(timespec="seconds"),
                                   "model": res.model, "calls": res.calls, "est_cost_usd": round(res.cost, 6),
                                   "plan": res.plan.model_dump(mode="json")}, indent=2), encoding="utf-8")
        print(f"saved {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
