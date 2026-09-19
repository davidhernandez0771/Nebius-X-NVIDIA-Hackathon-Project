"""Offline checks: the JSONL usage log never raises and totals correctly."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from nebius_llm.usage import record_usage, total_spend


class UsageTests(unittest.TestCase):
    def _with_log(self, path):
        return patch.dict("os.environ", {"USAGE_LOG_PATH": str(path)})

    def test_total_spend_on_missing_file_is_zero(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self._with_log(Path(tmp) / "no_such_file.jsonl"):
                totals = total_spend()
        self.assertEqual(totals["calls"], 0)
        self.assertEqual(totals["est_cost_usd"], 0.0)

    def test_record_and_sum_across_tiers(self):
        with tempfile.TemporaryDirectory() as tmp:
            log_path = Path(tmp) / "usage_log.jsonl"
            with self._with_log(log_path):
                record_usage({"tier": "nano", "prompt_tokens": 10, "completion_tokens": 5, "est_cost_usd": 0.001})
                record_usage({"tier": "ultra", "prompt_tokens": 20, "completion_tokens": 10, "est_cost_usd": 0.05})
                totals = total_spend()

            self.assertEqual(totals["calls"], 2)
            self.assertAlmostEqual(totals["est_cost_usd"], 0.051)
            self.assertEqual(totals["by_tier"]["nano"]["calls"], 1)
            self.assertEqual(totals["by_tier"]["ultra"]["prompt_tokens"], 20)

            lines = log_path.read_text().splitlines()
            self.assertEqual(len(lines), 2)
            self.assertIn("ts", json.loads(lines[0]))

    def test_record_usage_never_raises_on_bad_path(self):
        with self._with_log("/nonexistent-dir-xyz/usage_log.jsonl"):
            record_usage({"tier": "nano"})  # must not raise


if __name__ == "__main__":
    unittest.main()
