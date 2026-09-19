"""Debug helper: run the itemization prompt on one image file and print
exactly what the model said, before any JSON parsing. Use this when the
Review screen shows "No candidates" and you need to see why.

Run:
    uv run python scripts/vision_debug.py path/to/photo.jpg
    uv run python scripts/vision_debug.py path/to/photo.jpg --tier glm-flash
"""
from __future__ import annotations

import argparse
import mimetypes
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from app.ai.vision import ITEMIZE_PROMPT, _parse_candidates  # noqa: E402
from nebius_llm import TokenFactoryError, chat_vision  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("image_path")
    parser.add_argument("--tier", default=None, help="minicpm (default) or glm-flash")
    args = parser.parse_args()

    path = Path(args.image_path)
    if not path.exists():
        print(f"No such file: {path}")
        return 1
    mime_type = mimetypes.guess_type(path.name)[0] or "image/jpeg"
    print(f"Sending {path} ({path.stat().st_size} bytes, mime={mime_type}) to tier={args.tier or 'minicpm'}...")

    try:
        result = chat_vision(ITEMIZE_PROMPT, path.read_bytes(), mime_type=mime_type, tier=args.tier)
    except TokenFactoryError as error:
        print(f"FAILED: {error}")
        return 1

    print(f"\nModel: {result.model}")
    print(f"Tokens: {result.prompt_tokens} in / {result.completion_tokens} out  finish={result.finish_reason}")
    print(f"Cost: ${result.est_cost_usd:.6f}")
    print("\n--- raw response text ---")
    print(result.text or "<empty>")
    print("--- end ---")

    parsed = _parse_candidates(result.text)
    print(f"\nParsed as {len(parsed)} candidate(s):")
    for c in parsed:
        print(f"  - {c.label} ({c.category}, x{c.count}) {c.uncertainty_note}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
