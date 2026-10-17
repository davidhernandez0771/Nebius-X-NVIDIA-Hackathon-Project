"""R6 prototype eval: plain-language repair requests -> repair ops, Nemotron vs a keyword baseline.

The set (tests/data/repair_requests.jsonl, 34 requests) and the scoring rules were committed
before any model call; see the sprint 7 pre-registration in docs/superpowers/notes/2026-10-15-t4-status.md.

Spend: the model arm makes at most --max-calls calls (one per request, plus one retry when a
reply is invalid) and never makes a call that could push the run past --max-cost. Requests it
cannot afford score as empty and are marked "skipped". The keyword arm makes no calls.

Run:
  uv run python scripts/repair_request_eval.py --arm keywords --out <file>
  uv run python scripts/repair_request_eval.py --smoke "smooth the approach"     # 1 call
  uv run python scripts/repair_request_eval.py --arm model --max-calls 39 --out <file>
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from app.ai.repair_keywords import parse_with_keywords  # noqa: E402
from app.ai.repair_request import DemoContext, parse_repair_request  # noqa: E402

DATA = ROOT / "tests" / "data"
SPAN_TOL_S = 0.25
EST_CALL_USD = 0.0006  # assumed cost of the next call, raised to the dearest call seen
OPS = ("trim", "remove_pause", "smooth", "retime", "recenter_grasp", "replan_transit", "discard")
CATEGORIES = ("paraphrase", "negation", "multi", "none")


def load_set(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def load_context(path: Path = DATA / "repair_requests_context.json") -> DemoContext:
    return DemoContext.from_dict(json.loads(path.read_text(encoding="utf-8")))


# --- scoring (pre-registered) -----------------------------------------------------------

def normalize(intents: list, ctx: DemoContext) -> list[dict]:
    """One atom per thing asked for: trim both -> start + end, remove_pause all -> one per pause."""
    out: list[dict] = []
    for it in intents:
        span = list(it.span) if isinstance(getattr(it, "span", None), tuple) else getattr(it, "span", None)
        if it.op == "trim":
            atoms = [{"op": "trim", "end": e} for e in (("start", "end") if it.end == "both" else (it.end,))]
        elif it.op == "remove_pause":
            ks = range(1, len(ctx.pauses) + 1) if it.pause == "all" else [it.pause]
            atoms = [{"op": "remove_pause", "pause": k} for k in ks]
        elif it.op == "smooth":
            atoms = [{"op": "smooth", "span": span, "strength": it.strength}]
        elif it.op == "retime":
            atoms = [{"op": "retime", "span": span, "factor": it.speed_factor}]
        else:
            atoms = [{"op": it.op}]
        out += [a for a in atoms if a not in out]
    return out


def _same_span(pred, gold) -> bool:
    if isinstance(gold, list) or isinstance(pred, list):
        return (isinstance(gold, list) and isinstance(pred, list)
                and all(abs(p - g) <= SPAN_TOL_S + 1e-9 for p, g in zip(pred, gold)))
    return pred == gold


def matches(pred: dict, gold: dict) -> bool:
    if pred["op"] != gold["op"]:
        return False
    op = gold["op"]
    if op == "trim":
        return pred["end"] == gold["end"]
    if op == "remove_pause":
        return pred["pause"] == gold["pause"]
    if op == "smooth":
        return _same_span(pred["span"], gold["span"]) and gold["strength"] in (None, pred["strength"])
    if op == "retime":
        lo, hi = gold["factor"]
        return _same_span(pred["span"], gold["span"]) and lo - 1e-9 <= pred["factor"] <= hi + 1e-9
    return True


def _pair(preds: list[dict], golds: list[dict], same) -> tuple[list[dict], list[dict], list[dict]]:
    """Greedy one-to-one matching in gold order: (matched golds, unmatched preds, unmatched golds)."""
    left, hit, miss = list(preds), [], []
    for g in golds:
        k = next((i for i, p in enumerate(left) if same(p, g)), None)
        if k is None:
            miss.append(g)
        else:
            hit.append(g)
            left.pop(k)
    return hit, left, miss


def _prf(tp: int, fp: int, fn: int) -> dict:
    p = tp / (tp + fp) if tp + fp else 0.0
    r = tp / (tp + fn) if tp + fn else 0.0
    return {"tp": tp, "fp": fp, "fn": fn, "p": p, "r": r, "f1": 2 * p * r / (p + r) if p + r else 0.0}


def score(rows: list[dict]) -> dict:
    exact = {"all": [], **{c: [] for c in CATEGORIES}}
    per_op = {op: [0, 0, 0] for op in OPS}
    micro, op_only = [0, 0, 0], [0, 0, 0]
    for row in rows:
        hit, extra, miss = _pair(row["pred"], row["gold"], matches)
        ok = not extra and not miss
        exact["all"].append(ok)
        exact[row["category"]].append(ok)
        for bucket, items in ((0, hit), (1, extra), (2, miss)):
            micro[bucket] += len(items)
            for a in items:
                per_op[a["op"]][bucket] += 1
        o_hit, o_extra, o_miss = _pair(row["pred"], row["gold"], lambda p, g: p["op"] == g["op"])
        for bucket, items in ((0, o_hit), (1, o_extra), (2, o_miss)):
            op_only[bucket] += len(items)
    return {
        "n": len(rows),
        "exact": {k: sum(v) / len(v) for k, v in exact.items() if v},
        "micro": _prf(*micro),
        "op_only": _prf(*op_only),
        "per_op": {op: _prf(*v) for op, v in per_op.items()},
    }


# --- the arms ---------------------------------------------------------------------------

def _row(item: dict, pred: list[dict], **extra) -> dict:
    return {"id": item["id"], "category": item["category"], "text": item["text"],
            "gold": item["expect"], "pred": pred, **extra}


def run_keywords(items: list[dict], ctx: DemoContext) -> tuple[list[dict], dict]:
    rows = [_row(it, normalize(parse_with_keywords(it["text"], ctx), ctx)) for it in items]
    return rows, {"calls": 0, "cost": 0.0}


def run_model(items: list[dict], ctx: DemoContext, *, chat_fn=None, max_calls: int, max_cost: float) -> tuple[list[dict], dict]:
    calls, cost, dearest = 0, 0.0, EST_CALL_USD
    kwargs = {} if chat_fn is None else {"chat_fn": chat_fn}
    rows = []
    for it in items:
        if calls + 1 > max_calls or cost + dearest > max_cost:
            rows.append(_row(it, [], invalid=False, skipped="budget"))
            continue
        retries = 1 if calls + 2 <= max_calls and cost + 2 * dearest <= max_cost else 0
        res = parse_repair_request(it["text"], ctx, retries=retries, **kwargs)
        calls += res.calls
        cost += res.cost
        dearest = max(dearest, res.cost / res.calls)  # the prior stays as a floor: conservative
        rows.append(_row(it, normalize(res.intents, ctx), invalid=res.error is not None,
                         calls=res.calls, raw=res.raw, error=res.error))
    return rows, {"calls": calls, "cost": cost}


# --- CLI --------------------------------------------------------------------------------

def _summary(name: str, s: dict, spend: dict) -> str:
    ex, mi, oo = s["exact"], s["micro"], s["op_only"]
    lines = [f"[{name}] n={s['n']}  calls={spend['calls']}  cost=${spend['cost']:.6f}",
             "  exact: " + "  ".join(f"{k}={v:.3f}" for k, v in ex.items()),
             f"  micro P/R/F1 = {mi['p']:.3f}/{mi['r']:.3f}/{mi['f1']:.3f}  (tp {mi['tp']}, fp {mi['fp']}, fn {mi['fn']})",
             f"  op-only F1 = {oo['f1']:.3f}"]
    lines += [f"  {op:15s} F1={v['f1']:.3f}  (tp {v['tp']}, fp {v['fp']}, fn {v['fn']})" for op, v in s["per_op"].items()]
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--arm", choices=("keywords", "model"))
    ap.add_argument("--smoke", help="one model call on this request (not in the eval set), then exit")
    ap.add_argument("--set", type=Path, default=DATA / "repair_requests.jsonl")
    ap.add_argument("--max-calls", type=int, default=40)
    ap.add_argument("--max-cost", type=float, default=0.03)
    ap.add_argument("--out", type=Path)
    args = ap.parse_args(argv)
    ctx = load_context()
    items = load_set(args.set)

    if args.smoke or args.arm == "model":
        from dotenv import load_dotenv  # the key is read from .env and never printed
        load_dotenv(ROOT / ".env")
    if args.smoke:
        if any(it["text"].strip().lower() == args.smoke.strip().lower() for it in items):
            print("STOP: the smoke request is in the eval set")
            return 1
        res = parse_repair_request(args.smoke, ctx, retries=0)
        print(json.dumps({"raw": res.raw, "ops": [o.model_dump() for o in res.ops], "error": res.error,
                          "calls": res.calls, "cost": res.cost}, indent=2))
        return 0
    if args.arm is None:
        ap.error("give --arm or --smoke")

    if args.arm == "keywords":
        rows, spend = run_keywords(items, ctx)
    else:
        rows, spend = run_model(items, ctx, max_calls=args.max_calls, max_cost=args.max_cost)
    s = score(rows)
    print(_summary(args.arm, s, spend))
    for r in rows:
        if r["pred"] != r["gold"]:
            hit, extra, miss = _pair(r["pred"], r["gold"], matches)
            if extra or miss:
                print(f"  MISS {r['id']} {r['text']!r}\n       extra={extra}  missing={miss}"
                      + ("  [invalid]" if r.get("invalid") else "") + ("  [skipped]" if r.get("skipped") else ""))
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps({"arm": args.arm, "spend": spend, "score": s, "rows": rows}, indent=2),
                            encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
