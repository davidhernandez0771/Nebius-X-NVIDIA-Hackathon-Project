"""Vision reply parsing: fail safe on invalid, partial and runaway output.
No network -- chat_vision is mocked."""
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace as NS
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from app.ai.vision import (  # noqa: E402
    MAX_CANDIDATES,
    _parse_candidates,
    _parse_with_status,
    itemize_photo_detailed,
)

GOOD = '[{"label": "lamp", "category": "decor", "count": 1, "uncertainty_note": ""}]'


class ParseTests(unittest.TestCase):
    def test_clean_array(self):
        cands, complete = _parse_with_status(GOOD)
        self.assertTrue(complete)
        self.assertEqual([c.label for c in cands], ["lamp"])

    def test_markdown_fence_and_prose(self):
        cands = _parse_candidates(f"Sure! Here you go:\n```json\n{GOOD}\n```\nHope that helps.")
        self.assertEqual([c.label for c in cands], ["lamp"])

    def test_truncated_mid_object_keeps_complete_items(self):
        raw = '[{"label": "lamp", "category": "decor", "count": 1, "uncertainty_note": ""}, {"label": "boo'
        cands, complete = _parse_with_status(raw)
        self.assertFalse(complete)
        self.assertEqual([c.label for c in cands], ["lamp"])

    def test_truncated_between_objects(self):
        raw = '[{"label": "a", "category": "x", "count": 2}, {"label": "b", "category": "x", "count": 1},'
        cands, complete = _parse_with_status(raw)
        self.assertFalse(complete)
        self.assertEqual([c.label for c in cands], ["a", "b"])

    def test_garbage_and_empty_never_raise(self):
        for raw in ["", "no json here", "{not: valid", "[", "[}", "null", '{"label": "x"}', None]:
            cands, _ = _parse_with_status(raw)
            self.assertEqual(cands, [], raw)

    def test_empty_array_is_complete(self):
        self.assertEqual(_parse_with_status("[]"), ([], True))

    def test_non_dict_and_blank_label_entries_skipped(self):
        cands = _parse_candidates('[1, "x", null, {"label": "  "}, {"label": "mug"}]')
        self.assertEqual([c.label for c in cands], ["mug"])

    def test_repetition_loop_is_deduped_and_capped(self):
        raw = "[" + ",".join('{"label": "book", "category": "books", "count": 1}' for _ in range(200))
        cands, complete = _parse_with_status(raw)
        self.assertFalse(complete)
        self.assertEqual(len(cands), 1)

    def test_many_distinct_items_capped(self):
        raw = "[" + ",".join(f'{{"label": "item{i}"}}' for i in range(100)) + "]"
        self.assertEqual(len(_parse_candidates(raw)), MAX_CANDIDATES)

    def test_bad_counts_are_sanitized(self):
        cands = _parse_candidates(
            '[{"label": "a", "count": "lots"}, {"label": "b", "count": -4}, {"label": "c", "count": 1e999}, {"label": "d", "count": 5000}]'
        )
        self.assertEqual([c.count for c in cands], [1, 1, 1, 99])

    def test_long_fields_are_clipped(self):
        cands = _parse_candidates('[{"label": "%s"}]' % ("x" * 500))
        self.assertLessEqual(len(cands[0].label), 80)


class MalformedObjectTests(unittest.TestCase):
    # Real MiniCPM-V-4.5 output (2026-09-19): the uncertainty_note key was dropped,
    # leaving a stray "" before the closing brace. Used to yield zero items.
    REAL = (
        '[{"label": "nightstand", "category": "furniture", "count": 1, ""}, '
        '{"label": "vase", "category": "decorative", "count": 1, ""}, '
        '{"label": "rug", "category": "flooring", "count": 1, ""}]'
    )

    def test_stray_empty_string_is_repaired(self):
        cands, complete = _parse_with_status(self.REAL)
        self.assertEqual([c.label for c in cands], ["nightstand", "vase", "rug"])
        self.assertTrue(complete)

    def test_unrepairable_object_is_skipped_not_fatal(self):
        raw = '[{"label": "a", "count": 1}, {"label": oops}, {"label": "c", "count": 2}]'
        cands, complete = _parse_with_status(raw)
        self.assertEqual([c.label for c in cands], ["a", "c"])
        self.assertFalse(complete)

    def test_braces_inside_strings_do_not_confuse_recovery(self):
        raw = '[{"label": "box {red}", "count": 1, ""}, {"label": "b"}]'
        self.assertEqual([c.label for c in _parse_candidates(raw)], ["box {red}", "b"])

    def test_truncated_after_bad_object_keeps_earlier_items(self):
        raw = '[{"label": "a", "count": 1, ""}, {"label": "b", "cou'
        cands, complete = _parse_with_status(raw)
        self.assertEqual([c.label for c in cands], ["a"])
        self.assertFalse(complete)


class DetailedTests(unittest.TestCase):
    def _run(self, text, finish):
        reply = NS(text=text, est_cost_usd=0.001, finish_reason=finish, prompt_tokens=700,
                   completion_tokens=700, latency_s=1.5, model="m")
        with patch("app.ai.vision.chat_vision", return_value=reply) as mock:
            result = itemize_photo_detailed(b"img")
        return result, mock

    def test_length_finish_is_flagged_but_salvaged(self):
        result, _ = self._run('[{"label": "lamp"}, {"label": "bo', "length")
        self.assertTrue(result.truncated)
        self.assertEqual([c.label for c in result.candidates], ["lamp"])
        self.assertTrue(result.warnings)

    def test_clean_stop_not_flagged(self):
        result, _ = self._run(GOOD, "stop")
        self.assertFalse(result.truncated)
        self.assertEqual(result.warnings, [])

    def test_output_is_capped_by_max_tokens(self):
        _, mock = self._run(GOOD, "stop")
        self.assertLessEqual(mock.call_args.kwargs["max_tokens"], 1024)


if __name__ == "__main__":
    unittest.main()
