"""Ask SANT: Nemotron only proposes one of the client's tools; anything that doesn't fit the
client's list comes back as no tool. Every Nemotron call is mocked -- no network, no spend."""
from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace as NS
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from fastapi.testclient import TestClient  # noqa: E402

from app.ai.ask import ToolSpec, build_prompt, parse  # noqa: E402
from app.main import app  # noqa: E402
from nebius_llm import TokenFactoryError  # noqa: E402

TOOLS = [
    ToolSpec("go_to_section", "Move the camera", ["top", "story", "workshop"]),
    ToolSpec("show_cartridges_with_tag", "Filter the spiral", ["record", "results"]),
    ToolSpec("start_tutorial", "Tour the workshop", None),
]
TOOLS_JSON = [{"name": t.name, "description": t.description, "values": t.values} for t in TOOLS]


class ParseTests(unittest.TestCase):
    def test_valid_call_with_and_without_an_argument(self):
        r = parse('{"tool": "show_cartridges_with_tag", "arg": "results", "reply": "Here are the results."}', TOOLS)
        self.assertEqual((r.tool, r.arg, r.reply), ("show_cartridges_with_tag", "results", "Here are the results."))
        r = parse('Sure: {"tool": "start_tutorial", "arg": "ignored", "reply": "Let me show you round."}', TOOLS)
        self.assertEqual((r.tool, r.arg), ("start_tutorial", None))

    def test_unknown_tools_and_values_become_no_tool(self):
        for raw in [
            '{"tool": "rm_rf", "arg": null, "reply": "x"}',
            '{"tool": "go_to_section", "arg": "lab", "reply": "x"}',
            '{"tool": "go_to_section", "arg": null, "reply": "x"}',
            '{"tool": 3, "arg": "top"}',
            "not json",
            "[1, 2]",
            "",
        ]:
            self.assertIsNone(parse(raw, TOOLS).tool, raw)

    def test_reply_is_one_short_line(self):
        r = parse(json.dumps({"tool": None, "arg": None, "reply": "a\nb   c" + "x" * 400}), TOOLS)
        self.assertNotIn("\n", r.reply)
        self.assertLessEqual(len(r.reply), 140)
        self.assertTrue(r.reply.startswith("a b c"))

    def test_prompt_lists_every_tool_and_its_values(self):
        p = build_prompt(TOOLS)
        self.assertIn("go_to_section", p)
        self.assertIn("top, story, workshop", p)
        self.assertIn("start_tutorial: Tour the workshop (no argument)", p)


class EndpointTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_returns_the_validated_call(self):
        reply = NS(text='{"tool": "go_to_section", "arg": "workshop", "reply": "Down to the workshop."}', est_cost_usd=0.00002)
        with patch("app.ai.ask.chat", return_value=reply) as m:
            res = self.client.post("/api/ask", json={"text": "show me the workshop", "tools": TOOLS_JSON})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["tool"], "go_to_section")
        self.assertEqual(res.json()["arg"], "workshop")
        self.assertEqual(m.call_args.kwargs["tier"], "nano")

    def test_model_errors_are_a_502_so_the_client_falls_back(self):
        with patch("app.ai.ask.chat", side_effect=TokenFactoryError("down")):
            res = self.client.post("/api/ask", json={"text": "hi", "tools": TOOLS_JSON})
        self.assertEqual(res.status_code, 502)

    def test_rejects_empty_text_and_no_tools(self):
        self.assertEqual(self.client.post("/api/ask", json={"text": "", "tools": TOOLS_JSON}).status_code, 422)
        self.assertEqual(self.client.post("/api/ask", json={"text": "hi", "tools": []}).status_code, 422)


if __name__ == "__main__":
    unittest.main()
