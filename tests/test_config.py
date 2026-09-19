"""Offline checks: tier resolution and cost estimation."""
import unittest

from nebius_llm import TIERS, get_model
from nebius_llm.config import DEFAULT_TIER


class ConfigTests(unittest.TestCase):
    def test_default_tier_is_nano(self):
        self.assertEqual(DEFAULT_TIER, "nano")
        self.assertIs(get_model(None), TIERS["nano"])

    def test_get_model_resolves_known_tiers(self):
        for name in ("nano", "super", "ultra"):
            spec = get_model(name)
            self.assertEqual(spec.tier, name)

    def test_get_model_is_case_insensitive(self):
        self.assertIs(get_model("NANO"), TIERS["nano"])

    def test_get_model_rejects_unknown_tier(self):
        with self.assertRaises(ValueError):
            get_model("giant")

    def test_estimate_cost_uses_per_million_pricing(self):
        spec = TIERS["nano"]
        cost = spec.estimate_cost(1_000_000, 1_000_000)
        self.assertAlmostEqual(cost, spec.input_price_per_m + spec.output_price_per_m)


if __name__ == "__main__":
    unittest.main()
