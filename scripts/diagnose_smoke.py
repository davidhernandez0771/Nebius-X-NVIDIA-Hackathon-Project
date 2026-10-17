"""Live smoke test of the Nemotron VL diagnoser on a synthetic demo with one 0.9 s pause.

Run:  uv run python scripts/diagnose_smoke.py
Cost: one diagnose() call with 10 drawn frames, of which diagnose() sends 8
(Token Factory's per-prompt image limit), 256x256 (plus one retry if the first
reply is invalid), then, only if no retry happened, one text-only calibration
call (max_tokens=1) with the same prompt, so tokens per image can be computed
exactly. Expected well under $0.02 total; refuses to run once usage_log.jsonl
holds MAX_LIVE_CALLS nemotron-vl calls.

The frames are a red square (the carried cube) moving toward a blue square (the
bin); the red square holds still from t=1.0 to t=1.9 s. Frame times appear only in the PNG
filenames; diagnose() captions each image with its time.
"""

from __future__ import annotations

import json
import struct
import sys
import zlib
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

from app.ai.diagnose import DiagnosisError, build_diagnosis_prompt, diagnose, select_frames  # noqa: E402
from demo_pipeline.schemas import MetricsWindow  # noqa: E402
from nebius_llm import TokenFactoryError, chat_vision_images  # noqa: E402
from nebius_llm.config import get_vision_model  # noqa: E402
from nebius_llm.usage import _log_path  # noqa: E402

TASK = "pick up the red cube and place it in the blue bin"
SIZE = 256
N_FRAMES = 10
DURATION = 3.0
PAUSE = (1.0, 1.9)
MAX_LIVE_CALLS = 3
OUT_DIR = Path("data/smoke_diagnose")
TIER = "vision:nemotron-vl"


def png_bytes(pixels: list[list[tuple[int, int, int]]]) -> bytes:
    """Encode an RGB image (rows of (r, g, b)) as PNG with the stdlib only."""
    height, width = len(pixels), len(pixels[0])
    raw = b"".join(b"\x00" + bytes(c for px in row for c in px) for row in pixels)

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


def progress(t: float) -> float:
    """Fraction of the carry done at time t: moves, holds still during PAUSE, then moves again."""
    moving = DURATION - (PAUSE[1] - PAUSE[0])
    if t < PAUSE[0]:
        done = t
    elif t < PAUSE[1]:
        done = PAUSE[0]
    else:
        done = t - (PAUSE[1] - PAUSE[0])
    return done / moving


def draw_frame(t: float) -> bytes:
    bg, red, blue = (215, 215, 215), (220, 30, 30), (30, 60, 220)
    pixels = [[bg] * SIZE for _ in range(SIZE)]

    def square(cx: int, cy: int, half: int, color: tuple[int, int, int]) -> None:
        for y in range(max(0, cy - half), min(SIZE, cy + half)):
            for x in range(max(0, cx - half), min(SIZE, cx + half)):
                pixels[y][x] = color

    square(200, 128, 34, blue)
    square(40 + round(progress(t) * 160), 128, 14, red)
    return png_bytes(pixels)


def fake_windows() -> list[MetricsWindow]:
    """Six 0.5 s windows of a carry (gripper closed, cube in hand), with the pause in windows 3-4."""
    speeds = [0.12, 0.12, 0.0, 0.028, 0.12, 0.11]  # the pause covers 1.0-1.9 s
    return [
        MetricsWindow(
            t0=i * 0.5, t1=(i + 1) * 0.5, speed=s, jerk_rms=0.8, gripper=1, dist_ee_cube=0.0,
            cube_height=0.12, contact_gripper_cube=True, contact_arm_bin=False, contact_arm_table=False,
        )
        for i, s in enumerate(speeds)
    ]


def read_log() -> list[dict]:
    path = _log_path()
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def vl_calls(entries: list[dict]) -> list[dict]:
    return [e for e in entries if e.get("tier") == TIER]


def main() -> int:
    before = read_log()
    if len(vl_calls(before)) >= MAX_LIVE_CALLS:
        print(f"REFUSED: {_log_path()} already has {len(vl_calls(before))} {TIER} calls (cap {MAX_LIVE_CALLS}).")
        return 1

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    frames = []
    for i in range(N_FRAMES):
        t = DURATION * i / (N_FRAMES - 1)
        png = draw_frame(t)
        (OUT_DIR / f"frame_{i:02d}_t{t:.3f}.png").write_bytes(png)
        frames.append((t, png))
    windows = fake_windows()
    print(f"Wrote {N_FRAMES} frames ({SIZE}x{SIZE}) to {OUT_DIR}; model {get_vision_model('nemotron-vl').model_id}")

    diagnosis, error = None, None
    try:
        diagnosis = diagnose(frames, None, windows, TASK, replay_success=True, duration=DURATION)
    except (DiagnosisError, TokenFactoryError) as e:
        error = e

    diag_calls = vl_calls(read_log()[len(before):])
    for n, e in enumerate(diag_calls, start=1):
        print(
            f"diagnose call {n}: model={e['model']} prompt_tokens={e['prompt_tokens']} "
            f"completion_tokens={e['completion_tokens']} cost=${e['est_cost_usd']:.6f} "
            f"latency={e['latency_s']}s finish={e['finish_reason']}"
        )
    if error is not None:
        print(f"\nFAILED: {type(error).__name__}: {error}")
        return 1

    print("\nDiagnosis:")
    print(diagnosis.model_dump_json(indent=2))
    print(f"\nValid JSON on first try: {len(diag_calls) == 1}")
    pause_found = any(
        i.type == "pause" and i.t0 is not None and i.t0 < PAUSE[1] and i.t1 > PAUSE[0] for i in diagnosis.issues
    )
    remove_pause = [r for r in diagnosis.repairs if r.op == "remove_pause"]
    print(f"Pause issue overlapping {PAUSE}: {pause_found}; remove_pause repairs: {[r.model_dump() for r in remove_pause]}")

    if len(diag_calls) == 1:
        # Same prompt, no images, 1 output token: its prompt_tokens is the text-only cost.
        sent = select_frames(frames, has_wrist_frame=False)
        prompt = build_diagnosis_prompt(TASK, windows, [t for t, _ in sent], False, True)
        text_only = chat_vision_images(
            prompt, [], tier="nemotron-vl", max_tokens=1,
            extra_body={"chat_template_kwargs": {"enable_thinking": False}},
        )
        per_image = (diag_calls[0]["prompt_tokens"] - text_only.prompt_tokens) / len(sent)
        print(
            f"\nCalibration call: text-only prompt_tokens={text_only.prompt_tokens} "
            f"cost=${text_only.est_cost_usd:.6f} -> {per_image:.1f} prompt tokens per {SIZE}x{SIZE} image"
        )

    run = vl_calls(read_log()[len(before):])
    print(f"\nThis run: {len(run)} calls, ${sum(e['est_cost_usd'] for e in run):.6f} estimated")
    print(f"All {TIER} calls in log: {len(vl_calls(read_log()))}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
