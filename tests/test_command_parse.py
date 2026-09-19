"""Command parsing: the model only proposes; the parser rejects incomplete or
malformed proposals as "unknown". No network."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from app.ai.commands import _parse  # noqa: E402


class ParseCommandTests(unittest.TestCase):
    def test_complete_trash(self):
        p = _parse('{"action": "trash", "item_name": " lamp ", "location_name": null, "question": null}')
        self.assertEqual((p.action, p.item_name), ("trash", "lamp"))

    def test_fenced_json_with_prose(self):
        p = _parse('Sure:\n```json\n{"action": "organize", "location_name": "desk"}\n```')
        self.assertEqual((p.action, p.location_name), ("organize", "desk"))

    def test_incomplete_actions_become_unknown(self):
        for raw in [
            '{"action": "trash", "item_name": null}',
            '{"action": "trash", "item_name": "   "}',
            '{"action": "move", "item_name": "lamp", "location_name": null}',
            '{"action": "move", "item_name": null, "location_name": "desk"}',
            '{"action": "query", "question": null}',
        ]:
            self.assertEqual(_parse(raw).action, "unknown", raw)

    def test_invalid_or_hostile_output_is_unknown(self):
        for raw in ["", "I can't do that", "{broken", "[1, 2]", '{"action": "rm -rf"}', '{"action": 5}',
                    '{"action": "trash", "item_name": 12}']:
            self.assertEqual(_parse(raw).action, "unknown", raw)


if __name__ == "__main__":
    unittest.main()
