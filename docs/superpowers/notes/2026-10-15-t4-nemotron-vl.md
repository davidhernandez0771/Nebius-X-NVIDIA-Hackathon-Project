# Nemotron 3.5 Super VL: live smoke results (2026-10-15)

Script: `scripts/diagnose_smoke.py` (synthetic demo, one 0.9 s pause at t = 1.0–1.9 s,
6 metrics windows, 10 drawn 256×256 PNG frames).

## Model

- **Exact ID:** `nvidia/Nemotron-3.5-Super-VL` (the default in `VISION_TIERS["nemotron-vl"]`;
  the API echoed the same ID back).
- **Listing** (`GET /v1/models?verbose=true`, free): modality `text+image->text`,
  context 1,048,576, region us-north1, 2M tokens/min and 300 requests/min,
  `supported_sampling_parameters: []` (but `temperature=0.2` was accepted).
- **Price:** $0.30 per 1M prompt tokens, $0.90 per 1M completion tokens; `pricing.image = "0"`,
  so images are billed as prompt tokens.
- **Hard limit:** at most **8 images per prompt**. The first live call (10 images) failed with
  HTTP 400 `At most 8 image(s) may be provided in one prompt. (parameter=image)`.
  Spec 8.3's 10 front frames + 1 wrist frame do not fit, so `diagnose()` now subsamples to
  `MAX_IMAGES = 8` (7 front + wrist, or 8 front with no wrist frame).

## Measurements

| Call | Images | Prompt tokens | Completion tokens | Est. cost | Latency | Result |
|---|---|---|---|---|---|---|
| 1 | 10 | – | – | $0 (not logged) | – | HTTP 400, 8-image limit |
| 2 (diagnose) | 8 | 3,269 | 390 | $0.001332 | 2.52 s | valid, `finish_reason=stop` |
| 3 (calibration, text-only, `max_tokens=1`) | 0 | 1,165 | 1 | $0.000350 | 0.56 s | – |

- **Prompt tokens per 256×256 image:** (3,269 − 1,165) / 8 = **263 tokens**
  (≈ $0.000079 per image).
- **Cost per diagnose call:** ≈ **$0.0013** with 8 images. Total spend for this track: ≈ $0.0017.
- **Latency:** 2.5 s for a diagnose call with thinking off.

## Quality (one sample, synthetic input: treat as anecdotal)

- **JSON valid on the first try:** yes (no fences, no prose, passed `check_times`).
- **Pause found:** yes, partly. It reported `pause` at 1.0–1.5 s and `remove_pause(1.0, 1.5)`.
  The true pause is 1.0–1.9 s. The metrics table shows 0.000 m/s for 1.0–1.5 and 0.028 m/s for
  1.5–2.0, so with 0.5 s windows the end of the pause cannot be read off the table. The
  repairs pipeline should refine pause bounds from the per-step speed (the rules detector
  does this) rather than trust the model's window-aligned times.
- **Errors in the reply:**
  - Evidence says "gripper remains open", but the table says gripper = 1 (closed) throughout.
  - Two false `idle_start_end` issues (0–0.5 s and 2.5–3.0 s), although speed there is 0.12 /
    0.11 m/s. It seems to have read `dist_ee_cube = 0.000` (constant in this synthetic table)
    as "no motion".
  - So it proposed `trim(0.5, 2.5)`, which would cut real motion.
  - It invented approach/grasp/lift segments that the input (a pure carry) does not support.
- **Takeaway:** the format contract works (valid JSON, schema-checked, times in range), but
  the semantic judgement needs a realistic demo before we trust it. The synthetic table
  (constant `dist_ee_cube = 0`, no gripper events) is unlike a real demo, so this is a weak test.
  Re-test on the first real recorded episode, and keep the rules fallback as the safety net.
