# Vision model comparison (2026-09-19)

Prompt: `ITEMIZE_PROMPT` in `src/app/ai/vision.py`, `max_tokens=700`, no retries.
5 product/stock photos in `test-photos/` (git-ignored), run with `scripts/vision_eval.py`.

| | MiniCPM-V-4.5 | GLM-5.3-Flash |
|---|---|---|
| Calls that returned a usable list | 5 / 5 | 1 / 5 (2 timeouts at 120 s, 2 hit the 700-token limit with 0 items, 1 ok) |
| Avg latency (successful calls) | 2.8 s | 25.6 s (8-40 s) |
| Avg output tokens | 241 | 680 (mostly hitting the cap) |
| Cost per image (estimated) | ~$0.00066 | ~$0.0006 per call, but 4/5 wasted |
| `finish_reason=length` | 0 | 2 of 3 logged (+2 more with thinking disabled) |

GLM did no better with `enable_thinking=false` (both extra calls still hit the
limit, though the 4 items it did return on one photo were more specific than
MiniCPM's). Two timed-out GLM calls were never logged and may have been billed.

**Pick MiniCPM.** Spot check against two photos: kitchen shelf, MiniCPM found the
coffee maker, cup, bowl, plate, 3 bottles and cans (counted 4 cans, 3 visible);
nightstand, it found vase, frame, stone, plant, pillow, blanket but merged the two vases and
the dried-flower arrangement. Known weaknesses: occasional dropped
`uncertainty_note` key (repaired by the parser), inflated counts for crowded
shelves ("100 books"), and it still lists some fixtures/furniture despite the prompt.

The earlier `finish_reason=length` MiniCPM call in the log did not reproduce on
these photos with either the old or new prompt. Old-prompt output ran ~28 tokens
per item, so roughly 37+ items would hit 1024; the 20-item cap keeps replies near 560.
