"""Run the itemization prompt over every image in test-photos/ and report, per
image: items found, latency, tokens, finish_reason and estimated cost.

Spend safety (Nebius budget is $25 total):
  * one call per (image, tier), no retries, no loops beyond that;
  * a HARD cap on calls (--max-calls, never above ABSOLUTE_MAX_CALLS);
  * a pre-flight worst-case cost estimate; if it exceeds $1 the script refuses
    unless you pass --allow-over-1usd (ask the team lead first);
  * every call is logged to usage_log.jsonl by chat_vision().
  * stops immediately on auth / rate-limit / model-not-found errors.

Run:
    uv run python scripts/vision_eval.py --dry-run
    uv run python scripts/vision_eval.py --tiers minicpm --max-calls 3
    uv run python scripts/vision_eval.py --tiers minicpm,glm-flash --max-calls 6
"""
from __future__ import annotations

import argparse
import mimetypes
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from app.ai.vision import VISION_MAX_TOKENS, itemize_photo_detailed  # noqa: E402
from nebius_llm import TokenFactoryError, VISION_TIERS, get_vision_model, total_spend  # noqa: E402
from nebius_llm.client import AuthError, ModelNotFoundError, RateLimitError  # noqa: E402

ABSOLUTE_MAX_CALLS = 12
TOTAL_BUDGET_USD = 25.0
SINGLE_EXPERIMENT_LIMIT_USD = 1.0
WORST_CASE_PROMPT_TOKENS = 3000  # image + prompt; the one logged MiniCPM call used 702
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png"}


def find_images(folder: Path) -> list[Path]:
    return sorted(p for p in folder.iterdir() if p.suffix.lower() in IMAGE_SUFFIXES and p.is_file())


def worst_case_cost(tiers: list[str], n_images: int) -> float:
    total = 0.0
    for tier in tiers:
        spec = get_vision_model(tier)
        total += n_images * spec.estimate_cost(WORST_CASE_PROMPT_TOKENS, VISION_MAX_TOKENS)
    return total


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--photos", default="test-photos", help="folder of .jpg/.jpeg/.png images")
    parser.add_argument("--tiers", default="minicpm", help=f"comma list from: {', '.join(VISION_TIERS)}")
    parser.add_argument("--max-calls", type=int, default=6, help=f"hard cap on API calls (<= {ABSOLUTE_MAX_CALLS})")
    parser.add_argument("--dry-run", action="store_true", help="show the plan and worst-case cost; make no calls")
    parser.add_argument("--allow-over-1usd", action="store_true", help="permit a run whose worst case exceeds $1")
    parser.add_argument("--show-raw", action="store_true", help="print the raw model reply for each image")
    args = parser.parse_args()

    folder = Path(args.photos)
    if not folder.is_dir():
        print(f"No such folder: {folder}/ -- put a few shelf/drawer photos there first.")
        return 1
    images = find_images(folder)
    if not images:
        print(f"No .jpg/.jpeg/.png images in {folder}/")
        return 1
    tiers = [t.strip() for t in args.tiers.split(",") if t.strip()]
    try:
        for t in tiers:
            get_vision_model(t)
    except ValueError as error:
        print(error)
        return 1

    cap = min(args.max_calls, ABSOLUTE_MAX_CALLS)
    plan = [(tier, image) for tier in tiers for image in images]
    if len(plan) > cap:
        print(f"Plan is {len(plan)} calls ({len(images)} images x {len(tiers)} tiers) but the cap is {cap}.")
        print("Remove images, pass fewer --tiers, or raise --max-calls (max %d)." % ABSOLUTE_MAX_CALLS)
        return 1

    worst = worst_case_cost(tiers, len(images))
    spent = total_spend()["est_cost_usd"]
    print(f"Plan: {len(plan)} call(s), cap {cap}. Worst-case cost ${worst:.4f}. "
          f"Logged spend so far (this log only): ${spent:.4f} of ${TOTAL_BUDGET_USD:.2f}.")
    if worst > SINGLE_EXPERIMENT_LIMIT_USD and not args.allow_over_1usd:
        print("Worst case exceeds $1: refusing. Ask first, then pass --allow-over-1usd.")
        return 1
    if spent + worst > TOTAL_BUDGET_USD:
        print("Worst case would exceed the $25 total budget: refusing.")
        return 1
    if args.dry_run:
        for tier, image in plan:
            print(f"  would call {tier}: {image}")
        return 0

    rows = []
    calls = 0
    for tier, image in plan:
        if calls >= cap:  # belt and braces; the plan was already checked against cap
            break
        mime = mimetypes.guess_type(image.name)[0] or "image/jpeg"
        calls += 1
        print(f"\n[{calls}/{len(plan)}] {tier} <- {image.name}")
        try:
            r = itemize_photo_detailed(image.read_bytes(), mime_type=mime, tier=tier)
        except (AuthError, RateLimitError, ModelNotFoundError) as error:
            print(f"  STOP: {error}")
            return 1
        except TokenFactoryError as error:
            print(f"  FAILED (continuing): {error}")
            rows.append({"tier": tier, "image": image.name, "failed": True})
            continue
        flag = "  TRUNCATED" if r.truncated else ""
        print(f"  {len(r.candidates)} item(s) | {r.latency_s:.1f}s | "
              f"{r.prompt_tokens} in / {r.completion_tokens} out | finish={r.finish_reason} | "
              f"${r.est_cost_usd:.6f}{flag}")
        for c in r.candidates:
            note = f" [{c.uncertainty_note}]" if c.uncertainty_note else ""
            print(f"    - {c.label} ({c.category}) x{c.count}{note}")
        if args.show_raw:
            print("  --- raw ---\n  " + (r.raw_text or "<empty>").replace("\n", "\n  "))
        rows.append({"tier": tier, "image": image.name, "r": r})

    print("\n=== summary ===")
    print(f"{'tier':<10} {'images':>6} {'items':>6} {'truncated':>9} {'avg s':>7} {'avg out tok':>11} {'total $':>10}")
    for tier in tiers:
        ok = [row["r"] for row in rows if row["tier"] == tier and "r" in row]
        if not ok:
            print(f"{tier:<10} {'0':>6}")
            continue
        n = len(ok)
        print(f"{tier:<10} {n:>6} {sum(len(r.candidates) for r in ok):>6} "
              f"{sum(r.truncated for r in ok):>9} {sum(r.latency_s for r in ok) / n:>7.1f} "
              f"{sum(r.completion_tokens for r in ok) / n:>11.0f} {sum(r.est_cost_usd for r in ok):>10.6f}")
    print(f"\nCalls made: {calls}. Logged spend now: ${total_spend()['est_cost_usd']:.4f} (this log only).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
